jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn().mockResolvedValue(undefined),
  getItem: jest.fn().mockResolvedValue(null),
  removeItem: jest.fn().mockResolvedValue(undefined),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
/* eslint-disable @typescript-eslint/no-require-imports */
import { captureBoot, readLastCrash, clearLastCrash, CRASH_KEY } from '../earlyCrashLog';

const mockSetItem = AsyncStorage.setItem as jest.Mock;
const mockGetItem = AsyncStorage.getItem as jest.Mock;
const mockRemoveItem = AsyncStorage.removeItem as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('captureBoot', () => {
  it('Error instance -> captures stack', () => {
    const err = new Error('boot failure');
    captureBoot('App.tsx init', err);

    expect(mockSetItem).toHaveBeenCalledTimes(1);
    const [key, json] = mockSetItem.mock.calls[0];
    expect(key).toBe(CRASH_KEY);
    const record = JSON.parse(json);
    expect(record.step).toBe('App.tsx init');
    expect(record.message).toBe('boot failure');
    expect(record.stack).toContain('boot failure');
    expect(record.timestamp).toBeDefined();
  });

  it('non-Error -> string fallback', () => {
    captureBoot('init', 'string crash');

    const [, json] = mockSetItem.mock.calls[0];
    const record = JSON.parse(json);
    expect(record.message).toBe('string crash');
    expect(record.stack).toBeDefined();
  });

  it('non-Error object -> coerced via String()', () => {
    captureBoot('init', { code: 42 });

    const [, json] = mockSetItem.mock.calls[0];
    const record = JSON.parse(json);
    expect(record.message).toBe('[object Object]');
  });
});

describe('readLastCrash', () => {
  it('no stored data -> null', async () => {
    mockGetItem.mockResolvedValue(null);

    const result = await readLastCrash();

    expect(result).toBeNull();
    expect(mockGetItem).toHaveBeenCalledWith(CRASH_KEY);
  });

  it('stored JSON -> parses', async () => {
    const stored = {
      timestamp: '2026-01-01T00:00:00.000Z',
      step: 'boot',
      message: 'crash',
      stack: 'stack trace',
    };
    mockGetItem.mockResolvedValue(JSON.stringify(stored));

    const result = await readLastCrash();

    expect(result).toEqual(stored);
  });

  it('malformed JSON -> returns null', async () => {
    mockGetItem.mockResolvedValue('not valid json{{{');

    const result = await readLastCrash();

    expect(result).toBeNull();
  });
});

describe('clearLastCrash', () => {
  it('removes key', async () => {
    await clearLastCrash();

    expect(mockRemoveItem).toHaveBeenCalledWith(CRASH_KEY);
  });
});

describe('persistRecord (fire-and-forget)', () => {
  it('catch does not throw even when storage fails', () => {
    mockSetItem.mockRejectedValue(new Error('Storage broken'));

    // captureBoot calls persistRecord internally — should not throw
    expect(() => captureBoot('init', new Error('boom'))).not.toThrow();
  });
});

describe('installEarlyCrashHandler', () => {
  let originalErrorUtils: any;
  let originalAddEventListener: any;

  beforeEach(() => {
    originalErrorUtils = (global as any).ErrorUtils;
    originalAddEventListener = (global as any).addEventListener;
    // Reset the module's _installed flag by re-requiring
  });

  afterEach(() => {
    (global as any).ErrorUtils = originalErrorUtils;
    if (originalAddEventListener !== undefined) {
      (global as any).addEventListener = originalAddEventListener;
    } else {
      delete (global as any).addEventListener;
    }
  });

  it('idempotent: second call is a no-op', () => {
    // We need a fresh module to reset _installed
    jest.resetModules();

    const mockSetGlobalHandler = jest.fn();
    const mockGetGlobalHandler = jest.fn().mockReturnValue(() => {});
    (global as any).ErrorUtils = {
      setGlobalHandler: mockSetGlobalHandler,
      getGlobalHandler: mockGetGlobalHandler,
    };

    const freshModule = require('../earlyCrashLog');

    freshModule.installEarlyCrashHandler();
    expect(mockSetGlobalHandler).toHaveBeenCalledTimes(1);

    freshModule.installEarlyCrashHandler();
    expect(mockSetGlobalHandler).toHaveBeenCalledTimes(1); // still 1 — no-op
  });
});
