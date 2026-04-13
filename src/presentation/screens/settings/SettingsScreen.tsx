import React from 'react';
import { View, StyleSheet } from 'react-native';
import { List, Surface, Divider } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAppStore } from '../../stores/appStore';
import { colours, spacing } from '../../theme/tokens';
import type { SettingsScreenProps, RootStackParamList } from '../../navigation/types';

export const SettingsScreen: React.FC<SettingsScreenProps> = ({ navigation }) => {
  const session = useAppStore((s) => s.session);
  const email = session?.user?.email ?? 'Unknown';
  const householdId = useAppStore((s) => s.householdId);
  const availableHouseholds = useAppStore((s) => s.availableHouseholds);
  const currentHousehold = availableHouseholds.find((h) => h.id === householdId);

  const rootNavigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

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
});
