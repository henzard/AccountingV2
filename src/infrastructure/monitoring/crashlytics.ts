import crashlytics from '@react-native-firebase/crashlytics';

export async function initCrashlytics(userId: string | null): Promise<void> {
  // Disable collection in dev so local errors don't spam the dashboard.
  await crashlytics().setCrashlyticsCollectionEnabled(!__DEV__);
  if (userId) await crashlytics().setUserId(userId);
}

export function recordError(
  err: unknown,
  context?: Record<string, string | number | boolean>,
): void {
  if (context) {
    Object.entries(context).forEach(([k, v]) => {
      crashlytics().setAttribute(k, String(v));
    });
  }
  const error = err instanceof Error ? err : new Error(String(err));
  crashlytics().recordError(error);
}

export function log(message: string): void {
  crashlytics().log(message);
}
