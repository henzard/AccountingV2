import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SlipConsentScreen } from '../screens/slipScanning/SlipConsentScreen';
import { SlipQueueScreen } from '../screens/slipScanning/SlipQueueScreen';

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

/**
 * Placeholder screens for stages that require runtime dependencies
 * (camera, use cases). In App.tsx these are replaced with fully-wired versions.
 */
function PlaceholderScreen(): React.JSX.Element {
  return <></>;
}

export type SlipScanningStackNavigatorProps = {
  householdId: string;
  createdBy: string;
  recordConsent: (userId: string) => Promise<{ success: boolean }>;
  repo: Parameters<typeof SlipQueueScreen>[0]['repo'];
};

export function SlipScanningStackNavigator({
  householdId,
  createdBy: _createdBy,
  recordConsent,
  repo,
}: SlipScanningStackNavigatorProps): React.JSX.Element {
  return (
    <Stack.Navigator screenOptions={{ headerShown: true }}>
      <Stack.Screen name="SlipQueue" options={{ title: 'Slip history' }}>
        {() => <SlipQueueScreen repo={repo} householdId={householdId} />}
      </Stack.Screen>
      <Stack.Screen name="SlipConsent" options={{ title: 'Slip scanning consent' }}>
        {() => <SlipConsentScreen recordConsent={recordConsent} />}
      </Stack.Screen>
      <Stack.Screen
        name="SlipCapture"
        component={PlaceholderScreen}
        options={{ title: 'Scan slip', headerShown: false }}
      />
      <Stack.Screen
        name="SlipProcessing"
        component={PlaceholderScreen}
        options={{ title: 'Processing', gestureEnabled: false }}
      />
      <Stack.Screen
        name="SlipConfirm"
        component={PlaceholderScreen}
        options={{ title: 'Confirm transactions' }}
      />
    </Stack.Navigator>
  );
}
