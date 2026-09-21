import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, StyleSheet, ScrollView, Linking, Platform } from 'react-native';
import { List, Switch, Text, TextInput, Surface, Button, HelperText } from 'react-native-paper';
import { NotificationPreferencesRepository } from '../../../infrastructure/notifications/NotificationPreferencesRepository';
import { LocalNotificationScheduler } from '../../../infrastructure/notifications/LocalNotificationScheduler';
import * as Notifications from 'expo-notifications';
import { useNotificationStore } from '../../stores/notificationStore';
import { rearmBudgetNudges } from '../../boot/eveningLogPrompt';
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

  // UX2-15c: locally-controlled time inputs — allow empty, validate on blur
  const [hourInput, setHourInput] = useState(String(preferences.eveningLogPromptHour));
  const [minuteInput, setMinuteInput] = useState(String(preferences.eveningLogPromptMinute));
  const [hourError, setHourError] = useState<string | null>(null);
  const [minuteError, setMinuteError] = useState<string | null>(null);
  // SET-3: these useState initializers only seed the inputs from the store
  // ONCE, at first mount — but the store hydrates asynchronously (e.g. from
  // AsyncStorage) after mount, so opening this screen right after cold start
  // showed defaults that never resynced once the real values loaded. Track
  // focus so the resync below never clobbers what the user is mid-typing.
  const [hourFocused, setHourFocused] = useState(false);
  const [minuteFocused, setMinuteFocused] = useState(false);
  // Whether the user actually TYPED in the field during this focus. A field
  // that was only tapped must not be persisted on blur: if the store
  // hydrated meanwhile, that would write the stale pre-hydration value back
  // over the real preference.
  const hourEditedRef = useRef(false);
  const minuteEditedRef = useRef(false);

  useEffect(() => {
    if (!hourFocused) setHourInput(String(preferences.eveningLogPromptHour));
  }, [preferences.eveningLogPromptHour, hourFocused]);

  useEffect(() => {
    if (!minuteFocused) setMinuteInput(String(preferences.eveningLogPromptMinute));
  }, [preferences.eveningLogPromptMinute, minuteFocused]);

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
      // VAL2-11: pull-back nudges — `rearmBudgetNudges` reads current
      // preferences straight back out of the store (already updated above
      // via `setPreferences`), so it arms whichever of the two is enabled;
      // an explicitly-disabled one is cancelled here, same pattern as the
      // other toggles in this screen.
      if (updated.periodClosingNudgeEnabled || updated.weeklyCheckInNudgeEnabled) {
        await rearmBudgetNudges();
      }
      if (!updated.periodClosingNudgeEnabled) {
        await scheduler.cancelPeriodClosingNudge();
      }
      if (!updated.weeklyCheckInNudgeEnabled) {
        await scheduler.cancelWeeklyCheckIn();
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
    <ScrollView
      style={[styles.screen, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.container}
    >
      {!permissionsGranted && (
        <Surface
          style={[styles.permWarning, { backgroundColor: colors.warningContainer }]}
          elevation={0}
        >
          <Text variant="bodySmall" style={[styles.permWarningText, { color: colors.warning }]}>
            Notification permissions not granted. Enable in device Settings to receive reminders.
          </Text>
          {Platform.OS !== 'web' && (
            <Button
              mode="outlined"
              textColor={colors.warning}
              onPress={() => Linking.openSettings()}
              accessibilityLabel="Open notification settings"
              testID="open-notification-settings"
              style={styles.permWarningButton}
            >
              Open settings
            </Button>
          )}
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
            <View>
              <View style={styles.timeRow}>
                <View style={{ flex: 1 }}>
                  <TextInput
                    label="Hour (0-23)"
                    value={hourInput}
                    onChangeText={(v) => {
                      hourEditedRef.current = true;
                      setHourInput(v);
                    }}
                    onFocus={() => {
                      hourEditedRef.current = false;
                      setHourFocused(true);
                    }}
                    onBlur={() => {
                      setHourFocused(false);
                      if (!hourEditedRef.current) {
                        setHourError(null);
                        return;
                      }
                      if (hourInput === '') {
                        setHourError(null);
                        return;
                      }
                      const n = parseInt(hourInput, 10);
                      if (isNaN(n) || n < 0 || n > 23) {
                        setHourError('Enter an hour from 0 to 23');
                      } else {
                        setHourError(null);
                        debouncedUpdatePref({ eveningLogPromptHour: n });
                      }
                    }}
                    keyboardType="numeric"
                    mode="outlined"
                    style={{ backgroundColor: colors.surface }}
                    testID="evening-hour-input"
                  />
                  {hourError && (
                    <HelperText type="error" visible testID="hour-error">
                      {hourError}
                    </HelperText>
                  )}
                </View>
                <View style={{ flex: 1, marginLeft: 8 }}>
                  <TextInput
                    label="Minute (0-59)"
                    value={minuteInput}
                    onChangeText={(v) => {
                      minuteEditedRef.current = true;
                      setMinuteInput(v);
                    }}
                    onFocus={() => {
                      minuteEditedRef.current = false;
                      setMinuteFocused(true);
                    }}
                    onBlur={() => {
                      setMinuteFocused(false);
                      if (!minuteEditedRef.current) {
                        setMinuteError(null);
                        return;
                      }
                      if (minuteInput === '') {
                        setMinuteError(null);
                        return;
                      }
                      const n = parseInt(minuteInput, 10);
                      if (isNaN(n) || n < 0 || n > 59) {
                        setMinuteError('Enter minutes from 0 to 59');
                      } else {
                        setMinuteError(null);
                        debouncedUpdatePref({ eveningLogPromptMinute: n });
                      }
                    }}
                    keyboardType="numeric"
                    mode="outlined"
                    style={{ backgroundColor: colors.surface }}
                    testID="evening-minute-input"
                  />
                  {minuteError && (
                    <HelperText type="error" visible testID="minute-error">
                      {minuteError}
                    </HelperText>
                  )}
                </View>
              </View>
              {hourInput !== '' && minuteInput !== '' && !hourError && !minuteError && (
                <Text
                  variant="bodySmall"
                  style={[
                    styles.timePreview,
                    { color: colors.onSurfaceVariant, marginTop: spacing.sm },
                  ]}
                  testID="time-preview"
                >
                  Reminder at {String(parseInt(hourInput, 10)).padStart(2, '0')}:
                  {String(parseInt(minuteInput, 10)).padStart(2, '0')}
                </Text>
              )}
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
            title="Payday reminder"
            description="A nudge on payday to set up the month's budget."
            right={() => (
              <Switch
                value={preferences.monthStartPreflightEnabled}
                onValueChange={(v) => updatePref({ monthStartPreflightEnabled: v })}
                color={colors.primary}
              />
            )}
          />
          <List.Item
            title="Payday countdown"
            description="A nudge 3 days before payday with how much is left across your envelopes."
            right={() => (
              <Switch
                value={preferences.periodClosingNudgeEnabled}
                onValueChange={(v) => updatePref({ periodClosingNudgeEnabled: v })}
                color={colors.primary}
                testID="period-closing-nudge-toggle"
              />
            )}
          />
          <List.Item
            title="Weekly check-in"
            description="Every Sunday, a summary of what you spent this week and how many envelopes are on track."
            right={() => (
              <Switch
                value={preferences.weeklyCheckInNudgeEnabled}
                onValueChange={(v) => updatePref({ weeklyCheckInNudgeEnabled: v })}
                color={colors.primary}
                testID="weekly-checkin-nudge-toggle"
              />
            )}
          />
        </Surface>
      </List.Section>

      <List.Section>
        <List.Subheader style={[styles.subheader, { color: colors.onSurfaceVariant }]}>
          Household Activity
        </List.Subheader>
        <Surface style={[styles.section, { backgroundColor: colors.surface }]} elevation={0}>
          <List.Item
            title="Household activity"
            description="Push your partner when you log a transaction, go over budget, or confirm a slip. There is no server-side receiving preference yet — this only controls what THIS device sends."
            right={() => (
              <Switch
                value={preferences.householdActivityEnabled}
                onValueChange={(v) => updatePref({ householdActivityEnabled: v })}
                color={colors.primary}
              />
            )}
          />
        </Surface>
      </List.Section>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1 },
  container: { padding: spacing.base },
  permWarning: {
    padding: spacing.base,
    borderRadius: radius.md,
    marginBottom: spacing.base,
  },
  permWarningText: {},
  permWarningButton: { marginTop: spacing.sm },
  subheader: { letterSpacing: 1 },
  section: { borderRadius: radius.md, marginBottom: spacing.sm },
  timeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.base,
    paddingBottom: spacing.sm,
  },
  timePreview: {},
  dayRow: { paddingHorizontal: spacing.base, paddingBottom: spacing.sm },
  dayInput: {},
});
