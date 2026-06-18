import { NotificationPreferencesRepository } from '../NotificationPreferencesRepository';
import { DEFAULT_NOTIFICATION_PREFERENCES } from '../NotificationPreferences';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../logging/Logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';

const mockGetItem = AsyncStorage.getItem as jest.Mock;
const mockSetItem = AsyncStorage.setItem as jest.Mock;

describe('NotificationPreferencesRepository', () => {
  let repo: NotificationPreferencesRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    repo = new NotificationPreferencesRepository();
  });

  describe('load', () => {
    it('returns defaults when no stored value exists', async () => {
      mockGetItem.mockResolvedValue(null);
      const prefs = await repo.load();
      expect(prefs).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
    });

    it('merges stored partial prefs with defaults', async () => {
      mockGetItem.mockResolvedValue(
        JSON.stringify({ eveningLogPromptHour: 21, envelopeWarningEnabled: false }),
      );
      const prefs = await repo.load();
      expect(prefs.eveningLogPromptHour).toBe(21);
      expect(prefs.envelopeWarningEnabled).toBe(false);
      expect(prefs.eveningLogPromptEnabled).toBe(true);
      expect(prefs.meterReadingReminderDay).toBe(1);
    });

    it('returns defaults when stored JSON is malformed', async () => {
      mockGetItem.mockResolvedValue('not-json{{{');
      const prefs = await repo.load();
      expect(prefs).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
    });

    it('returns a fresh copy each time (not same reference)', async () => {
      mockGetItem.mockResolvedValue(null);
      const a = await repo.load();
      const b = await repo.load();
      expect(a).not.toBe(b);
      expect(a).toEqual(b);
    });

    it('reads from the correct storage key', async () => {
      mockGetItem.mockResolvedValue(null);
      await repo.load();
      expect(mockGetItem).toHaveBeenCalledWith('@accountingv2:notification_preferences');
    });
  });

  describe('save', () => {
    it('persists preferences as JSON string', async () => {
      const prefs = { ...DEFAULT_NOTIFICATION_PREFERENCES, eveningLogPromptHour: 20 };
      await repo.save(prefs);
      expect(mockSetItem).toHaveBeenCalledWith(
        '@accountingv2:notification_preferences',
        JSON.stringify(prefs),
      );
    });

    it('writes to the correct storage key', async () => {
      await repo.save(DEFAULT_NOTIFICATION_PREFERENCES);
      expect(mockSetItem).toHaveBeenCalledWith(
        '@accountingv2:notification_preferences',
        expect.any(String),
      );
    });
  });
});
