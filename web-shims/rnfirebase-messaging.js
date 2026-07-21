// Web no-op stub for @react-native-firebase/messaging (no web implementation).
// Push messaging is not wired up in the web build; token operations resolve to
// null and listeners return a no-op unsubscribe so callers behave gracefully.
const unsubscribe = () => {};
const api = {
  getToken: () => Promise.resolve(null),
  deleteToken: () => Promise.resolve(),
  onTokenRefresh: () => unsubscribe,
  onMessage: () => unsubscribe,
  requestPermission: () => Promise.resolve(0),
  hasPermission: () => Promise.resolve(0),
  setBackgroundMessageHandler: () => {},
  registerDeviceForRemoteMessages: () => Promise.resolve(),
};
module.exports = () => api;
module.exports.default = module.exports;
