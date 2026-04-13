# Supabase Sync & Cloud Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** All writes to SQLite are mirrored to Supabase in the background, and logging in restores the user's data from Supabase to SQLite so data survives reinstalls.

**Architecture:** A `PendingSyncEnqueuer` is injected into every use case and called after each SQLite write. A `SyncOrchestrator` reads the `pending_sync` queue and upserts records to Supabase. A `RestoreService` runs at login to pull all of the user's household data from Supabase into SQLite. The Supabase schema mirrors the local schema (snake_case columns, same PKs) plus a `household_members` join table.

**Tech Stack:** Supabase JS client v2, Drizzle ORM (expo-sqlite), expo-crypto (randomUUID), React Native, TypeScript strict mode.

---

## Supabase SQL (run manually in Supabase dashboard)

Before writing any code, apply this SQL in the Supabase SQL editor. This sets up the tables and Row Level Security policies.

```sql
-- households
CREATE TABLE IF NOT EXISTS households (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  payday_day INTEGER NOT NULL DEFAULT 25,
  user_level INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- household_members: links auth.users to households
CREATE TABLE IF NOT EXISTS household_members (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  joined_at TEXT NOT NULL,
  UNIQUE(household_id, user_id)
);

-- envelopes
CREATE TABLE IF NOT EXISTS envelopes (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  allocated_cents INTEGER NOT NULL DEFAULT 0,
  spent_cents INTEGER NOT NULL DEFAULT 0,
  envelope_type TEXT NOT NULL DEFAULT 'spending',
  is_savings_locked BOOLEAN NOT NULL DEFAULT false,
  is_archived BOOLEAN NOT NULL DEFAULT false,
  period_start TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- transactions
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  envelope_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  payee TEXT,
  description TEXT,
  transaction_date TEXT NOT NULL,
  is_business_expense BOOLEAN NOT NULL DEFAULT false,
  spending_trigger_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- debts
CREATE TABLE IF NOT EXISTS debts (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  creditor_name TEXT NOT NULL,
  debt_type TEXT NOT NULL,
  outstanding_balance_cents INTEGER NOT NULL,
  initial_balance_cents INTEGER NOT NULL DEFAULT 0,
  interest_rate_percent REAL NOT NULL,
  minimum_payment_cents INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_paid_off BOOLEAN NOT NULL DEFAULT false,
  total_paid_cents INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- meter_readings
CREATE TABLE IF NOT EXISTS meter_readings (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  meter_type TEXT NOT NULL,
  reading_value REAL NOT NULL,
  reading_date TEXT NOT NULL,
  cost_cents INTEGER,
  vehicle_id TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- RLS: enable on all tables
ALTER TABLE households ENABLE ROW LEVEL SECURITY;
ALTER TABLE household_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE envelopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE debts ENABLE ROW LEVEL SECURITY;
ALTER TABLE meter_readings ENABLE ROW LEVEL SECURITY;

-- RLS policies: access only to households the user is a member of
CREATE POLICY "household members full access" ON households
  FOR ALL USING (
    id IN (SELECT household_id FROM household_members WHERE user_id = auth.uid())
  );

CREATE POLICY "household members full access" ON household_members
  FOR ALL USING (user_id = auth.uid());

CREATE POLICY "household members full access" ON envelopes
  FOR ALL USING (
    household_id IN (SELECT household_id FROM household_members WHERE user_id = auth.uid())
  );

CREATE POLICY "household members full access" ON transactions
  FOR ALL USING (
    household_id IN (SELECT household_id FROM household_members WHERE user_id = auth.uid())
  );

CREATE POLICY "household members full access" ON debts
  FOR ALL USING (
    household_id IN (SELECT household_id FROM household_members WHERE user_id = auth.uid())
  );

CREATE POLICY "household members full access" ON meter_readings
  FOR ALL USING (
    household_id IN (SELECT household_id FROM household_members WHERE user_id = auth.uid())
  );
```

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `src/data/local/schema/householdMembers.ts` | Create | SQLite household_members table |
| `src/data/local/schema/index.ts` | Modify | Export householdMembers |
| `src/data/local/migrations/0002_household_members.sql` | Create | SQL migration |
| `src/data/local/migrations/meta/_journal.json` | Modify | Register migration 0002 |
| `src/data/local/migrations/migrations.js` | Modify | Import migration 0002 |
| `src/data/sync/PendingSyncEnqueuer.ts` | Create | Enqueue writes to pending_sync |
| `src/data/sync/PendingSyncEnqueuer.test.ts` | Create | Unit tests |
| `src/data/sync/rowConverters.ts` | Create | camelCase ↔ snake_case transforms |
| `src/data/sync/SyncOrchestrator.ts` | Create | Push pending_sync rows to Supabase |
| `src/data/sync/SyncOrchestrator.test.ts` | Create | Unit tests |
| `src/data/sync/RestoreService.ts` | Create | Pull Supabase data → SQLite on login |
| `src/data/sync/RestoreService.test.ts` | Create | Unit tests |
| `src/domain/households/EnsureHouseholdUseCase.ts` | Modify | Create household_members row; support UUID household IDs |
| `src/domain/transactions/CreateTransactionUseCase.ts` | Modify | Enqueue INSERT after write |
| `src/domain/transactions/DeleteTransactionUseCase.ts` | Modify | Enqueue DELETE after write |
| `src/domain/envelopes/CreateEnvelopeUseCase.ts` | Modify | Enqueue INSERT after write |
| `src/domain/envelopes/UpdateEnvelopeUseCase.ts` | Modify | Enqueue UPDATE after write |
| `src/domain/envelopes/ArchiveEnvelopeUseCase.ts` | Modify | Enqueue UPDATE after write |
| `src/domain/debtSnowball/CreateDebtUseCase.ts` | Modify | Enqueue INSERT after write |
| `src/domain/debtSnowball/LogDebtPaymentUseCase.ts` | Modify | Enqueue UPDATE after write |
| `src/domain/meterReadings/LogMeterReadingUseCase.ts` | Modify | Enqueue INSERT after write |
| `src/presentation/stores/appStore.ts` | Modify | Add syncStatus helpers, availableHouseholds |
| `App.tsx` | Modify | Run RestoreService on login, trigger background sync |

