import { SupabaseSlipImageUploader, resetWifiOnlyCache } from '../SupabaseSlipImageUploader';

// Mock AsyncStorage and NetInfo before importing the module under test
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@react-native-community/netinfo', () => ({
  fetch: jest.fn().mockResolvedValue({ type: 'wifi', isConnected: true }),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';

const mockAsyncStorageGetItem = AsyncStorage.getItem as jest.Mock;
const mockNetInfoFetch = NetInfo.fetch as jest.Mock;

function makeSupabase() {
  const uploadFn = jest.fn().mockResolvedValue({ data: { path: 'h1/s1/0.jpg' }, error: null });
  const supabase = { storage: { from: jest.fn().mockReturnValue({ upload: uploadFn }) } } as any;
  return { supabase, uploadFn };
}

describe('SupabaseSlipImageUploader', () => {
  beforeEach(() => {
    resetWifiOnlyCache(); // ensure cache is clear so each test reads AsyncStorage fresh
    mockAsyncStorageGetItem.mockResolvedValue(null); // wifi-only off by default
    mockNetInfoFetch.mockResolvedValue({ type: 'wifi', isConnected: true });
  });

  it('uploads to slip-images/<household>/<slip>/<index>.jpg', async () => {
    const { supabase, uploadFn } = makeSupabase();
    const uploader = new SupabaseSlipImageUploader(supabase);
    const path = await uploader.upload({
      householdId: 'h1',
      slipId: 's1',
      frameIndex: 0,
      base64: 'dGVzdA==',
    });

    expect(supabase.storage.from).toHaveBeenCalledWith('slip-images');
    expect(uploadFn).toHaveBeenCalledWith(
      'h1/s1/0.jpg',
      expect.any(Uint8Array),
      expect.objectContaining({ contentType: 'image/jpeg' }),
    );
    expect(path).toBe('h1/s1/0.jpg');
  });

  it('throws on upload error', async () => {
    const uploadFn = jest
      .fn()
      .mockResolvedValue({ data: null, error: { message: 'storage fail' } });
    const supabase = { storage: { from: jest.fn().mockReturnValue({ upload: uploadFn }) } } as any;
    const uploader = new SupabaseSlipImageUploader(supabase);
    await expect(
      uploader.upload({ householdId: 'h1', slipId: 's1', frameIndex: 0, base64: 'dGVzdA==' }),
    ).rejects.toMatchObject({ message: 'storage fail' });
  });

  describe('WiFi-only enforcement', () => {
    it('throws SLIP_WIFI_REQUIRED when wifi-only is on and network type is cellular', async () => {
      mockAsyncStorageGetItem.mockResolvedValue('true');
      mockNetInfoFetch.mockResolvedValue({ type: 'cellular', isConnected: true });
      const { supabase } = makeSupabase();
      const uploader = new SupabaseSlipImageUploader(supabase);
      await expect(
        uploader.upload({ householdId: 'h1', slipId: 's1', frameIndex: 0, base64: 'dGVzdA==' }),
      ).rejects.toMatchObject({ code: 'SLIP_WIFI_REQUIRED' });
    });

    it('uploads normally when wifi-only is on and network type is wifi', async () => {
      mockAsyncStorageGetItem.mockResolvedValue('true');
      mockNetInfoFetch.mockResolvedValue({ type: 'wifi', isConnected: true });
      const { supabase, uploadFn } = makeSupabase();
      const uploader = new SupabaseSlipImageUploader(supabase);
      await uploader.upload({ householdId: 'h1', slipId: 's1', frameIndex: 0, base64: 'dGVzdA==' });
      expect(uploadFn).toHaveBeenCalled();
    });

    it('uploads normally when wifi-only is off regardless of network type', async () => {
      mockAsyncStorageGetItem.mockResolvedValue('false');
      mockNetInfoFetch.mockResolvedValue({ type: 'cellular', isConnected: true });
      const { supabase, uploadFn } = makeSupabase();
      const uploader = new SupabaseSlipImageUploader(supabase);
      await uploader.upload({ householdId: 'h1', slipId: 's1', frameIndex: 0, base64: 'dGVzdA==' });
      expect(uploadFn).toHaveBeenCalled();
    });
  });
});
