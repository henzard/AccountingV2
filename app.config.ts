import type { ExpoConfig, ConfigContext } from 'expo/config';

// newArchEnabled and edgeToEdgeEnabled are valid Expo SDK 52+ runtime fields
// not yet reflected in @expo/config-types — cast via spread to avoid TS2353
type AndroidExtra = { edgeToEdgeEnabled?: boolean };
type ConfigExtra = { newArchEnabled?: boolean; platforms?: string[] };

export default (_ctx: ConfigContext): ExpoConfig & ConfigExtra => ({
  name: 'AccountingV2',
  slug: 'accountingv2',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  newArchEnabled: true,
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
    ...({ edgeToEdgeEnabled: true } as AndroidExtra),
  },
  plugins: [
    'expo-sqlite',
    'expo-secure-store',
    '@react-native-firebase/app',
    '@react-native-firebase/messaging',
    ['expo-notifications', { icon: './assets/icon.png', color: '#00695C' }],
  ],
  extra: {
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    eas: {
      projectId: '08628d56-2d7d-4fef-95ab-dc6d8fc61a79',
    },
  },
});
