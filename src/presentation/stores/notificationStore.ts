import { create } from 'zustand';
import type { NotificationPreferences } from '../../infrastructure/notifications/NotificationPreferences';
import { DEFAULT_NOTIFICATION_PREFERENCES } from '../../infrastructure/notifications/NotificationPreferences';

interface NotificationState {
  preferences: NotificationPreferences;
  permissionsGranted: boolean;
}

interface NotificationActions {
  setPreferences: (prefs: NotificationPreferences) => void;
  setPermissionsGranted: (granted: boolean) => void;
}

export const useNotificationStore = create<NotificationState & NotificationActions>((set) => ({
  preferences: { ...DEFAULT_NOTIFICATION_PREFERENCES },
  permissionsGranted: false,
  setPreferences: (preferences): void => set({ preferences }),
  setPermissionsGranted: (permissionsGranted): void => set({ permissionsGranted }),
}));
