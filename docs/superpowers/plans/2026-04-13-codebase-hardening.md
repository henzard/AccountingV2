# Codebase Hardening — Three-Sprint Implementation Plan (single PR)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Each phase is independently mergeable — **if the single-PR approach becomes unwieldy, split by phase at any point.**

**Goal:** Fix every Critical/High/Medium issue surfaced in the 2026-04-13 hive-mind codebase review, in one mergeable branch, across three phases.

**Architecture:** Phase A lands correctness + security fixes that protect shipping users. Phase B makes PRD Journey 1 reachable (onboarding, signup, sign-out, money-visibility). Phase C hardens foundations (domain abstractions, dark theme, a11y, performance, E2E). Each phase is internally cohesive and leaves the app green on `npm run typecheck && npm test && npm run lint`.

**Tech Stack:** React Native + Expo SDK 55, TypeScript 5.9, Drizzle ORM + expo-sqlite, Supabase (PostgreSQL), Zustand, react-native-paper, @react-navigation/native-stack, Jest, @testing-library/react-native. New additions: husky, lint-staged, prettier config, @react-native-firebase/crashlytics.

**Source reports:** `C:\Users\henza\AppData\Local\Temp\claude\C--Project-AccountingV2\a4919458-1ae1-4b7f-b6e9-25f312a1c5e2\tasks\` (10 specialist reports from hive-1776061933751-bewhfm).

**Verification per phase:** at the end of every phase run `npm run typecheck && npm test && npm run lint` — all exit 0. The phase-end commit includes the verification output in its message.

---

## File Structure Overview

Phase A adds / modifies:
- `supabase/migrations/005_security_and_sync_correctness.sql` (new)
- `src/data/local/migrations/0005_composite_indexes.sql` (new)
- `src/data/local/schema/babySteps.ts` (no change — the constraint name is remote-only)
- `src/data/sync/SyncOrchestrator.ts` (retry/backoff, merge RPCs, audit + slip sync)
- `src/data/sync/rowConverters.ts` (audit_events + slip_queue support)
- `src/data/sync/RestoreService.ts` (restore audit + slips)
- `src/data/sync/PendingSyncEnqueuer.ts` (dedup on `(tableName, recordId)`)
- `src/domain/households/AcceptInviteUseCase.ts` (no behavioural change; tests added)
- `src/domain/households/CreateInviteUseCase.ts` (expo-crypto CSPRNG)
- `src/infrastructure/logging/Logger.ts` (new)
- `src/infrastructure/monitoring/crashlytics.ts` (new)
- `package.json` (add deps + scripts)
- `.github/workflows/ci.yml` (add prettier check)
- `.husky/` + `.prettierrc.json` (new)

Phase B adds / modifies:
- `src/presentation/screens/auth/onboarding/` (7 screens — wizard steps)
- `src/presentation/screens/auth/SignUpScreen.tsx` (new)
- `src/presentation/screens/auth/LoginScreen.tsx` (add sign-up link)
- `src/presentation/navigation/AuthNavigator.tsx` (register SignUp + Onboarding)
- `src/presentation/navigation/RootNavigator.tsx` (household gate logic)
- `src/presentation/screens/settings/SettingsScreen.tsx` (sign-out button)
- `src/presentation/screens/transactions/AddTransactionScreen.tsx` (envelope picker with balance + date picker)
- `src/presentation/screens/dashboard/DashboardScreen.tsx` (real `loggingDaysCount`)
- `src/presentation/navigation/MainTabNavigator.tsx` (tab labels)

Phase C adds / modifies:
- `src/domain/ports/` (new — repository interfaces)
- `src/data/repositories/` (new — drizzle-backed implementations)
- `src/presentation/theme/tokens.ts` + `theme.ts` (add `darkColours`, `useAppTheme`)
- `src/presentation/components/shared/ScreenHeader.tsx`, `EmptyState.tsx`, `LoadingSkeletonList.tsx` (new)
- A11y passes on `LoginScreen`, `SignUpScreen`, `AddTransactionScreen`, `AddDebtScreen`, `LogPaymentScreen`, `AddEditEnvelopeScreen`, `AddReadingScreen`, `RamseyScoreBadge`, `DebtPayoffBar`, `SnowballDashboardScreen`, `DebtDetailScreen`
- `src/data/local/migrations/0006_hot_column_indexes.sql` (already-planned indexes)
- `e2e/` (new — Detox harness + 3 smoke specs)

---

# Phase A — Correctness + Security Hotfixes

**Goal:** Stop shipping bugs and close data-loss vectors.

---

### Task A1: Hotfix `merge_baby_step` `ON CONFLICT` form (runtime bug)

**Why:** `ON CONFLICT ON CONSTRAINT idx_baby_steps_household_step` requires a named constraint, not a unique index. At runtime PostgreSQL throws. Our current merge RPC would fail on first sync of a baby step under conflict.

**Files:**
- Create: `supabase/migrations/005_security_and_sync_correctness.sql`

- [ ] **Step 1: Create migration with new RPC definition**

Content (will extend with other changes in this phase — see A2-A5):

```sql
-- 005_security_and_sync_correctness.sql
-- Hotfix the merge_baby_step RPC: change ON CONFLICT from named-constraint form
-- to column-list form so it works with a standalone unique index.

CREATE OR REPLACE FUNCTION public.merge_baby_step(row baby_steps)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_id uuid := auth.uid();
  is_member boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.user_households
    WHERE household_id = row.household_id AND user_id = caller_id
  ) INTO is_member;
  IF NOT is_member THEN
    RAISE EXCEPTION 'not a member of household %', row.household_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO public.baby_steps (
    id, household_id, step_number, is_completed, completed_at,
    is_manual, celebrated_at, created_at, updated_at
  )
  VALUES (
    row.id, row.household_id, row.step_number, row.is_completed, row.completed_at,
    row.is_manual, row.celebrated_at, row.created_at, row.updated_at
  )
  ON CONFLICT (household_id, step_number) DO UPDATE
    SET
      is_completed  = EXCLUDED.is_completed,
      completed_at  = EXCLUDED.completed_at,
      is_manual     = EXCLUDED.is_manual,
      celebrated_at = CASE
                        WHEN EXCLUDED.celebrated_at IS NULL
                             AND baby_steps.celebrated_at IS NOT NULL
                          THEN baby_steps.celebrated_at
                        ELSE EXCLUDED.celebrated_at
                      END,
      created_at    = EXCLUDED.created_at,
      updated_at    = EXCLUDED.updated_at
    WHERE EXCLUDED.updated_at >= baby_steps.updated_at;
END;
$$;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/005_security_and_sync_correctness.sql
git commit -m "fix(sql): merge_baby_step ON CONFLICT uses column list (not constraint name)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task A2: Resolve `user_households` vs `household_members` duality

**Why:** RLS policies reference `user_households`; app writes to `household_members`. New members can't see their financial data after accepting an invite.

