import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SlipConsentScreen } from '../screens/slipScanning/SlipConsentScreen';
import { SlipCaptureScreen } from '../screens/slipScanning/SlipCaptureScreen';
import { SlipProcessingScreen } from '../screens/slipScanning/SlipProcessingScreen';
import { SlipConfirmScreen } from '../screens/slipScanning/SlipConfirmScreen';
import { SlipQueueScreen } from '../screens/slipScanning/SlipQueueScreen';
import type { ProgressState } from '../../application/SlipScanFlow';
import type { EnvelopeOption } from '../screens/slipScanning/components/EnvelopePickerSheet';

export type SlipScanningStackParamList = {
  SlipQueue: undefined;
  SlipConsent: undefined;
  SlipCapture: { householdId: string; createdBy: string } | undefined;
  SlipProcessing:
    | {
        householdId: string;
        createdBy: string;
        frameLocalUris: string[];
      }
    | undefined;
  SlipConfirm: { slipId: string; extraction: unknown } | undefined;
};

const Stack = createNativeStackNavigator<SlipScanningStackParamList>();

export type SlipScanningStackNavigatorProps = {
  householdId: string;
  createdBy: string;
  recordConsent: (userId: string) => Promise<{ success: boolean }>;
  repo: Parameters<typeof SlipQueueScreen>[0]['repo'];
  startScan: Parameters<typeof SlipProcessingScreen>[0]['startScan'];
  progress: ProgressState;
  confirmSlip: Parameters<typeof SlipConfirmScreen>[0]['confirmSlip'];
  envelopes: EnvelopeOption[];
};

export function SlipScanningStackNavigator({
  householdId,
  createdBy,
  recordConsent,
  repo,
  startScan,
  progress,
  confirmSlip,
  envelopes,
}: SlipScanningStackNavigatorProps): React.JSX.Element {
  return (
    <Stack.Navigator screenOptions={{ headerShown: true }}>
      <Stack.Screen name="SlipQueue" options={{ title: 'Slip history' }}>
        {() => <SlipQueueScreen repo={repo} householdId={householdId} />}
      </Stack.Screen>
      <Stack.Screen name="SlipConsent" options={{ title: 'Slip scanning consent' }}>
        {() => <SlipConsentScreen recordConsent={recordConsent} />}
      </Stack.Screen>
      <Stack.Screen name="SlipCapture" options={{ title: 'Scan slip', headerShown: false }}>
        {() => <SlipCaptureScreen householdId={householdId} createdBy={createdBy} />}
      </Stack.Screen>
      <Stack.Screen name="SlipProcessing" options={{ title: 'Processing', gestureEnabled: false }}>
        {() => <SlipProcessingScreen startScan={startScan} progress={progress} />}
      </Stack.Screen>
      <Stack.Screen name="SlipConfirm" options={{ title: 'Confirm transactions' }}>
        {() => <SlipConfirmScreen confirmSlip={confirmSlip} envelopes={envelopes} />}
      </Stack.Screen>
    </Stack.Navigator>
  );
}
