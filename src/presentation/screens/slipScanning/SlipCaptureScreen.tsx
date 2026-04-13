import React, { useRef, useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, TouchableOpacity, ScrollView, Image, Linking, Text } from 'react-native';
import { Button } from 'react-native-paper';
import { CameraView, useCameraPermissions } from 'expo-camera';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import { useNetworkStore } from '../../stores/networkStore';

const MAX_FRAMES = 5;
const DAILY_LIMIT = 25;
const COACHMARK_KEY = 'slip_capture_coachmark_shown';
const DAILY_COUNT_KEY = 'slip_scan_daily_count';

export type SlipCaptureScreenProps = {
  householdId: string;
  createdBy: string;
};

export function SlipCaptureScreen({
  householdId,
  createdBy,
}: SlipCaptureScreenProps): React.JSX.Element {
  const navigation = useNavigation<any>(); // eslint-disable-line @typescript-eslint/no-explicit-any
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<InstanceType<typeof CameraView>>(null);
  const [frames, setFrames] = useState<string[]>([]);
  const [showCoachmark, setShowCoachmark] = useState(false);
  const [dailyCount, setDailyCount] = useState(0);
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);
  const isOnline = useNetworkStore((s) => s.isOnline);

  useEffect(() => {
    AsyncStorage.getItem(COACHMARK_KEY).then((val) => {
      if (!val) setShowCoachmark(true);
    });
    AsyncStorage.getItem(DAILY_COUNT_KEY).then((val) => {
      setDailyCount(val ? parseInt(val, 10) : 0);
    });
  }, []);

  const dismissCoachmark = useCallback(async (): Promise<void> => {
    setShowCoachmark(false);
    await AsyncStorage.setItem(COACHMARK_KEY, '1');
  }, []);

  const takePicture = useCallback(async (): Promise<void> => {
    if (!cameraRef.current) return;
    if (frames.length >= MAX_FRAMES) return;
    if (!isOnline) return;
    if (dailyCount >= DAILY_LIMIT) return;
    if (showCoachmark) {
      await dismissCoachmark();
    }
    const cam = cameraRef.current as unknown as {
      takePictureAsync: (opts: object) => Promise<{ uri: string }>;
    };
    const photo = await cam.takePictureAsync({
      base64: false,
      quality: 0.9,
    });
    const newFrames = [...frames, photo.uri];
    setFrames(newFrames);
    const newCount = dailyCount + 1;
    setDailyCount(newCount);
    await AsyncStorage.setItem(DAILY_COUNT_KEY, String(newCount));
  }, [cameraRef, frames, isOnline, dailyCount, showCoachmark, dismissCoachmark]);

  const removeFrame = useCallback((idx: number): void => {
    setPendingDelete(idx);
    setTimeout(() => {
      setPendingDelete(null);
      setFrames((prev) => prev.filter((_, i) => i !== idx));
    }, 3000);
  }, []);

  const undoDelete = useCallback((): void => {
    setPendingDelete(null);
  }, []);

  const handleDone = useCallback((): void => {
    if (frames.length === 0) return;
    const nav = navigation as unknown as {
      navigate: (screen: string, params: object) => void;
    };
    nav.navigate('SlipProcessing', {
      householdId,
      createdBy,
      frameLocalUris: frames,
    });
  }, [navigation, householdId, createdBy, frames]);

  if (!permission) {
    return <View style={styles.container} />;
  }

  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <Text style={styles.permissionText}>Camera permission is required to scan slips.</Text>
        {permission.canAskAgain ? (
          <TouchableOpacity
            style={styles.permissionButton}
            onPress={requestPermission}
            testID="request-permission"
          >
            <Text>Grant Permission</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.permissionButton}
            onPress={() => Linking.openSettings()}
            testID="open-settings"
          >
            <Text>Open Settings</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  const shutterDisabled = !isOnline || frames.length >= MAX_FRAMES || dailyCount >= DAILY_LIMIT;

  return (
    <View style={styles.container}>
      {/* Daily counter */}
      <View style={styles.counterRow}>
        <Text style={styles.counterText} testID="daily-counter">
          {dailyCount}/{DAILY_LIMIT} today
        </Text>
      </View>

      {/* Camera viewfinder */}
      <CameraView ref={cameraRef} style={styles.camera} />

      {/* Thumbnail strip */}
      <ScrollView horizontal style={styles.thumbnailStrip} testID="thumbnail-strip">
        {frames.map((uri, idx) => {
          const isPending = pendingDelete === idx;
          return (
            <View key={uri} style={styles.thumbnailWrapper}>
              <Image
                source={{ uri }}
                style={[styles.thumbnail, isPending && styles.thumbnailFaded]}
              />
              {isPending ? (
                <TouchableOpacity
                  onPress={undoDelete}
                  style={styles.undoButton}
                  testID={`undo-delete-${idx}`}
                >
                  <Text style={styles.undoText}>Undo</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  onPress={() => removeFrame(idx)}
                  style={styles.deleteButton}
                  testID={`delete-frame-${idx}`}
                >
                  <Text style={styles.deleteText}>✕</Text>
                </TouchableOpacity>
              )}
            </View>
          );
        })}
      </ScrollView>

      {/* Shutter + Done */}
      <View style={styles.controls}>
        <TouchableOpacity
          style={[styles.shutter, shutterDisabled && styles.shutterDisabled]}
          onPress={takePicture}
          disabled={shutterDisabled}
          testID="shutter-button"
        />
        <TouchableOpacity
          style={[styles.doneButton, frames.length === 0 && styles.doneDisabled]}
          onPress={handleDone}
          disabled={frames.length === 0}
          testID="done-button"
        >
          <Text style={styles.doneText}>Done ({frames.length})</Text>
        </TouchableOpacity>
      </View>

      {/* Coachmark */}
      {showCoachmark && (
        <View style={styles.coachmark} testID="coachmark">
          <Text style={styles.coachmarkTitle}>How to scan</Text>
          <Text style={styles.coachmarkBody}>
            Tap the shutter to capture your slip. Capture up to 5 photos for multi-page slips.
          </Text>
          <TouchableOpacity onPress={dismissCoachmark} testID="coachmark-dismiss">
            <Text style={styles.coachmarkDismiss}>Got it</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Offline banner */}
      {!isOnline && (
        <View style={styles.offlineBanner} testID="offline-banner">
          <Text style={styles.offlineText}>You are offline — scanning unavailable</Text>
          <Button
            mode="outlined"
            onPress={() =>
              (navigation as unknown as { navigate: (s: string) => void }).navigate(
                'AddTransaction',
              )
            }
            testID="log-manually-button"
            textColor="#fff"
            style={styles.logManuallyButton}
          >
            Log manually
          </Button>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  permissionText: { color: '#fff', textAlign: 'center', marginBottom: 16, padding: 24 },
  permissionButton: {
    alignSelf: 'center',
    backgroundColor: '#4CAF50',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
  },
  counterRow: { padding: 8, alignItems: 'center' },
  counterText: { color: '#fff', fontSize: 14 },
  camera: { flex: 1 },
  thumbnailStrip: { height: 80, backgroundColor: '#111' },
  thumbnailWrapper: { margin: 4, position: 'relative' },
  thumbnail: { width: 64, height: 72, borderRadius: 4 },
  thumbnailFaded: { opacity: 0.4 },
  deleteButton: {
    position: 'absolute',
    top: 2,
    right: 2,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 8,
    padding: 2,
  },
  deleteText: { color: '#fff', fontSize: 10 },
  undoButton: {
    position: 'absolute',
    top: 2,
    right: 2,
    backgroundColor: 'rgba(255,165,0,0.8)',
    borderRadius: 8,
    padding: 2,
  },
  undoText: { color: '#fff', fontSize: 10 },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 16 },
  shutter: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#fff',
    marginRight: 24,
  },
  shutterDisabled: { backgroundColor: '#555' },
  doneButton: {
    backgroundColor: '#4CAF50',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
  },
  doneDisabled: { backgroundColor: '#555' },
  doneText: { color: '#fff', fontWeight: 'bold' },
  coachmark: {
    position: 'absolute',
    bottom: 160,
    left: 24,
    right: 24,
    backgroundColor: 'rgba(0,0,0,0.85)',
    padding: 16,
    borderRadius: 12,
  },
  coachmarkTitle: { color: '#fff', fontWeight: 'bold', fontSize: 16, marginBottom: 8 },
  coachmarkBody: { color: '#ddd', marginBottom: 12 },
  coachmarkDismiss: { color: '#4CAF50', fontWeight: 'bold' },
  offlineBanner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: '#c62828',
    padding: 8,
    alignItems: 'center',
  },
  offlineText: { color: '#fff', fontWeight: 'bold' },
  logManuallyButton: { marginTop: 6, borderColor: '#fff' },
});
