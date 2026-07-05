import React, { useCallback, useRef } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { List, Switch, Divider, Text, TextInput, Surface } from 'react-native-paper';
import { NotificationPreferencesRepository } from '../../../infrastructure/notifications/NotificationPreferencesRepository';
import { LocalNotificationScheduler } from '../../../infrastructure/notifications/LocalNotificationScheduler';
import * as Notifications from 'expo-notifications';
import { useNotificationStore } from '../../stores/notificationStore';
import { radius, spacing } from '../../theme/tokens';
import { useAppTheme } from '../../theme/useAppTheme';
import { useAppStore } from '../../stores/appStore';
import type { NotificationPreferences } from '../../../infrastructure/notifications/NotificationPreferences';
import type { NotificationPreferencesScreenProps } from '../../navigation/types';

const repo = new NotificationPreferencesRepository();
const scheduler = new LocalNotificationScheduler();

export const NotificationPreferencesScreen: React.FC<NotificationPreferencesScreenProps> = () => {
  const { colors } = useAppTheme();
  const { preferences, setPreferences, permissionsGranted } = useNotificationStore();
  const paydayDay = useAppStore((s) => s.paydayDay);
  // L10 fix: one timer PER FIELD (keyed by the update's own key), not one
  // shared timer for the whole screen — a shared timer meant editing hour
  // then minute within the debounce window cleared hour's pending callback
  // before it ever fired, silently dropping that edit.
  const debounceTimers = useRef<
    Partial<Record<keyof NotificationPreferences, ReturnType<typeof setTimeout>>>
  >({});

  const updatePref = async (update: Partial<NotificationPreferences>): Promise<void> => {
    // L10 fix: merge against the FRESHEST store state (read via getState()),
    // not the `preferences` closed over at render time. With per-field
    // debounce timers, two fields edited within the debounce window each
    // schedule their own callback from the SAME render's `preferences`
    // snapshot; if we merged against that stale closure, the field whose
    // timer fires second would still clobber the first field's already-
    // persisted change back to its old value.
    const latest = useNotificationStore.getState().preferences;
    const updated = { ...latest, ...update };
    setPreferences(updated);
    await repo.save(updated);

    if (permissionsGranted) {
      if (updated.eveningLogPromptEnabled) {
        await scheduler.scheduleEveningLogPrompt(
          updated.eveningLogPromptHour,
          updated.eveningLogPromptMinute,
        );
      } else {
        await Notifications.cancelScheduledNotificationAsync('evening-log').catch(() => {});
      }
      if (updated.meterReadingReminderEnabled) {
        await scheduler.scheduleMeterReadingReminder(updated.meterReadingReminderDay);
      } else {
        await Notifications.cancelScheduledNotificationAsync('meter-reading').catch(() => {});
      }
      if (updated.monthStartPreflightEnabled) {
        await scheduler.scheduleMonthStartPreflight(paydayDay);
      } else {
        await Notifications.cancelScheduledNotificationAsync('month-start').catch(() => {});
      }
    }
  };

  const debouncedUpdatePref = useCallback(
    (update: Partial<NotificationPreferences>) => {
      // Each call site passes a single-key partial (e.g. {eveningLogPromptHour}),
      // so the update's own key is a stable per-field timer slot.
      const keys = Object.keys(update) as Array<keyof NotificationPreferences>;
      const key = keys[0];
      if (!key) return;
      const timers = debounceTimers.current;
      const existing = timers[key];
      if (existing) clearTimeout(existing);
      timers[key] = setTimeout(() => void updatePref(update), 600);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [permissionsGranted, paydayDay],
  );

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {!permissionsGranted && (
        <Surface
          style={[styles.permWarning, { backgroundColor: colors.warningContainer }]}
          elevation={0}
        >
          <Text variant="bodySmall" style={[styles.permWarningText, { color: colors.warning }]}>
            Notification permissions not granted. Enable in device Settings to receive reminders.
          </Text>
        </Surface>
      )}

      <List.Section>
        <List.Subheader style={[styles.subheader, { color: colors.onSurfaceVariant }]}>
          Daily Log Prompt
        </List.Subheader>
        <Surface style={[styles.section, { backgroundColor: colors.surface }]} elevation={0}>
          <List.Item
            title="Evening log reminder"
            description="Daily prompt to log transactions"
            right={() => (
              <Switch
                value={preferences.eveningLogPromptEnabled}
                onValueChange={(v) => updatePref({ eveningLogPromptEnabled: v })}
                color={colors.primary}
              />
            )}
          />
          {preferences.eveningLogPromptEnabled && (
            <View style={styles.timeRow}>
              <TextInput
                label="Hour (0-23)"
                value={String(preferences.eveningLogPromptHour)}
                onChangeText={(v) => {
                  const n = parseInt(v, 10);
                  if (!isNaN(n) && n >= 0 && n <= 23)
                    debouncedUpdatePref({ eveningLogPromptHour: n });
                }}
                keyboardType="numeric"
                mode="outlined"
                style={[styles.timeInput, { backgroundColor: colors.surface }]}
              />
              <TextInput
                label="Minute (0-59)"
                value={String(preferences.eveningLogPromptMinute)}
                onChangeText={(v) => {
                  const n = parseInt(v, 10);
                  if (!isNaN(n) && n >= 0 && n <= 59)
                    debouncedUpdatePref({ eveningLogPromptMinute: n });
                }}
                keyboardType="numeric"
                mode="outlined"
                style={[styles.timeInput, { backgroundColor: colors.surface }]}
              />
            </View>
          )}
        </Surface>
      </List.Section>

      <List.Section>
        <List.Subheader style={[styles.subheader, { color: colors.onSurfaceVariant }]}>
          Meter Reading Reminder
        </List.Subheader>
        <Surface style={[styles.section, { backgroundColor: colors.surface }]} elevation={0}>
          <List.Item
            title="Monthly meter reminder"
            description="Prompt to log readings each month"
            right={() => (
              <Switch
                value={preferences.meterReadingReminderEnabled}
                onValueChange={(v) => updatePref({ meterReadingReminderEnabled: v })}
                color={colors.primary}
              />
            )}
          />
          {preferences.meterReadingReminderEnabled && (
            <View style={styles.dayRow}>
              <TextInput
                label="Day of month (1-28)"
                value={String(preferences.meterReadingReminderDay)}
                onChangeText={(v) => {
                  const n = parseInt(v, 10);
                  if (!isNaN(n) && n >= 1 && n <= 28)
                    debouncedUpdatePref({ meterReadingReminderDay: n });
                }}
                keyboardType="numeric"
                mode="outlined"
                style={[styles.dayInput, { backgroundColor: colors.surface }]}
              />
            </View>
          )}
        </Surface>
      </List.Section>

      <List.Section>
        <List.Subheader style={[styles.subheader, { color: colors.onSurfaceVariant }]}>
          Budget Period
        </List.Subheader>
        <Surface style={[styles.section, { backgroundColor: colors.surface }]} elevation={0}>
          <List.Item
            title="Month-start pre-flight"
            description={`Reminder on payday (day ${paydayDay}) to fill envelopes`}
            right={() => (
              <Switch
                value={preferences.monthStartPreflightEnabled}
                onValueChange={(v) => updatePref({ monthStartPreflightEnabled: v })}
                color={colors.primary}
              />
            )}
          />
          <Divider />
          {/*
            L9 fix: envelopeWarningEnabled was a fully inert toggle — persisted
            but never read by any scheduler or notify-event call (no overspend
            alert mechanism exists yet, local or remote). Rather than leave a
            control that silently does nothing (a user enabling it believed
            they'd be alerted and never would be), it's disabled with an
            honest "coming soon" description until a real overspend-alert path
            is built. It intentionally still reads/displays the persisted
            preference value (so a future wiring pass doesn't need a data
            migration) but cannot be toggled.
          */}
          <List.Item
            title="Envelope overspend warning"
            description="Coming soon — not yet wired to an alert"
            right={() => (
              <Switch
                value={preferences.envelopeWarningEnabled}
                onValueChange={(v) => updatePref({ envelopeWarningEnabled: v })}
                disabled
                color={colors.primary}
                testID="envelope-warning-switch"
              />
            )}
            testID="envelope-warning-item"
          />
        </Surface>
      </List.Section>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { padding: spacing.base },
  permWarning: {
    padding: spacing.base,
    borderRadius: radius.md,
    marginBottom: spacing.base,
  },
  permWarningText: {},
  subheader: { letterSpacing: 1 },
  section: { borderRadius: radius.md, marginBottom: spacing.sm },
  timeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.base,
    paddingBottom: spacing.sm,
  },
  timeInput: { flex: 1 },
  dayRow: { paddingHorizontal: spacing.base, paddingBottom: spacing.sm },
  dayInput: {},
});
