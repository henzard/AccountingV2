import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Button } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import { useAppStore } from '../../stores/appStore';
import { spacing } from '../../theme/tokens';
import { useAppTheme } from '../../theme/useAppTheme';

export type SlipConsentScreenProps = {
  recordConsent: (userId: string) => Promise<{ success: boolean }>;
};

export function SlipConsentScreen({ recordConsent }: SlipConsentScreenProps): React.JSX.Element {
  // Uses any-typed navigation because this screen sits in a nested stack
  // and needs to navigate to inner stack routes (SlipCapture).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const navigation = useNavigation<any>();
  const session = useAppStore((s) => s.session);
  const userId = session?.user?.id;
  const theme = useAppTheme();

  const handleAccept = async (): Promise<void> => {
    if (!userId) return;
    const result = await recordConsent(userId);
    if (result.success) navigation.navigate('SlipCapture');
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Text variant="headlineSmall" style={styles.title}>
        Slip scanning
      </Text>
      <Text variant="bodyMedium" style={styles.body}>
        Slip scanning sends your photo to AI to read the merchant, total, and items. We delete your
        photo from our servers after 30 days. You can revoke consent in Settings → Privacy at any
        time.
      </Text>
      <Button mode="contained" onPress={handleAccept} testID="consent-accept">
        I agree — start scanning
      </Button>
      <Button mode="text" onPress={() => navigation.goBack()} testID="consent-decline">
        Not now
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.lg, justifyContent: 'center' },
  title: { marginBottom: spacing.base },
  body: { marginBottom: spacing.lg, lineHeight: 22 },
});