---

### Task 1: SQLite household_members table (migration 0002)

**Files:**
- Create: `src/data/local/schema/householdMembers.ts`
- Modify: `src/data/local/schema/index.ts`
- Create: `src/data/local/migrations/0002_household_members.sql`
- Modify: `src/data/local/migrations/meta/_journal.json`
- Modify: `src/data/local/migrations/migrations.js`

- [ ] **Step 1: Create the schema file**

```typescript
// src/data/local/schema/householdMembers.ts
import { sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const householdMembers = sqliteTable('household_members', {
  id: text('id').primaryKey(),
  householdId: text('household_id').notNull(),
  userId: text('user_id').notNull(),   // Supabase auth.uid()
  role: text('role').notNull().default('member'), // 'owner' | 'member'
  joinedAt: text('joined_at').notNull(),
});
```

- [ ] **Step 2: Export from schema index**

Add to `src/data/local/schema/index.ts`:
```typescript
export { householdMembers } from './householdMembers';
```

- [ ] **Step 3: Write the migration SQL**

```sql
-- src/data/local/migrations/0002_household_members.sql
CREATE TABLE `household_members` (
  `id` text PRIMARY KEY NOT NULL,
  `household_id` text NOT NULL,
  `user_id` text NOT NULL,
  `role` text DEFAULT 'member' NOT NULL,
  `joined_at` text NOT NULL
);
```

- [ ] **Step 4: Register migration in `_journal.json`**

Read `src/data/local/migrations/meta/_journal.json` and add entry:
```json
{
  "idx": 2,
  "when": 1744574400000,
  "tag": "0002_household_members",
  "breakpoints": true
}
```

- [ ] **Step 5: Import migration in `migrations.js`**

Read `src/data/local/migrations/migrations.js`. Add:
```javascript
import m0002 from './0002_household_members.sql';
```
And add `m0002` to the `migrations` array.

- [ ] **Step 6: Verify TypeScript**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/data/local/schema/householdMembers.ts src/data/local/schema/index.ts src/data/local/migrations/0002_household_members.sql src/data/local/migrations/meta/_journal.json src/data/local/migrations/migrations.js
git commit -m "feat(sync): add household_members local schema and migration 0002"
```

---

### Task 2: PendingSyncEnqueuer service

**Files:**
- Create: `src/data/sync/PendingSyncEnqueuer.ts`
- Create: `src/data/sync/PendingSyncEnqueuer.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/data/sync/PendingSyncEnqueuer.test.ts
import { PendingSyncEnqueuer } from './PendingSyncEnqueuer';

