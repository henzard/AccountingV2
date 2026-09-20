import React, { useState, useEffect } from 'react';
import { View, ScrollView, StyleSheet, Switch } from 'react-native';
import {
  List,
  Surface,
  Divider,
  Button,
  SegmentedButtons,
  Portal,
  Dialog,
  TextInput,
  HelperText,
  Text,
} from 'react-native-paper';
import { useThemeStore } from '../../stores/themeStore';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAppStore } from '../../stores/appStore';
import { useToastStore } from '../../stores/toastStore';
import { supabase } from '../../../data/remote/supabaseClient';
import { db } from '../../../data/local/db';
import { UpdateHouseholdPaydayDayUseCase } from '../../../domain/households/UpdateHouseholdPaydayDayUseCase';
import { confirm } from '../../components/shared/ConfirmDialogHost';
import { unregisterFcmToken } from '../../../infrastructure/notifications/FcmTokenRegistrar';
import { radius, spacing, fontSize } from '../../theme/tokens';
import { useAppTheme } from '../../theme/useAppTheme';
import type { SettingsScreenProps, RootStackParamList } from '../../navigation/types';

const WIFI_ONLY_KEY = '@settings:slip_wifi_only';

export const SettingsScreen: React.FC<SettingsScreenProps> = ({ navigation }) => {
  const { colors } = useAppTheme();
  const session = useAppStore((s) => s.session);
  const email = session?.user?.email ?? 'Unknown';
  const householdId = useAppStore((s) => s.householdId);
  const availableHouseholds = useAppStore((s) => s.availableHouseholds);
  const currentHousehold = availableHouseholds.find((h) => h.id === householdId);
  const userLevel = useAppStore((s) => s.userLevel);
  const levelLabels: Record<number, string> = { 1: 'Learner', 2: 'Practitioner', 3: 'Mentor' };
  const levelLabel = levelLabels[userLevel] ?? 'Learner';

  const themePref = useThemeStore((s) => s.preference);
  const setThemePref = useThemeStore((s) => s.setPreference);
  const userId = session?.user?.id;

  const paydayDay = useAppStore((s) => s.paydayDay);
  const setPaydayDay = useAppStore((s) => s.setPaydayDay);
  const enqueue = useToastStore((s) => s.enqueue);

  const [wifiOnly, setWifiOnly] = useState(false);

  const [paydayDialogVisible, setPaydayDialogVisible] = useState(false);
  const [paydayDayInput, setPaydayDayInput] = useState(String(paydayDay));
  const [paydayError, setPaydayError] = useState<string | null>(null);
  const [paydaySaving, setPaydaySaving] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(WIFI_ONLY_KEY).then((v) => setWifiOnly(v === 'true'));
  }, []);

  const handleWifiOnlyToggle = async (value: boolean): Promise<void> => {
    setWifiOnly(value);
    await AsyncStorage.setItem(WIFI_ONLY_KEY, String(value));
  };

  const rootNavigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const handleSignOut = async (): Promise<void> => {
    // M17 fix: clear this device's FCM token BEFORE signing out — the
    // delete relies on RLS (user_id = auth.uid()), which needs the
    // still-authenticated session. Without this, a shared device's next
    // user would silently keep receiving the previous user's push
    // notifications (the FCM token identifies the device install, not the
    // signed-in user, and survives a user switch otherwise).
    if (userId) {
      await unregisterFcmToken(userId);
    }
    await supabase.auth.signOut();
    // reset() is owned by the onAuthStateChange listener in App.tsx — it runs
    // on any sign-out (including token expiry) so we don't duplicate it here.
  };

  const confirmSignOut = async (): Promise<void> => {
    const confirmed = await confirm({
      title: 'Sign out?',
      message: 'You will need to sign in again to access your data.',
      confirmLabel: 'Sign out',
      destructive: true,
    });
    if (confirmed) {
      await handleSignOut();
    }
  };

  const openPaydayDialog = (): void => {
    setPaydayDayInput(String(paydayDay));
    setPaydayError(null);
    setPaydayDialogVisible(true);
  };

  const handleSavePaydayDay = async (): Promise<void> => {
    setPaydayError(null);
    const day = Number.parseInt(paydayDayInput, 10);
    if (!Number.isInteger(day) || String(day) !== paydayDayInput.trim() || day < 1 || day > 28) {
      setPaydayError('Enter a day between 1 and 28');
      return;
    }
    if (!householdId) return;

    setPaydaySaving(true);
    try {
      const uc = new UpdateHouseholdPaydayDayUseCase(db, householdId, day);
      const result = await uc.execute();
      if (!result.success) {
        setPaydayError(result.error.message);
        return;
      }
      setPaydayDay(day);
      setPaydayDialogVisible(false);
      const { collidedEnvelopeCount } = result.data;
      enqueue(
        collidedEnvelopeCount > 0
          ? `Payday updated. ${collidedEnvelopeCount} envelope${collidedEnvelopeCount === 1 ? '' : 's'} already existed in the new month and were left as they were.`
          : 'Payday updated',
        'success',
      );
    } catch (e) {
      setPaydayError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setPaydaySaving(false);
    }
  };

  return (
    <ScrollView
      style={[styles.flex, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
    >
      <List.Section>
        <List.Subheader style={styles.subheader}>Household</List.Subheader>
        <Surface style={[styles.section, { backgroundColor: colors.surface }]} elevation={0}>
          <List.Item
            title={currentHousehold?.name ?? 'My Household'}
            description="Active household"
            left={(props) => <List.Icon {...props} icon="home-outline" />}
            right={() => (
              <View style={[styles.levelBadge, { backgroundColor: colors.primaryContainer }]}>
                <List.Subheader
                  style={[styles.levelText, { color: colors.onPrimaryContainer }]}
                  testID="level-badge"
                >
                  {`Lv${userLevel} ${levelLabel}`}
                </List.Subheader>
              </View>
            )}
          />
          <Divider />
          <List.Item
            title="Household members"
            description="See who is in this household, remove members, or leave"
            left={(props) => <List.Icon {...props} icon="account-group-outline" />}
            right={(props) => <List.Icon {...props} icon="chevron-right" />}
            onPress={() =>
              rootNavigation.navigate('HouseholdMembers', {
                householdId: householdId!,
                householdName: currentHousehold?.name ?? 'My Household',
              })
            }
            testID="household-members-row"
          />
          <Divider />
          <List.Item
            title="Invite Member"
            description="Share an invite code"
            left={(props) => <List.Icon {...props} icon="account-plus-outline" />}
            right={(props) => <List.Icon {...props} icon="chevron-right" />}
            onPress={() =>
              rootNavigation.navigate('ShareInvite', {
                householdId: householdId!,
                householdName: currentHousehold?.name ?? 'My Household',
              })
            }
          />
          <Divider />
          <List.Item
            title="Join a Household"
            description="Enter an invite code"
            left={(props) => <List.Icon {...props} icon="account-multiple-plus-outline" />}
            right={(props) => <List.Icon {...props} icon="chevron-right" />}
            onPress={() => rootNavigation.navigate('JoinHousehold')}
          />
          <Divider />
          <List.Item
            title="Payday"
            description={`Day ${paydayDay} of the month`}
            left={(props) => <List.Icon {...props} icon="calendar-month-outline" />}
            right={(props) => <List.Icon {...props} icon="chevron-right" />}
            onPress={openPaydayDialog}
            testID="payday-day-item"
          />
          {availableHouseholds.length > 1 && (
            <>
              <Divider />
              <List.Item
                title="Switch Household"
                description={`${availableHouseholds.length} households available`}
                left={(props) => <List.Icon {...props} icon="swap-horizontal" />}
                right={(props) => <List.Icon {...props} icon="chevron-right" />}
                onPress={() => rootNavigation.navigate('HouseholdPicker')}
              />
            </>
          )}
        </Surface>
      </List.Section>
      <Surface style={[styles.section, { backgroundColor: colors.surface }]} elevation={0}>
        <List.Item
          title={email}
          description="Signed in account"
          left={(props) => <List.Icon {...props} icon="account-circle-outline" />}
        />
        <Divider />
        <List.Item
          title="Notifications"
          description="Manage reminders and alerts"
          left={(props) => <List.Icon {...props} icon="bell-outline" />}
          right={(props) => <List.Icon {...props} icon="chevron-right" />}
          onPress={() => navigation.navigate('NotificationPreferences')}
        />
        <Divider />
        <List.Item
          title="Sync status"
          description="Sync status, pending changes, and items needing attention"
          left={(props) => <List.Icon {...props} icon="sync" />}
          right={(props) => <List.Icon {...props} icon="chevron-right" />}
          onPress={() => navigation.navigate('SyncHealth')}
          testID="sync-health-item"
        />
        {__DEV__ && (
          <>
            <Divider />
            <List.Item
              title="Crash log"
              description="Early-boot JS errors captured before Crashlytics"
              left={(props) => <List.Icon {...props} icon="bug-outline" />}
              right={(props) => <List.Icon {...props} icon="chevron-right" />}
              onPress={() => navigation.navigate('CrashLog')}
              testID="crash-log-item"
            />
          </>
        )}
      </Surface>

      {/* Slip scanning */}
      <List.Section>
        <List.Subheader style={styles.subheader}>Slip scanning</List.Subheader>
        <Surface style={[styles.section, { backgroundColor: colors.surface }]} elevation={0}>
          <List.Item
            title="Slip history"
            description="View scanned slips"
            left={(props) => <List.Icon {...props} icon="history" />}
            right={(props) => <List.Icon {...props} icon="chevron-right" />}
            onPress={() =>
              (navigation as unknown as { navigate: (s: string) => void }).navigate('SlipScanning')
            }
            testID="slip-history-item"
          />
          <Divider />
          <List.Item
            title="Privacy — Slip scanning consent"
            description="Manage your consent"
            left={(props) => <List.Icon {...props} icon="shield-account-outline" />}
            right={(props) => <List.Icon {...props} icon="chevron-right" />}
            onPress={() =>
              // M11 fix: 'SlipConsent' is not a route on this (Settings)
              // stack — it lives inside SlipScanningStackNavigator, nested
              // under the root 'SlipScanning' modal. Navigate through the
              // nested-navigator convention (same one the "Slip history"
              // row above uses for the root 'SlipScanning' route) so React
              // Navigation descends into that stack instead of bubbling an
              // unresolved action to the root (previously a silent no-op).
              (
                navigation as unknown as {
                  navigate: (screen: string, params?: unknown) => void;
                }
              ).navigate('SlipScanning', { screen: 'SlipConsent' })
            }
            testID="slip-consent-item"
          />
          <Divider />
          <List.Item
            title="Upload on Wi-Fi only"
            description="Slip images upload only when connected to Wi-Fi"
            left={(props) => <List.Icon {...props} icon="wifi" />}
            right={() => (
              <Switch
                value={wifiOnly}
                onValueChange={handleWifiOnlyToggle}
                testID="wifi-only-switch"
              />
            )}
            testID="wifi-only-item"
          />
        </Surface>
      </List.Section>

      <List.Section>
        <List.Subheader style={styles.subheader}>Appearance</List.Subheader>
        <Surface style={[styles.section, { backgroundColor: colors.surface }]} elevation={0}>
          <View style={styles.appearanceRow}>
            <SegmentedButtons
              value={themePref}
              onValueChange={(v): void => setThemePref(v as 'system' | 'light' | 'dark', userId)}
              buttons={[
                { value: 'system', label: 'System', testID: 'appearance-system' },
                { value: 'light', label: 'Light', testID: 'appearance-light' },
                { value: 'dark', label: 'Dark', testID: 'appearance-dark' },
              ]}
            />
          </View>
        </Surface>
      </List.Section>

      <View style={styles.signOutSection}>
        <Button
          mode="outlined"
          icon="logout"
          onPress={confirmSignOut}
          textColor={colors.error}
          style={[styles.signOutButton, { borderColor: colors.error }]}
          testID="sign-out-button"
        >
          Sign out
        </Button>
        <Button
          mode="text"
          onPress={() => navigation.navigate('DeleteAccount')}
          textColor={colors.error}
          accessibilityLabel="Delete account"
          testID="delete-account-row"
        >
          Delete account
        </Button>
      </View>

      <Portal>
        <Dialog
          visible={paydayDialogVisible}
          onDismiss={() => setPaydayDialogVisible(false)}
          testID="payday-dialog"
        >
          <Dialog.Title>Change payday</Dialog.Title>
          <Dialog.Content>
            <Text
              variant="bodyMedium"
              style={{ marginBottom: spacing.base, color: colors.onSurfaceVariant }}
            >
              Your current budget month will restart from this day.
            </Text>
            <TextInput
              label="Day of month (1–28)"
              value={paydayDayInput}
              onChangeText={setPaydayDayInput}
              keyboardType="numeric"
              mode="outlined"
              disabled={paydaySaving}
              testID="payday-day-input"
            />
            {paydayError !== null && (
              <HelperText type="error" visible testID="payday-error">
                {paydayError}
              </HelperText>
            )}
            {paydayError === null && (
              <HelperText type="info" visible testID="payday-helper">
                Paid on the 29th–31st or at month-end? Use 28.
              </HelperText>
            )}
          </Dialog.Content>
          <Dialog.Actions>
            <Button
              onPress={() => setPaydayDialogVisible(false)}
              disabled={paydaySaving}
              testID="payday-cancel"
            >
              Cancel
            </Button>
            <Button
              onPress={handleSavePaydayDay}
              loading={paydaySaving}
              disabled={paydaySaving}
              testID="payday-save"
            >
              Save
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingBottom: spacing.xxl },
  section: {
    marginTop: spacing.base,
    marginHorizontal: spacing.base,
    borderRadius: radius.md,
  },
  subheader: {
    marginHorizontal: spacing.base,
  },
  signOutSection: {
    marginTop: spacing.xl,
    marginHorizontal: spacing.base,
  },
  signOutButton: {},
  appearanceRow: {
    padding: spacing.base,
  },
  levelBadge: {
    alignSelf: 'center',
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    justifyContent: 'center',
  },
  levelText: {
    fontFamily: 'PlusJakartaSans_600SemiBold',
    fontSize: fontSize.xs,
    marginHorizontal: 0,
    paddingHorizontal: 0,
  },
});