**Decision:** `user_households` is the remote-facing source of truth (it's what RLS already uses). `household_members` on the client is the local mirror. We populate BOTH on accept: local `household_members` + remote `user_households`.

**Files:**
- Modify: `supabase/migrations/005_security_and_sync_correctness.sql` (append)
- Modify: `src/domain/households/AcceptInviteUseCase.ts`
- Modify: `src/domain/households/__tests__/AcceptInviteUseCase.test.ts`

- [ ] **Step 1: Append to migration 005 — unify via view or write trigger**

Append to `005_security_and_sync_correctness.sql`:

```sql
-- Mirror household_members inserts into user_households so RLS keeps working.
-- (Remove if user_households is phased out later.)
CREATE OR REPLACE FUNCTION public.sync_household_member_to_user_households()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_households (user_id, household_id, role, created_at)
  VALUES (NEW.user_id, NEW.household_id, COALESCE(NEW.role, 'member'), NEW.created_at)
  ON CONFLICT (user_id, household_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_household_members_sync_user_households
  ON public.household_members;
CREATE TRIGGER tr_household_members_sync_user_households
  AFTER INSERT ON public.household_members
  FOR EACH ROW EXECUTE FUNCTION public.sync_household_member_to_user_households();
```

- [ ] **Step 2: Add test in `AcceptInviteUseCase.test.ts` (success path)**

Currently the success path is untested (32% coverage). Add:

```ts
describe('AcceptInviteUseCase — success path', () => {
  it('inserts household_members locally, enqueues sync, and triggers restore', async () => {
    const mockInvite = {
      code: 'ABC123',
      household_id: 'h1',
      invited_by_user_id: 'user-a',
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      used_by_user_id: null,
      used_at: null,
    };

    const singleMock = jest.fn().mockResolvedValue({ data: mockInvite, error: null });
    const fromMock = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      is: jest.fn().mockReturnThis(),
      single: singleMock,
      insert: jest.fn().mockResolvedValue({ data: null, error: null }),
      update: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }),
    });
    const supabase = { from: fromMock, auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'user-b' } } }) } };

    const db = {
      insert: jest.fn().mockReturnValue({ values: jest.fn().mockReturnValue({ onConflictDoNothing: jest.fn().mockResolvedValue(undefined) }) }),
    };

    const enqueuer = { enqueue: jest.fn() };
    const restoreService = { restoreHousehold: jest.fn().mockResolvedValue({ success: true }) };

    const useCase = new AcceptInviteUseCase(
      db as any, supabase as any, enqueuer as any, restoreService as any,
      { userId: 'user-b', code: 'ABC123' },
    );
    const result = await useCase.execute();

    expect(result.success).toBe(true);
    expect(db.insert).toHaveBeenCalled();
    expect(enqueuer.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ tableName: 'household_members' }),
    );
    expect(restoreService.restoreHousehold).toHaveBeenCalledWith('h1');
  });
});
```

- [ ] **Step 3: Run test; implement if it fails**

```bash
npx jest src/domain/households/__tests__/AcceptInviteUseCase.test.ts
```

If it fails because the current use case doesn't call `enqueue` or `restoreHousehold` — fix the production code. If it passes, the coverage gap was only tests, not behaviour.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/005_security_and_sync_correctness.sql \
        src/domain/households/__tests__/AcceptInviteUseCase.test.ts
git commit -m "fix(sync): mirror household_members → user_households via trigger

Adds a trigger on household_members AFTER INSERT that populates
user_households. RLS policies continue using user_households unchanged.
Adds the success-path coverage that was missing from AcceptInviteUseCase
(was 32% coverage, critical membership flow).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task A3: RLS policies for `invitations` and `household_members`

**Why:** Without RLS, any authenticated user can read all invitations and insert arbitrary memberships — full household takeover.

**Files:** `supabase/migrations/005_security_and_sync_correctness.sql` (append)

- [ ] **Step 1: Append RLS**

```sql
-- RLS on invitations: only the inviter or the person accepting may read;
-- only authenticated users may insert; only the creator may update/delete.
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inv_select ON public.invitations;
CREATE POLICY inv_select ON public.invitations
  FOR SELECT TO authenticated
  USING (
    invited_by_user_id = auth.uid()
    OR used_by_user_id = auth.uid()
    OR (used_by_user_id IS NULL AND expires_at > NOW())
  );
-- Note: the last clause lets an acceptor look up by code. The code is the secret.

DROP POLICY IF EXISTS inv_insert ON public.invitations;
CREATE POLICY inv_insert ON public.invitations
  FOR INSERT TO authenticated
  WITH CHECK (invited_by_user_id = auth.uid());

DROP POLICY IF EXISTS inv_update ON public.invitations;
CREATE POLICY inv_update ON public.invitations
  FOR UPDATE TO authenticated
  USING (invited_by_user_id = auth.uid() OR used_by_user_id IS NULL)
  WITH CHECK (true);

-- RLS on household_members: members can read their own households' members;
-- only the user themself may insert their row (via the trigger chain);
-- only the user themself may delete their row.
ALTER TABLE public.household_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hm_select ON public.household_members;
CREATE POLICY hm_select ON public.household_members
  FOR SELECT TO authenticated
  USING (
    household_id IN (
      SELECT household_id FROM public.user_households WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS hm_insert ON public.household_members;
CREATE POLICY hm_insert ON public.household_members
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS hm_delete ON public.household_members;
CREATE POLICY hm_delete ON public.household_members
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/005_security_and_sync_correctness.sql
git commit -m "fix(sec): RLS policies on invitations and household_members

Without these, any authenticated user could read all invites or insert
arbitrary household memberships — full takeover vector.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task A4: CSPRNG invite codes

**Files:**
- Modify: `src/domain/households/CreateInviteUseCase.ts`
- Add: `src/domain/households/__tests__/CreateInviteUseCase.test.ts` if missing

- [ ] **Step 1: Replace `Math.random()` with `expo-crypto`**

Replace the existing `generateCode()` method:

```ts
import * as Crypto from 'expo-crypto';

function generateCode(): string {
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 chars, no 0/O/1/I
  const bytes = Crypto.getRandomBytes(6);
  let out = '';
  for (let i = 0; i < 6; i += 1) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}
```

- [ ] **Step 2: Add a test asserting distinct codes across 1000 invocations**

```ts
describe('CreateInviteUseCase.generateCode', () => {
  it('produces codes of length 6 from the safe alphabet', () => {
    const codes = new Set<string>();
    for (let i = 0; i < 1000; i += 1) codes.add(generateCode());
    expect(codes.size).toBeGreaterThan(990); // allow a tiny birthday collision
    codes.forEach((c) => {
      expect(c).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
    });
  });
});
```

- [ ] **Step 3: Run test + commit**

```bash
npx jest src/domain/households/__tests__/CreateInviteUseCase.test.ts
git add src/domain/households/CreateInviteUseCase.ts \
        src/domain/households/__tests__/CreateInviteUseCase.test.ts
git commit -m "fix(sec): invite codes use expo-crypto CSPRNG

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task A5: Add missing remote `debts` columns + `envelope_type` CHECK

**Files:** `supabase/migrations/005_security_and_sync_correctness.sql` (append)

- [ ] **Step 1: Append**

```sql
ALTER TABLE public.debts ADD COLUMN IF NOT EXISTS initial_balance_cents BIGINT NOT NULL DEFAULT 0;
ALTER TABLE public.debts ADD COLUMN IF NOT EXISTS total_paid_cents BIGINT NOT NULL DEFAULT 0;

ALTER TABLE public.envelopes
  DROP CONSTRAINT IF EXISTS envelopes_envelope_type_check;
ALTER TABLE public.envelopes
  ADD CONSTRAINT envelopes_envelope_type_check
  CHECK (envelope_type IN ('spending','savings','emergency_fund','baby_step','utility','income'));
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/005_security_and_sync_correctness.sql
git commit -m "fix(sync): add missing debts columns + envelope_type CHECK constraint

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task A6: Generic merge RPCs with LWW guard + route all tables through them

**Why:** Only `baby_steps` has LWW protection. Every other table blindly overwrites remote data with stale local data on reconnect.

**Strategy:** Add one generic `merge_row(table_name text, row jsonb)` RPC that performs LWW per table, OR add per-table merge RPCs. Per-table is safer (explicit column lists). There are 7 sync tables; 6 additional RPCs needed.

For simplicity we'll generate one per table. All follow the same pattern as `merge_baby_step`.

**Files:** `supabase/migrations/005_security_and_sync_correctness.sql` (append)

- [ ] **Step 1: Add `merge_envelope` RPC**

```sql
CREATE OR REPLACE FUNCTION public.merge_envelope(row envelopes)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_id uuid := auth.uid();
  is_member boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.user_households
    WHERE household_id = row.household_id AND user_id = caller_id
  ) INTO is_member;
  IF NOT is_member THEN
    RAISE EXCEPTION 'not a member of household %', row.household_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO public.envelopes VALUES (row.*)
  ON CONFLICT (id) DO UPDATE
    SET
      name = EXCLUDED.name,
      allocated_cents = EXCLUDED.allocated_cents,
      spent_cents = EXCLUDED.spent_cents,
      envelope_type = EXCLUDED.envelope_type,
      is_savings_locked = EXCLUDED.is_savings_locked,
      is_archived = EXCLUDED.is_archived,
      period_start = EXCLUDED.period_start,
      updated_at = EXCLUDED.updated_at
    WHERE EXCLUDED.updated_at >= envelopes.updated_at;
