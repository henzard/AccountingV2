jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

import * as SecureStore from 'expo-secure-store';
import { SecureStorageAdapter } from '../SecureStorageAdapter';

const mockGetItemAsync = SecureStore.getItemAsync as jest.Mock;
const mockSetItemAsync = SecureStore.setItemAsync as jest.Mock;
const mockDeleteItemAsync = SecureStore.deleteItemAsync as jest.Mock;

describe('SecureStorageAdapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getItem', () => {
    it('delegates to SecureStore.getItemAsync', async () => {
      mockGetItemAsync.mockResolvedValue('stored-value');
      const result = await SecureStorageAdapter.getItem('my-key');
      expect(mockGetItemAsync).toHaveBeenCalledWith('my-key');
      expect(result).toBe('stored-value');
    });

    it('returns null when no value exists', async () => {
      mockGetItemAsync.mockResolvedValue(null);
      const result = await SecureStorageAdapter.getItem('missing-key');
      expect(result).toBeNull();
    });
  });

  describe('setItem', () => {
    it('delegates to SecureStore.setItemAsync', async () => {
      mockSetItemAsync.mockResolvedValue(undefined);
      const result = await SecureStorageAdapter.setItem('my-key', 'my-value');
      expect(mockSetItemAsync).toHaveBeenCalledWith('my-key', 'my-value');
      expect(result).toBeUndefined();
    });
  });

  describe('removeItem', () => {
    it('delegates to SecureStore.deleteItemAsync', async () => {
      mockDeleteItemAsync.mockResolvedValue(undefined);
      const result = await SecureStorageAdapter.removeItem('my-key');
      expect(mockDeleteItemAsync).toHaveBeenCalledWith('my-key');
      expect(result).toBeUndefined();
    });
  });
});