describe('PendingSyncEnqueuer', () => {
  it('inserts a pending_sync row with correct fields', async () => {
    const insertedRows: unknown[] = [];
    const mockDb = {
      insert: () => ({
        values: (row: unknown) => {
          insertedRows.push(row);
          return Promise.resolve();
        },
      }),
    } as any;

    const enqueuer = new PendingSyncEnqueuer(mockDb);
    await enqueuer.enqueue('envelopes', 'abc-123', 'INSERT');

    expect(insertedRows).toHaveLength(1);
    const row = insertedRows[0] as any;
    expect(row.tableName).toBe('envelopes');
    expect(row.recordId).toBe('abc-123');
    expect(row.operation).toBe('INSERT');
    expect(row.retryCount).toBe(0);
    expect(row.lastAttemptedAt).toBeNull();
    expect(typeof row.id).toBe('string');
    expect(typeof row.createdAt).toBe('string');
  });

  it('accepts DELETE operation', async () => {
    const insertedRows: unknown[] = [];
    const mockDb = {
      insert: () => ({ values: (row: unknown) => { insertedRows.push(row); return Promise.resolve(); } }),
    } as any;

    const enqueuer = new PendingSyncEnqueuer(mockDb);
    await enqueuer.enqueue('transactions', 'tx-1', 'DELETE');

    expect((insertedRows[0] as any).operation).toBe('DELETE');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest PendingSyncEnqueuer.test --no-coverage
```
Expected: FAIL — "Cannot find module './PendingSyncEnqueuer'"

- [ ] **Step 3: Implement PendingSyncEnqueuer**

```typescript
// src/data/sync/PendingSyncEnqueuer.ts
import { randomUUID } from 'expo-crypto';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../local/schema';
import { pendingSync } from '../local/schema';

export type SyncOperation = 'INSERT' | 'UPDATE' | 'DELETE';

export class PendingSyncEnqueuer {
  constructor(private readonly db: ExpoSQLiteDatabase<typeof schema>) {}

  async enqueue(tableName: string, recordId: string, operation: SyncOperation): Promise<void> {
    const now = new Date().toISOString();
    await this.db.insert(pendingSync).values({
      id: randomUUID(),
      tableName,
      recordId,
      operation,
      retryCount: 0,
      lastAttemptedAt: null,
      createdAt: now,
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx jest PendingSyncEnqueuer.test --no-coverage
```
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/data/sync/PendingSyncEnqueuer.ts src/data/sync/PendingSyncEnqueuer.test.ts
git commit -m "feat(sync): add PendingSyncEnqueuer service"
```

---

### Task 3: rowConverters utility

**Files:**
- Create: `src/data/sync/rowConverters.ts`
- Create: `src/data/sync/rowConverters.test.ts`

These helpers convert between Drizzle's camelCase objects and Supabase's snake_case column names.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/data/sync/rowConverters.test.ts
import { toSupabaseRow, toLocalRow } from './rowConverters';

describe('toSupabaseRow', () => {
  it('converts camelCase keys to snake_case and strips isSynced', () => {
    const result = toSupabaseRow({
      id: '1',
      householdId: 'hh-1',
      allocatedCents: 5000,
      isSynced: false,
      periodStart: '2026-01-01',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });
    expect(result).toEqual({
      id: '1',
      household_id: 'hh-1',
      allocated_cents: 5000,
      period_start: '2026-01-01',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    });
    expect('isSynced' in result).toBe(false);
    expect('is_synced' in result).toBe(false);
  });
});

describe('toLocalRow', () => {
  it('converts snake_case keys to camelCase and adds isSynced: true', () => {
    const result = toLocalRow({
      id: '1',
      household_id: 'hh-1',
      allocated_cents: 5000,
      period_start: '2026-01-01',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    });
    expect(result).toMatchObject({
      id: '1',
      householdId: 'hh-1',
      allocatedCents: 5000,
      periodStart: '2026-01-01',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      isSynced: true,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest rowConverters.test --no-coverage
```
Expected: FAIL

- [ ] **Step 3: Implement rowConverters**

```typescript
// src/data/sync/rowConverters.ts

export function toSupabaseRow(
  camelRow: Record<string, unknown>,
): Record<string, unknown> {
  const { isSynced: _isSynced, ...rest } = camelRow;
  return Object.fromEntries(
    Object.entries(rest).map(([key, value]) => [
      key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`),
      value,
    ]),
  );
}

export function toLocalRow(
  snakeRow: Record<string, unknown>,
): Record<string, unknown> {
  const camel = Object.fromEntries(
    Object.entries(snakeRow).map(([key, value]) => [
      key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
      value,
    ]),
  );
  return { ...camel, isSynced: true };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest rowConverters.test --no-coverage
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/data/sync/rowConverters.ts src/data/sync/rowConverters.test.ts
git commit -m "feat(sync): add camelCase/snake_case row converters"
```

---

### Task 4: SyncOrchestrator

**Files:**
- Create: `src/data/sync/SyncOrchestrator.ts`
- Create: `src/data/sync/SyncOrchestrator.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/data/sync/SyncOrchestrator.test.ts
import { SyncOrchestrator } from './SyncOrchestrator';

const makeDb = (rows: unknown[], envelopeRow?: unknown) => ({
  select: () => ({ from: () => ({ orderBy: () => ({ limit: () => Promise.resolve(rows) }) }) }),
  delete: () => ({ where: () => Promise.resolve() }),
  update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
  // per-table selects used in fetchRecord:
  _envelopeRow: envelopeRow,
});

describe('SyncOrchestrator.syncPending', () => {
  it('returns synced:0 failed:0 when queue is empty', async () => {
    const db = {
      select: () => ({ from: () => ({ orderBy: () => ({ limit: () => Promise.resolve([]) }) }) }),
    } as any;
    const supabase = {} as any;
    const orch = new SyncOrchestrator(db, supabase);
    const result = await orch.syncPending();
    expect(result).toEqual({ synced: 0, failed: 0 });
  });

  it('increments failed count when Supabase upsert throws', async () => {
    const pending = [
      { id: 'p1', tableName: 'envelopes', recordId: 'e1', operation: 'INSERT', retryCount: 0 },
    ];
    const db = {
      select: () => ({ from: () => ({ orderBy: () => ({ limit: () => Promise.resolve(pending) }) }) }),
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    } as any;
    const supabase = {
      from: () => ({
        select: () => ({ eq: () => ({ limit: () => Promise.resolve({ data: [{ id: 'e1', householdId: 'h1', isSynced: false }], error: null }) }) }),
        upsert: () => Promise.resolve({ error: { message: 'network error' } }),
      }),
    } as any;
    const orch = new SyncOrchestrator(db, supabase);
    const result = await orch.syncPending();
    expect(result.failed).toBe(1);
    expect(result.synced).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest SyncOrchestrator.test --no-coverage
```
Expected: FAIL

- [ ] **Step 3: Implement SyncOrchestrator**

```typescript
// src/data/sync/SyncOrchestrator.ts
import { asc, eq } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type { SupabaseClient } from '@supabase/supabase-js';
import type * as schema from '../local/schema';
import {
  pendingSync,
  envelopes,
  transactions,
  debts,
  meterReadings,
  households,
  householdMembers,
} from '../local/schema';
import { toSupabaseRow } from './rowConverters';

type SyncTable =
  | typeof envelopes
  | typeof transactions
  | typeof debts
  | typeof meterReadings
  | typeof households
  | typeof householdMembers;

const TABLE_MAP: Record<string, SyncTable> = {
  envelopes,
  transactions,
  debts,
  meter_readings: meterReadings,
  households,
  household_members: householdMembers,
};

export class SyncOrchestrator {
  constructor(
    private readonly db: ExpoSQLiteDatabase<typeof schema>,
    private readonly supabase: SupabaseClient,
  ) {}

  async syncPending(): Promise<{ synced: number; failed: number }> {
    const pending = await this.db
      .select()
      .from(pendingSync)
      .orderBy(asc(pendingSync.createdAt))
      .limit(100);

    let synced = 0;
    let failed = 0;

    for (const item of pending) {
      try {
        await this.processItem(item);
        await this.db.delete(pendingSync).where(eq(pendingSync.id, item.id));
        synced++;
      } catch {
        const now = new Date().toISOString();
        await this.db
          .update(pendingSync)
          .set({ retryCount: item.retryCount + 1, lastAttemptedAt: now })
          .where(eq(pendingSync.id, item.id));
        failed++;
      }
    }

    return { synced, failed };
  }

  private async processItem(item: typeof pendingSync.$inferSelect): Promise<void> {
    if (item.operation === 'DELETE') {
      const { error } = await this.supabase
        .from(item.tableName)
        .delete()
        .eq('id', item.recordId);
      if (error) throw new Error(error.message);
      return;
    }

    const table = TABLE_MAP[item.tableName];
    if (!table) return;

    const [row] = await this.db
      .select()
      .from(table)
      .where(eq(table.id as typeof envelopes.id, item.recordId))
      .limit(1);

    if (!row) return;

    const snakeRow = toSupabaseRow(row as Record<string, unknown>);
    const { error } = await this.supabase
      .from(item.tableName)
      .upsert(snakeRow, { onConflict: 'id' });
    if (error) throw new Error(error.message);

    await this.db
      .update(table)
      .set({ isSynced: true } as Partial<typeof table.$inferInsert>)
      .where(eq(table.id as typeof envelopes.id, item.recordId));
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest SyncOrchestrator.test --no-coverage
```
Expected: PASS

- [ ] **Step 5: TypeScript check**

```bash
npx tsc --noEmit
```
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/data/sync/SyncOrchestrator.ts src/data/sync/SyncOrchestrator.test.ts
git commit -m "feat(sync): add SyncOrchestrator — pushes pending_sync queue to Supabase"
```

---

### Task 5: RestoreService

**Files:**
- Create: `src/data/sync/RestoreService.ts`
- Create: `src/data/sync/RestoreService.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/data/sync/RestoreService.test.ts
import { RestoreService } from './RestoreService';

describe('RestoreService.restore', () => {
  it('returns empty array when user has no household memberships in Supabase', async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    } as any;
    const db = {} as any;
    const svc = new RestoreService(db, supabase);
    const result = await svc.restore('user-1');
    expect(result).toEqual([]);
  });

  it('returns error result when Supabase membership fetch fails', async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => Promise.resolve({ data: null, error: { message: 'network' } }),
        }),
      }),
    } as any;
    const db = {} as any;
    const svc = new RestoreService(db, supabase);
    await expect(svc.restore('user-1')).rejects.toThrow('network');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest RestoreService.test --no-coverage
```
Expected: FAIL

- [ ] **Step 3: Implement RestoreService**

```typescript
// src/data/sync/RestoreService.ts
import { sql } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type { SupabaseClient } from '@supabase/supabase-js';
import type * as schema from '../local/schema';
import {
  households,
  householdMembers,
  envelopes,
  transactions,
  debts,
  meterReadings,
} from '../local/schema';
import { toLocalRow } from './rowConverters';

export interface HouseholdSummary {
  id: string;
  name: string;
  paydayDay: number;
  role: string;
}

export class RestoreService {
  constructor(
    private readonly db: ExpoSQLiteDatabase<typeof schema>,
    private readonly supabase: SupabaseClient,
  ) {}

  async restore(userId: string): Promise<HouseholdSummary[]> {
    // 1. Fetch memberships from Supabase
    const { data: members, error: memberError } = await this.supabase
      .from('household_members')
      .select('household_id, role')
      .eq('user_id', userId);

    if (memberError) throw new Error(memberError.message);
    if (!members || members.length === 0) return [];

    const summaries: HouseholdSummary[] = [];

    for (const member of members) {
      const summary = await this.restoreHousehold(member.household_id as string, member.role as string, userId);
      if (summary) summaries.push(summary);
    }

    return summaries;
  }

  async restoreHousehold(
    householdId: string,
    role: string,
    userId: string,
  ): Promise<HouseholdSummary | null> {
    // Fetch household row
    const { data: hh, error: hhError } = await this.supabase
      .from('households')
      .select('*')
      .eq('id', householdId)
      .single();
    if (hhError || !hh) return null;

    // Upsert household into SQLite
    const localHh = toLocalRow(hh as Record<string, unknown>);
    await this.db
      .insert(households)
      .values(localHh as typeof households.$inferInsert)
      .onConflictDoUpdate({
        target: households.id,
        set: {
          name: sql`excluded.name`,
          paydayDay: sql`excluded.payday_day`,
          updatedAt: sql`excluded.updated_at`,
          isSynced: true,
        },
      });

    // Upsert household_members row
    const { data: allMembers } = await this.supabase
      .from('household_members')
      .select('*')
      .eq('household_id', householdId);

    for (const m of allMembers ?? []) {
      const localMember = toLocalRow(m as Record<string, unknown>);
      await this.db
        .insert(householdMembers)
        .values(localMember as typeof householdMembers.$inferInsert)
        .onConflictDoNothing();
    }

    // Restore entity tables
    await this.restoreTable('envelopes', envelopes, householdId);
    await this.restoreTable('transactions', transactions, householdId);
    await this.restoreTable('debts', debts, householdId);
    await this.restoreTable('meter_readings', meterReadings, householdId);

    return {
      id: hh.id as string,
      name: hh.name as string,
      paydayDay: hh.payday_day as number,
      role,
    };
  }

  private async restoreTable(
    supabaseTable: string,
    localTable:
      | typeof envelopes
      | typeof transactions
      | typeof debts
      | typeof meterReadings,
    householdId: string,
  ): Promise<void> {
    const { data, error } = await this.supabase
      .from(supabaseTable)
      .select('*')
      .eq('household_id', householdId);

    if (error || !data) return;

    for (const row of data) {
      const localRow = toLocalRow(row as Record<string, unknown>);
      await this.db
        .insert(localTable)
        .values(localRow as typeof localTable.$inferInsert)
        .onConflictDoNothing();
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest RestoreService.test --no-coverage
```
Expected: PASS

- [ ] **Step 5: TypeScript check**

```bash
npx tsc --noEmit
```
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/data/sync/RestoreService.ts src/data/sync/RestoreService.test.ts
git commit -m "feat(sync): add RestoreService — pulls Supabase data into SQLite on login"
```

---

### Task 6: Update EnsureHouseholdUseCase for household_members

**Files:**
- Modify: `src/domain/households/EnsureHouseholdUseCase.ts`
- Modify: `src/domain/households/EnsureHouseholdUseCase.test.ts`

The use case must now:
1. Check `household_members` WHERE `user_id = userId` — if rows exist, return the first household.
2. If no membership found: check for old-style household (`id = userId`) and create a membership row for it. If that doesn't exist either, create a brand-new UUID household + membership.
3. Always enqueue INSERT for newly created records.

- [ ] **Step 1: Update the test**

```typescript
// src/domain/households/EnsureHouseholdUseCase.test.ts
import { EnsureHouseholdUseCase } from './EnsureHouseholdUseCase';

const makeDb = ({
  memberRows = [] as unknown[],
  householdRows = [] as unknown[],
  insertMember = jest.fn().mockReturnValue({ values: () => Promise.resolve() }),
  insertHousehold = jest.fn().mockReturnValue({ values: () => Promise.resolve() }),
  insertPending = jest.fn().mockReturnValue({ values: () => Promise.resolve() }),
} = {}) => ({
  select: jest
    .fn()
    .mockReturnValueOnce({
      from: () => ({ where: () => ({ limit: () => Promise.resolve(memberRows) }) }),
    })
    .mockReturnValueOnce({
      from: () => ({ where: () => ({ limit: () => Promise.resolve(householdRows) }) }),
    }),
  insert: jest
    .fn()
    .mockImplementationOnce(() => ({ values: insertMember }))
    .mockImplementationOnce(() => ({ values: insertHousehold }))
    .mockImplementationOnce(() => ({ values: insertPending })),
});

describe('EnsureHouseholdUseCase', () => {
  it('returns existing household when a membership row exists', async () => {
    const db = makeDb({
      memberRows: [{ householdId: 'hh-1', role: 'owner' }],
      householdRows: [{ id: 'hh-1', name: 'My Household', paydayDay: 25, userLevel: 1 }],
    });
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const uc = new EnsureHouseholdUseCase(db as any, audit as any, 'user-1');
    const result = await uc.execute();
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.id).toBe('hh-1');
  });

  it('creates new household + membership when none exists', async () => {
    const insertedRows: unknown[] = [];
    const db = {
      select: jest
        .fn()
        .mockReturnValueOnce({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) })
        .mockReturnValueOnce({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) }),
      insert: jest.fn().mockReturnValue({
        values: (row: unknown) => { insertedRows.push(row); return Promise.resolve(); },
      }),
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const uc = new EnsureHouseholdUseCase(db as any, audit as any, 'user-1');
    const result = await uc.execute();
    expect(result.success).toBe(true);
    // Should have inserted household, household_members row, and 2 pending_sync rows
    expect(insertedRows.length).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run test to confirm current behavior**

```bash
npx jest EnsureHouseholdUseCase.test --no-coverage
```

- [ ] **Step 3: Update EnsureHouseholdUseCase**

```typescript
// src/domain/households/EnsureHouseholdUseCase.ts
import { randomUUID } from 'expo-crypto';
import { eq } from 'drizzle-orm';
import type { InferInsertModel } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import { households, householdMembers } from '../../data/local/schema';
import { AuditLogger } from '../../data/audit/AuditLogger';
import { PendingSyncEnqueuer } from '../../data/sync/PendingSyncEnqueuer';
import type { Result } from '../shared/types';
import { createSuccess } from '../shared/types';

export interface HouseholdSummary {
  id: string;
  name: string;
  paydayDay: number;
  userLevel: 1 | 2 | 3;
}

export class EnsureHouseholdUseCase {
  private readonly enqueuer: PendingSyncEnqueuer;

  constructor(
    private readonly db: ExpoSQLiteDatabase<typeof schema>,
    private readonly audit: AuditLogger,
    private readonly userId: string,
  ) {
    this.enqueuer = new PendingSyncEnqueuer(db);
  }

  async execute(): Promise<Result<HouseholdSummary>> {
    // 1. Check if user already has a membership row
    const [membership] = await this.db
      .select()
      .from(householdMembers)
      .where(eq(householdMembers.userId, this.userId))
      .limit(1);

    if (membership) {
      // Return the linked household
      const [hh] = await this.db
        .select()
        .from(households)
        .where(eq(households.id, membership.householdId))
        .limit(1);
      if (hh) {
        return createSuccess({
          id: hh.id,
          name: hh.name,
          paydayDay: hh.paydayDay,
          userLevel: hh.userLevel as 1 | 2 | 3,
        });
      }
    }

    // 2. Check for legacy household where id = userId
    const [legacy] = await this.db
      .select()
      .from(households)
      .where(eq(households.id, this.userId))
      .limit(1);

    const now = new Date().toISOString();

    if (legacy) {
      // Create membership row for the legacy household
      const memberId = randomUUID();
      const memberRow: InferInsertModel<typeof householdMembers> = {
        id: memberId,
        householdId: legacy.id,
        userId: this.userId,
        role: 'owner',
        joinedAt: now,
      };
      await this.db.insert(householdMembers).values(memberRow);
      await this.enqueuer.enqueue('household_members', memberId, 'INSERT');
      await this.enqueuer.enqueue('households', legacy.id, 'INSERT');
      return createSuccess({
        id: legacy.id,
        name: legacy.name,
        paydayDay: legacy.paydayDay,
        userLevel: legacy.userLevel as 1 | 2 | 3,
      });
    }

    // 3. Create new household with UUID + membership
    const householdId = randomUUID();
    const newHousehold: InferInsertModel<typeof households> = {
      id: householdId,
      name: 'My Household',
      paydayDay: 25,
      userLevel: 1,
      createdAt: now,
      updatedAt: now,
      isSynced: false,
    };
    await this.db.insert(households).values(newHousehold);

    const memberId = randomUUID();
    const memberRow: InferInsertModel<typeof householdMembers> = {
      id: memberId,
      householdId,
      userId: this.userId,
      role: 'owner',
      joinedAt: now,
    };
    await this.db.insert(householdMembers).values(memberRow);

    await this.audit.log({
      householdId,
      entityType: 'household',
      entityId: householdId,
      action: 'create',
      previousValue: null,
      newValue: { id: householdId, name: newHousehold.name, paydayDay: newHousehold.paydayDay },
    });

    await this.enqueuer.enqueue('households', householdId, 'INSERT');
    await this.enqueuer.enqueue('household_members', memberId, 'INSERT');

    return createSuccess({
      id: householdId,
      name: newHousehold.name,
      paydayDay: newHousehold.paydayDay ?? 25,
      userLevel: 1,
    });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest EnsureHouseholdUseCase.test --no-coverage
```
Expected: PASS

- [ ] **Step 5: TypeScript check**

```bash
npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add src/domain/households/EnsureHouseholdUseCase.ts src/domain/households/EnsureHouseholdUseCase.test.ts
git commit -m "feat(sync): EnsureHousehold creates household_members row and enqueues sync"
```

---

### Task 7: Wire PendingSyncEnqueuer into all existing use cases

**Files to modify (add enqueue call after the SQLite write in each):**
- `src/domain/transactions/CreateTransactionUseCase.ts`
- `src/domain/transactions/DeleteTransactionUseCase.ts`
- `src/domain/envelopes/CreateEnvelopeUseCase.ts`
- `src/domain/envelopes/UpdateEnvelopeUseCase.ts`
- `src/domain/envelopes/ArchiveEnvelopeUseCase.ts`
- `src/domain/debtSnowball/CreateDebtUseCase.ts`
- `src/domain/debtSnowball/LogDebtPaymentUseCase.ts`
- `src/domain/meterReadings/LogMeterReadingUseCase.ts`

The pattern is the same for every file. In the constructor, add:
```typescript
private readonly enqueuer = new PendingSyncEnqueuer(this.db);
```
After the SQLite write, before `return createSuccess(...)`, add:
```typescript
await this.enqueuer.enqueue('table_name', id, 'INSERT'); // or 'UPDATE' / 'DELETE'
```

- [ ] **Step 1: Update CreateTransactionUseCase**

In `src/domain/transactions/CreateTransactionUseCase.ts`:

Add import:
```typescript
import { PendingSyncEnqueuer } from '../../data/sync/PendingSyncEnqueuer';
```

Add to class body (after `private readonly audit` line):
```typescript
private readonly enqueuer = new PendingSyncEnqueuer(this.db);
```

Add after the `await this.audit.log(...)` call:
```typescript
await this.enqueuer.enqueue('transactions', id, 'INSERT');
```

- [ ] **Step 2: Update DeleteTransactionUseCase**

In `src/domain/transactions/DeleteTransactionUseCase.ts`:

Add import:
```typescript
import { PendingSyncEnqueuer } from '../../data/sync/PendingSyncEnqueuer';
```

Add field:
```typescript
private readonly enqueuer = new PendingSyncEnqueuer(this.db);
```

Add after `await this.audit.log(...)`:
```typescript
await this.enqueuer.enqueue('transactions', this.tx.id, 'DELETE');
```

- [ ] **Step 3: Update CreateEnvelopeUseCase**

Same pattern in `src/domain/envelopes/CreateEnvelopeUseCase.ts`:
```typescript
import { PendingSyncEnqueuer } from '../../data/sync/PendingSyncEnqueuer';
// ...
private readonly enqueuer = new PendingSyncEnqueuer(this.db);
// After audit.log:
await this.enqueuer.enqueue('envelopes', id, 'INSERT');
```

- [ ] **Step 4: Update UpdateEnvelopeUseCase**

Same pattern, operation `'UPDATE'`, use `this.current.id`.

- [ ] **Step 5: Update ArchiveEnvelopeUseCase**

Same pattern, operation `'UPDATE'`, use `this.envelope.id`.

- [ ] **Step 6: Update CreateDebtUseCase**

Same pattern, operation `'INSERT'`, use the new debt's `id`.

- [ ] **Step 7: Update LogDebtPaymentUseCase**

Same pattern, operation `'UPDATE'`, use `this.input.currentDebt.id`.

- [ ] **Step 8: Update LogMeterReadingUseCase**

Same pattern, operation `'INSERT'`, use the new reading's `id`.

- [ ] **Step 9: Run full test suite**

```bash
npx jest --no-coverage
```
Expected: all 111+ tests pass.

- [ ] **Step 10: TypeScript check**

```bash
npx tsc --noEmit
```

- [ ] **Step 11: Commit**

```bash
git add src/domain/transactions/CreateTransactionUseCase.ts src/domain/transactions/DeleteTransactionUseCase.ts src/domain/envelopes/CreateEnvelopeUseCase.ts src/domain/envelopes/UpdateEnvelopeUseCase.ts src/domain/envelopes/ArchiveEnvelopeUseCase.ts src/domain/debtSnowball/CreateDebtUseCase.ts src/domain/debtSnowball/LogDebtPaymentUseCase.ts src/domain/meterReadings/LogMeterReadingUseCase.ts
git commit -m "feat(sync): wire PendingSyncEnqueuer into all write use cases"
```

---

### Task 8: Wire RestoreService + SyncOrchestrator into App.tsx

**Files:**
- Modify: `App.tsx`
- Modify: `src/presentation/stores/appStore.ts`

The updated flow:
1. Session restored → run `RestoreService.restore(userId)` to pull Supabase data into SQLite.
2. Then run `EnsureHouseholdUseCase` (picks up the restored household or creates one).
3. After every `useFocusEffect` data load, trigger `SyncOrchestrator.syncPending()` in the background.

- [ ] **Step 1: Update appStore to store available households**

In `src/presentation/stores/appStore.ts`, add to `AppState`:
```typescript
availableHouseholds: HouseholdSummary[];
```

Import `HouseholdSummary` from `../../domain/households/EnsureHouseholdUseCase`.

Add to `AppActions`:
```typescript
setAvailableHouseholds: (households: HouseholdSummary[]) => void;
```

Add to the `create` call:
```typescript
availableHouseholds: [],
setAvailableHouseholds: (availableHouseholds): void => set({ availableHouseholds }),
```

- [ ] **Step 2: Update App.tsx**

Replace the `loadHousehold` function and `useEffect` in `App.tsx`:

```typescript
import { RestoreService } from './src/data/sync/RestoreService';
import { SyncOrchestrator } from './src/data/sync/SyncOrchestrator';

const restoreService = new RestoreService(db, supabase);
const syncOrchestrator = new SyncOrchestrator(db, supabase);

async function initSession(
  userId: string,
  setHouseholdId: (id: string) => void,
  setPaydayDay: (day: number) => void,
  setSyncStatus: (s: SyncStatus) => void,
): Promise<void> {
  // 1. Restore from Supabase (no-op if offline or first-time)
  try {
    await restoreService.restore(userId);
  } catch {
    // Offline or first login — continue with local data
  }

  // 2. Ensure household exists locally
  const uc = new EnsureHouseholdUseCase(db, audit, userId);
  const result = await uc.execute();
  if (result.success) {
    setHouseholdId(result.data.id);
    setPaydayDay(result.data.paydayDay);
  }

  // 3. Push any pending local writes to Supabase
  setSyncStatus('syncing');
  try {
    await syncOrchestrator.syncPending();
    setSyncStatus('success');
  } catch {
    setSyncStatus('error');
  }
}
```

In the `useEffect`, replace `loadHousehold(...)` calls with `initSession(...)`.

Also call `setSyncStatus` from the store:
```typescript
const setSyncStatus = useAppStore((s) => s.setSyncStatus);
```

- [ ] **Step 3: Run TypeScript check**

```bash
npx tsc --noEmit
```
Expected: no errors

- [ ] **Step 4: Run full test suite**

```bash
npx jest --no-coverage
```
Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add App.tsx src/presentation/stores/appStore.ts
git commit -m "feat(sync): wire RestoreService + SyncOrchestrator into App startup"
```

---

### Task 9: Lint check and final validation

- [ ] **Step 1: Full lint**

```bash
npx eslint src/ --ext .ts,.tsx --max-warnings 0
```
Expected: no warnings or errors.

- [ ] **Step 2: Full test suite**

```bash
npx jest --no-coverage
```
Expected: all tests pass.

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Manual smoke test**
  - Build and run on emulator: `npx expo run:android`
  - Log in → data should load from Supabase (if any exists there)
  - Create a transaction → check Supabase dashboard: the `transactions` table should have the new row within seconds
  - Uninstall app → reinstall → log in → all data should reappear

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat(sprint-3): Supabase sync + cloud persistence — data survives reinstalls"
```
