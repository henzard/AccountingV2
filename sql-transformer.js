/**
 * Custom Metro transformer for .sql files.
 * Drizzle ORM's expo-sqlite migrator imports raw SQL files.
 * This transformer exports the SQL text as a JavaScript string module
 * so the migrator can read and execute it.
 */
const upstreamTransformer = require('@expo/metro-config/babel-transformer');

module.exports.transform = async function ({ src, filename, options }) {
  if (filename.endsWith('.sql')) {
    return upstreamTransformer.transform({
      src: `module.exports = ${JSON.stringify(src)};`,
      filename: filename.replace(/\.sql$/, '.sql.js'),
      options,
    });
  }
  return upstreamTransformer.transform({ src, filename, options });
};
