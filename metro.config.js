const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Drizzle ORM imports .sql migration files. Metro must treat them as
// source modules (not assets) and export their raw text as a JS string.
config.resolver.assetExts = config.resolver.assetExts.filter((ext) => ext !== 'sql');
config.resolver.sourceExts.push('sql');
config.transformer.babelTransformerPath = require.resolve('./sql-transformer.js');

// expo-sqlite's web backend (wa-sqlite) imports a .wasm binary. Metro does not
// treat `wasm` as an asset by default, so register it — otherwise the web
// bundle fails to resolve `expo-sqlite/web/wa-sqlite/wa-sqlite.wasm`.
if (!config.resolver.assetExts.includes('wasm')) {
  config.resolver.assetExts.push('wasm');
}

// react-native-firebase has no web implementation: on web its native modules
// are absent and any call throws "No Firebase App '[DEFAULT]'". For the web
// platform only, alias the firebase packages to local no-op stubs so crash
// reporting / push messaging degrade gracefully instead of crashing boot.
const path = require('path');
const FIREBASE_WEB_STUBS = {
  '@react-native-firebase/crashlytics': path.resolve(__dirname, 'web-shims/rnfirebase-crashlytics.js'),
  '@react-native-firebase/messaging': path.resolve(__dirname, 'web-shims/rnfirebase-messaging.js'),
  '@react-native-firebase/app': path.resolve(__dirname, 'web-shims/rnfirebase-app.js'),
};
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && FIREBASE_WEB_STUBS[moduleName]) {
    return { type: 'sourceFile', filePath: FIREBASE_WEB_STUBS[moduleName] };
  }
  return (defaultResolveRequest ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
