import React from 'react';
import { View, StyleSheet } from 'react-native';
import { List, Surface, Divider } from 'react-native-paper';
import { useAppStore } from '../../stores/appStore';
import { colours, spacing } from '../../theme/tokens';
import type { SettingsScreenProps } from '../../navigation/types';

export const SettingsScreen: React.FC<SettingsScreenProps> = ({ navigation }) => {
  const session = useAppStore((s) => s.session);
  const email = session?.user?.email ?? 'Unknown';

  return (
    <View style={styles.flex}>
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
});
