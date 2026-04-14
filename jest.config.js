module.exports = {
  preset: 'jest-expo',
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/supabase/'],
  setupFiles: ['<rootDir>/jest-setup-globals.js'],
  setupFilesAfterEnv: ['@testing-library/jest-native/extend-expect'],
  transformIgnorePatterns: [
    '/node_modules/(?!(.pnpm|react-native|@react-native|@react-native-community|expo|@expo|@expo-google-fonts|react-navigation|@react-navigation|@unimodules|unimodules|sentry-expo|native-base|react-native-svg|@supabase|zustand|drizzle-orm))',
  ],
  moduleNameMapper: {
    '^@domain/(.*)$': '<rootDir>/src/domain/$1',
    '^@data/(.*)$': '<rootDir>/src/data/$1',
    '^@presentation/(.*)$': '<rootDir>/src/presentation/$1',
    '^@infrastructure/(.*)$': '<rootDir>/src/infrastructure/$1',
    '^expo/src/winter$': '<rootDir>/__mocks__/expo-winter.js',
    '^expo/src/winter/(.*)$': '<rootDir>/__mocks__/expo-winter.js',
    // react-native-vector-icons is remapped to @expo/vector-icons by jest-expo preset.
    // Since @expo/vector-icons is not installed, we stub both paths with a minimal mock.
    '^react-native-vector-icons$': '<rootDir>/__mocks__/@expo/vector-icons/index.js',
    '^react-native-vector-icons/(.*)$': '<rootDir>/__mocks__/@expo/vector-icons/index.js',
    '^@expo/vector-icons/(.*)$': '<rootDir>/__mocks__/@expo/vector-icons/index.js',
    '^@expo/vector-icons$': '<rootDir>/__mocks__/@expo/vector-icons/index.js',
    '^@react-native-firebase/crashlytics$': '<rootDir>/__mocks__/@react-native-firebase/crashlytics.js',
    // Stub useAppTheme — avoids configureFonts (react-native-paper) in test env
    '^.*/theme/useAppTheme$': '<rootDir>/__mocks__/useAppTheme.js',
  },
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/index.ts',
    '!src/**/*.d.ts',
    '!src/presentation/navigation/**',
    '!src/presentation/theme/**',
    '!src/presentation/screens/settings/CrashLogViewer.tsx',
    '!src/infrastructure/monitoring/earlyCrashLog.ts',
    '!src/presentation/boot/**',
  ],
  coverageThreshold: { global: { lines: 65, branches: 50 } },
};
