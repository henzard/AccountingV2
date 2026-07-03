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

**Scope note (per the spec's build order):** RPC signature contract tests belong to Slice 2, where the RPCs are rebuilt — today's client intentionally mismatches `join_household_via_invite` (the known invite bug), so a contract test added now would leave this slice permanently red. The spec's tier-2 definition annotates this placement.

- [ ] **Step 1: Install dependencies**

```bash
npm install --save-dev better-sqlite3@~12.9.0 @types/better-sqlite3 @babel/preset-env @babel/preset-typescript
```

The `~12.9.0` pin is load-bearing (12.9.0 is the last published version with Node 20 / ABI node-v115 prebuilds — there is no 12.9.1): better-sqlite3 ≥ 12.10 dropped Node 20 prebuilt binaries when Node 20 left LTS, so an unpinned install on this Node 20 repo source-compiles via node-gyp — fine on ubuntu CI, but it fails on Windows dev machines without VS Build Tools. Unpin when the project moves to Node 22.

Execution note (Task 3 deviation): the `supabase` npm wrapper is NOT installed as a devDependency — its platform binary packages (`@supabase/cli-*`) are unpublished placeholders as of 2.109.0, so `npx supabase` fails on every OS. Local dev installs the CLI via scoop (`scoop bucket add supabase https://github.com/supabase/scoop-bucket.git && scoop install supabase`); CI uses `supabase/setup-cli@v2`. Plan commands written as `npx supabase ...` run as plain `supabase ...` locally.

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

Then verify the CI command picks up BOTH projects (the "Done means" criterion depends on it):
Run: `npx jest --listTests 2>&1 | grep -c "tests/realsql"`
Expected: ≥ 1 (the realsql tests are in the default `npx jest` run that CI's `check` job executes as `npx jest --coverage`).

- [ ] **Step 10: Commit**

```bash
git add jest.config.js package.json package-lock.json tests/realsql/ src/data/local/migrations/0007_household_members_updated_at.sql
git commit -m "test(realsql): real-SQLite migration harness; fix invalid non-constant default in 0007"
```

If Step 7 was skipped (0007 applied cleanly under better-sqlite3), drop the 0007 file from `git add` and commit with `-m "test(realsql): real-SQLite migration harness; 0007 applies cleanly under better-sqlite3"` instead.

---

### Task 2: Drizzle-schema ↔ migrated-database conformance test (catches the missing envelope target columns)

**Files:**

- Create: `tests/realsql/schemaConformance.test.ts`
- Create: `src/data/local/migrations/0010_envelope_targets.sql`
- Modify: `src/data/local/migrations/meta/_journal.json`
- Modify: `src/data/local/migrations/migrations.js`

**Interfaces:**

- Consumes: `openMigratedDb()` from Task 1; the barrel export `src/data/local/schema/index.ts` (already exists).

**Known drift this task fixes:** `src/data/local/schema/envelopes.ts` declares `targetAmountCents` (`target_amount_cents`) and `targetDate` (`target_date`), but no local migration 0000–0009 creates those columns (the server got them in `supabase/migrations/009_sinking_funds.sql`; the local chain never did). The conformance test exposes this; the fix is migration 0010 below.

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

- [ ] **Step 2: Run it — expect the envelopes drift failure**

Run: `npm run test:realsql`
Expected: FAIL on table `envelopes` — columns `target_amount_cents` and `target_date` are missing from the migrated database (see "Known drift" above). If any OTHER table/column also fails, STOP and report it to the user before proceeding — that would be a new, unreviewed drift.

- [ ] **Step 3: Add local migration 0010 for the missing columns**

Create `src/data/local/migrations/0010_envelope_targets.sql`:

```sql
ALTER TABLE `envelopes` ADD `target_amount_cents` integer;--> statement-breakpoint
ALTER TABLE `envelopes` ADD `target_date` text;
```

Append to the `entries` array in `src/data/local/migrations/meta/_journal.json` (after the idx 9 entry):

```json
{
  "idx": 10,
  "version": "6",
  "when": 1782000000000,
  "tag": "0010_envelope_targets",
  "breakpoints": true
}
```

In `src/data/local/migrations/migrations.js`, add the import and map entry following the existing pattern:

```js
import m0010 from './0010_envelope_targets.sql';
```

and inside the `migrations` object, after `m0009,`:

```js
m0010,
```

- [ ] **Step 4: Run the realsql project — expect green**

Run: `npm run test:realsql`
Expected: PASS (all realsql tests, including Task 1's).

- [ ] **Step 5: Commit**

```bash
git add tests/realsql/schemaConformance.test.ts src/data/local/migrations/
git commit -m "test(realsql): schema conformance test; add missing envelope target columns as 0010"
```

---

### Task 3: Local Supabase stack — `db reset` green, duplicate migrations resolved, CI wired

**Files:**

- Create: `supabase/config.toml` (via `supabase init`)
- Delete: `supabase/migrations/010_user_preferences.sql`
- Rename: `supabase/migrations/008_user_preferences.sql` → `supabase/migrations/010_user_preferences.sql`
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

- [ ] **Step 2: Resolve BOTH duplicate-migration problems**

There are two distinct landmines in the chain:

1. **Content duplicate:** `010_user_preferences.sql` re-creates the same `user_preferences` table and the same three policies as `008_user_preferences.sql` (verified: files differ only in header/trailing comments). The unguarded `CREATE POLICY up_select/up_insert/up_update` statements abort any fresh replay with `42710 duplicate_object`.
2. **Version-number collision:** TWO files share the numeric prefix `008` (`008_phase2_data_integrity.sql` and `008_user_preferences.sql`). The Supabase CLI parses the version as the filename's leading digits (`^([0-9]+)_(.*)\.sql$` in the CLI's migration/file.go) and records it in `supabase_migrations.schema_migrations`, where `version` is the PRIMARY KEY with a plain INSERT per migration — so a fresh replay inserts version `008` twice and dies with a `schema_migrations_pkey` violation even after fix 1.

Fix both with one move — delete the content-duplicate and renumber the second 008 into the freed 010 slot (its content is unchanged; `user_preferences` is self-contained, so applying at position 010 instead of 008 is order-safe):

```bash
git rm supabase/migrations/010_user_preferences.sql
git mv supabase/migrations/008_user_preferences.sql supabase/migrations/010_user_preferences.sql
```

Then update the header comment inside the moved file from `-- supabase/migrations/008_user_preferences.sql` to `-- supabase/migrations/010_user_preferences.sql`.

- [ ] **Step 3: Replay the full chain locally (Docker must be running)**

```bash
npx supabase start
npx supabase db reset
```

Expected: `db reset` applies the full chain (001 → 019, now with unique version prefixes) and finishes with `Finished supabase db reset`. If another migration aborts with `duplicate_object`, apply the same idempotency pattern in that file — prepend a guard for each failing statement:

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

    - uses: supabase/setup-cli@v2
      with:
        version: latest

    - name: Boot local Supabase stack
      run: supabase start

    - name: Replay full migration chain
      run: supabase db reset
```

(The `Run pgTAP suite` step is deliberately NOT added here — `supabase test db` behavior with a nonexistent `supabase/tests/` directory is CLI-version-dependent, and Task 4 adds the step together with the first test so the job can never be red in between.)

- [ ] **Step 5: Verify locally, then commit**

Run: `npx supabase db reset`
Expected: `Finished supabase db reset` with no errors.

```bash
git add supabase/config.toml supabase/migrations/ .github/workflows/ci.yml package.json package-lock.json
git commit -m "ci(db): local Supabase stack in CI; dedupe migrations 008/010; fix branch glob"
```

(`supabase/migrations/` is staged so that any files touched by Step 3's `DROP POLICY IF EXISTS` contingency path are committed too — the `git rm`/`git mv` from Step 2 are already staged, plain edits are not.)

Push the branch and confirm the `db` job goes green in GitHub Actions before starting Task 4.

---

### Task 4: pgTAP harness + first adversarial cross-household RLS probes (catches the broken membership trigger)

**Files:**

- Create: `supabase/tests/rls_cross_household.test.sql`
- Create: `supabase/migrations/020_fix_member_sync_trigger.sql`
- Modify: `.github/workflows/ci.yml` (add the pgTAP step to the `db` job)

**Interfaces:**

- Consumes: the local stack from Task 3.
- Produces: the seed pattern (two auth users, two households, memberships, JWT-claim switching) that Slice 2's full per-table RLS suite will copy.

**Known live bug this task exposes:** `005_security_and_sync_correctness.sql:79` — the `sync_household_member_to_user_households` trigger function reads `NEW.created_at`, but `household_members` has no `created_at` column (it has `joined_at`, 005:12; no later migration fixes the function — 018 only mentions it in a comment). On a fresh-replay database, EVERY insert into `household_members` raises `record "new" has no field "created_at"` — which also means `join_household_via_invite` and `merge_household_member` are broken on any fresh deployment. The pgTAP seed will hit this first; migration 020 below fixes it.

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

- [ ] **Step 2: Run it — expect the trigger failure**

Run: `npx supabase test db`
Expected: FAIL — the seed's `insert into public.household_members` aborts with `record "new" has no field "created_at"` (the known live bug described above). If it fails with a DIFFERENT error on `auth.users` (NOT NULL columns differ across CLI image versions), extend only the seed's `auth.users` insert columns — never the assertions — and re-run until the trigger failure appears.

- [ ] **Step 3: Fix the trigger with migration 020**

Create `supabase/migrations/020_fix_member_sync_trigger.sql`:

```sql
-- 005's sync_household_member_to_user_households reads NEW.created_at, but
-- household_members has no created_at column (only joined_at) — every INSERT
-- into household_members fails on a fresh-replay database. Use joined_at.
CREATE OR REPLACE FUNCTION public.sync_household_member_to_user_households()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_households (user_id, household_id, role, created_at)
  VALUES (NEW.user_id::uuid, NEW.household_id, COALESCE(NEW.role, 'member'), NEW.joined_at)
  ON CONFLICT (user_id, household_id) DO NOTHING;
  RETURN NEW;
END;
$$;
```

Then re-apply the chain: `npx supabase db reset`
Expected: `Finished supabase db reset` (now applying 020 at the end).

- [ ] **Step 4: Run the suite again — expect green**

Run: `npx supabase test db`
Expected: `rls_cross_household: ok 4/4`. If an RLS probe (not the seed) FAILs, that is a live cross-household RLS hole: STOP, report it to the user, and file it against Slice 2 (RLS rebuild) rather than patching policies ad hoc here.

- [ ] **Step 5: Add the pgTAP step to the CI `db` job**

In `.github/workflows/ci.yml`, append to the `db` job's steps (after `Replay full migration chain`):

```yaml
- name: Run pgTAP suite
  run: supabase test db
```

- [ ] **Step 6: Commit and confirm CI**

```bash
git add supabase/tests/rls_cross_household.test.sql supabase/migrations/020_fix_member_sync_trigger.sql .github/workflows/ci.yml
git commit -m "test(db): pgTAP cross-household RLS probes; fix broken user_households sync trigger"
```

Push and confirm both `check` and `db` CI jobs are green.

---

## Done means

- `npm run test:realsql` green locally and in CI (inside `npx jest --coverage`).
- `supabase db reset` + `supabase test db` green locally and in the new `db` CI job.
- Migration 0007 valid; envelope target columns exist locally (0010); the 008 version collision and content-duplicate 010 resolved; the `user_households` sync trigger fixed (020); CI triggers on slash-named branches.
- Slice 2 (schema baselines) can now be planned against a proving ground that already caught four real bugs.
