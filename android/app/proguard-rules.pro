# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

-keep class com.facebook.react.turbomodule.** { *; }

# Crashlytics: keep source file and line numbers so obfuscated release stack
# traces stay readable once the mapping file is uploaded. The Crashlytics
# Gradle plugin runs :app:uploadCrashlyticsMappingFileRelease automatically as
# part of the release build (no separate CD step needed).
# -renamesourcefileattribute hides the original file names while keeping the
# attribute R8 needs.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# expo-modules-core Record conversion: keep the records package itself (the
# @Field/@Required annotations and RecordTypeConverter), not just the Record
# implementations its consumer rules cover. With R8 optimisation on, leaving
# it unkept makes every JS object -> Record argument fail with a bare
# NullPointerException. expo-sqlite's openDatabaseSync(name, options) runs at
# bundle load, so that surfaced as a SIGABRT on launch in 1.1.127.
-keep class expo.modules.kotlin.records.** { *; }

# expo-notifications ships this rule in its own android/proguard-rules.pro,
# but its build.gradle declares no consumerProguardFiles, so that file is
# never actually applied to consuming apps (verified: neither
# consumerProguardFiles nor proguardFiles reference it). Scheduled
# notifications are Java-serialized, so an R8 class rename across builds
# would silently drop them on deserialization without this kept locally.
-keep class expo.modules.notifications.** { *; }

# Add any project specific keep options here:
