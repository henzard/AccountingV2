import React, { useEffect, useCallback, useRef } from 'react';
import { View, StyleSheet, BackHandler, Alert } from 'react-native';
import { Text, Button, ActivityIndicator } from 'react-native-paper';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { ProgressState } from '../../../application/SlipScanFlow';
import type { SlipScanErrorCode } from '../../../domain/slipScanning/errors';

export type SlipProcessingScreenProps = {
  startScan: (input: {
    householdId: string;
    createdBy: string;
    frameLocalUris: string[];
  }) => Promise<{
    success: boolean;
    data?: { slipId: string; extraction: unknown };
    error?: unknown;
  }>;
  progress: ProgressState;
  cancelSlip?: (slipId: string) => Promise<void>;
};

const ERROR_COPY: Record<SlipScanErrorCode, string> = {
  SLIP_OPENAI_UNREACHABLE: 'Slip service is temporarily unreachable. Try again, or log manually.',
  SLIP_RATE_LIMITED_HOUSEHOLD: 'Your household has used its 50 daily scans. Log this one manually.',
  SLIP_RATE_LIMITED_USER:
    'You\u2019ve used your 25 daily scans. Another household member can still scan today, or log manually.',
  SLIP_UNREADABLE: 'We couldn\u2019t read this slip. The photo may be blurry or too dark.',
  SLIP_CONSENT_MISSING: 'Slip scanning requires consent.', // handled via redirect, shouldn't display
  SLIP_OFFLINE: 'Upload failed \u2014 check your connection.',
  SLIP_PAYLOAD_TOO_LARGE: 'This slip is too large. Try fewer or smaller frames.',
  SLIP_FORBIDDEN: 'You don\u2019t have permission to scan for this household.',
  SLIP_UNREASONABLE_EXTRACTION:
    'Something looked off with this slip\u2019s extraction. Log manually.',
  SLIP_WIFI_REQUIRED: 'WiFi-only is on. Connect to WiFi or disable the setting.',
  SLIP_INVALID_FRAME_COUNT: 'A slip needs 1\u20135 frames.',
  SLIP_DB_ERROR: 'A local database error occurred. Try again.',
  SLIP_PARTIAL_SAVE_FAILED: 'Some transactions couldn\u2019t be saved. Try again.',
  SLIP_CLEANUP_FAILED: 'Cleanup failed. Data may still be present.',
  SLIP_STORAGE_UPLOAD_FAILED: 'Image upload failed. Check your connection and try again.',
};

function progressLabel(state: ProgressState): string {
  switch (state.stage) {
    case 'capturing':
      return 'Preparing\u2026';
    case 'uploading':
      return 'Uploading\u2026';
    case 'extracting':
      return 'Reading slip\u2026';
    case 'done':
      return 'Done!';
    case 'failed':
      return 'Failed';
    default:
      return '\u2026';
  }
}

export function SlipProcessingScreen({
  startScan,
  progress,
  cancelSlip,
}: SlipProcessingScreenProps): React.JSX.Element {
  const navigation = useNavigation<{
    navigate: (screen: string, params?: object) => void;
    replace: (screen: string, params?: object) => void;
    goBack: () => void;
    getParent: () => { navigate: (screen: string, params?: object) => void } | undefined;
  }>();
  const route = useRoute<{
    key: string;
    name: string;
    params: { householdId: string; createdBy: string; frameLocalUris: string[] };
  }>();

  const { householdId, createdBy, frameLocalUris } = route.params;

  const mounted = useRef(true);
  const inFlightSlipIdRef = useRef<string | null>(null);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  const handleCancel = useCallback((): void => {
    Alert.alert('Cancel scan?', 'Your photos will not be saved.', [
      { text: 'Keep going', style: 'cancel' },
      {
        text: 'Cancel',
        style: 'destructive',
        onPress: () => {
          const slipId = inFlightSlipIdRef.current;
          // Fire-and-forget cleanup; don't block navigation
          if (slipId && cancelSlip) {
            cancelSlip(slipId).catch((err) => console.warn('cancelSlip failed', err));
          }
          navigation.goBack();
        },
      },
    ]);
  }, [navigation, cancelSlip]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      handleCancel();
      return true;
    });
    return () => sub.remove();
  }, [handleCancel]);

  useEffect(() => {
    startScan({ householdId, createdBy, frameLocalUris }).then((result) => {
      if (!mounted.current) return;
      if (result.success && result.data) {
        const data = result.data as { slipId: string; extraction: unknown };
        inFlightSlipIdRef.current = data.slipId;
        navigation.navigate('SlipConfirm', {
          slipId: data.slipId,
          extraction: data.extraction,
        });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isFailed = progress.stage === 'failed';
  const errorCode =
    isFailed && 'error' in progress
      ? ((progress.error as { code?: SlipScanErrorCode }).code ?? null)
      : null;

  // Consent missing → redirect immediately, don't display error
  useEffect(() => {
    if (errorCode === 'SLIP_CONSENT_MISSING') {
      navigation.replace('SlipConsent');
    }
  }, [errorCode, navigation]);

  const humanMessage =
    errorCode && errorCode !== 'SLIP_CONSENT_MISSING'
      ? (ERROR_COPY[errorCode] ?? 'Something went wrong.')
      : null;

  const handleLogManually = useCallback((): void => {
    navigation.getParent()?.navigate('Transactions', { screen: 'AddTransaction' });
  }, [navigation]);

  return (
    <View style={styles.container} testID="processing-screen">
      <ActivityIndicator
        animating={!isFailed}
        size="large"
        style={styles.spinner}
        testID="progress-spinner"
      />
      <Text variant="bodyLarge" style={styles.label} testID="progress-label">
        {progressLabel(progress)}
      </Text>
      {!isFailed && (
        <Text variant="bodySmall" style={styles.subLabel} testID="processing-sub-label">
          This usually takes 5\u201315 seconds
        </Text>
      )}
      {isFailed && humanMessage && (
        <Text variant="bodyMedium" style={styles.error} testID="error-message">
          {humanMessage}
        </Text>
      )}
      {!isFailed && (
        <Button mode="text" onPress={handleCancel} testID="cancel-button">
          Cancel
        </Button>
      )}
      {isFailed && errorCode !== 'SLIP_CONSENT_MISSING' && (
        <>
          <Button mode="contained" onPress={() => navigation.goBack()} testID="retry-button">
            Try again
          </Button>
          <Button
            mode="outlined"
            onPress={handleLogManually}
            style={styles.logManuallyButton}
            testID="log-manually-button"
          >
            Log manually
          </Button>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    backgroundColor: '#fff',
  },
  spinner: { marginBottom: 24 },
  label: { marginBottom: 8, textAlign: 'center' },
  subLabel: { marginBottom: 16, textAlign: 'center', color: '#888' },
  error: { marginBottom: 16, color: '#c62828', textAlign: 'center' },
  logManuallyButton: { marginTop: 8 },
});
