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

module.exports = config;
