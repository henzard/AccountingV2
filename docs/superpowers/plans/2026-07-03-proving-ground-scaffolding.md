# Proving-Ground Scaffolding Implementation Plan (Slice 1 of 6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the real-engine test tiers (real SQLite for local migrations, real Postgres for the Supabase chain + RLS) in CI, proving they catch the bug classes the deep review found.

**Architecture:** A second Jest project (`realsql`, node environment) runs tests against better-sqlite3 with the actual migration SQL files; a new CI job boots local Supabase, replays the full remote migration chain, and runs a pgTAP adversarial RLS suite. This is Slice 1 of the [oplog sync & correctness rebuild spec](../specs/2026-07-03-oplog-sync-correctness-design.md) — slices 2–6 get their own plans once this lands.

**Tech Stack:** Jest 30 (multi-project), better-sqlite3, Supabase CLI (local stack via Docker), pgTAP.

## Global Constraints

- TypeScript strict; `npx tsc --noEmit` must stay green.
- ESLint `--max-warnings 0` on `src/`; prettier enforced by lint-staged pre-commit hooks (they run automatically on `git commit`).
- Existing Jest suite (jest-expo preset) must keep passing with unchanged coverage thresholds (lines 80 / branches 60).
- The app is NOT launched: rewriting an already-applied local migration is allowed, but note it resets dev installs (the boot checksum guard in `src/data/local/db.ts` will flag the changed file — uninstall/reinstall the dev app afterwards).
- Local Supabase requires Docker running (Docker Desktop on this machine; preinstalled on ubuntu CI runners).
- Windows dev shell: commands below are bash-compatible (run in Git Bash) unless noted.

---

### Task 1: `realsql` Jest project + local-migration harness + full-chain test (catches the invalid 0007)

**Files:**

- Modify: `jest.config.js`
- Modify: `package.json` (devDependencies + `test:realsql` script)
- Create: `tests/realsql/harness/openMigratedDb.ts`
- Create: `tests/realsql/migrations.test.ts`
- Modify: `src/data/local/migrations/0007_household_members_updated_at.sql`

**Interfaces:**

- Produces: `openMigratedDb(upToTag?: string): Database.Database` — opens an in-memory better-sqlite3 DB with `foreign_keys=ON` and all local migrations applied in journal order (optionally stopping after `upToTag`); and `applyMigrationsAfter(db: Database.Database, afterTag: string): void` — applies every migration after `afterTag` to an existing DB. Task 2 and all future slice tests consume these.

**Deliberate deviation from the spec:** the spec's Real-Postgres tier also lists "RPC signature contract tests". Those are deferred to Slice 2: today's client intentionally mismatches `join_household_via_invite` (the known invite bug), so a contract test added now would leave this slice permanently red. Slice 2 rebuilds the RPCs and lands the contract test with them.

- [ ] **Step 1: Install dependencies**

```bash
npm install --save-dev better-sqlite3 @types/better-sqlite3 @babel/preset-env @babel/preset-typescript
```

- [ ] **Step 2: Convert jest.config.js to multi-project**

Replace the entire file with (the `app` project is the existing config verbatim, plus `<rootDir>/tests/` added to its ignore list):

```js
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
    '^expo-sqlite$': '<rootDir>/__mocks__/expo-sqlite.js',
    '^drizzle-orm/expo-sqlite$': '<rootDir>/__mocks__/drizzle-orm-expo-sqlite.js',
    '^.*/migrations/migrations$': '<rootDir>/__mocks__/migrations-stub.js',
    '^expo/src/winter$': '<rootDir>/__mocks__/expo-winter.js',
    '^expo/src/winter/(.*)$': '<rootDir>/__mocks__/expo-winter.js',
    '^react-native-vector-icons$': '<rootDir>/__mocks__/@expo/vector-icons/index.js',
    '^react-native-vector-icons/(.*)$': '<rootDir>/__mocks__/@expo/vector-icons/index.js',
    '^@expo/vector-icons/(.*)$': '<rootDir>/__mocks__/@expo/vector-icons/index.js',
    '^@expo/vector-icons$': '<rootDir>/__mocks__/@expo/vector-icons/index.js',
    '^@react-native-firebase/crashlytics$':
      '<rootDir>/__mocks__/@react-native-firebase/crashlytics.js',
    '^.*/theme/useAppTheme$': '<rootDir>/__mocks__/useAppTheme.js',
  },
};

const realSqlProject = {
  displayName: 'realsql',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/realsql/**/*.test.ts'],
  transform: {
    '^.+\\.ts$': [
      'babel-jest',
      {
        presets: [
          ['@babel/preset-env', { targets: { node: 'current' } }],
          '@babel/preset-typescript',
        ],
      },
    ],
  },
};

module.exports = {
  projects: [appProject, realSqlProject],
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
```

