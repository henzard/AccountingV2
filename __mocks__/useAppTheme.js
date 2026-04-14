/**
 * Minimal useAppTheme stub for Jest.
 * Returns light theme token values — avoids react-native-paper's configureFonts call.
 */
const colours = {
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
  warning: '#E65100',
  warningContainer: '#FFF3E0',
  error: '#C62828',
  errorContainer: '#FFEBEE',
  onError: '#FFFFFF',
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
  scoreFair: '#B25E09',
  scorePoor: '#C62828',
  scrim: 'rgba(0,0,0,0.4)',
  shimmer: 'rgba(255,255,255,0.6)',
};

const lightTheme = {
  dark: false,
  colors: colours,
  fonts: {},
  roundness: 3,
};

function useAppTheme() {
  return lightTheme;
}

module.exports = { useAppTheme, lightTheme, darkTheme: lightTheme };
