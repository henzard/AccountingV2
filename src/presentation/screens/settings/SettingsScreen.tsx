import React from 'react';
import { View, StyleSheet, Alert } from 'react-native';
import { List, Surface, Divider, Button } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAppStore } from '../../stores/appStore';
import { supabase } from '../../../data/remote/supabaseClient';
import { colours, spacing } from '../../theme/tokens';
import type { SettingsScreenProps, RootStackParamList } from '../../navigation/types';

export const SettingsScreen: React.FC<SettingsScreenProps> = ({ navigation }) => {
  const session = useAppStore((s) => s.session);
  const email = session?.user?.email ?? 'Unknown';
  const householdId = useAppStore((s) => s.householdId);
  const availableHouseholds = useAppStore((s) => s.availableHouseholds);
  const currentHousehold = availableHouseholds.find((h) => h.id === householdId);

  const rootNavigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const handleSignOut = async (): Promise<void> => {
    await supabase.auth.signOut();
    // reset() is owned by the onAuthStateChange listener in App.tsx — it runs
    // on any sign-out (including token expiry) so we don't duplicate it here.
  };

  const confirmSignOut = (): void => {
    Alert.alert('Sign out?', 'You will need to sign in again to access your data.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: handleSignOut },
    ]);
  };

  return (
    <View style={styles.flex}>
      <List.Section>
        <List.Subheader style={styles.subheader}>Household</List.Subheader>
        <Surface style={styles.section} elevation={0}>
          <List.Item
            title={currentHousehold?.name ?? 'My Household'}
            description="Active household"
            left={(props) => <List.Icon {...props} icon="home-outline" />}
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
      <Surface style={styles.section} elevation={0}>
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
      </Surface>

      {/* Slip scanning */}
      <List.Section>
        <List.Subheader style={styles.subheader}>Slip scanning</List.Subheader>
        <Surface style={styles.section} elevation={0}>
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
              (navigation as unknown as { navigate: (s: string) => void }).navigate('SlipConsent')
            }
            testID="slip-consent-item"
          />
        </Surface>
      </List.Section>

      <View style={styles.signOutSection}>
        <Button
          mode="outlined"
          icon="logout"
          onPress={confirmSignOut}
          textColor={colours.error}
          style={styles.signOutButton}
          testID="sign-out-button"
        >
          Sign out
        </Button>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colours.background },
  section: {
    marginTop: spacing.base,
    marginHorizontal: spacing.base,
    borderRadius: 8,
    backgroundColor: colours.surface,
  },
  subheader: {
    marginHorizontal: spacing.base,
  },
  signOutSection: {
    marginTop: spacing.xl,
    marginHorizontal: spacing.base,
  },
  signOutButton: {
    borderColor: colours.error,
  },
});
