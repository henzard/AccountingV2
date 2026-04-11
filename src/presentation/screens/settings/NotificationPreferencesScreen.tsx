import React, { useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { List, Switch, Divider, Text, TextInput, Surface } from 'react-native-paper';
import { NotificationPreferencesRepository } from '../../../infrastructure/notifications/NotificationPreferencesRepository';
import { LocalNotificationScheduler } from '../../../infrastructure/notifications/LocalNotificationScheduler';
import { useNotificationStore } from '../../stores/notificationStore';
import { colours, spacing } from '../../theme/tokens';
import { useAppStore } from '../../stores/appStore';
import type { NotificationPreferences } from '../../../infrastructure/notifications/NotificationPreferences';
import type { NotificationPreferencesScreenProps } from '../../navigation/types';

const repo = new NotificationPreferencesRepository();
const scheduler = new LocalNotificationScheduler();

export const NotificationPreferencesScreen: React.FC<NotificationPreferencesScreenProps> = () => {
  const { preferences, setPreferences, permissionsGranted } = useNotificationStore();
  const paydayDay = useAppStore((s) => s.paydayDay);
  const [saving, setSaving] = useState(false);

  const updatePref = async (update: Partial<NotificationPreferences>) => {
    const updated = { ...preferences, ...update };
    setPreferences(updated);
    setSaving(true);
    await repo.save(updated);

    if (permissionsGranted) {
      if (updated.eveningLogPromptEnabled) {
        await scheduler.scheduleEveningLogPrompt(updated.eveningLogPromptHour, updated.eveningLogPromptMinute);
      }
      if (updated.meterReadingReminderEnabled) {
        await scheduler.scheduleMeterReadingReminder(updated.meterReadingReminderDay);
      }
      if (updated.monthStartPreflightEnabled) {
        await scheduler.scheduleMonthStartPreflight(paydayDay);
      }
    }
    setSaving(false);
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {!permissionsGranted && (
        <Surface style={styles.permWarning} elevation={0}>
          <Text variant="bodySmall" style={styles.permWarningText}>
            Notification permissions not granted. Enable in device Settings to receive reminders.
          </Text>
        </Surface>
      )}

      <List.Section>
        <List.Subheader style={styles.subheader}>Daily Log Prompt</List.Subheader>
        <Surface style={styles.section} elevation={0}>
          <List.Item
            title="Evening log reminder"
            description="Daily prompt to log transactions"
            right={() => (
              <Switch
                value={preferences.eveningLogPromptEnabled}
                onValueChange={(v) => updatePref({ eveningLogPromptEnabled: v })}
                color={colours.primary}
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
                  if (!isNaN(n) && n >= 0 && n <= 23) updatePref({ eveningLogPromptHour: n });
                }}
                keyboardType="numeric"
                mode="outlined"
                style={styles.timeInput}
              />
              <TextInput
                label="Minute (0-59)"
                value={String(preferences.eveningLogPromptMinute)}
                onChangeText={(v) => {
                  const n = parseInt(v, 10);
                  if (!isNaN(n) && n >= 0 && n <= 59) updatePref({ eveningLogPromptMinute: n });
                }}
                keyboardType="numeric"
                mode="outlined"
                style={styles.timeInput}
              />
            </View>
          )}
        </Surface>
      </List.Section>

      <List.Section>
        <List.Subheader style={styles.subheader}>Meter Reading Reminder</List.Subheader>
        <Surface style={styles.section} elevation={0}>
          <List.Item
            title="Monthly meter reminder"
            description="Prompt to log readings each month"
            right={() => (
              <Switch
                value={preferences.meterReadingReminderEnabled}
                onValueChange={(v) => updatePref({ meterReadingReminderEnabled: v })}
                color={colours.primary}
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
                  if (!isNaN(n) && n >= 1 && n <= 28) updatePref({ meterReadingReminderDay: n });
                }}
                keyboardType="numeric"
                mode="outlined"
                style={styles.dayInput}
              />
            </View>
          )}
        </Surface>
      </List.Section>

      <List.Section>
        <List.Subheader style={styles.subheader}>Budget Period</List.Subheader>
        <Surface style={styles.section} elevation={0}>
          <List.Item
            title="Month-start pre-flight"
            description={`Reminder on payday (day ${paydayDay}) to fill envelopes`}
            right={() => (
              <Switch
                value={preferences.monthStartPreflightEnabled}
                onValueChange={(v) => updatePref({ monthStartPreflightEnabled: v })}
                color={colours.primary}
              />
            )}
          />
          <Divider />
          <List.Item
            title="Envelope overspend warning"
            description="Alert when an envelope nears its limit"
            right={() => (
              <Switch
                value={preferences.envelopeWarningEnabled}
                onValueChange={(v) => updatePref({ envelopeWarningEnabled: v })}
                color={colours.primary}
              />
            )}
          />
        </Surface>
      </List.Section>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { padding: spacing.base },
  permWarning: {
    backgroundColor: colours.warningContainer,
    padding: spacing.base,
    borderRadius: 8,
    marginBottom: spacing.base,
  },
  permWarningText: { color: colours.warning },
  subheader: { color: colours.onSurfaceVariant, letterSpacing: 1 },
  section: { backgroundColor: colours.surface, borderRadius: 8, marginBottom: spacing.sm },
  timeRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.base, paddingBottom: spacing.sm },
  timeInput: { flex: 1, backgroundColor: colours.surface },
  dayRow: { paddingHorizontal: spacing.base, paddingBottom: spacing.sm },
  dayInput: { backgroundColor: colours.surface },
});