END;
$$;

GRANT EXECUTE ON FUNCTION public.merge_envelope(envelopes) TO authenticated;
```

- [ ] **Step 2: Repeat pattern for `transactions`, `debts`, `meter_readings`, `households`, `household_members`**

The engineer should copy the pattern above for each table, substituting the columns. Only non-auto-assigned columns go in the SET clause. For `household_members` the membership check is `user_id = auth.uid()` instead of the household check.

- [ ] **Step 3: Update `SyncOrchestrator.processItem` to route every table through the matching RPC**

In `src/data/sync/SyncOrchestrator.ts`, currently `baby_steps` has a dedicated RPC branch. Replace that branch with a generic `TABLE_RPC_MAP`:

```ts
const TABLE_RPC_MAP: Record<string, string> = {
  baby_steps: 'merge_baby_step',
  envelopes: 'merge_envelope',
  transactions: 'merge_transaction',
  debts: 'merge_debt',
  meter_readings: 'merge_meter_reading',
  households: 'merge_household',
  household_members: 'merge_household_member',
};
```

Route the row through `supabase.rpc(TABLE_RPC_MAP[tableName], { row: snakeRow })` for any table in the map. Delete operations still use the plain `.delete()` path.

- [ ] **Step 4: Update `SyncOrchestrator.test.ts` — assert RPC path taken for each table**

Add parameterized test using `it.each`:

```ts
it.each(['envelopes','transactions','debts','meter_readings','households','household_members','baby_steps'])(
  'routes %s through its merge RPC on upsert',
  async (tableName) => {
    // ... existing mock setup ...
    expect(rpcMock).toHaveBeenCalledWith(`merge_${tableName.replace('s','').replace('_readings','_reading')}`, expect.any(Object));
  },
);
```
(Fix the RPC naming: the engineer should hand-write the test rather than rely on regex transforms.)

- [ ] **Step 5: Run tests + commit**

```bash
npm run typecheck && npm test
git add supabase/migrations/005_security_and_sync_correctness.sql \
        src/data/sync/SyncOrchestrator.ts \
        src/data/sync/__tests__/SyncOrchestrator.test.ts
git commit -m "fix(sync): LWW guard on all sync tables via per-table merge RPCs

Previously only baby_steps had LWW protection. A plain upsert with
onConflict:id overwrites newer remote data with stale local data on
reconnect. Now every synced table uses a dedicated merge RPC that
verifies household membership and enforces WHERE excluded.updated_at >=
existing.updated_at.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task A7: Sync retry backoff + dead-letter queue

**Files:**
- Modify: `src/data/local/schema/pendingSync.ts` (add `last_attempted_at`, `dead_lettered_at`)
- Create: `src/data/local/migrations/0005_pending_sync_dlq.sql`
- Modify: `src/data/sync/SyncOrchestrator.ts`

- [ ] **Step 1: Schema + migration**

Local migration SQL:
```sql
ALTER TABLE pending_sync ADD COLUMN dead_lettered_at TEXT;
```

Update Drizzle schema to match.

- [ ] **Step 2: Dead-letter after 10 attempts OR after 7 days**

In `SyncOrchestrator.processItem`, after the `retryCount` increment:

```ts
const DLQ_MAX_RETRIES = 10;
const DLQ_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const shouldDLQ =
  (item.retryCount + 1) >= DLQ_MAX_RETRIES ||
  (Date.now() - new Date(item.createdAt).getTime()) >= DLQ_MAX_AGE_MS;

if (shouldDLQ) {
  await this.db.update(pendingSync)
    .set({ deadLetteredAt: new Date().toISOString() })
    .where(eq(pendingSync.id, item.id));
}
```

Modify the main query to skip DLQ'd items:
```ts
.where(isNull(pendingSync.deadLetteredAt))
```

- [ ] **Step 3: Exponential backoff between attempts**

```ts
const backoffMs = Math.min(60_000, 1000 * 2 ** item.retryCount);
const nextAttempt = new Date(Date.now() + backoffMs).toISOString();
// stored as last_attempted_at; query filter: last_attempted_at IS NULL OR last_attempted_at < NOW()
```

- [ ] **Step 4: Add test — poison-pill row gets DLQ'd after 10 attempts**

Hand-write in `SyncOrchestrator.test.ts`. Simulate a row whose upsert always errors; after 10 calls to `syncPending`, assert the row has `dead_lettered_at` set and is not returned by the next call.

- [ ] **Step 5: Commit**

```bash
git add src/data/local/schema/pendingSync.ts \
        src/data/local/migrations/0005_pending_sync_dlq.sql \
        src/data/local/migrations/migrations.js \
        src/data/local/migrations/meta \
        src/data/sync/SyncOrchestrator.ts \
        src/data/sync/__tests__/SyncOrchestrator.test.ts
git commit -m "fix(sync): exponential backoff + DLQ after 10 retries or 7 days

Poison-pill rows previously blocked the queue forever. Now they DLQ
and the next row is processed.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task A8: Dedup `PendingSyncEnqueuer` by `(tableName, recordId)`

**Files:** `src/data/sync/PendingSyncEnqueuer.ts` + `PendingSyncTable.ts`

- [ ] **Step 1: Before insert, check for existing un-synced entry**

```ts
async enqueue(item: PendingSyncInput): Promise<void> {
  const existing = await this.db
    .select({ id: pendingSync.id })
    .from(pendingSync)
    .where(and(
      eq(pendingSync.tableName, item.tableName),
      eq(pendingSync.recordId, item.recordId),
      isNull(pendingSync.deadLetteredAt),
    ))
    .limit(1);

  if (existing.length > 0) {
    // Update the existing entry's updatedAt so the newer op takes priority on LWW.
    await this.db.update(pendingSync)
      .set({ operation: item.operation, updatedAt: new Date().toISOString() })
      .where(eq(pendingSync.id, existing[0].id));
    return;
  }

  await this.db.insert(pendingSync).values({ /* ... */ });
}
```

- [ ] **Step 2: Test — rapid offline edits produce one pending entry per record**

Hand-written test; `expect(pending).toHaveLength(1)` after 5 consecutive enqueues of the same `recordId`.

- [ ] **Step 3: Commit**

```bash
git add src/data/sync/PendingSyncEnqueuer.ts \
        src/data/sync/PendingSyncTable.ts \
        src/data/sync/__tests__/PendingSyncEnqueuer.test.ts
git commit -m "fix(sync): dedup pending entries by (tableName, recordId)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task A9: Sync `auditEvents` + `slipQueue`

