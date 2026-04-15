import { loadThemePreference, saveThemePreference } from './userPreferences';

const mockSelectSingle = jest.fn();
const mockUpsert = jest.fn();

jest.mock('../../data/remote/supabaseClient', () => ({
  supabase: {
    from: (): object => ({
      select: (): object => ({
        eq: (): object => ({
          maybeSingle: mockSelectSingle,
        }),
      }),
      upsert: mockUpsert,
    }),
  },
}));

describe('userPreferences repository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('loadThemePreference returns remote value when present', async () => {
    mockSelectSingle.mockResolvedValue({ data: { theme_preference: 'dark' }, error: null });
    const result = await loadThemePreference('user-1');
    expect(result).toBe('dark');
  });

  it('loadThemePreference returns null when row does not exist', async () => {
    mockSelectSingle.mockResolvedValue({ data: null, error: null });
    const result = await loadThemePreference('user-1');
    expect(result).toBeNull();
  });

  it('loadThemePreference returns null on network error (non-fatal)', async () => {
    mockSelectSingle.mockResolvedValue({ data: null, error: { message: 'network' } });
    const result = await loadThemePreference('user-1');
    expect(result).toBeNull();
  });

  it('saveThemePreference upserts with userId + preference', async () => {
    mockUpsert.mockResolvedValue({ error: null });
    await saveThemePreference('user-1', 'light');
    expect(mockUpsert).toHaveBeenCalledWith(
      { user_id: 'user-1', theme_preference: 'light', updated_at: expect.any(String) },
      { onConflict: 'user_id' },
    );
  });

  it('saveThemePreference swallows errors (non-fatal)', async () => {
    mockUpsert.mockResolvedValue({ error: { message: 'offline' } });
    await expect(saveThemePreference('user-1', 'dark')).resolves.toBeUndefined();
  });
});
