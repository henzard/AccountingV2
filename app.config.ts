import type { ExpoConfig, ConfigContext } from 'expo/config';
import { withAndroidManifest, type ConfigPlugin } from '@expo/config-plugins';

// newArchEnabled is a valid Expo SDK 52+ runtime field not yet reflected
// in @expo/config-types — cast via spread to avoid TS2353
type ConfigExtra = { newArchEnabled?: boolean; platforms?: string[] };

/**
 * expo-notifications sets com.google.firebase.messaging.default_notification_color
 * in the app manifest. @react-native-firebase/messaging also declares it.
 * The manifest merger fails unless our declaration has tools:replace="android:resource".
 */
const withFirebaseNotificationColorFix: ConfigPlugin = (config) => {
  return withAndroidManifest(config, (androidConfig) => {
    const app = androidConfig.modResults.manifest.application?.[0];
    if (app?.['meta-data']) {
      for (const metaData of app['meta-data']) {
        if (
          metaData.$['android:name'] === 'com.google.firebase.messaging.default_notification_color'
        ) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (metaData.$ as any)['tools:replace'] = 'android:resource';
        }
      }
    }
    return androidConfig;
  });
};

export default (_ctx: ConfigContext): ExpoConfig & ConfigExtra => ({
  name: 'AccountingV2',
  slug: 'accountingv2',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  newArchEnabled: false,
  splash: {
    image: './assets/splash-icon.png',
    resizeMode: 'contain',
    backgroundColor: '#ffffff',
  },
  platforms: ['android'],
  android: {
    package: 'com.henza.accountingv2',
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#00695C',
    },
    googleServicesFile: './google-services.json',
    predictiveBackGestureEnabled: false,
    allowBackup: false,
  },
  plugins: [
    '@config-plugins/detox', // must precede build-property-consuming plugins
    'expo-sqlite',
    'expo-secure-store',
    'expo-camera',
    '@react-native-community/datetimepicker',
    '@react-native-firebase/app',
    '@react-native-firebase/crashlytics',
    '@react-native-firebase/messaging',
    ['expo-notifications', { icon: './assets/icon.png', color: '#00695C' }],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    withFirebaseNotificationColorFix as any,
  ],
  extra: {
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    eas: {
      projectId: '08628d56-2d7d-4fef-95ab-dc6d8fc61a79',
    },
  },
});
