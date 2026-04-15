import { useThemeStore } from './themeStore';

describe('themeStore', () => {
  beforeEach(() => {
    useThemeStore.setState({ preference: 'system', hydrated: false });
  });

  it('defaults to system preference before hydration', () => {
    expect(useThemeStore.getState().preference).toBe('system');
    expect(useThemeStore.getState().hydrated).toBe(false);
  });

  it('setPreference updates value', () => {
    useThemeStore.getState().setPreference('dark');
    expect(useThemeStore.getState().preference).toBe('dark');
  });

  it('markHydrated flips hydrated to true', () => {
    useThemeStore.getState().markHydrated();
    expect(useThemeStore.getState().hydrated).toBe(true);
  });
});

import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn().mockResolvedValue(null),
    setItem: jest.fn().mockResolvedValue(undefined),
  },
}));
jest.mock('../../infrastructure/storage/userPreferences', () => ({
  loadThemePreference: jest.fn(),
  saveThemePreference: jest.fn(),
}));

import {
  loadThemePreference,
  saveThemePreference,
} from '../../infrastructure/storage/userPreferences';
import { hydrateThemeFromLocal, hydrateThemeFromRemote } from './themeStore';

const mockGetItem = AsyncStorage.getItem as jest.Mock;
const mockSetItem = AsyncStorage.setItem as jest.Mock;
const mockLoadRemote = loadThemePreference as jest.Mock;
const mockSaveRemote = saveThemePreference as jest.Mock;

describe('themeStore hydration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useThemeStore.setState({ preference: 'system', hydrated: false });
  });

  it('hydrateThemeFromLocal reads AsyncStorage and marks hydrated', async () => {
    mockGetItem.mockResolvedValue('dark');
    await hydrateThemeFromLocal();
    expect(mockGetItem).toHaveBeenCalledWith('@theme:preference');
    expect(useThemeStore.getState().preference).toBe('dark');
    expect(useThemeStore.getState().hydrated).toBe(true);
  });

  it('hydrateThemeFromLocal tolerates missing value', async () => {
    mockGetItem.mockResolvedValue(null);
    await hydrateThemeFromLocal();
    expect(useThemeStore.getState().preference).toBe('system');
    expect(useThemeStore.getState().hydrated).toBe(true);
  });

  it('hydrateThemeFromLocal ignores invalid values', async () => {
    mockGetItem.mockResolvedValue('turquoise');
    await hydrateThemeFromLocal();
    expect(useThemeStore.getState().preference).toBe('system');
  });

  it('setPreference writes to AsyncStorage', async () => {
    mockSetItem.mockResolvedValue(undefined);
    useThemeStore.getState().setPreference('light');
    // setter fires write asynchronously; flush microtasks
    await new Promise((r) => setImmediate(r));
    expect(mockSetItem).toHaveBeenCalledWith('@theme:preference', 'light');
  });

  it('hydrateThemeFromRemote overrides local when server has a value', async () => {
    mockLoadRemote.mockResolvedValue('light');
    useThemeStore.setState({ preference: 'dark', hydrated: true });
    await hydrateThemeFromRemote('user-1');
    expect(useThemeStore.getState().preference).toBe('light');
  });

  it('hydrateThemeFromRemote no-ops when remote returns null', async () => {
    mockLoadRemote.mockResolvedValue(null);
    useThemeStore.setState({ preference: 'dark', hydrated: true });
    await hydrateThemeFromRemote('user-1');
    expect(useThemeStore.getState().preference).toBe('dark');
  });

  it('setPreference also upserts to Supabase when userId provided', async () => {
    mockSaveRemote.mockResolvedValue(undefined);
    useThemeStore.getState().setPreference('dark', 'user-1');
    await new Promise((r) => setImmediate(r));
    expect(mockSaveRemote).toHaveBeenCalledWith('user-1', 'dark');
  });
});
