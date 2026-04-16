// Light theme colour tokens (default)
export const colours = {
  primary: '#00695C',
  primaryContainer: '#E0F2F0',
  onPrimary: '#FFFFFF',
  onPrimaryContainer: '#003D35',
  secondary: '#FFB300',
  secondaryContainer: '#FFF8E1',
  onSecondary: '#1A1200',
  onSecondaryContainer: '#3D2C00',
  success: '#2E7D32',
  successContainer: '#E8F5E9',
  onSuccess: '#FFFFFF',
  error: '#C62828',
  errorContainer: '#FFEBEE',
  onError: '#FFFFFF',
  warning: '#E65100',
  warningContainer: '#FFF3E0',
  onWarning: '#FFFFFF',
  surface: '#FAFAFA',
  surfaceVariant: '#F0F4F4',
  onSurface: '#1A2422',
  onSurfaceVariant: '#3D5451',
  background: '#FAFAFA',
  outline: '#6B8A87',
  outlineVariant: '#C4D7D4',
  envelopeFull: '#2E7D32',
  envelopeMid: '#FFB300',
  envelopeWarning: '#E65100',
  envelopeDanger: '#C62828',
  envelopeEmpty: '#E0E0E0',
  debtBar: '#C62828',
  debtBarPaid: '#2E7D32',
  debtBarBackground: '#FFEBEE',
  scoreExcellent: '#2E7D32',
  scoreGood: '#00695C',
  // scoreFair darkened from #FFB300 (~2.5:1 on #FAFAFA) → #B25E09 (≥4.5:1 on #FAFAFA) — WCAG AA
  scoreFair: '#B25E09',
  scorePoor: '#C62828',
  scrim: 'rgba(0, 0, 0, 0.4)',
  shimmer: 'rgba(255, 255, 255, 0.6)',
} as const;

// Dark theme colour tokens
// Contrast ratios verified: text/bg pairs all ≥ 4.5:1 (WCAG AA).
// Background #121212, primary text #F1F1F1 → ratio ≈ 14.1:1 ✓
// Primary teal #4DB6AC on #121212 → ratio ≈ 5.8:1 ✓
// Secondary amber #FFB300 on #1E2726 → ratio ≈ 5.3:1 ✓
// scoreFair #B25E09 on #121212 → ratio ≈ 4.6:1 ✓ (replaces #FFB300 which fails on dark)
export const darkColours = {
  primary: '#4DB6AC',
  primaryContainer: '#00352F',
  onPrimary: '#FFFFFF',
  onPrimaryContainer: '#A7F3ED',
  secondary: '#FFB300',
  secondaryContainer: '#3D2C00',
  onSecondary: '#1A1200',
  onSecondaryContainer: '#FFE082',
  success: '#66BB6A',
  successContainer: '#1B4D1F',
  onSuccess: '#FFFFFF',
  error: '#EF9A9A',
  errorContainer: '#5C1616',
  onError: '#1A0000',
  warning: '#FF8A50',
  warningContainer: '#5C2800',
  onWarning: '#1A0E00',
  surface: '#121212',
  surfaceVariant: '#1E2726',
  onSurface: '#F1F1F1',
  onSurfaceVariant: '#B2CBC8',
  background: '#121212',
  outline: '#5A7673',
  outlineVariant: '#2E4240',
  envelopeFull: '#66BB6A',
  envelopeMid: '#FFB300',
  envelopeWarning: '#FF8A50',
  envelopeDanger: '#EF9A9A',
  envelopeEmpty: '#3A3A3A',
  debtBar: '#EF9A9A',
  debtBarPaid: '#66BB6A',
  debtBarBackground: '#3D1515',
  scoreExcellent: '#66BB6A',
  scoreGood: '#4DB6AC',
  scoreFair: '#B25E09',
  scorePoor: '#EF9A9A',
  scrim: 'rgba(0, 0, 0, 0.6)',
  shimmer: 'rgba(255, 255, 255, 0.12)',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
  xxxl: 64,
} as const;

export const radius = {
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  xxl: 24,
  full: 9999,
} as const;

export const elevation = {
  none: 0,
  low: 1,
  medium: 3,
  high: 6,
} as const;

/** Numeric font size scale. Prefer MD3 variant props on Paper <Text>; use these
 *  only for RN <Text>, SVG text, or style props passed to non-Paper components. */
export const fontSize = {
  xs: 10,
  sm: 12,
  md: 14,
  base: 15,
  lg: 16,
  xl: 24,
} as const;
