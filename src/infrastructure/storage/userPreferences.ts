import { supabase } from '../../data/remote/supabaseClient';
import type { ThemePreference } from '../../presentation/stores/themeStore';

export async function loadThemePreference(userId: string): Promise<ThemePreference | null> {
  const { data, error } = await supabase
    .from('user_preferences')
    .select('theme_preference')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) return null;
  const v = (data as { theme_preference?: string }).theme_preference;
  if (v === 'system' || v === 'light' || v === 'dark') return v;
  return null;
}

export async function saveThemePreference(
  userId: string,
  preference: ThemePreference,
): Promise<void> {
  await supabase.from('user_preferences').upsert(
    {
      user_id: userId,
      theme_preference: preference,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );
}
