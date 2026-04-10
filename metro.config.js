const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Allow Metro to bundle Drizzle SQL migration files
config.resolver.assetExts.push('sql');

module.exports = config;
