# R8 rules for the Detox INSTRUMENTATION (androidTest) APK of the `e2e` build
# type only. This APK is installed on the CI emulator and never shipped, so
# there is nothing to gain from shrinking or obfuscating it — it only has to
# link. Without these, minifyE2eAndroidTestWithR8 fails with "Missing classes
# detected" for classes the test APK references but that live in the app APK.
-dontwarn **
-dontobfuscate
-dontoptimize
-dontshrink
