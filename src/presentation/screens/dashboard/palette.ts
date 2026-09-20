/**
 * PULSE dashboard palette — shared hard-coded colors used by the dashboard's
 * dark/light surface treatment (gradients, card backgrounds/borders).
 *
 * Previously lived on `HeroSummaryCard` (`export const P = ...`) purely so
 * `DashboardScreen`/`BabyStepsBar` could import it after `HeroSummaryCard`
 * itself stopped being rendered anywhere (see the dashboard redesign) — this
 * module is the real home for it now that the component is gone.
 */
export const P = {
  // text
  heroText: '#E2F5EC',
  heroMuted: 'rgba(160,210,190,0.50)',
  // accent
  accent: '#00D68F',
  accentDim: 'rgba(0,214,143,0.50)',
  // dark surfaces
  cardBgDark: 'rgba(255,255,255,0.05)',
  cardBorderDark: 'rgba(255,255,255,0.09)',
  // light surfaces
  cardBgLight: '#0E2B24',
  tileBgLight: '#FFFFFF',
  tileBorderLight: '#E2EBE8',
  screenBgLight: '#F2F5F3',
  // dark tile surfaces
  tileBgDark: 'rgba(255,255,255,0.04)',
  tileBorderDark: 'rgba(255,255,255,0.07)',
  // shared
  divider: 'rgba(255,255,255,0.07)',
  statLabel: 'rgba(160,210,190,0.40)',
  statValue: 'rgba(200,235,220,0.85)',
  scoreBg: 'rgba(0,214,143,0.08)',
  scoreBorder: 'rgba(0,214,143,0.15)',
  amber: '#FFD000',
  amberLight: '#B26000',
  red: '#FF6B6B',
  redLight: '#C62828',
  navBgDark: 'rgba(6,20,16,0.95)',
} as const;
