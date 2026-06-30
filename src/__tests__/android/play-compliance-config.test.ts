import fs from 'fs';
import path from 'path';

const repoRoot = path.resolve(__dirname, '../../..');

describe('Android Play Console compliance configuration', () => {
  it('disables expo-camera barcode scanning in app.config.ts', () => {
    const configSource = fs.readFileSync(path.join(repoRoot, 'app.config.ts'), 'utf8');
    expect(configSource).toMatch(/expo-camera',\s*\{\s*barcodeScannerEnabled:\s*false\s*\}/);
  });

  it('does not lock orientation to portrait in app.config.ts', () => {
    const configSource = fs.readFileSync(path.join(repoRoot, 'app.config.ts'), 'utf8');
    expect(configSource).not.toMatch(/orientation:\s*['"]portrait['"]/);
  });

  it('sets expo.camera.barcode-scanner-enabled=false in gradle.properties', () => {
    const gradleProps = fs.readFileSync(path.join(repoRoot, 'android/gradle.properties'), 'utf8');
    expect(gradleProps).toContain('expo.camera.barcode-scanner-enabled=false');
    expect(gradleProps).toContain('edgeToEdgeEnabled=false');
  });

  it('removes portrait lock and ML Kit scanner activity from AndroidManifest', () => {
    const manifest = fs.readFileSync(
      path.join(repoRoot, 'android/app/src/main/AndroidManifest.xml'),
      'utf8',
    );
    expect(manifest).not.toContain('android:screenOrientation="portrait"');
    expect(manifest).toContain('android:resizeableActivity="true"');
    expect(manifest).toContain('GmsBarcodeScanningDelegateActivity');
    expect(manifest).toContain('tools:node="remove"');
  });

  it('does not set deprecated status bar colors in AppTheme styles', () => {
    const styles = fs.readFileSync(
      path.join(repoRoot, 'android/app/src/main/res/values/styles.xml'),
      'utf8',
    );
    expect(styles).not.toContain('android:statusBarColor');
    expect(styles).not.toContain('android:navigationBarColor');
  });

  it('includes Play compliance config plugin in app.config.ts', () => {
    const configSource = fs.readFileSync(path.join(repoRoot, 'app.config.ts'), 'utf8');
    expect(configSource).toContain('withAndroidPlayCompliance');
    expect(configSource).toContain("tools:node': 'remove'");
  });
});
