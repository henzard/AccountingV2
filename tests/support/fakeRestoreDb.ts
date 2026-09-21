// tests/support/fakeRestoreDb.ts
//
// Hand-rolled doubles for the two collaborators `RestoreService` drives: a
// Supabase query builder and a Drizzle-shaped local database. They exist
// because RestoreService now (a) reads the household's server oplog cursor,
// (b) pages every table with `.range()`, and (c) commits the whole snapshot
// AND the cursor inside one `db.transaction(...)` — none of which the old
// one-method-deep `{ insert: () => ({ values: ... }) }` literals could model.
//
// Lives under tests/ (excluded from the `app` project's testMatch) so it is
// importable from the app-tier suites without being collected as a suite.

import { getTableName } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Supabase double
// ---------------------------------------------------------------------------

export interface FakeSupabaseConfig {
  /** Rows returned for `households` by id; a missing id resolves to null. */
  households?: Record<string, Record<string, unknown> | null>;
  /** Rows per remote table name (`household_members`, `envelopes`, ...). */
  tables?: Record<string, Record<string, unknown>[]>;
  /** Memberships returned for `household_members` filtered by `user_id`.
   * `RestoreService` chains `.is('deleted_at', null)` onto that query, and
   * this double applies the filter for real — a row carrying a non-null
   * `deleted_at` is dropped, exactly as PostgREST would. */
  memberships?: Record<string, unknown>[];
  /** Highest server oplog `seq` for the household; omitted means "no ops". */
  maxSeq?: number | null;
  /** Successive answers for the repeated max-seq reads `stabiliseCursor`
   * makes. Each read consumes the next entry; the last one repeats. Takes
   * precedence over `maxSeq`. */
  maxSeqSequence?: (number | null)[];
  /** Table names whose fetch must fail, mapped to the error message. */
  errors?: Record<string, string>;
  /**
   * Called with the table name AFTER each paged table fetch has taken its
   * rows. Lets a test model a write that lands mid-restore by mutating the
   * `tables` map it passed in — `rowsFor` re-reads it on every call, so the
   * next fetch of that table sees the new row.
   */
  onTableFetch?: (table: string) => void;
  /**
   * Makes the Nth `.range()` call (1-based) for `table` fail with `message`
   * instead of returning a page — models a network error on, say, page 2 of
   * a large table so a test can assert nothing partial was written locally.
   */
  failOnPage?: Record<string, { page: number; message: string }>;
}

export interface FakeSupabaseRecorder {
  /** Every `(table, column)` pair queried, in order. */
  queries: { table: string; column: string }[];
  /** Every `.is(column, value)` filter applied, per table, in order. */
  isFilters: { table: string; column: string; value: unknown }[];
  /** Every `.range(from, to)` a table fetch asked for. */
  ranges: { table: string; from: number; to: number }[];
  /** Every `.order(column, { ascending })` a table fetch applied, in order. */
  orders: { table: string; column: string; ascending: boolean }[];
  /** Every keyset continuation `.gt(column, value)` a paged fetch applied. */
  keysetAfter: { table: string; column: string; value: string | number }[];
  /** How many times the household's max oplog seq was read. */
  maxSeqReads: number;
}

type QueryResult = Promise<{ data: unknown; error: { message: string } | null }>;

/**
 * Builds the subset of the Supabase query builder RestoreService uses:
 * `.select().eq().maybeSingle()`, `.select().eq().range()` and
 * `.select().eq().order().limit()`.
 */
