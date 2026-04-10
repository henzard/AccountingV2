const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Drizzle ORM imports .sql migration files. Metro must treat them as
// source modules (not assets) and export their raw text as a JS string.
config.resolver.assetExts = config.resolver.assetExts.filter((ext) => ext !== 'sql');
config.resolver.sourceExts.push('sql');
config.transformer.babelTransformerPath = require.resolve('./sql-transformer.js');

module.exports = config;
