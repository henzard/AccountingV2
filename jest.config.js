const appProject = {
  displayName: 'app',
  preset: 'jest-expo',
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/supabase/', '<rootDir>/tests/'],
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
    // Native SQLite + ORM stubs — avoid native module load in unit tests.
    '^expo-sqlite$': '<rootDir>/__mocks__/expo-sqlite.js',
    '^drizzle-orm/expo-sqlite$': '<rootDir>/__mocks__/drizzle-orm-expo-sqlite.js',
    // Bundled SQL migration files cannot be parsed by Jest — stub them out.
    '^.*/migrations/migrations$': '<rootDir>/__mocks__/migrations-stub.js',
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
};

// Shared node-tier transform + expo-crypto shim (used by both the offline
// realsql tier and the Postgres-backed two-device tier).
// `createSyncedRepo.ts` generates oplog ids via `expo-crypto`'s `randomUUID()`.
// The real package is ESM with a native RN/Expo bridge — neither works under
// this plain "node" environment, so it's stubbed with a Node
// `crypto.randomUUID()`-backed shim.
const nodeTierTransform = {
  '^.+\\.ts$': [
    'babel-jest',
    {
      presets: [
        ['@babel/preset-env', { targets: { node: 'current' } }],
        '@babel/preset-typescript',
      ],
    },
  ],
};
const nodeTierModuleNameMapper = {
  '^expo-crypto$': '<rootDir>/__mocks__/expo-crypto.js',
};

// Real-SQL tier: node environment, real better-sqlite3 against the actual
// migration files. Offline (no network) — runs in CI's `check` job.
const realSqlProject = {
  displayName: 'realsql',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/realsql/**/*.test.ts'],
  // The two-device convergence tier needs a live Postgres (local Supabase),
  // so it runs in CI's `db` job — NOT this offline project. Exclude it here.
  testPathIgnorePatterns: ['<rootDir>/tests/realsql/twoDevice/'],
  transform: nodeTierTransform,
  moduleNameMapper: nodeTierModuleNameMapper,
};

// Two-device convergence tier: drives the REAL sync_push/sync_pull RPCs against
// a live local Supabase Postgres. Requires the stack up — runs in CI's `db` job.
const twoDeviceProject = {
  displayName: 'twodevice',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/realsql/twoDevice/**/*.test.ts'],
  transform: nodeTierTransform,
  moduleNameMapper: nodeTierModuleNameMapper,
};

module.exports = {
  projects: [appProject, realSqlProject, twoDeviceProject],
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
  coverageThreshold: { global: { lines: 80, branches: 60 } },
};
