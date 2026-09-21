import React, { useEffect, useState, useRef, useCallback } from 'react';
import { View, StyleSheet, Share } from 'react-native';
import { Text, Surface, Button, ActivityIndicator } from 'react-native-paper';
import { format, parseISO } from 'date-fns';
import { supabase } from '../../../data/remote/supabaseClient';
import { CreateInviteUseCase } from '../../../domain/households/CreateInviteUseCase';
import { useAppStore } from '../../stores/appStore';
import { spacing, radius } from '../../theme/tokens';
import { useAppTheme } from '../../theme/useAppTheme';
import type { ShareInviteScreenProps } from '../../navigation/types';

export const ShareInviteScreen: React.FC<ShareInviteScreenProps> = ({ route }) => {
  const { colors } = useAppTheme();
  const { householdName } = route.params;
  const session = useAppStore((s) => s.session);
  const householdId = useAppStore((s) => s.householdId)!;

  const [code, setCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestCounterRef = useRef(0);
  const unmountedRef = useRef(false);

  const executeInvite = useCallback(
    (requestNumber: number): void => {
      if (!session) return;
      const uc = new CreateInviteUseCase(supabase, {
        householdId,
        createdByUserId: session.user.id,
      });
      uc.execute().then((result) => {
        // Ignore if screen unmounted or a newer request has started
        if (unmountedRef.current || requestNumber !== requestCounterRef.current) {
          return;
        }
        setLoading(false);
        if (result.success) {
          setCode(result.data.code);
          setExpiresAt(result.data.expiresAt);
          setError(null);
        } else {
          setError(result.error.message);
        }
      });
    },
    [householdId, session],
  );

  useEffect((): (() => void) => {
    unmountedRef.current = false;
    const requestNumber = requestCounterRef.current;
    executeInvite(requestNumber);

    return (): void => {
      unmountedRef.current = true;
    };
  }, [householdId, session, executeInvite]);

  const handleRetry = (): void => {
    requestCounterRef.current += 1;
    setLoading(true);
    executeInvite(requestCounterRef.current);
  };

  const handleShare = async (): Promise<void> => {
    if (!code) return;
    await Share.share({
      message: `Join "${householdName}" on AccountingV2!\n\nUse invite code: ${code}\n\nExpires in 48 hours.`,
    });
  };

  if (code) {
    const expiryDate = expiresAt ? format(parseISO(expiresAt), 'd MMM yyyy') : '';

    return (
      <View style={[styles.flex, { backgroundColor: colors.background }]}>
        <Surface style={[styles.card, { backgroundColor: colors.primaryContainer }]} elevation={1}>
          <Text variant="labelMedium" style={[styles.label, { color: colors.onPrimaryContainer }]}>
            INVITE CODE
          </Text>
          <Text variant="displaySmall" style={[styles.code, { color: colors.primary }]}>
            {code}
          </Text>
          <Text variant="bodySmall" style={[styles.expiry, { color: colors.onPrimaryContainer }]}>
            Expires {expiryDate} · Single use
          </Text>
        </Surface>

        <Text
          variant="bodyMedium"
          style={[styles.instructions, { color: colors.onSurfaceVariant }]}
        >
          Share this code with the person you want to invite. They can enter it in Settings → Join a
          Household.
        </Text>

        <Button
          mode="contained"
          icon="share-variant"
          onPress={handleShare}
          style={[styles.shareBtn, { backgroundColor: colors.primary }]}
          contentStyle={styles.shareBtnContent}
        >
          Share Code
        </Button>
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.flex, { backgroundColor: colors.background }]}>
        <View style={styles.center}>
          <Text variant="bodyMedium" style={[styles.errorText, { color: colors.error }]}>
            {error}
          </Text>
          <Button
            mode="contained"
            onPress={handleRetry}
            disabled={loading}
            accessibilityLabel="Try again"
            testID="share-invite-retry"
            style={[styles.retryBtn, { backgroundColor: colors.primary }]}
            contentStyle={styles.retryBtnContent}
          >
            Try again
          </Button>
          {loading && (
            <ActivityIndicator
              animating
              color={colors.primary}
              style={styles.retryLoadingIndicator}
            />
          )}
        </View>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator animating color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.center}>
      <Text variant="bodyMedium" style={[styles.errorText, { color: colors.error }]}>
        Failed to generate code
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1, padding: spacing.base },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: {
    alignItems: 'center',
    borderRadius: radius.xl,
    padding: spacing.xl,
    marginTop: spacing.xl,
    marginBottom: spacing.base,
  },
  label: { letterSpacing: 1.5, marginBottom: spacing.sm },
  code: { fontFamily: 'PlusJakartaSans_700Bold', letterSpacing: 8 },
  expiry: { marginTop: spacing.sm },
  instructions: {
    textAlign: 'center',
    marginHorizontal: spacing.base,
  },
  errorText: { textAlign: 'center' },
  shareBtn: { marginTop: spacing.xl },
  shareBtnContent: { paddingVertical: spacing.xs },
  retryBtn: { marginTop: spacing.xl },
  retryBtnContent: { paddingVertical: spacing.xs },
  retryLoadingIndicator: { marginTop: spacing.xl },
});