export function makeFakeSupabase(config: FakeSupabaseConfig = {}): {
  supabase: unknown;
  recorder: FakeSupabaseRecorder;
} {
  const recorder: FakeSupabaseRecorder = {
    queries: [],
    isFilters: [],
    ranges: [],
    orders: [],
    keysetAfter: [],
    maxSeqReads: 0,
  };
  /** How many `.range()` calls each table has taken so far — 1-based when
   * read, for `failOnPage`. */
  const rangeCallCounts = new Map<string, number>();

  const nextMaxSeq = (): number | null => {
    const sequence = config.maxSeqSequence;
    if (!sequence || sequence.length === 0) return config.maxSeq ?? null;
    const index = Math.min(recorder.maxSeqReads - 1, sequence.length - 1);
    return sequence[index];
  };

  const errorFor = (table: string): { message: string } | null => {
    const message = config.errors?.[table];
    return message ? { message } : null;
  };

  const rowsFor = (table: string, column: string, value: string): Record<string, unknown>[] => {
    if (table === 'household_members' && column === 'user_id') return config.memberships ?? [];
    if (table === 'households') {
      const row = config.households?.[value];
      return row ? [row] : [];
    }
    return config.tables?.[table] ?? [];
  };

  /** The chainable part of the builder — `.is()` returns one of these too,
   * so a filter can be appended anywhere in the chain. */
  interface FakeQueryBuilder {
    is(column: string, value: unknown): FakeQueryBuilder;
    maybeSingle(): QueryResult;
    range(from: number, to: number): QueryResult;
    order(col: string, opts?: { ascending?: boolean }): FakeQueryBuilder;
    gt(column: string, value: string | number): FakeQueryBuilder;
    limit(n: number): QueryResult;
    then(resolve: (r: { data: unknown; error: { message: string } | null }) => unknown): unknown;
  }

  const makeBuilder = (
    table: string,
    rows: Record<string, unknown>[],
    error: { message: string } | null,
  ): FakeQueryBuilder => ({
    is: (column: string, value: unknown): FakeQueryBuilder => {
      recorder.isFilters.push({ table, column, value });
      return makeBuilder(
        table,
        rows.filter((row) => (row[column] ?? null) === value),
        error,
      );
    },
    maybeSingle: (): QueryResult =>
      Promise.resolve({ data: error ? null : (rows[0] ?? null), error }),
    range: (from: number, to: number): QueryResult => {
      recorder.ranges.push({ table, from, to });
      const pageNumber = (rangeCallCounts.get(table) ?? 0) + 1;
      rangeCallCounts.set(table, pageNumber);
      const failure = config.failOnPage?.[table];
      if (failure && failure.page === pageNumber) {
        return Promise.resolve({ data: null, error: { message: failure.message } });
      }
      const page = error ? null : rows.slice(from, to + 1);
      config.onTableFetch?.(table);
      return Promise.resolve({ data: page, error });
    },
    // Used both for the oplog max-seq read (`.order().limit()`) and for
    // paged entity fetches (`.order().range()`) — a real Supabase/PostgREST
    // builder supports both continuations off `.order()`, so this fake
    // returns a full builder rather than the `.limit()`-only shape it used
    // to, and actually sorts by the given column so a test can hand rows in
    // an arbitrary order and still see deterministic paging.
    order: (col: string, opts?: { ascending?: boolean }): FakeQueryBuilder => {
      const ascending = opts?.ascending ?? true;
      recorder.orders.push({ table, column: col, ascending });
      const sorted = [...rows].sort((a, b) => {
        const av = a[col];
        const bv = b[col];
        if (av === bv) return 0;
        const cmp = av == null ? -1 : bv == null ? 1 : av < bv ? -1 : 1;
        return ascending ? cmp : -cmp;
      });
      return makeBuilder(table, sorted, error);
    },
    // Keyset continuation: "rows after this key". Applied for real, so a
    // test sees exactly the rows a PostgREST `gt` filter would return.
    gt: (column: string, value: string | number): FakeQueryBuilder => {
      recorder.keysetAfter.push({ table, column, value });
      return makeBuilder(
        table,
        rows.filter((row) => (row[column] as string | number) > value),
        error,
      );
    },
    limit: (n: number): QueryResult => {
      recorder.maxSeqReads += 1;
      const seq = nextMaxSeq();
      return Promise.resolve({
        data: error ? null : seq == null ? [] : [{ seq }].slice(0, n),
        error,
      });
    },
    then: (
      resolve: (r: { data: unknown; error: { message: string } | null }) => unknown,
    ): unknown => resolve({ data: error ? null : rows, error }),
  });

  const supabase = {
    from: (table: string) => ({
      select: (_columns?: string) => ({
        eq: (column: string, value: string): FakeQueryBuilder => {
          recorder.queries.push({ table, column });
          return makeBuilder(table, rowsFor(table, column, value), errorFor(table));
        },
      }),
    }),
  };

  return { supabase, recorder };
}

// ---------------------------------------------------------------------------
// Drizzle-shaped local database double
// ---------------------------------------------------------------------------