**Files:**
- Modify: `supabase/migrations/005_security_and_sync_correctness.sql` (append CREATE TABLE for audit_events + slip_queue remotes)
- Modify: `src/data/sync/SyncOrchestrator.ts` (add to `TABLE_MAP` + RPC map)
- Modify: `src/data/sync/rowConverters.ts` (verify generic converter handles both)
- Modify: `src/data/sync/RestoreService.ts` (add to dispatch)
- Modify callers: `AuditLogger` and wherever `slipQueue` rows are inserted — call `PendingSyncEnqueuer.enqueue`.

- [ ] **Step 1: Remote tables**

Append to migration 005:

```sql
CREATE TABLE IF NOT EXISTS public.audit_events (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  user_id TEXT,
  event_type TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  old_value_json TEXT,
  new_value_json TEXT,
  created_at TEXT NOT NULL
);
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY ae_select ON public.audit_events FOR SELECT TO authenticated
  USING (household_id IN (SELECT household_id FROM public.user_households WHERE user_id = auth.uid()));
CREATE POLICY ae_insert ON public.audit_events FOR INSERT TO authenticated
  WITH CHECK (household_id IN (SELECT household_id FROM public.user_households WHERE user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS public.slip_queue (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  -- (mirror columns from src/data/local/schema/slipQueue.ts — read that file first)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
ALTER TABLE public.slip_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY sq_select ON public.slip_queue FOR SELECT TO authenticated
  USING (household_id IN (SELECT household_id FROM public.user_households WHERE user_id = auth.uid()));
CREATE POLICY sq_insert ON public.slip_queue FOR INSERT TO authenticated
  WITH CHECK (household_id IN (SELECT household_id FROM public.user_households WHERE user_id = auth.uid()));
```

Plus `merge_audit_event` and `merge_slip_queue` RPCs per Task A6 pattern.

- [ ] **Step 2: Wire into sync pipeline**

Add `audit_events` and `slip_queue` to `TABLE_MAP` and `TABLE_RPC_MAP`. Add them to the `RestoreService` dispatch map.

- [ ] **Step 3: Enqueue from `AuditLogger`**

`src/data/audit/AuditLogger.ts` — after the local insert, call `this.enqueuer.enqueue({ tableName: 'audit_events', recordId: row.id, operation: 'INSERT' })`.

- [ ] **Step 4: Tests**

Round-trip test for both tables in `SyncOrchestrator.test.ts` and `RestoreService.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "fix(sync): plumb auditEvents and slipQueue through sync pipeline

Both tables previously lived only on-device; audit trail and queued slip
scans were lost on reinstall. Now both sync to Supabase with RLS and LWW.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task A10: Fix `RestoreService.onConflictDoNothing` → force-overwrite on restore

**Files:** `src/data/sync/RestoreService.ts`

- [ ] **Step 1: Replace per-table inserts to use `merge_*` RPC or explicit upsert with set-all**

`onConflictDoNothing` silently drops remote updates if local has a row with the same id. On restore the remote is authoritative — use `onConflictDoUpdate` with all fields in the set clause, OR delete-then-insert.

Choose the `onConflictDoUpdate` path:

```ts
await this.db.insert(table).values(rows).onConflictDoUpdate({
  target: table.id,
  set: /* all columns from rows[0] */
});
```

Drizzle's `onConflictDoUpdate` needs an explicit set clause. Helper pattern:

```ts
function buildSetClause(columns: string[]) {
  return Object.fromEntries(columns.map((c) => [c, sql.raw(`excluded.${c}`)]));
}
```

- [ ] **Step 2: Test — local row gets overwritten by remote on restore**

Add test seeding a local row with `updated_at = '2020-01-01'`, restore with a row having `updated_at = '2026-04-13'`, assert local row now has 2026 data.

- [ ] **Step 3: Commit**

```bash
git add src/data/sync/RestoreService.ts src/data/sync/__tests__/RestoreService.test.ts
git commit -m "fix(sync): RestoreService overwrites local with remote on restore

Previously onConflictDoNothing silently kept stale local rows after a
reinstall. Restore now treats remote as authoritative.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task A11: `Logger` abstraction + remove bare `catch {}`

**Files:**
- Create: `src/infrastructure/logging/Logger.ts`
- Modify: `SyncOrchestrator.ts`, `RestoreService.ts`, `NotificationPreferencesRepository.ts` — replace silent `catch` with logged errors.

- [ ] **Step 1: `Logger.ts`**

```ts
export interface Logger {
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, err: unknown, data?: Record<string, unknown>): void;
}

class ConsoleLogger implements Logger {
  info(msg: string, data?: Record<string, unknown>) { if (__DEV__) console.log(msg, data); }
  warn(msg: string, data?: Record<string, unknown>) { console.warn(msg, data); }
  error(msg: string, err: unknown, data?: Record<string, unknown>) {
    console.error(msg, err, data);
    // Crashlytics hook wired in Task A12
  }
}

export const logger: Logger = new ConsoleLogger();
```

- [ ] **Step 2: Fix the three swallowed-catch sites**

In `SyncOrchestrator.ts` around line 60:
```ts
} catch (err) {
  logger.error('sync item failed', err, { itemId: item.id, table: item.tableName });
  const now = new Date().toISOString();
  await this.db.update(pendingSync)
    .set({ retryCount: item.retryCount + 1, lastAttemptedAt: now })
    .where(eq(pendingSync.id, item.id));
  failed++;
}
```

In `RestoreService.ts` — remove the redundant try/catch wrapping `onConflictDoNothing` (or keep with `logger.error`).

In `NotificationPreferencesRepository.ts` — log parse failures:
```ts
} catch (err) {
  logger.warn('NotificationPreferences read failed, using defaults', { err: String(err) });
  return defaultPreferences;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/infrastructure/logging/Logger.ts \
        src/data/sync/SyncOrchestrator.ts \
        src/data/sync/RestoreService.ts \
        src/infrastructure/notifications/NotificationPreferencesRepository.ts
git commit -m "refactor: Logger abstraction; fix bare catch swallowing errors

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task A12: Firebase Crashlytics crash monitoring

**Rationale:** The project already ships `@react-native-firebase/app` and `google-services.json`, so Crashlytics piggy-backs on existing Firebase integration. Native Android crash capture is best-in-class; JS crashes are routed via `recordError`. Free, no DSN management, no per-event billing.

**Files:**
- Modify: `package.json` (`@react-native-firebase/crashlytics`)
- Modify: `app.config.ts` (add plugin entries)
- Create: `src/infrastructure/monitoring/crashlytics.ts`
- Modify: `App.tsx` (init) + `src/infrastructure/logging/Logger.ts` (wire `recordError` in `error()`)
- Modify: `.github/workflows/cd.yml` (upload JS source maps post-build)

- [ ] **Step 1: Install**

```bash
npx expo install @react-native-firebase/crashlytics
```

- [ ] **Step 2: `app.config.ts` — add Firebase + Crashlytics plugins**

```ts
plugins: [
  // ...existing plugins,
  '@react-native-firebase/app',
  '@react-native-firebase/crashlytics',
  [
    'expo-build-properties',
    {
      android: {
        // Crashlytics Gradle plugin needed for NDK symbol upload
        extraMavenRepos: [],
      },
    },
  ],
],
```

(If `expo-build-properties` is not installed: `npx expo install expo-build-properties`. If already installed with other config, merge rather than replace.)

- [ ] **Step 3: Init module**

`src/infrastructure/monitoring/crashlytics.ts`:
```ts
import crashlytics from '@react-native-firebase/crashlytics';

