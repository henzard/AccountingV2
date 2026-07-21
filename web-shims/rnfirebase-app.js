// Web no-op stub for @react-native-firebase/app (no web implementation).
const app = { name: '[DEFAULT]', options: {} };
const firebase = { app: () => app, apps: [app], initializeApp: () => app };
module.exports = firebase;
module.exports.default = firebase;
module.exports.firebase = firebase;
