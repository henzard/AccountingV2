// tests/realsql/harness/setupGlobals.js
//
// The realsql/twodevice tiers run under a plain `node` Jest environment (see
// jest.config.js) -- no jest-expo preset, so RN/Metro's `__DEV__` global
// (referenced by src/infrastructure/logging/Logger.ts) is never defined here.
// Set it to `true`, matching a dev build: this keeps `logger.info`/`.warn`
// as harmless console output and, critically, keeps `logger.error` from
// taking its `!__DEV__` branch, which calls into `recordError` /
// `@react-native-firebase/crashlytics` -- a real native module with no place
// in an offline node test run.
if (typeof global.__DEV__ === 'undefined') {
  global.__DEV__ = true;
}
