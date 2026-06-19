/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * db-migration-runner.test.ts — tests for runMigrationsOnce branching logic.
 *
 * Strategy: mock React hooks (useState/useEffect) so useDatabaseMigrations can
 * be called as a plain function. The useEffect callback triggers runMigrationsOnce
 * which exercises the real migration logic against the mocked SQLite DB.
 * jest.isolateModules resets the singleton migrationsPromise between tests.
 */

const LEGACY_CHECKSUM = 'legacy';

let mockCapturedSetters: jest.Mock[] = [];

jest.mock('react', () => {
  const actual = jest.requireActual('react');
  return {
    ...actual,
    useState: jest.fn((init: unknown) => {
      const setter = jest.fn();
      mockCapturedSetters.push(setter);
      return [init, setter];
    }),
    useEffect: jest.fn((cb: () => (() => void) | void) => {
      cb();
    }),
  };
});

function makeMockExpo(overrides: Partial<Record<string, jest.Mock>> = {}) {
  return {
    execAsync: jest.fn().mockResolvedValue(undefined),
    getAllAsync: jest.fn().mockResolvedValue([]),
    runAsync: jest.fn().mockResolvedValue(undefined),
    withExclusiveTransactionAsync: jest.fn(async (cb: (tx: any) => Promise<void>) => {
      const tx = {
        execAsync: jest.fn().mockResolvedValue(undefined),
        runAsync: jest.fn().mockResolvedValue(undefined),
      };
      await cb(tx);
      return tx;
    }),
    ...overrides,
  };
}

function flush(): Promise<void> {
  return new Promise((r) => setTimeout(r, 50));
}

function loadAndTrigger(expo: ReturnType<typeof makeMockExpo>, migrations: Record<string, string>) {
  mockCapturedSetters = [];

  let mod: { useDatabaseMigrations: () => any; djb2Hex: (s: string) => string };

  jest.isolateModules(() => {
    jest.doMock('expo-sqlite', () => ({
      openDatabaseSync: jest.fn(() => expo),
    }));
    jest.doMock('drizzle-orm/expo-sqlite', () => ({
      drizzle: jest.fn(() => ({})),
    }));
    jest.doMock('../schema', () => ({}));
    jest.doMock('../migrations/migrations', () => ({ migrations }));

    mod = require('../db');
  });

  mod!.useDatabaseMigrations();

  return {
    mod: mod!,
    getSetSuccess: () => mockCapturedSetters[0],
    getSetError: () => mockCapturedSetters[1],
  };
}

describe('runMigrationsOnce', () => {
  it('singleton: second call reuses the same promise', async () => {
    const expo = makeMockExpo();
    const { mod } = loadAndTrigger(expo, {});
    await flush();

    mockCapturedSetters = [];
    mod.useDatabaseMigrations();
    await flush();

    const createCalls = expo.execAsync.mock.calls.filter((c: string[]) =>
      c[0]?.includes('CREATE TABLE'),
    );
    expect(createCalls).toHaveLength(1);
  });

  it('orphan detection: applied migration not in current list -> throws', async () => {
    const expo = makeMockExpo({
      getAllAsync: jest
        .fn()
        .mockResolvedValue([{ name: 'orphan_migration', checksum: 'abc12345' }]),
    });

    const { getSetError } = loadAndTrigger(expo, {
      '0001_init': 'CREATE TABLE x (id TEXT)',
    });
    await flush();

    expect(getSetError()).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('Unknown applied migration'),
      }),
    );
  });

  it('checksum mismatch: stored != expected -> throws', async () => {
    const sql = 'CREATE TABLE x (id TEXT)';
    const expo = makeMockExpo({
      getAllAsync: jest.fn().mockResolvedValue([{ name: '0001_init', checksum: 'deadbeef' }]),
    });

    const { getSetError } = loadAndTrigger(expo, { '0001_init': sql });
    await flush();

    expect(getSetError()).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('checksum mismatch'),
      }),
    );
  });

  it('legacy checksum: skip verification (no throw)', async () => {
    const expo = makeMockExpo({
      getAllAsync: jest.fn().mockResolvedValue([{ name: '0001_init', checksum: LEGACY_CHECKSUM }]),
    });

    const { getSetSuccess, getSetError } = loadAndTrigger(expo, {
      '0001_init': 'CREATE TABLE x (id TEXT)',
    });
    await flush();

    expect(getSetSuccess()).toHaveBeenCalledWith(true);
    expect(getSetError()).not.toHaveBeenCalled();
  });

  it('apply loop: skip already-applied, run new SQL', async () => {
    const txMock = {
      execAsync: jest.fn().mockResolvedValue(undefined),
      runAsync: jest.fn().mockResolvedValue(undefined),
    };
    const expo = makeMockExpo({
      getAllAsync: jest.fn().mockResolvedValue([{ name: '0001_init', checksum: LEGACY_CHECKSUM }]),
      withExclusiveTransactionAsync: jest.fn(async (cb: any) => {
        await cb(txMock);
      }),
    });

    const { getSetSuccess } = loadAndTrigger(expo, {
      '0001_init': 'CREATE TABLE x (id TEXT)',
      '0002_add_col': 'ALTER TABLE x ADD COLUMN name TEXT',
    });
    await flush();

    expect(getSetSuccess()).toHaveBeenCalledWith(true);
    expect(expo.withExclusiveTransactionAsync).toHaveBeenCalledTimes(1);
    expect(txMock.execAsync).toHaveBeenCalledWith('ALTER TABLE x ADD COLUMN name TEXT');
  });

  it('duplicate column catch: ALTER TABLE on existing column -> swallowed', async () => {
    const expo = makeMockExpo({
      execAsync: jest
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('duplicate column name: checksum')),
    });

    const { getSetSuccess, getSetError } = loadAndTrigger(expo, {});
    await flush();

    expect(getSetSuccess()).toHaveBeenCalledWith(true);
    expect(getSetError()).not.toHaveBeenCalled();
  });

  it('other ALTER error -> rethrown', async () => {
    const expo = makeMockExpo({
      execAsync: jest
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('disk I/O error')),
    });

    const { getSetError } = loadAndTrigger(expo, {});
    await flush();

    expect(getSetError()).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'disk I/O error' }),
    );
  });

  it('statement breakpoints are stripped before execution', async () => {
    const txMock = {
      execAsync: jest.fn().mockResolvedValue(undefined),
      runAsync: jest.fn().mockResolvedValue(undefined),
    };
    const expo = makeMockExpo({
      withExclusiveTransactionAsync: jest.fn(async (cb: any) => {
        await cb(txMock);
      }),
    });

    const sqlWithBreakpoint =
      'CREATE TABLE a (id TEXT);--> statement-breakpointCREATE TABLE b (id TEXT);';

    loadAndTrigger(expo, { '0001_init': sqlWithBreakpoint });
    await flush();

    expect(txMock.execAsync).toHaveBeenCalledWith(
      'CREATE TABLE a (id TEXT);CREATE TABLE b (id TEXT);',
    );
  });
});
