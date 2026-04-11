import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Share } from 'react-native';
import { Text, Surface, Button, ActivityIndicator } from 'react-native-paper';
import { supabase } from '../../../data/remote/supabaseClient';
import { CreateInviteUseCase } from '../../../domain/households/CreateInviteUseCase';
import { useAppStore } from '../../stores/appStore';
import { colours, spacing, radius } from '../../theme/tokens';
import type { ShareInviteScreenProps } from '../../navigation/types';

export const ShareInviteScreen: React.FC<ShareInviteScreenProps> = ({ route }) => {
  const { householdName } = route.params;
  const session = useAppStore((s) => s.session);
  const householdId = useAppStore((s) => s.householdId)!;

  const [code, setCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    const uc = new CreateInviteUseCase(supabase, {
      householdId,
      createdByUserId: session.user.id,
    });
    uc.execute().then((result) => {
      setLoading(false);
      if (result.success) {
        setCode(result.data.code);
        setExpiresAt(result.data.expiresAt);
      } else {
        setError(result.error.message);
      }
    });
  }, [householdId, session]);

  const handleShare = async (): Promise<void> => {
    if (!code) return;
    await Share.share({
      message: `Join "${householdName}" on AccountingV2!\n\nUse invite code: ${code}\n\nExpires in 48 hours.`,
    });
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator animating color={colours.primary} />
      </View>
    );
  }

  if (error || !code) {
    return (
      <View style={styles.center}>
        <Text variant="bodyMedium" style={styles.errorText}>{error ?? 'Failed to generate code'}</Text>
      </View>
    );
  }

  const expiryDate = expiresAt ? new Date(expiresAt).toLocaleDateString('en-ZA') : '';

  return (
    <View style={styles.flex}>
      <Surface style={styles.card} elevation={1}>
        <Text variant="labelMedium" style={styles.label}>INVITE CODE</Text>
        <Text variant="displaySmall" style={styles.code}>{code}</Text>
        <Text variant="bodySmall" style={styles.expiry}>Expires {expiryDate} · Single use</Text>
      </Surface>

      <Text variant="bodyMedium" style={styles.instructions}>
        Share this code with the person you want to invite. They can enter it in Settings → Join a Household.
      </Text>

      <Button
        mode="contained"
        icon="share-variant"
        onPress={handleShare}
        style={styles.shareBtn}
        contentStyle={styles.shareBtnContent}
      >
        Share Code
      </Button>
    </View>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colours.background, padding: spacing.base },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: {
    alignItems: 'center',
    borderRadius: radius.xl,
    padding: spacing.xl,
    backgroundColor: colours.primaryContainer,
    marginTop: spacing.xl,
    marginBottom: spacing.base,
  },
  label: { color: colours.onPrimaryContainer, letterSpacing: 1.5, marginBottom: spacing.sm },
  code: { color: colours.primary, fontFamily: 'PlusJakartaSans_700Bold', letterSpacing: 8 },
  expiry: { color: colours.onPrimaryContainer, marginTop: spacing.sm },
  instructions: { color: colours.onSurfaceVariant, textAlign: 'center', marginHorizontal: spacing.base },
  errorText: { color: colours.error, textAlign: 'center' },
  shareBtn: { marginTop: spacing.xl, backgroundColor: colours.primary },
  shareBtnContent: { paddingVertical: spacing.xs },
});
