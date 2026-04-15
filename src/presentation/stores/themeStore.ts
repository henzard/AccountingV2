import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  loadThemePreference,
  saveThemePreference,
} from '../../infrastructure/storage/userPreferences';

export type ThemePreference = 'system' | 'light' | 'dark';
const STORAGE_KEY = '@theme:preference';

interface ThemeState {
  preference: ThemePreference;
  hydrated: boolean;
  setPreference: (p: ThemePreference, userId?: string) => void;
  markHydrated: () => void;
}

function isThemePreference(v: unknown): v is ThemePreference {
  return v === 'system' || v === 'light' || v === 'dark';
}

export const useThemeStore = create<ThemeState>((set) => ({
  preference: 'system',
  hydrated: false,
  setPreference: (preference, userId): void => {
    set({ preference });
    void AsyncStorage.setItem(STORAGE_KEY, preference).catch(() => {});
    if (userId) void saveThemePreference(userId, preference).catch(() => {});
  },
  markHydrated: (): void => set({ hydrated: true }),
}));

export async function hydrateThemeFromLocal(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (isThemePreference(raw)) {
      useThemeStore.setState({ preference: raw });
    }
  } finally {
    useThemeStore.getState().markHydrated();
  }
}

export async function hydrateThemeFromRemote(userId: string): Promise<void> {
  const remote = await loadThemePreference(userId);
  if (remote) {
    useThemeStore.setState({ preference: remote });
    void AsyncStorage.setItem(STORAGE_KEY, remote).catch(() => {});
  }
}