export async function initCrashlytics(userId: string | null): Promise<void> {
  // Disable collection in dev so local errors don't spam the dashboard.
  await crashlytics().setCrashlyticsCollectionEnabled(!__DEV__);
  if (userId) await crashlytics().setUserId(userId);
}

export function recordError(
  err: unknown,
  context?: Record<string, string | number | boolean>,
): void {
  if (context) {
    Object.entries(context).forEach(([k, v]) => {
      crashlytics().setAttribute(k, String(v));
    });
  }
  const error = err instanceof Error ? err : new Error(String(err));
  crashlytics().recordError(error);
}

export function log(message: string): void {
  crashlytics().log(message);
}
```

- [ ] **Step 4: Wire into `Logger.ts`**

Replace the placeholder comment from Task A11 with the real Crashlytics call:
```ts
import { recordError } from '../monitoring/crashlytics';

class ConsoleLogger implements Logger {
  info(msg: string, data?: Record<string, unknown>) {
    if (__DEV__) console.log(msg, data);
  }
  warn(msg: string, data?: Record<string, unknown>) {
    console.warn(msg, data);
  }
  error(msg: string, err: unknown, data?: Record<string, unknown>) {
    console.error(msg, err, data);
    if (!__DEV__) {
      // Coerce unknown context values to strings for Crashlytics attribute API.
      const ctx: Record<string, string> = { msg };
      if (data) {
        Object.entries(data).forEach(([k, v]) => { ctx[k] = String(v); });
      }
      recordError(err, ctx);
    }
  }
}
```

- [ ] **Step 5: `App.tsx` — call `initCrashlytics` after auth resolves**

Inside the `initSession` flow, after `supabase.auth.getSession()` returns:
```ts
await initCrashlytics(session?.user?.id ?? null);
```

On sign-out (Task B4) clear the user id:
```ts
await crashlytics().setUserId('');
```

- [ ] **Step 6: Enable in Firebase Console**

One-time manual step (document in README):
- Firebase Console → your project → **Crashlytics** → Enable.
- First crash auto-creates the dashboard within ~5 min.

- [ ] **Step 7: Upload JS source maps in CD**

Minified JS stacks without source maps are useless. In `.github/workflows/cd.yml`, after the Gradle build step, add:

```yaml
- name: Upload JS source maps to Crashlytics
  run: |
    cd android
    ./gradlew uploadCrashlyticsSymbolFileRelease
    ./gradlew uploadCrashlyticsMappingFileRelease
```

(The tasks are added automatically by the Crashlytics Gradle plugin; no manual config needed.)

- [ ] **Step 8: Verify with a test crash**

Temporarily add a dev-only crash button in `SettingsScreen` (remove before commit):
```tsx
{__DEV__ && (
  <Button onPress={() => crashlytics().crash()}>Test crash</Button>
)}
```
Rebuild, tap, relaunch, confirm appearance in Firebase Console. Then delete the button.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(observability): Firebase Crashlytics crash reporting

Piggy-backs on existing @react-native-firebase/app integration. Native
Android crashes captured automatically; JS errors routed via
Logger.error → recordError. Crashlytics collection disabled in dev.

Source maps uploaded during CD so minified JS stacks are symbolicated.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

**Note on the active device crash:** Crashlytics only captures crashes *after* it's installed. For the crash you're seeing right now on the already-deployed draft build, use Play Console → Quality → Crashes & ANRs (which Google populates from Android's built-in crash reporting regardless of Crashlytics). Once this task lands and a new CD build ships, all future crashes land in Firebase.

---

### Task A13: Tooling — husky, lint-staged, prettier, prettier CI gate

**Files:** `package.json`, `.husky/pre-commit`, `.prettierrc.json`, `.prettierignore`, `.github/workflows/ci.yml`

- [ ] **Step 1: Install**

```bash
npm install --save-dev husky lint-staged
```

- [ ] **Step 2: `.prettierrc.json`**

```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "arrowParens": "always"
}
```

- [ ] **Step 3: `.prettierignore`**
```
node_modules
coverage
android
ios
.expo
dist
build
```

- [ ] **Step 4: `package.json` scripts**

```json
"scripts": {
  "format": "prettier --write \"src/**/*.{ts,tsx,js,json}\"",
  "format:check": "prettier --check \"src/**/*.{ts,tsx,js,json}\"",
  "prepare": "husky"
},
"lint-staged": {
  "*.{ts,tsx}": ["prettier --write", "eslint --fix"],
  "*.{json,md}": ["prettier --write"]
}
```

- [ ] **Step 5: Husky hook**

```bash
npx husky init
```

Edit `.husky/pre-commit`:
```bash
#!/usr/bin/env sh
npx lint-staged
npx tsc --noEmit
```

- [ ] **Step 6: Run prettier once on the whole tree**

```bash
npm run format
```

Commit the formatted tree in its own commit.

- [ ] **Step 7: CI — add format-check and tighten eslint config**

`.github/workflows/ci.yml` add step:
```yaml
- run: npm run format:check
```

`eslint.config.js` — change `explicit-function-return-type` and `react-hooks/exhaustive-deps` from `warn` to `error`. Tidy any new errors that surface.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore(dx): husky + lint-staged + prettier + CI format check

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task A14: Local composite indexes for hot columns

**Files:** new `src/data/local/migrations/0006_hot_column_indexes.sql` (or rely on drizzle-kit)

- [ ] **Step 1: Add drizzle schema indexes**

In the relevant schema files, add:
```ts
import { index } from 'drizzle-orm/sqlite-core';

export const transactions = sqliteTable('transactions', { /* ... */ }, (t) => ({
  householdDateIdx: index('transactions_household_date_idx').on(t.householdId, t.transactionDate),
}));

export const envelopes = sqliteTable('envelopes', { /* ... */ }, (t) => ({
  householdPeriodIdx: index('envelopes_household_period_idx').on(t.householdId, t.periodStart, t.isArchived),
}));

export const meterReadings = sqliteTable('meter_readings', { /* ... */ }, (t) => ({
  householdMeterIdx: index('meter_readings_household_meter_idx').on(t.householdId, t.meterType),
}));
```

- [ ] **Step 2: Generate migration**

```bash
npx drizzle-kit generate
```

Inspect the SQL — must be `CREATE INDEX`, nothing else. Commit the generated files.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "perf(db): composite indexes on hot-query columns

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task A15: Android `allowBackup=false` (POPIA)

**Files:** `app.config.ts`

- [ ] **Step 1: Add to Android config**

```ts
android: {
  // ... existing ...
  allowBackup: false,
},
```

- [ ] **Step 2: Commit**

```bash
git add app.config.ts
git commit -m "fix(sec): disable Android auto-backup (POPIA compliance)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Phase A Verification Checkpoint

- [ ] **Run all gates:**

```bash
npm run format:check && npm run typecheck && npm test && npm run lint
```

All exit 0. Commit message for the phase-end marker:

