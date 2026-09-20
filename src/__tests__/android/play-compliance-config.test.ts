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
    expect(configSource).toMatch(/expo-camera',\s*\{\s*barcodeScannerEnabled:\s*false\s*,?\s*recordAudioAndroid:\s*false\s*\}/);
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

  it('keeps the expo-modules-core records package so R8 cannot break Record arguments', () => {
    // Without this, R8 optimisation makes expo-sqlite's openDatabaseSync options
    // conversion throw at bundle load, which aborts the process on launch.
    const proguard = fs.readFileSync(path.join(repoRoot, 'android/app/proguard-rules.pro'), 'utf8');
    expect(proguard).toContain('-keep class expo.modules.kotlin.records.** { *; }');
  });

  it('keeps expo-notifications classes so R8 cannot rename scheduled-notification payload classes', () => {
    // expo-notifications ships this rule in its own proguard-rules.pro, but its
    // build.gradle declares no consumerProguardFiles, so that file is never applied
    // to consuming apps — it must be duplicated here or scheduled (Java-serialized)
    // notifications silently drop across R8 class renames.
    const proguard = fs.readFileSync(path.join(repoRoot, 'android/app/proguard-rules.pro'), 'utf8');
    expect(proguard).toContain('-keep class expo.modules.notifications.** { *; }');
  });

  it('registers the accountingv2:// scheme in AndroidManifest so password-reset links can open the app', () => {
    // app.config.ts sets scheme 'accountingv2' and ForgotPasswordScreen builds
    // reset links as accountingv2://reset-password, but the generated manifest
    // only carries the Expo dev-client scheme (exp+accountingv2) unless this is
    // added explicitly to the VIEW/BROWSABLE intent filter.
    const manifest = fs.readFileSync(
      path.join(repoRoot, 'android/app/src/main/AndroidManifest.xml'),
      'utf8',
    );
    expect(manifest).toContain('<data android:scheme="accountingv2"/>');
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

  it('disables audio recording in expo-camera plugin config', () => {
    const configSource = fs.readFileSync(path.join(repoRoot, 'app.config.ts'), 'utf8');
    expect(configSource).toMatch(/expo-camera',\s*\{\s*barcodeScannerEnabled:\s*false,\s*recordAudioAndroid:\s*false\s*\}/);
  });

  it('removes RECORD_AUDIO permission via tools:node="remove" in main manifest', () => {
    const manifest = fs.readFileSync(
      path.join(repoRoot, 'android/app/src/main/AndroidManifest.xml'),
      'utf8',
    );
    expect(manifest).toContain('android:name="android.permission.RECORD_AUDIO"');
    expect(manifest).toContain('tools:node="remove"');
    // Verify it's the RECORD_AUDIO permission that has tools:node="remove"
    expect(manifest).toMatch(/android:name="android\.permission\.RECORD_AUDIO"\s+tools:node="remove"/);
  });

  it('does not declare SYSTEM_ALERT_WINDOW in main manifest', () => {
    const manifest = fs.readFileSync(
      path.join(repoRoot, 'android/app/src/main/AndroidManifest.xml'),
      'utf8',
    );
    expect(manifest).not.toContain('android.permission.SYSTEM_ALERT_WINDOW');
  });

  it('does not declare expo.modules.updates metadata in main manifest', () => {
    const manifest = fs.readFileSync(
      path.join(repoRoot, 'android/app/src/main/AndroidManifest.xml'),
      'utf8',
    );
    expect(manifest).not.toContain('expo.modules.updates.ENABLED');
    expect(manifest).not.toContain('expo.modules.updates.EXPO_UPDATES_CHECK_ON_LAUNCH');
    expect(manifest).not.toContain('expo.modules.updates.EXPO_UPDATES_LAUNCH_WAIT_MS');
  });

  it('declares the tools namespace in main manifest root element', () => {
    const manifest = fs.readFileSync(
      path.join(repoRoot, 'android/app/src/main/AndroidManifest.xml'),
      'utf8',
    );
    expect(manifest).toMatch(/xmlns:tools="http:\/\/schemas\.android\.com\/tools"/);
  });

  it('declares SYSTEM_ALERT_WINDOW only in debug manifest', () => {
    const debugManifest = fs.readFileSync(
      path.join(repoRoot, 'android/app/src/debug/AndroidManifest.xml'),
      'utf8',
    );
    expect(debugManifest).toContain('android.permission.SYSTEM_ALERT_WINDOW');
  });
});
