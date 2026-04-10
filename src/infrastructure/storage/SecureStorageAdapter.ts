import * as SecureStore from 'expo-secure-store';
import type { SupportedStorage } from '@supabase/supabase-js';

export const SecureStorageAdapter: SupportedStorage = {
  getItem: (key: string): Promise<string | null> => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string): Promise<void> =>
    SecureStore.setItemAsync(key, value).then(() => undefined),
  removeItem: (key: string): Promise<void> =>
    SecureStore.deleteItemAsync(key).then(() => undefined),
};
