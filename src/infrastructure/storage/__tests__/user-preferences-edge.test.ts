jest.mock('../../../data/remote/supabaseClient', () => {
  const mockFrom = jest.fn();
  return {
    supabase: { from: mockFrom },
    __mockFrom: mockFrom,
  };
});

/* eslint-disable @typescript-eslint/no-require-imports */
import { loadThemePreference, saveThemePreference } from '../userPreferences';

const { __mockFrom } = require('../../../data/remote/supabaseClient');
const mockFrom = __mockFrom as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('loadThemePreference', () => {
  it('invalid theme value stored (e.g., "purple") -> returns null', async () => {
    mockFrom.mockReturnValue({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: { theme_preference: 'purple' }, error: null }),
        }),
      }),
    });

    const result = await loadThemePreference('user-1');

    expect(result).toBeNull();
  });

  it('valid "system" -> returns "system"', async () => {
    mockFrom.mockReturnValue({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: { theme_preference: 'system' }, error: null }),
        }),
      }),
    });

    const result = await loadThemePreference('user-1');

    expect(result).toBe('system');
  });

  it('valid "light" -> returns "light"', async () => {
    mockFrom.mockReturnValue({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: { theme_preference: 'light' }, error: null }),
        }),
      }),
    });

    const result = await loadThemePreference('user-1');

    expect(result).toBe('light');
  });

  it('valid "dark" -> returns "dark"', async () => {
    mockFrom.mockReturnValue({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: { theme_preference: 'dark' }, error: null }),
        }),
      }),
    });

    const result = await loadThemePreference('user-1');

    expect(result).toBe('dark');
  });

  it('Supabase error -> returns null', async () => {
    mockFrom.mockReturnValue({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: null, error: { message: 'rls' } }),
        }),
      }),
    });

    const result = await loadThemePreference('user-1');

    expect(result).toBeNull();
  });

  it('no data -> returns null', async () => {
    mockFrom.mockReturnValue({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
        }),
      }),
    });

    const result = await loadThemePreference('user-1');

    expect(result).toBeNull();
  });

  it('missing theme_preference field -> returns null', async () => {
    mockFrom.mockReturnValue({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: { some_other_field: 'value' }, error: null }),
        }),
      }),
    });

    const result = await loadThemePreference('user-1');

    expect(result).toBeNull();
  });
});

describe('saveThemePreference', () => {
  it('upserts the preference', async () => {
    const upsertMock = jest.fn().mockResolvedValue({ error: null });
    mockFrom.mockReturnValue({ upsert: upsertMock });

    await saveThemePreference('user-1', 'dark');

    expect(mockFrom).toHaveBeenCalledWith('user_preferences');
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        theme_preference: 'dark',
      }),
      { onConflict: 'user_id' },
    );
  });
});
