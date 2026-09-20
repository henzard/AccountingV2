# Extra R8 keep rules for the `e2e` build type's APP apk only (never applied
# to `release`). Detox's instrumentation is loaded into the app process and
# links against the Kotlin stdlib / coroutines that live in the app apk; R8
# removes whatever the app's own code does not reference. First evidence:
#   java.lang.NoClassDefFoundError: Failed resolution of: Lkotlin/TuplesKt;
#     at com.wix.detox.adapters.server.InvokeActionHandler.handle
-keep class kotlin.** { *; }
-keep class kotlinx.coroutines.** { *; }
-dontwarn kotlin.**
-dontwarn kotlinx.coroutines.**