```bash
git commit --allow-empty -m "chore: Phase A (correctness + security) complete

- Hotfixed merge_baby_step ON CONFLICT form
- Membership model unified via trigger
- RLS on invitations + household_members
- CSPRNG invite codes
- LWW guard on all sync tables
- DLQ + exponential backoff in sync
- auditEvents + slipQueue plumbed
- RestoreService overwrites stale local
- Logger abstraction + Firebase Crashlytics
- Commit hooks + prettier + CI format-check
- Composite DB indexes
- Android allowBackup=false

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

# Phase B — Journey 1 is reachable

**Goal:** PRD Journey 1 (Thandi, new user) works end-to-end.

---

### Task B1: Onboarding wizard scaffolding

**Files:** new under `src/presentation/screens/auth/onboarding/`

Wizard steps per PRD Journey 1:
1. Welcome screen (`WelcomeStep.tsx`)
2. Income entry (`IncomeStep.tsx`) — creates income envelope
3. Expense categories picker (`ExpenseCategoriesStep.tsx`) — creates expense envelopes
4. Payday day selection (`PaydayStep.tsx`)
5. Meter setup (optional, `MeterSetupStep.tsx`) — creates meter_readings baselines
6. Ramsey score explainer (`ScoreIntroStep.tsx`)
7. Finish (`FinishStep.tsx`) — navigates to Dashboard

Wizard container: `OnboardingNavigator.tsx` (stack within the auth flow).

- [ ] **Step 1: Create stack navigator**

`OnboardingNavigator.tsx`:
```tsx
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { WelcomeStep } from './WelcomeStep';
// ... imports

const Stack = createNativeStackNavigator();

export function OnboardingNavigator(): JSX.Element {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Welcome" component={WelcomeStep} />
      <Stack.Screen name="Income" component={IncomeStep} />
      <Stack.Screen name="ExpenseCategories" component={ExpenseCategoriesStep} />
      <Stack.Screen name="Payday" component={PaydayStep} />
      <Stack.Screen name="MeterSetup" component={MeterSetupStep} />
      <Stack.Screen name="ScoreIntro" component={ScoreIntroStep} />
      <Stack.Screen name="Finish" component={FinishStep} />
    </Stack.Navigator>
  );
}
```

- [ ] **Step 2: `WelcomeStep.tsx`**

```tsx
import { View, StyleSheet } from 'react-native';
import { Text, Button } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';

export function WelcomeStep(): JSX.Element {
  const navigation = useNavigation<any>();
  return (
    <View style={styles.container}>
      <Text variant="displaySmall">Welcome.</Text>
      <Text variant="bodyLarge" style={{ marginTop: 16 }}>
        Let's set up your money. One question at a time. Takes about 12 minutes.
      </Text>
      <Button mode="contained" onPress={() => navigation.navigate('Income')} style={{ marginTop: 32 }}>
        Let's begin
      </Button>
    </View>
  );
}
const styles = StyleSheet.create({ container: { flex: 1, padding: 24, justifyContent: 'center' } });
```

- [ ] **Step 3: `IncomeStep.tsx`**

Collect monthly income. On save, call `CreateEnvelopeUseCase` with `envelopeType: 'income'`, then navigate.

- [ ] **Step 4: `ExpenseCategoriesStep.tsx`**

Chip picker with defaults (Groceries, Transport, Rent, Utilities, Airtime, Savings). Multi-select. On save, for each selected category, `CreateEnvelopeUseCase` with `envelopeType: 'spending'`. Navigate.

- [ ] **Step 5: `PaydayStep.tsx`**

Day-of-month picker (1-31). On save, store on household (`updateHouseholdPaydayDay` — add a use case if missing).

- [ ] **Step 6: `MeterSetupStep.tsx`**

Three toggles: electricity / water / odometer. For each enabled, insert an empty meter_readings record with the current date as baseline. Skip button present.

- [ ] **Step 7: `ScoreIntroStep.tsx`**

Static content explaining Ramsey Score. Continue button.

- [ ] **Step 8: `FinishStep.tsx`**

Confetti-free "Your budget is ready" moment. Button → dismisses wizard → dashboard. Sets a flag in `AsyncStorage` `onboarding_completed = true`.

- [ ] **Step 9: Gate in `RootNavigator`**

If user authenticated AND `householdId` set AND `!onboardingCompleted`, route to OnboardingNavigator instead of MainTabs.

- [ ] **Step 10: Component tests**

For each step, assert: renders title, renders CTA button, calls correct use case with correct args on save, navigates to the next step. Use `@testing-library/react-native`.

- [ ] **Step 11: Commit (one per step + one for gate)**

```bash
git commit -m "feat(onboarding): wizard steps 1-7 + navigator + RootNavigator gate

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task B2: Sign-up screen

**Files:** `src/presentation/screens/auth/SignUpScreen.tsx`, `LoginScreen.tsx`, `AuthNavigator.tsx`

- [ ] **Step 1: `SignUpScreen.tsx`**

Email + password + confirm password. On submit: `supabase.auth.signUp({ email, password })`. On success, navigate to `CreateHousehold` (below). On error, show the supabase error via `HelperText` below the relevant input.

```tsx
export function SignUpScreen(): JSX.Element {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigation = useNavigation<any>();

  const onSubmit = async () => {
    setErr(null);
    if (password !== confirm) { setErr('Passwords do not match'); return; }
    if (password.length < 8) { setErr('Password must be at least 8 characters'); return; }
    setLoading(true);
    const { error } = await supabase.auth.signUp({ email, password });
    setLoading(false);
    if (error) { setErr(error.message); return; }
    navigation.replace('CreateHousehold');
  };

  return (/* JSX with TextInput label props, HelperText, Button */);
}
```

- [ ] **Step 2: Link from LoginScreen**

Below the "Sign in" button, add a `TextButton` / Button variant: "New here? Create an account" → `navigation.navigate('SignUp')`.

- [ ] **Step 3: Register in `AuthNavigator`**

```tsx
<Stack.Screen name="SignUp" component={SignUpScreen} />
<Stack.Screen name="CreateHousehold" component={CreateHouseholdScreen} />
```

- [ ] **Step 4: Test**

Component test asserting submit calls `supabase.auth.signUp` and navigates on success.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(auth): sign-up screen + link from login

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task B3: Household-creation gate after auth

**Files:** `src/presentation/navigation/RootNavigator.tsx`

- [ ] **Step 1: Three-way gate logic**

```tsx
if (!user) return <AuthNavigator />;
if (user && !householdId) return <CreateHouseholdNavigator />; // new small stack with the existing CreateHouseholdScreen
if (user && householdId && !onboardingCompleted) return <OnboardingNavigator />;
return <MainTabNavigator />;
```

- [ ] **Step 2: `CreateHouseholdNavigator`**

Tiny stack holding just `CreateHouseholdScreen` + `JoinHouseholdScreen`. Existing screens; just needs its own navigator wrapper.

- [ ] **Step 3: Tests**

RootNavigator renders correct variant per state fixture (4 states).

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(auth): household-creation gate between auth and main tabs

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task B4: Sign-out in Settings

**Files:** `src/presentation/screens/settings/SettingsScreen.tsx`

- [ ] **Step 1: Add button**

```tsx
<View style={styles.section}>
  <Button
    mode="outlined"
    icon="logout"
    onPress={() => Alert.alert('Sign out?', '', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: handleSignOut },
    ])}
    textColor={theme.colors.error}
  >
    Sign out
  </Button>
</View>
```

Handler:
```tsx
const handleSignOut = async (): Promise<void> => {
  await supabase.auth.signOut();
  useAppStore.getState().reset(); // zustand reset
};
```

Add `reset()` to `appStore` if absent.

- [ ] **Step 2: Test**

Assert that tapping "Sign out", confirming Alert, calls `supabase.auth.signOut`.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(auth): sign-out button in Settings

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task B5: Envelope picker shows balance

**Files:** `src/presentation/screens/transactions/AddTransactionScreen.tsx`

- [ ] **Step 1: Extend the picker data shape**

Today the picker uses `{ id, name }`. Change to `{ id, name, allocatedCents, spentCents, envelopeType }` — reads via `useEnvelopes`, filters current period.

- [ ] **Step 2: Render balance per row**

```tsx
<Text variant="bodySmall" style={{ color: theme.colors.outline }}>
  {`R${((env.allocatedCents - env.spentCents) / 100).toFixed(2)} left`}
</Text>
```

