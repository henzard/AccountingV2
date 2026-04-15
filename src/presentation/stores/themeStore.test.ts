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
