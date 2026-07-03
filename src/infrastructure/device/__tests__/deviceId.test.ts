import AsyncStorage from '@react-native-async-storage/async-storage';
import { getDeviceId } from '../deviceId';

jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn().mockResolvedValue(undefined),
  getItem: jest.fn().mockResolvedValue(null),
}));

jest.mock('uuid', () => ({
  v4: jest.fn(() => 'generated-uuid-1'),
}));

describe('getDeviceId', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the persisted device id when one already exists', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce('existing-device-id');

    const id = await getDeviceId();

    expect(id).toBe('existing-device-id');
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });

  it('generates and persists a new uuid v4 on first call', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(null);

    const id = await getDeviceId();

    expect(id).toBe('generated-uuid-1');
    expect(AsyncStorage.setItem).toHaveBeenCalledWith('@device_id', 'generated-uuid-1');
  });

  it('reads the correct storage key', async () => {
    await getDeviceId();

    expect(AsyncStorage.getItem).toHaveBeenCalledWith('@device_id');
  });
});