Add to `package.json` scripts:

```json
"test:realsql": "jest --selectProjects realsql"
```

- [ ] **Step 3: Verify the existing suite still passes under multi-project config**

Run: `npx jest --selectProjects app --silent 2>&1 | tail -5`
Expected: same pass/fail counts as `master` (suite green).

- [ ] **Step 4: Write the migration harness**

Create `tests/realsql/harness/openMigratedDb.ts`:

```ts
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../src/data/local/migrations');

interface JournalEntry {
  idx: number;
  tag: string;
}

function readJournal(): JournalEntry[] {
  return (
    JSON.parse(fs.readFileSync(path.join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf8')) as {
      entries: JournalEntry[];
    }
  ).entries;
}

function applyOne(db: Database.Database, tag: string): void {
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, `${tag}.sql`), 'utf8');
  for (const statement of sql.split('--> statement-breakpoint')) {
    const trimmed = statement.trim();
    if (trimmed.length > 0) {
      try {
        db.exec(trimmed);
      } catch (e) {
        throw new Error(`Migration ${tag} failed: ${(e as Error).message}\nStatement: ${trimmed}`);
      }
    }
  }
}

/** Applies the real local migration chain (in journal order) to an in-memory DB. */
export function openMigratedDb(upToTag?: string): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const entry of readJournal()) {
    applyOne(db, entry.tag);
    if (upToTag !== undefined && entry.tag === upToTag) break;
  }
  return db;
}

/** Applies every migration AFTER `afterTag` (journal order) to an existing DB. */
export function applyMigrationsAfter(db: Database.Database, afterTag: string): void {
  let apply = false;
  for (const entry of readJournal()) {
    if (apply) applyOne(db, entry.tag);
    if (entry.tag === afterTag) apply = true;
  }
}
```

- [ ] **Step 5: Write the failing full-chain test**

Create `tests/realsql/migrations.test.ts`:

