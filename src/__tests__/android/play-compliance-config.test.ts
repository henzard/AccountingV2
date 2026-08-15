import fs from 'fs';
import path from 'path';

const repoRoot = path.resolve(__dirname, '../../..');

/**
 * Return the body of the Gradle block that starts at `header` (e.g. 'release {'),
 * bounded by its matching closing brace. Slicing to end-of-file instead would let
 * unrelated config further down the file satisfy the assertions below.
 */
function gradleBlock(source: string, header: string, from = 0): string {
  const start = source.indexOf(header, from);
  if (start < 0) throw new Error(`block not found: ${header}`);
  let depth = 0;
  for (let i = start + header.indexOf('{'); i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces in block: ${header}`);
}

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

  it('enables R8 minification for release builds', () => {
    const gradleProps = fs.readFileSync(path.join(repoRoot, 'android/gradle.properties'), 'utf8');
    expect(gradleProps).toMatch(/^android\.enableMinifyInReleaseBuilds=true$/m);
  });

  it('wires the release build type to R8 with the optimised ProGuard baseline', () => {
    const buildGradle = fs.readFileSync(path.join(repoRoot, 'android/app/build.gradle'), 'utf8');
    const buildTypes = gradleBlock(buildGradle, 'buildTypes {');
    const releaseBlock = gradleBlock(buildTypes, 'release {');
    // minifyEnabled must read the gradle.properties flag, not a hardcoded false.
    expect(releaseBlock).toMatch(/minifyEnabled\s+enableMinifyInReleaseBuilds/);
    expect(buildGradle).toMatch(
      /enableMinifyInReleaseBuilds\s*=\s*\(findProperty\('android\.enableMinifyInReleaseBuilds'\)/,
    );
    // proguard-android.txt sets -dontoptimize, which would disable R8's
    // optimisation passes; the project's own keep rules must also be applied.
    expect(releaseBlock).toMatch(
      /getDefaultProguardFile\("proguard-android-optimize\.txt"\),\s*"proguard-rules\.pro"/,
    );
    expect(releaseBlock).not.toContain('getDefaultProguardFile("proguard-android.txt")');
    // Resource shrinking stays opt-in via property, defaulting to false.
    expect(releaseBlock).toMatch(
      /findProperty\('android\.enableShrinkResourcesInReleaseBuilds'\)\s*\?:\s*'false'/,
    );
  });

  it('keeps line-number attributes so Crashlytics can deobfuscate R8 stack traces', () => {
    const proguard = fs.readFileSync(path.join(repoRoot, 'android/app/proguard-rules.pro'), 'utf8');
    expect(proguard).toContain('-keepattributes SourceFile,LineNumberTable');
    expect(proguard).toContain('-renamesourcefileattribute SourceFile');
  });

  it('leaves resource shrinking off (RN resolves some drawables by name at runtime)', () => {
    const gradleProps = fs.readFileSync(path.join(repoRoot, 'android/gradle.properties'), 'utf8');
    expect(gradleProps).not.toMatch(/^android\.enableShrinkResourcesInReleaseBuilds=true$/m);
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
