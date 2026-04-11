import AsyncStorage from '@react-native-async-storage/async-storage';
import type { NotificationPreferences } from './NotificationPreferences';
import { DEFAULT_NOTIFICATION_PREFERENCES } from './NotificationPreferences';

const STORAGE_KEY = '@accountingv2:notification_preferences';

export class NotificationPreferencesRepository {
  async load(): Promise<NotificationPreferences> {
    const json = await AsyncStorage.getItem(STORAGE_KEY);
    if (!json) return { ...DEFAULT_NOTIFICATION_PREFERENCES };
    try {
      return { ...DEFAULT_NOTIFICATION_PREFERENCES, ...JSON.parse(json) } as NotificationPreferences;
    } catch {
      return { ...DEFAULT_NOTIFICATION_PREFERENCES };
    }
  }

  async save(prefs: NotificationPreferences): Promise<void> {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  }
}
