import fs from 'fs';
import path from 'path';

/**
 * Regression: ML Kit barcode scanning must stay disabled. The app only uses
 * expo-camera for slip photos; bundling play-services-code-scanner registers
 * GmsBarcodeScanningDelegateActivity and crashes on devices without the GMS
 * barcode module (Play pre-launch tests, Honor/Huawei, outdated GMS).
 */
describe('Android barcode scanner configuration', () => {
  it('disables expo-camera barcode scanning in app.config.ts', () => {
    const configSource = fs.readFileSync(path.resolve(__dirname, '../../../app.config.ts'), 'utf8');
    expect(configSource).toMatch(/expo-camera',\s*\{\s*barcodeScannerEnabled:\s*false\s*\}/);
  });

  it('sets expo.camera.barcode-scanner-enabled=false in gradle.properties', () => {
    const gradleProps = fs.readFileSync(
      path.resolve(__dirname, '../../../android/gradle.properties'),
      'utf8',
    );
    expect(gradleProps).toContain('expo.camera.barcode-scanner-enabled=false');
  });

  it('strips ML Kit barcode metadata via config plugin', () => {
    const configSource = fs.readFileSync(path.resolve(__dirname, '../../../app.config.ts'), 'utf8');
    expect(configSource).toContain('withMlKitBarcodeMetadataRemoved');
    expect(configSource).toContain("metaData.$['android:name'] !== 'com.google.mlkit.vision.DEPENDENCIES'");
  });
});
