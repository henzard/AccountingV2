// Jest manual mock for @react-native-firebase/crashlytics
const crashlyticsMock = {
  setCrashlyticsCollectionEnabled: jest.fn().mockResolvedValue(undefined),
  setUserId: jest.fn().mockResolvedValue(undefined),
  setAttribute: jest.fn().mockResolvedValue(undefined),
  recordError: jest.fn(),
  log: jest.fn(),
  crash: jest.fn(),
};

const crashlytics = jest.fn(() => crashlyticsMock);

module.exports = crashlytics;
module.exports.default = crashlytics;
