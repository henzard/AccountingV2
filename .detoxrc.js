/** @type {Detox.DetoxConfig} */
module.exports = {
  testRunner: { args: { $0: 'jest', config: 'e2e/jest.config.js' }, jest: { setupTimeout: 120000 } },
  apps: {
    'android.release': {
      type: 'android.apk',
      binaryPath: 'android/app/build/outputs/apk/release/app-release.apk',
    },
    'android.debug': {
      type: 'android.apk',
      binaryPath: 'android/app/build/outputs/apk/debug/app-debug.apk',
      testBinaryPath: 'android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk',
      build: 'cd android && ./gradlew :app:assembleDebug :app:assembleAndroidTest --no-daemon',
    },
  },
  devices: {
    emulator: {
      type: 'android.emulator',
      device: { avdName: 'Pixel_API_34' },
    },
  },
  configurations: {
    'android.emu.release': { device: 'emulator', app: 'android.release' },
    'android.emu.debug': { device: 'emulator', app: 'android.debug' },
  },
};
