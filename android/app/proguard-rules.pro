# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# react-native-reanimated
-keep class com.swmansion.reanimated.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }

# Crashlytics: keep source file and line numbers so obfuscated release stack
# traces stay readable once the mapping file is uploaded (the CD workflow runs
# uploadCrashlyticsMappingFileRelease). -renamesourcefileattribute hides the
# original file names while keeping the attribute R8 needs.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# expo-modules-core Record conversion: keep the records package itself (the
# @Field/@Required annotations and RecordTypeConverter), not just the Record
# implementations its consumer rules cover. With R8 optimisation on, leaving
# it unkept makes every JS object -> Record argument fail with a bare
# NullPointerException. expo-sqlite's openDatabaseSync(name, options) runs at
# bundle load, so that surfaced as a SIGABRT on launch in 1.1.127.
-keep class expo.modules.kotlin.records.** { *; }

# Add any project specific keep options here:
