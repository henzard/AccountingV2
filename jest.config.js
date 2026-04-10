module.exports = {
  preset: 'jest-expo',
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
  },
  collectCoverageFrom: ['src/domain/**/*.ts', '!src/domain/**/index.ts'],
  coverageThreshold: { global: { lines: 80 } },
};