/** Renders the literal SQL text of a drizzle `sql` template (parameters are
 * left out — callers only need to recognise WHICH statement ran). */
function renderSql(query: unknown): string {
  const chunks = (query as { queryChunks?: unknown[] }).queryChunks ?? [];
  return chunks
    .map((chunk) => {
      const value = (chunk as { value?: unknown }).value;
      return Array.isArray(value) ? value.join('') : '';
    })
    .join(' ');
}

/** The parameter values bound into a drizzle `sql` template, in order. */
function sqlParams(query: unknown): unknown[] {
  const chunks = (query as { queryChunks?: unknown[] }).queryChunks ?? [];
  // Literal SQL arrives as `{ value: string[] }` chunks; bound parameters are
  // the raw values themselves, interleaved between them.
  return chunks.filter(
    (chunk) => !Array.isArray((chunk as { value?: unknown } | null)?.value ?? undefined),
  );
}

export interface FakeLocalDbConfig {
  /** Households that already have a `sync_cursor` row (restore must skip them). */
  householdsWithCursor?: string[];
  /** Row ids with an unpushed local oplog op (restore must not overwrite them). */
  unpushedRowIds?: string[];
  /** Rows the seeder's `select().from().where()` should see. A function is
   * re-read per call, for tests where a concurrent writer mutates the set. */
  existingBabySteps?: { stepNumber: number }[] | (() => { stepNumber: number }[]);
}

export interface FakeLocalDb {
  /** Rows written per local table name, in write order. */
  written: { table: string; row: Record<string, unknown>; conflict: 'update' | 'nothing' }[];
  /** `[householdId, seq]` for every `sync_cursor` write. */
  cursorWrites: { householdId: string; seq: number }[];
  /** True while the snapshot transaction is open — proves the cursor write is inside it. */
  transactions: number;
  /** Whether the transaction had committed before the cursor write landed. */
  cursorWrittenInTransaction: boolean;
  db: unknown;
}

/** A Drizzle-shaped local db that records what a restore writes. */
export function makeFakeLocalDb(config: FakeLocalDbConfig = {}): FakeLocalDb {
  const cursorHouseholds = new Set(config.householdsWithCursor ?? []);
  const state: FakeLocalDb = {
    written: [],
    cursorWrites: [],
    transactions: 0,
    cursorWrittenInTransaction: false,
    db: null,
  };
  let inTransaction = false;

  const insert = (table: unknown): unknown => {
    const name = getTableName(table as Parameters<typeof getTableName>[0]);
    return {
      values: (row: Record<string, unknown>) => ({
        onConflictDoUpdate: () => ({
          run: (): void => {
            state.written.push({ table: name, row, conflict: 'update' });
          },
        }),
        onConflictDoNothing: () => ({
          run: (): void => {
            state.written.push({ table: name, row, conflict: 'nothing' });
          },
        }),
      }),
    };
  };

  const run = (query: unknown): void => {
    const text = renderSql(query);
    if (text.includes('sync_cursor')) {
      const params = sqlParams(query);
      state.cursorWrites.push({
        householdId: String(params[0]),
        seq: Number(params[1]),
      });
      state.cursorWrittenInTransaction = inTransaction;
    }
  };

  const db = {
    insert,
    run,
    get: (query: unknown): unknown => {
      const params = sqlParams(query);
      if (renderSql(query).includes('sync_cursor')) {
        return cursorHouseholds.has(String(params[0])) ? { x: 1 } : undefined;
      }
      return undefined;
    },
    all: (query: unknown): unknown[] => {
      if (renderSql(query).includes('FROM oplog')) {
        return (config.unpushedRowIds ?? []).map((row_id) => ({ row_id }));
      }
      return [];
    },
    transaction: (fn: (tx: unknown) => unknown): unknown => {
      state.transactions += 1;
      inTransaction = true;
      try {
        return fn(db);
      } finally {
        inTransaction = false;
      }
    },
    // SeedBabyStepsUseCase's existence check.
    select: () => ({
      from: () => ({
        where: () => {
          const existing = config.existingBabySteps ?? [];
          return Promise.resolve(typeof existing === 'function' ? existing() : existing);
        },
      }),
    }),
  };

  state.db = db;
  return state;
}
