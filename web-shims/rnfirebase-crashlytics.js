// Web no-op stub for @react-native-firebase/crashlytics.
// react-native-firebase has no web implementation; on web its native module is
// absent and calling into it throws "No Firebase App '[DEFAULT]'". Metro aliases
// the package to this stub for the web platform (see metro.config.js). Crash
// reporting is simply a no-op in the browser build.
const api = {
  setCrashlyticsCollectionEnabled: () => Promise.resolve(),
  setUserId: () => Promise.resolve(),
  setAttribute: () => Promise.resolve(),
  setAttributes: () => Promise.resolve(),
  recordError: () => {},
  log: () => {},
  crash: () => {},
  isCrashlyticsCollectionEnabled: false,
};
module.exports = () => api;
module.exports.default = module.exports;