Negative balances render in `theme.colors.error`.

- [ ] **Step 3: Exclude income-type envelopes from picker**

Per domain rule (Phase 2 of Baby Steps spec).

- [ ] **Step 4: Date picker for back-dating**

Replace the hardcoded "Date: today" row with a `DateTimePicker` from `@react-native-community/datetimepicker` if installed, OR a simple date picker already in the codebase. If neither exists, install `@react-native-community/datetimepicker`:

```bash
npx expo install @react-native-community/datetimepicker
```

UI: "Date" row → opens picker modal → saves ISO yyyy-mm-dd.

- [ ] **Step 5: Amount validation — reject R0**

On submit, if `toCents(amount) <= 0` show error "Amount must be greater than R0".

- [ ] **Step 6: Component test**

Mount screen, assert each envelope row shows balance, negative balance shows error colour, submit with 0 amount shows validation error, submit with past date calls use case with that date.

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(transactions): envelope picker shows balance; back-datable; reject R0

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task B6: Real `loggingDaysCount` on Ramsey Score

**Files:** `src/presentation/screens/dashboard/DashboardScreen.tsx` + new `src/domain/scoring/resolveLoggingDays.ts`

- [ ] **Step 1: Helper**

```ts
export async function resolveLoggingDays(
  db: ExpoSQLiteDatabase<typeof schema>,
  householdId: string,
  periodStart: string,
  periodEnd: string,
): Promise<number> {
  const rows = await db.select({ date: transactions.transactionDate })
    .from(transactions)
    .where(and(
      eq(transactions.householdId, householdId),
      gte(transactions.transactionDate, periodStart),
      lte(transactions.transactionDate, periodEnd),
    ));
  const distinctDays = new Set(rows.map((r) => r.date));
  return distinctDays.size;
}
```

- [ ] **Step 2: Wire into DashboardScreen**

Replace the hardcoded `loggingDaysCount: 0` with a state value populated via the helper on focus.

- [ ] **Step 3: Test the helper**

Unit test the helper against an in-memory drizzle instance OR hand-rolled mock.

- [ ] **Step 4: Commit**

```bash
git commit -m "fix(dashboard): resolve loggingDaysCount from real transaction history

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task B7: Tab bar labels

**Files:** `src/presentation/navigation/MainTabNavigator.tsx`

- [ ] **Step 1: Remove `tabBarShowLabel: false`**

Add labels for all five tabs: Dashboard / Budget / Meters / Snowball / Settings.

- [ ] **Step 2: Snapshot test the navigator**

Or a simple render test that asserts each tab's label is present.

- [ ] **Step 3: Commit**

```bash
git commit -m "fix(nav): show tab bar labels (icons alone are ambiguous)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task B8: Transaction delete affordance — swipe + confirm

**Files:** `src/presentation/screens/transactions/TransactionListScreen.tsx`

- [ ] **Step 1: Replace long-press with swipe-to-delete**

Use `react-native-gesture-handler`'s `Swipeable` (already in RN Paper's dependency tree). Right-swipe reveals a red Delete button. Tap → Alert confirm → `DeleteTransactionUseCase.execute`.

- [ ] **Step 2: Commit**

```bash
git commit -m "fix(transactions): swipe-to-delete affordance (was undiscoverable long-press)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task B9: Envelope delete button

**Files:** `src/presentation/screens/envelopes/AddEditEnvelopeScreen.tsx` + new `ArchiveEnvelopeUseCase` wiring (already exists)

- [ ] **Step 1: Add "Archive" button at the bottom of edit mode**

Not a hard delete — archive so historical transactions keep their envelope name. Use existing `ArchiveEnvelopeUseCase`.

- [ ] **Step 2: Alert confirm + success toast**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(envelopes): archive button on edit screen

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task B10: Success toasts on every save

**Files:** use existing `toastStore` from Baby Steps work.

- [ ] **Step 1: Mount a `ToastHost` at the root navigator**

Consumes `toastStore.queue`, shows `react-native-paper` Snackbar.

- [ ] **Step 2: Call `toastStore.enqueue({ kind: 'info', message: 'Saved' })` after every successful save**

Sites: CreateTransaction, UpdateEnvelope, CreateEnvelope, CreateDebt, LogDebtPayment, LogMeterReading, accept invite.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(ux): success toasts across save flows

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task B11: Offline indicator

**Files:** new `src/presentation/components/shared/OfflineBanner.tsx`, mount in `MainTabNavigator`

- [ ] **Step 1: Use existing `NetworkObserver`**

The project has a `NetworkObserver` emitting `online`/`offline` state. Hook into a new Zustand `networkStore`.

- [ ] **Step 2: Thin yellow banner at top when offline**

Copy: "Offline — changes will sync when you're back online."

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(ux): offline banner when NetworkObserver reports offline

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Phase B Verification Checkpoint

- [ ] `npm run format:check && npm run typecheck && npm test && npm run lint` all exit 0.
- [ ] Manual smoke of Journey 1 on emulator: fresh install → sign up → create household → onboarding wizard → dashboard shows correct score → add transaction (with balance visible in picker) → see success toast.
- [ ] Commit marker:

```bash
git commit --allow-empty -m "chore: Phase B (Journey 1 reachable) complete

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

# Phase C — Hardening

**Goal:** Domain abstractions, dark theme, a11y, performance, shared components, E2E.

---

### Task C1: Repository interfaces in `src/domain/ports/`

**Files:** new directory `src/domain/ports/`

Create one port per aggregate: `ITransactionRepository`, `IEnvelopeRepository`, `IDebtRepository`, `IMeterReadingRepository`, `IBabyStepRepository`, `IHouseholdRepository`, `IAuditPort`, `ISyncEnqueuer`.

- [ ] **Step 1: Define interfaces**

Example:
```ts
// src/domain/ports/ITransactionRepository.ts
export interface ITransactionRepository {
  findById(id: string, householdId: string): Promise<TransactionEntity | null>;
  insert(t: TransactionEntity): Promise<void>;
  delete(id: string, householdId: string): Promise<void>;
}
```

- [ ] **Step 2: Drizzle-backed implementations in `src/data/repositories/`**

```ts
// src/data/repositories/DrizzleTransactionRepository.ts
export class DrizzleTransactionRepository implements ITransactionRepository { /* ... */ }
```

- [ ] **Step 3: Use cases accept interfaces via constructor**

Change every domain use case from `new PendingSyncEnqueuer(db)` inline to accepting `ISyncEnqueuer` in the constructor.

- [ ] **Step 4: Update all call sites**

App.tsx and tests construct the repo implementations once and inject.

- [ ] **Step 5: Commit (per aggregate)**

7 logical commits, one per aggregate rollout.

---

### Task C2: Dark theme

**Files:** `src/presentation/theme/tokens.ts`, `src/presentation/theme/theme.ts`, new `src/presentation/theme/useAppTheme.ts`

- [ ] **Step 1: Add `darkColours` token set**

Define a complete dark palette matching the existing `colours` shape. Verify contrast ≥ 4.5:1 for every text/background pair.

- [ ] **Step 2: `useAppTheme.ts`**

```ts
import { useColorScheme } from 'react-native';
import { MD3LightTheme, MD3DarkTheme } from 'react-native-paper';
import { colours, darkColours } from './tokens';

export function useAppTheme() {
  const scheme = useColorScheme();
  return scheme === 'dark'
    ? { ...MD3DarkTheme, colors: darkColours }
    : { ...MD3LightTheme, colors: colours };
}
```

- [ ] **Step 3: Replace static `appTheme` exports with `useAppTheme()` everywhere**

