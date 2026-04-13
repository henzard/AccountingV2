import React, { useEffect, useCallback } from 'react';
import { View, StyleSheet, BackHandler, Alert } from 'react-native';
import { Text, Button, ActivityIndicator } from 'react-native-paper';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { ProgressState } from '../../../application/SlipScanFlow';

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
};

function progressLabel(state: ProgressState): string {
  switch (state.stage) {
    case 'capturing':
      return 'Preparing…';
    case 'uploading':
      return 'Uploading…';
    case 'extracting':
      return 'Reading slip…';
    case 'done':
      return 'Done!';
    case 'failed':
      return 'Failed';
    default:
      return '…';
  }
}

export function SlipProcessingScreen({
  startScan,
  progress,
}: SlipProcessingScreenProps): React.JSX.Element {
  const navigation = useNavigation<{
    navigate: (screen: string, params?: object) => void;
    goBack: () => void;
  }>();
  const route = useRoute<{
    key: string;
    name: string;
    params: { householdId: string; createdBy: string; frameLocalUris: string[] };
  }>();

  const { householdId, createdBy, frameLocalUris } = route.params;

  const handleCancel = useCallback((): void => {
    Alert.alert('Cancel scan?', 'Your photos will not be saved.', [
      { text: 'Keep going', style: 'cancel' },
      { text: 'Cancel', style: 'destructive', onPress: () => navigation.goBack() },
    ]);
  }, [navigation]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      handleCancel();
      return true;
    });
    return () => sub.remove();
  }, [handleCancel]);

  useEffect(() => {
    startScan({ householdId, createdBy, frameLocalUris }).then((result) => {
      if (result.success && result.data) {
        navigation.navigate('SlipConfirm', {
          slipId: (result.data as { slipId: string }).slipId,
          extraction: (result.data as { extraction: unknown }).extraction,
        });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isFailed = progress.stage === 'failed';
  const errorMessage =
    isFailed && 'error' in progress
      ? ((progress.error as { message?: string }).message ?? 'Unknown error')
      : null;

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
      {isFailed && errorMessage && (
        <Text variant="bodyMedium" style={styles.error} testID="error-message">
          {errorMessage}
        </Text>
      )}
      {!isFailed && (
        <Button mode="text" onPress={handleCancel} testID="cancel-button">
          Cancel
        </Button>
      )}
      {isFailed && (
        <Button mode="contained" onPress={() => navigation.goBack()} testID="retry-button">
          Try again
        </Button>
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
  label: { marginBottom: 16, textAlign: 'center' },
  error: { marginBottom: 16, color: '#c62828', textAlign: 'center' },
});
