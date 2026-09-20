/** @type {Detox.DetoxConfig} */
module.exports = {
  testRunner: {
    args: { $0: 'jest', config: 'e2e/jest.config.js' },
    jest: { setupTimeout: 120000 },
  },
  apps: {
    'android.release': {
      type: 'android.apk',
      binaryPath: 'android/app/build/outputs/apk/release/app-release.apk',
    },
    // CI's e2e-gate target (was android.debug — see the comment on the `e2e`
    // buildType in android/app/build.gradle for why a debug APK can't work
    // with Detox here). `e2e` is a release-shaped, minified, non-debuggable
    // build type distinct from `release` itself, so the JS bundle is
    // embedded (no Metro needed in CI) and expo-dev-client's dev-launcher
    // never gets a chance to intercept the launch. `-DtestBuildType=e2e`
    // makes `:app:assembleAndroidTest` build the matching instrumentation
    // APK (see `testBuildType System.getProperty(...)` in build.gradle).
    'android.e2e': {
      type: 'android.apk',
      binaryPath: 'android/app/build/outputs/apk/e2e/app-e2e.apk',
      testBinaryPath: 'android/app/build/outputs/apk/androidTest/e2e/app-e2e-androidTest.apk',
      build:
        'cd android && ./gradlew :app:assembleE2e :app:assembleAndroidTest -DtestBuildType=e2e -PreactNativeArchitectures=x86_64 --no-daemon',
    },
    // Kept for local development against a running Metro server.
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
    'android.emu.e2e': { device: 'emulator', app: 'android.e2e' },
    'android.emu.debug': { device: 'emulator', app: 'android.debug' },
  },
};