Includes `App.tsx` `<PaperProvider theme={useAppTheme()}>`.

- [ ] **Step 4: Fix hardcoded whites in PayoffProjectionCard**

`'#FFFFFF'` → `theme.colors.onPrimary`.

- [ ] **Step 5: Commit**

---

### Task C3: Shared components — ScreenHeader, EmptyState, LoadingSkeletonList

**Files:** `src/presentation/components/shared/`

- [ ] **Step 1: `ScreenHeader.tsx`** — eyebrow + title pattern extracted.
- [ ] **Step 2: `EmptyState.tsx`** — icon + title + body + optional CTA.
- [ ] **Step 3: `LoadingSkeletonList.tsx`** — reusable skeleton card row.
- [ ] **Step 4: Replace 6 header duplicates + 3 empty-state duplicates with the new components.**
- [ ] **Step 5: Tests for each component.**
- [ ] **Step 6: Commit**

---

### Task C4: Accessibility pass

For each of these screens, add `accessibilityLabel`, `accessibilityRole`, `accessibilityState` where appropriate, and `maxFontSizeMultiplier={1.6}` on fixed-height containers.

- [ ] **Step 1: LoginScreen** — form field roles, error live region.
- [ ] **Step 2: SignUpScreen** — same.
- [ ] **Step 3: AddTransactionScreen** — picker modal `accessibilityViewIsModal`, focus trap, field labels.
- [ ] **Step 4: AddDebtScreen, LogPaymentScreen, AddEditEnvelopeScreen, AddReadingScreen** — form field patterns.
- [ ] **Step 5: Debt Snowball screens** — progress bars get `accessibilityRole="progressbar"` + `accessibilityValue={{ min, max, now }}` + label.
- [ ] **Step 6: `RamseyScoreBadge`** — fix `scoreFair` colour to a token that passes 4.5:1 on `surface`. Replace `#FFB300` with a darker amber (e.g. `#B25E09`) — test contrast.
- [ ] **Step 7: `outline` token `#6B8A87`** — darken to `#5A7673` for 4.5:1 on `surface`.
- [ ] **Step 8: CelebrationModal** — `accessibilityViewIsModal`, `AccessibilityInfo.announceForAccessibility` on open.
- [ ] **Step 9: Commit one per screen**

---

### Task C5: Parallel startup in App.tsx

**Files:** `App.tsx`

- [ ] **Step 1: Identify independent boot tasks**

`getSession` + migrations + local household lookup can all run in parallel.

- [ ] **Step 2: Refactor with `Promise.all`**

- [ ] **Step 3: Move `restoreService.restore` to fire-and-forget after navigator mounts**

- [ ] **Step 4: Commit**

---

### Task C6: Remove `react-native-vector-icons`; replace 2 usages with inline SVG

- [ ] **Step 1: Find the two MaterialCommunityIcons usages**
- [ ] **Step 2: Replace with inline `react-native-svg` paths**
- [ ] **Step 3: `npm uninstall react-native-vector-icons`**
- [ ] **Step 4: Commit**

---

### Task C7: SyncOrchestrator N+1 fix

- [ ] **Step 1: Batch-fetch rows by table**

```ts
const byTable = groupBy(pending, (p) => p.tableName);
for (const [tableName, items] of Object.entries(byTable)) {
  const ids = items.map((i) => i.recordId);
  const rows = await db.select().from(TABLE_MAP[tableName]).where(inArray(TABLE_MAP[tableName].id, ids));
  // Now sequentially process remote calls but with pre-fetched rows.
}
```

- [ ] **Step 2: Run remote upserts in `Promise.allSettled` per table batch**
- [ ] **Step 3: Benchmark test — 100 pending items run in <30s on CI**
- [ ] **Step 4: Commit**

---

### Task C8: Screen-level component tests for uncovered screens

Add tests for each of the 14 uncovered screens. For each: render, assert key elements, simulate one user action, assert state change. Full boilerplate is out of scope for this plan but pattern mirrors existing `BabyStepsScreen.test.tsx`.

- [ ] **Step 1: LoginScreen test**
- [ ] **Step 2: SignUpScreen test** (new in Phase B)
- [ ] **Step 3-14: one test file per remaining screen**
- [ ] **Step 15: Commit each**

---

### Task C9: Detox E2E harness

**Files:** new `.detoxrc.js`, `e2e/`

- [ ] **Step 1: Install**

```bash
npm install --save-dev detox jest-circus
```

- [ ] **Step 2: Init**

```bash
npx detox init --runner jest
```

Follow Detox setup instructions for Expo projects. This is non-trivial — budget 1-2 sessions.

- [ ] **Step 3: Three smoke specs**

- `e2e/signup.spec.ts` — signup → create household → onboarding → dashboard
- `e2e/addTransaction.spec.ts` — tap +, pick envelope, enter amount, save, see in list
- `e2e/syncRoundTrip.spec.ts` — create envelope, wait for sync, force-quit, relaunch, envelope still there

- [ ] **Step 4: CI job for E2E** (only runs on `master` merges due to cost)

- [ ] **Step 5: Commit**

---

### Task C10: Remove unused Firebase packages (if no FCM work planned)

- [ ] **Step 1: Confirm no FCM code in `src/`**

```bash
grep -r 'messaging' src/
```

- [ ] **Step 2: `npm uninstall @react-native-firebase/app @react-native-firebase/messaging`**

If push notifications are planned for Phase 2 of product roadmap, skip this task.

- [ ] **Step 3: Commit**

---

### Task C11: Pin CD action to SHA

**Files:** `.github/workflows/cd.yml`

- [ ] **Step 1: Replace `r0adkll/upload-google-play@v1` with the exact commit SHA**

Find current SHA: visit the GH Actions page, copy the SHA for the tagged release.

- [ ] **Step 2: Commit**

---

### Task C12: Coverage threshold expansion

**Files:** `jest.config.js`

- [ ] **Step 1: Expand `collectCoverageFrom` to `src/**` minus tests**
- [ ] **Step 2: Raise threshold to 80% lines / 75% branches**
- [ ] **Step 3: If threshold fails, add tests until it passes**
- [ ] **Step 4: Commit**

---

### Phase C Verification Checkpoint

- [ ] `npm run format:check && npm run typecheck && npm test -- --coverage && npm run lint` all exit 0, coverage ≥ 80%.
- [ ] Detox smoke suite runs green locally.
- [ ] Commit marker:

```bash
git commit --allow-empty -m "chore: Phase C (hardening) complete

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

# Final Verification

- [ ] **All gates:**
```bash
npm run format:check
npm run typecheck
npm test -- --coverage
npm run lint
```
All exit 0. Coverage ≥ 80%.

- [ ] **Manual smoke:**
  1. Fresh install → sign up → create household → onboarding → dashboard
  2. Add transaction with back-dated date, confirm picker shows balance, see success toast
  3. Toggle network off → offline banner appears → changes queue → network on → banner clears, data syncs
  4. Sign out from settings → lands back on login
  5. Android: verify `allowBackup=false` in manifest

- [ ] **PR description** includes the commit markers from each phase + the test/lint/typecheck/coverage numbers.

- [ ] **Open PR against master with title: `feat: codebase hardening — correctness, Journey 1, hardening`**

---

# Rollback notes

- Phases are internally cohesive. If the branch gets too large for review, split by creating three separate branches at the phase-end commit markers and open three PRs.
- The merge RPCs added in A6 are additive — old clients without the routing change continue using plain upsert, but their writes may be lost to LWW on the server (acceptable downside).
- The `user_households` trigger added in A2 is a one-way mirror; remove if the membership model is later unified to a single table.
