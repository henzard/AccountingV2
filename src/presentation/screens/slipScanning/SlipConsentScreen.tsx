import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Button } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import { useAppStore } from '../../stores/appStore';
import { spacing } from '../../theme/tokens';
import { useAppTheme } from '../../theme/useAppTheme';
import { logger } from '../../../infrastructure/logging/Logger';

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

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // A-4: every failure path here used to `return` silently — a missing
  // session and a rejected/failed recordConsent both left the button looking
  // live while nothing happened, so the user tapped "I agree" repeatedly and
  // concluded slip scanning was broken. Surface both, and don't offer the
  // button at all until the session (and therefore userId) has resolved.
  const handleAccept = async (): Promise<void> => {
    if (!userId || saving) return;
    setError(null);
    setSaving(true);
    try {
      const result = await recordConsent(userId);
      if (result.success) {
        navigation.navigate('SlipCapture');
        return;
      }
      setError('We couldn’t save your consent. Please try again.');
    } catch (err) {
      logger.warn('SlipConsentScreen: recordConsent threw', {
        error: err instanceof Error ? err.message : String(err),
      });
      setError('We couldn’t save your consent. Please try again.');
    } finally {
      setSaving(false);
    }
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
      {error !== null && (
        <Text
          variant="bodyMedium"
          style={[styles.error, { color: theme.colors.error }]}
          accessibilityLiveRegion="polite"
          testID="consent-error"
        >
          {error}
        </Text>
      )}
      <Button
        mode="contained"
        onPress={handleAccept}
        // Disabled while the session is still resolving (userId undefined) so
        // a tap can't fall through the `!userId` guard into silence, and
        // while a record is in flight so it can't be double-submitted.
        disabled={!userId || saving}
        loading={saving}
        testID="consent-accept"
      >
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
  error: { marginBottom: spacing.base },
});