```ts
import { openMigratedDb, applyMigrationsAfter } from './harness/openMigratedDb';

describe('local migration chain (real SQLite)', () => {
  it('applies every migration in journal order to an empty database', () => {
    const db = openMigratedDb();
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
    ).map((r) => r.name);
    for (const expected of [
      'households',
      'household_members',
      'envelopes',
      'transactions',
      'baby_steps',
      'pending_sync',
      'audit_events',
      'slip_queue',
    ]) {
      expect(tables).toContain(expected);
    }
    db.close();
  });

  it('applies the chain to a database with seeded rows at 0006', () => {
    const db = openMigratedDb('0006_round_betty_brant');
    db.prepare(
      `INSERT INTO households (id, name, payday_day, created_at, updated_at)
       VALUES ('hh-1', 'Test Household', 25, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO household_members (id, household_id, user_id, role, joined_at)
       VALUES ('hm-1', 'hh-1', 'user-1', 'owner', '2026-01-01T00:00:00.000Z')`,
    ).run();
    // Apply the remaining migrations (0007+) on top of the seeded DB.
    expect(() => applyMigrationsAfter(db, '0006_round_betty_brant')).not.toThrow();
    const cols = (
      db.prepare('PRAGMA table_info(household_members)').all() as { name: string }[]
    ).map((c) => c.name);
    expect(cols).toContain('updated_at'); // 0007 applied
    db.close();
  });
});
```

If `household_members` at tag 0006 has different NOT NULL columns than `(id, household_id, user_id, role, joined_at)`, inspect them with `db.prepare("PRAGMA table_info(household_members)").all()` in the test and adjust the INSERT — do not weaken the assertion.

- [ ] **Step 6: Run the realsql project — expect the 0007 failure**

Run: `npm run test:realsql`
Expected: FAIL. Migration `0007_household_members_updated_at` aborts with SQLite error `Cannot add a column with non-constant default` (its `ADD COLUMN ... DEFAULT (strftime(...))` is illegal in `ALTER TABLE`). This is deep-review finding "Migration 0007 is invalid SQL" being caught by the new harness — the whole point of this slice.

If instead both tests PASS, the engine accepted the default: keep the tests, skip Step 7, and note in the commit message that 0007 applies cleanly under better-sqlite3.

- [ ] **Step 7: Fix migration 0007 with a constant default + backfill**

Replace the content of `src/data/local/migrations/0007_household_members_updated_at.sql` with:

```sql
ALTER TABLE `household_members` ADD `updated_at` text NOT NULL DEFAULT '';--> statement-breakpoint
UPDATE `household_members` SET `updated_at` = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE `updated_at` = '';
```

Note: this changes the file's checksum — the boot integrity guard in `src/data/local/db.ts` will reject existing dev installs. Uninstall/reinstall the dev app. Pre-launch, this is acceptable (Global Constraints).

- [ ] **Step 8: Run the realsql project — expect green**

Run: `npm run test:realsql`
Expected: PASS (2 tests).

- [ ] **Step 9: Verify typecheck, lint, and the app project**

Run: `npx tsc --noEmit && npx eslint src/ --ext .ts,.tsx --max-warnings 0 && npx jest --selectProjects app --silent 2>&1 | tail -3`
Expected: all green.

- [ ] **Step 10: Commit**

```bash
git add jest.config.js package.json package-lock.json tests/realsql/ src/data/local/migrations/0007_household_members_updated_at.sql
git commit -m "test(realsql): real-SQLite migration harness; fix invalid non-constant default in 0007"
```

---

### Task 2: Drizzle-schema ↔ migrated-database conformance test

**Files:**

- Create: `tests/realsql/schemaConformance.test.ts`

**Interfaces:**

- Consumes: `openMigratedDb()` from Task 1; the barrel export `src/data/local/schema/index.ts` (already exists).

- [ ] **Step 1: Write the failing test**

Create `tests/realsql/schemaConformance.test.ts`:

```ts
import { is } from 'drizzle-orm';
import { getTableConfig, SQLiteTable } from 'drizzle-orm/sqlite-core';
import * as schema from '../../src/data/local/schema';
import { openMigratedDb } from './harness/openMigratedDb';

const tables = Object.values(schema).filter((v): v is SQLiteTable => is(v, SQLiteTable));

describe('Drizzle schema conformance (real SQLite)', () => {
  it('finds at least one exported Drizzle table', () => {
    expect(tables.length).toBeGreaterThanOrEqual(10);
  });

  it('every Drizzle table and column exists in the fully-migrated database', () => {
    const db = openMigratedDb();
    for (const table of tables) {
      const cfg = getTableConfig(table);
      const info = db.prepare(`PRAGMA table_info(${cfg.name})`).all() as { name: string }[];
      expect({ table: cfg.name, exists: info.length > 0 }).toEqual({
        table: cfg.name,
        exists: true,
      });
      const dbColumns = info.map((c) => c.name);
      for (const column of cfg.columns) {
        expect({
          table: cfg.name,
          column: column.name,
          present: dbColumns.includes(column.name),
        }).toEqual({
          table: cfg.name,
          column: column.name,
          present: true,
        });
      }
    }
    db.close();
  });
});
```

- [ ] **Step 2: Run it**

Run: `npm run test:realsql`
Expected: PASS if TS schema and SQL migrations agree. A FAIL here is a real drift finding (the review flagged convention drift, not missing columns) — if a column is genuinely missing from the migrations, STOP and report it rather than editing the schema to match; that fix belongs in Slice 2's baseline.

- [ ] **Step 3: Commit**

```bash
git add tests/realsql/schemaConformance.test.ts
git commit -m "test(realsql): assert Drizzle TS schema matches migrated SQLite schema"
```

---

### Task 3: Local Supabase stack — `db reset` green, duplicate 010 removed, CI wired

**Files:**

- Create: `supabase/config.toml` (via `supabase init`)
- Delete: `supabase/migrations/010_user_preferences.sql`
- Modify: `.github/workflows/ci.yml`
- Modify: `package.json` (devDependency `supabase`)

**Interfaces:**

- Produces: a bootable local Supabase stack (`npx supabase start`) with the full migration chain applying cleanly — Task 4 and every future server-side test tier depends on this.

- [ ] **Step 1: Install the Supabase CLI and init config**

```bash
npm install --save-dev supabase
npx supabase init
```

Expected: creates `supabase/config.toml` (accept defaults; answer "n" to VS Code/Deno settings prompts if asked). The existing `supabase/functions` and `supabase/migrations` directories are untouched.

- [ ] **Step 2: Delete the duplicate migration 010**

`010_user_preferences.sql` re-creates the same `user_preferences` table and the same three policies as `008_user_preferences.sql` (verified: files differ only in header/trailing comments). `CREATE TABLE IF NOT EXISTS` survives re-application but the unguarded `CREATE POLICY up_select/up_insert/up_update` statements abort any fresh replay with `42710 duplicate_object`.

```bash
git rm supabase/migrations/010_user_preferences.sql
```

- [ ] **Step 3: Replay the full chain locally (Docker must be running)**

```bash
npx supabase start
npx supabase db reset
```

Expected: `db reset` applies 001 → 019 and finishes with `Finished supabase db reset`. If another migration aborts with `duplicate_object`, apply the same idempotency pattern in that file — prepend a guard for each failing statement:

```sql
DROP POLICY IF EXISTS <policy_name> ON <table>;
```

directly above its `CREATE POLICY <policy_name> ...`, and re-run `npx supabase db reset` until clean. Record every file touched in the commit message.

- [ ] **Step 4: Add the `db` job to CI and fix the branch glob**

In `.github/workflows/ci.yml`, change the push trigger (line 5) — `'*'` never matches `feat/...` slash branches:

```yaml
on:
  push:
    branches: ['**']
  pull_request:
```

Add after the `check` job (same indentation level):

```yaml
db:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4

    - uses: supabase/setup-cli@v1
      with:
        version: latest

    - name: Boot local Supabase stack
      run: supabase start

    - name: Replay full migration chain
      run: supabase db reset

    - name: Run pgTAP suite
      run: supabase test db
```

(`supabase test db` passes trivially until Task 4 adds tests.)

- [ ] **Step 5: Verify locally, then commit**

Run: `npx supabase test db`
Expected: no failures (zero test files is OK at this point).

```bash
git add supabase/config.toml .github/workflows/ci.yml package.json package-lock.json
git commit -m "ci(db): local Supabase stack in CI; remove duplicate migration 010; fix branch glob"
```

Push the branch and confirm the `db` job goes green in GitHub Actions before starting Task 4.

---

### Task 4: pgTAP harness + first adversarial cross-household RLS probes

**Files:**

- Create: `supabase/tests/rls_cross_household.test.sql`

**Interfaces:**

- Consumes: the local stack from Task 3.
- Produces: the seed pattern (two auth users, two households, memberships, JWT-claim switching) that Slice 2's full per-table RLS suite will copy.

- [ ] **Step 1: Write the pgTAP test**

Create `supabase/tests/rls_cross_household.test.sql`:

```sql
begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

-- Seed: two auth users
insert into auth.users (id, email)
values
  ('00000000-0000-0000-0000-00000000000a', 'user-a@test.local'),
  ('00000000-0000-0000-0000-00000000000b', 'user-b@test.local');

-- Two households; membership triggers populate user_households
insert into public.households (id, name, payday_day, created_at, updated_at)
values
  ('hh-a', 'Household A', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('hh-b', 'Household B', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

insert into public.household_members (id, household_id, user_id, role, joined_at)
values
  ('hm-a', 'hh-a', '00000000-0000-0000-0000-00000000000a', 'owner', '2026-01-01T00:00:00.000Z'),
  ('hm-b', 'hh-b', '00000000-0000-0000-0000-00000000000b', 'owner', '2026-01-01T00:00:00.000Z');

insert into public.envelopes (id, household_id, name, allocated_cents, spent_cents, envelope_type, period_start, created_at, updated_at)
values
  ('env-b', 'hh-b', 'Groceries B', 10000, 0, 'spending', '2026-01-01', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

-- Act as user A (authenticated)
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';

select is(
  (select count(*)::int from public.households where id = 'hh-a'),
  1, 'member sees own household');

select is(
  (select count(*)::int from public.households where id = 'hh-b'),
  0, 'cross-household SELECT on households returns zero rows');

select is(
  (select count(*)::int from public.envelopes where household_id = 'hh-b'),
  0, 'cross-household SELECT on envelopes returns zero rows');

-- Anonymous sees nothing at all
set local role anon;
set local request.jwt.claims to '{}';
select is(
  (select count(*)::int from public.households),
  0, 'anon sees zero households');

select * from finish();
rollback;
```

- [ ] **Step 2: Run it**

Run: `npx supabase test db`
Expected: `rls_cross_household: ok 4/4`. If a probe FAILs, that is a live cross-household RLS hole: STOP, report it to the user, and file it against Slice 2 (RLS rebuild) rather than patching policies ad hoc here. If the seed itself errors (e.g., `auth.users` NOT NULL columns differ in the current CLI image), extend only the seed inserts — never the assertions.

- [ ] **Step 3: Commit and confirm CI**

```bash
git add supabase/tests/rls_cross_household.test.sql
git commit -m "test(db): pgTAP adversarial cross-household RLS probes"
```

Push and confirm both `check` and `db` CI jobs are green.

---

## Done means

- `npm run test:realsql` green locally and in CI (inside `npx jest --coverage`).
- `supabase db reset` + `supabase test db` green locally and in the new `db` CI job.
- Migration 0007 valid; duplicate 010 gone; CI triggers on slash-named branches.
- Slice 2 (schema baselines) can now be planned against a proving ground that would catch its mistakes.
