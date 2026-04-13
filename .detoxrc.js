/** @type {Detox.DetoxConfig} */
module.exports = {
  testRunner: { args: { $0: 'jest', config: 'e2e/jest.config.js' }, jest: { setupTimeout: 120000 } },
  apps: { 'android.release': { type: 'android.apk', binaryPath: 'android/app/build/outputs/apk/release/app-release.apk' } },
  devices: { emulator: { type: 'android.emulator', device: { avdName: 'Pixel_6_API_34' } } },
  configurations: { 'android.emu.release': { device: 'emulator', app: 'android.release' } },
};
