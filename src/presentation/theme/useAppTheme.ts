import { useColorScheme } from 'react-native';
import { MD3LightTheme, MD3DarkTheme, configureFonts } from 'react-native-paper';
import { colours, darkColours } from './tokens';

const fontConfig = {
  displayLarge: {
    fontFamily: 'Fraunces_700Bold',
    fontSize: 48,
    fontWeight: '700' as const,
    letterSpacing: -0.5,
  },
  displayMedium: {
    fontFamily: 'Fraunces_700Bold',
    fontSize: 36,
    fontWeight: '700' as const,
    letterSpacing: -0.5,
  },
  headlineLarge: {
    fontFamily: 'Fraunces_700Bold',
    fontSize: 28,
    fontWeight: '700' as const,
    letterSpacing: -0.25,
  },
  headlineMedium: {
    fontFamily: 'Fraunces_700Bold',
    fontSize: 22,
    fontWeight: '700' as const,
    letterSpacing: 0,
  },
  titleLarge: {
    fontFamily: 'PlusJakartaSans_600SemiBold',
    fontSize: 18,
    fontWeight: '600' as const,
    letterSpacing: 0,
  },
  titleMedium: {
    fontFamily: 'PlusJakartaSans_600SemiBold',
    fontSize: 16,
    fontWeight: '600' as const,
    letterSpacing: 0.15,
  },
  bodyLarge: {
    fontFamily: 'PlusJakartaSans_400Regular',
    fontSize: 16,
    fontWeight: '400' as const,
    letterSpacing: 0.15,
  },
  bodyMedium: {
    fontFamily: 'PlusJakartaSans_400Regular',
    fontSize: 14,
    fontWeight: '400' as const,
    letterSpacing: 0.25,
  },
  labelLarge: {
    fontFamily: 'PlusJakartaSans_600SemiBold',
    fontSize: 14,
    fontWeight: '600' as const,
    letterSpacing: 0.1,
  },
  labelMedium: {
    fontFamily: 'PlusJakartaSans_500Medium',
    fontSize: 12,
    fontWeight: '500' as const,
    letterSpacing: 0.5,
  },
  labelSmall: {
    fontFamily: 'PlusJakartaSans_500Medium',
    fontSize: 11,
    fontWeight: '500' as const,
    letterSpacing: 0.5,
  },
};

const sharedThemeBase = {
  fonts: configureFonts({ config: fontConfig }),
  roundness: 3,
};

export const lightTheme = {
  ...MD3LightTheme,
  ...sharedThemeBase,
  colors: {
    ...MD3LightTheme.colors,
    primary: colours.primary,
    primaryContainer: colours.primaryContainer,
    onPrimary: colours.onPrimary,
    onPrimaryContainer: colours.onPrimaryContainer,
    secondary: colours.secondary,
    secondaryContainer: colours.secondaryContainer,
    onSecondary: colours.onSecondary,
    onSecondaryContainer: colours.onSecondaryContainer,
    error: colours.error,
    errorContainer: colours.errorContainer,
    onError: colours.onError,
    surface: colours.surface,
    surfaceVariant: colours.surfaceVariant,
    onSurface: colours.onSurface,
    onSurfaceVariant: colours.onSurfaceVariant,
    background: colours.background,
    outline: colours.outline,
    outlineVariant: colours.outlineVariant,
  },
};

export const darkTheme = {
  ...MD3DarkTheme,
  ...sharedThemeBase,
  colors: {
    ...MD3DarkTheme.colors,
    primary: darkColours.primary,
    primaryContainer: darkColours.primaryContainer,
    onPrimary: darkColours.onPrimary,
    onPrimaryContainer: darkColours.onPrimaryContainer,
    secondary: darkColours.secondary,
    secondaryContainer: darkColours.secondaryContainer,
    onSecondary: darkColours.onSecondary,
    onSecondaryContainer: darkColours.onSecondaryContainer,
    error: darkColours.error,
    errorContainer: darkColours.errorContainer,
    onError: darkColours.onError,
    surface: darkColours.surface,
    surfaceVariant: darkColours.surfaceVariant,
    onSurface: darkColours.onSurface,
    onSurfaceVariant: darkColours.onSurfaceVariant,
    background: darkColours.background,
    outline: darkColours.outline,
    outlineVariant: darkColours.outlineVariant,
  },
};

export function useAppTheme(): typeof lightTheme | typeof darkTheme {
  const scheme = useColorScheme();
  return scheme === 'dark' ? darkTheme : lightTheme;
}
