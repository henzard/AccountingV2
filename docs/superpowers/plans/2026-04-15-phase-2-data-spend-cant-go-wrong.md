# Phase 2 — "Data + spend can't go wrong" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every known data-loss, cost-abuse, and enumeration path before opening the app to a wider test audience.

**Architecture:** Four self-contained tasks in dependency order — (1) harden the local migration runner so corrupt or tampered migrations fail fast; (2) tighten `invitations` RLS to creator-only reads with a new server-side lookup RPC so acceptors can't enumerate all invites; (3) eliminate the OpenAI rate-limit TOCTOU via an advisory-locked Postgres RPC; (4) rename "Ramsey Score" → "Habit Score" across the codebase. Each task has its own commit and leaves the suite green.

**Tech Stack:** React Native + Expo SDK 55, TypeScript, Drizzle ORM + expo-sqlite, Supabase (PostgreSQL + Edge Functions, Deno), Zustand, Jest / `jsr:@std/assert`.

---

## Prerequisite: Confirm Phase A is already landed

Before starting, verify `supabase/migrations/005_security_and_sync_correctness.sql` is present. It must contain both the `merge_baby_step` ON CONFLICT column-list fix and the `tr_household_members_sync_user_households` trigger. If either is missing, apply the hardening plan (`docs/superpowers/plans/2026-04-13-codebase-hardening.md`) Tasks A1–A2 first.

```bash
grep -c "tr_household_members_sync_user_households" supabase/migrations/005_security_and_sync_correctness.sql
# expected: 1 (or more)
grep -c "ON CONFLICT (household_id, step_number)" supabase/migrations/005_security_and_sync_correctness.sql
# expected: 1
```

---

## File Structure

| File                                                                         | Action          | Purpose                                                          |
| ---------------------------------------------------------------------------- | --------------- | ---------------------------------------------------------------- |
| `supabase/migrations/008_phase2_data_integrity.sql`                          | Create          | All Postgres changes for this phase                              |
| `src/data/local/db.ts`                                                       | Modify          | Per-file transaction + checksum verification                     |
| `src/data/local/__tests__/db.migrationChecksum.test.ts`                      | Create          | Unit-tests for the checksum hash                                 |
| `src/domain/households/AcceptInviteUseCase.ts`                               | Modify          | Use `lookup_invite_by_code` RPC instead of direct table SELECT   |
| `src/domain/households/AcceptInviteUseCase.test.ts`                          | Modify          | Update mocks to match new RPC call shape                         |
| `supabase/functions/extract-slip/index.ts`                                   | Modify          | Replace two COUNT queries with `check_and_reserve_slip_slot` RPC |
| `supabase/functions/extract-slip/__tests__/extract-slip.test.ts`             | Modify          | Update mock to handle RPC call                                   |
| `src/domain/scoring/RamseyScoreCalculator.ts`                                | Modify          | Rename class, interfaces, comments                               |
| `src/domain/scoring/__tests__/RamseyScoreCalculator.test.ts`                 | Rename + modify | Update imports and test descriptions                             |
| `src/presentation/screens/dashboard/components/RamseyScoreBadge.tsx`         | Modify          | Update `accessibilityLabel` and any "Ramsey" strings             |
| `src/presentation/screens/auth/onboarding/ScoreIntroStep.tsx`                | Modify          | Replace all "Ramsey Score" text                                  |
| `src/presentation/screens/auth/onboarding/__tests__/ScoreIntroStep.test.tsx` | Modify          | Update snapshot/string assertions                                |
| `src/presentation/screens/auth/onboarding/FinishStep.tsx`                    | Modify          | Replace "Ramsey Score" in body copy                              |
| `src/presentation/screens/dashboard/DashboardScreen.tsx`                     | Modify          | Update import name                                               |

---

## Task 1: Migration runner — per-file transaction + checksum

**Why:** The current runner calls `execAsync` per migration with no wrapping transaction and no integrity check. A partial migration (e.g., power cut mid-run) leaves the DB in an inconsistent state with no way to detect it. A checksum stored in `__app_migrations` lets us detect if a previously-applied migration file was changed.

**Files:**

- Modify: `src/data/local/db.ts`
- Create: `src/data/local/__tests__/db.migrationChecksum.test.ts`

- [ ] **Step 1: Write the failing unit tests for the hash function**

Create `src/data/local/__tests__/db.migrationChecksum.test.ts`:

```ts
// Tests for the djb2 checksum used by the migration runner.
// Import via the module-internal export (we'll export it in Step 2).
import { djb2Hex } from '../db';

describe('djb2Hex', () => {
  it('returns an 8-character hex string', () => {
    expect(djb2Hex('hello')).toMatch(/^[0-9a-f]{8}$/);
  });

  it('is deterministic', () => {
    expect(djb2Hex('CREATE TABLE foo (id TEXT)')).toBe(djb2Hex('CREATE TABLE foo (id TEXT)'));
  });

  it('produces different hashes for different inputs', () => {
    expect(djb2Hex('alpha')).not.toBe(djb2Hex('beta'));
  });

  it('handles empty string', () => {
    expect(djb2Hex('')).toBe('00001505'); // djb2 initial value 5381 = 0x1505
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npx jest src/data/local/__tests__/db.migrationChecksum.test.ts
```

Expected: FAIL — `djb2Hex` is not exported from `../db`.

- [ ] **Step 3: Implement the updated `db.ts`**

Replace the entire contents of `src/data/local/db.ts`:

```ts
import { useEffect, useState } from 'react';
import * as SQLite from 'expo-sqlite';
import { drizzle } from 'drizzle-orm/expo-sqlite';
import migrations from './migrations/migrations';
import * as schema from './schema';

const expo = SQLite.openDatabaseSync('accountingv2-v3.db');
export const db = drizzle(expo, { schema });

const MIGRATIONS_TABLE = '__app_migrations';
const STATEMENT_BREAKPOINT_RE = /--> statement-breakpoint/g;
const migrationEntries = Object.entries(
  (migrations as { migrations: Record<string, string> }).migrations,
);

// djb2 — fast, dependency-free, synchronous hash suitable for migration integrity checks.
// Not cryptographic — its purpose is detecting accidental file changes, not adversarial tampering.
export function djb2Hex(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    // djb2: hash = hash * 33 + charCode
    hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0xffffffff;
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

let migrationsPromise: Promise<void> | null = null;

function runMigrationsOnce(): Promise<void> {
  if (!migrationsPromise) {
    migrationsPromise = (async (): Promise<void> => {
      // Ensure table exists with the checksum column.
      await expo.execAsync(
        `CREATE TABLE IF NOT EXISTS \`${MIGRATIONS_TABLE}\` (` +
          '`name` TEXT PRIMARY KEY NOT NULL, ' +
          '`applied_at` TEXT NOT NULL, ' +
          "`checksum` TEXT NOT NULL DEFAULT 'legacy'" +
          ')',
      );
      // Idempotently add checksum column to tables created before this version.
      await expo
        .execAsync(
          `ALTER TABLE \`${MIGRATIONS_TABLE}\` ADD COLUMN \`checksum\` TEXT NOT NULL DEFAULT 'legacy'`,
        )
        .catch(() => {
          // Column already exists — ignore.
        });

      const rows =
        (await expo.getAllAsync<{ name: string; checksum: string }>(
          `SELECT name, checksum FROM \`${MIGRATIONS_TABLE}\``,
        )) ?? [];
      const applied = new Map(rows.map((r) => [r.name, r.checksum]));

      // Verify integrity of previously-applied migrations.
      for (const [name, sql] of migrationEntries) {
        const storedChecksum = applied.get(name);
        if (!storedChecksum) continue; // not applied yet — will run below
        if (storedChecksum === 'legacy') continue; // pre-checksum era — trust it
        const expected = djb2Hex(sql);
        if (storedChecksum !== expected) {
          throw new Error(
            `Migration checksum mismatch for "${name}": ` +
              `stored=${storedChecksum}, current=${expected}. ` +
              'The migration file was modified after it was applied — this is not allowed.',
          );
        }
      }

      if (applied.size === migrationEntries.length) return;

      for (const [name, sql] of migrationEntries) {
        if (applied.has(name)) continue;
        const checksum = djb2Hex(sql);
        const cleanSql = sql.replace(STATEMENT_BREAKPOINT_RE, '');
        // Wrap each migration in a transaction so a partial failure leaves no residue.
        await expo.execAsync('BEGIN');
        try {
          await expo.execAsync(cleanSql);
          await expo.runAsync(
            `INSERT INTO \`${MIGRATIONS_TABLE}\` (name, applied_at, checksum) VALUES (?, ?, ?)`,
            [name, new Date().toISOString(), checksum],
          );
          await expo.execAsync('COMMIT');
        } catch (e) {
          try {
            await expo.execAsync('ROLLBACK');
          } catch {
            /* ignore */
          }
          throw e;
        }
      }
    })();
  }
  return migrationsPromise;
}

export function useDatabaseMigrations(): { success: boolean; error?: Error } {
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<Error | undefined>();

  useEffect(() => {
    let cancelled = false;
    runMigrationsOnce().then(
      () => {
        if (!cancelled) setSuccess(true);
      },
      (err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err : new Error(String(err)));
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  return { success, error };
}
```

- [ ] **Step 4: Run the unit tests and confirm they pass**

```bash
npx jest src/data/local/__tests__/db.migrationChecksum.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Run the full suite to check no regressions**

```bash
npm run typecheck && npm test
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/data/local/db.ts src/data/local/__tests__/db.migrationChecksum.test.ts
git commit -m "fix(migrations): per-file BEGIN/COMMIT + djb2 checksum verification

Each migration now runs inside its own SQLite transaction so a partial
failure leaves the DB unmodified. The checksum is stored in
__app_migrations and verified on every boot — boot halts with a clear
error if a previously-applied migration file was changed.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 2: Invitations RLS — creator-only SELECT + lookup RPC

**Why:** The current policy (or the A3 policy in 005) lets any authenticated user SELECT invitations whose code is valid and unused — meaning the entire `invitations` table can be scanned by brute-forcing codes. The exit criteria requires `SELECT * FROM invitations` as a non-creator to return 0 rows. `AcceptInviteUseCase` currently does a direct table SELECT by code; we move that to a `SECURITY DEFINER` RPC so the acceptor never needs SELECT.

**Files:**

- Create: `supabase/migrations/008_phase2_data_integrity.sql`
- Modify: `src/domain/households/AcceptInviteUseCase.ts`
- Modify: `src/domain/households/AcceptInviteUseCase.test.ts`

- [ ] **Step 1: Create migration 008 with tightened RLS + lookup RPC**

Create `supabase/migrations/008_phase2_data_integrity.sql`:

```sql
-- 008_phase2_data_integrity.sql
-- Phase 2: invitations RLS (creator-only), lookup RPC, and OpenAI rate-limit fix.

-- ─── Invitations: tighten SELECT to creator only ───────────────────────────
-- Drop any permissive SELECT policy that allows acceptors to enumerate invites.
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inv_select ON public.invitations;
CREATE POLICY inv_select ON public.invitations
  FOR SELECT TO authenticated
  USING (invited_by_user_id = auth.uid());
-- Acceptors must use the lookup_invite_by_code RPC below — they never need raw SELECT.

DROP POLICY IF EXISTS inv_insert ON public.invitations;
CREATE POLICY inv_insert ON public.invitations
  FOR INSERT TO authenticated
  WITH CHECK (invited_by_user_id = auth.uid());

DROP POLICY IF EXISTS inv_update ON public.invitations;
CREATE POLICY inv_update ON public.invitations
  FOR UPDATE TO authenticated
  USING (invited_by_user_id = auth.uid() OR used_by IS NULL)
  WITH CHECK (true);

-- ─── RPC: look up a valid invite by code (SECURITY DEFINER bypasses RLS) ───
CREATE OR REPLACE FUNCTION public.lookup_invite_by_code(invite_code text)
RETURNS TABLE (
  id          text,
  household_id text,
  expires_at  text,
  used_by     text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    i.id,
    i.household_id,
    i.expires_at,
    i.used_by
  FROM public.invitations i
  WHERE i.code = UPPER(invite_code)
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.lookup_invite_by_code(text) TO authenticated;
```

- [ ] **Step 2: Write the failing test for the updated AcceptInviteUseCase**

Open `src/domain/households/AcceptInviteUseCase.test.ts` and add this new describe block (keep any existing tests):

```ts
describe('AcceptInviteUseCase — uses lookup_invite_by_code RPC', () => {
  it('calls supabase.rpc("lookup_invite_by_code") not a direct table SELECT', async () => {
    const mockInvite = {
      id: 'inv1',
      household_id: 'h1',
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      used_by: null,
    };

    const rpcMock = jest.fn().mockReturnValue({
      single: jest.fn().mockResolvedValue({ data: mockInvite, error: null }),
    });

    const fromMock = jest.fn().mockReturnValue({
      insert: jest.fn().mockResolvedValue({ data: null, error: null }),
    });

    const rpcClaimMock = jest.fn().mockResolvedValue({ error: null });

    const supabase = {
      rpc: jest.fn().mockImplementation((name: string) => {
        if (name === 'lookup_invite_by_code') return rpcMock();
        if (name === 'claim_invite') return rpcClaimMock();
        return { error: null };
      }),
      from: fromMock,
    };

    const db = {
      insert: jest.fn().mockReturnValue({
        values: jest.fn().mockResolvedValue(undefined),
      }),
    };

    const restoreService = {
      restoreHousehold: jest.fn().mockResolvedValue({
        id: 'h1',
        name: 'My House',
        paydayDay: 25,
      }),
    };

    const enqueuer = { enqueue: jest.fn() };

    const useCase = new AcceptInviteUseCase(
      supabase as any,
      db as any,
      restoreService as any,
      { code: 'ABC123', userId: 'user-b' },
      enqueuer as any,
    );

    const result = await useCase.execute();

    expect(result.success).toBe(true);
    expect(supabase.rpc).toHaveBeenCalledWith('lookup_invite_by_code', { invite_code: 'ABC123' });
    // Must NOT call supabase.from('invitations') for SELECT
    const fromCalls: string[] = fromMock.mock.calls.map((c: [string]) => c[0]);
    expect(fromCalls).not.toContain('invitations');
  });

  it('returns INVITE_NOT_FOUND when RPC returns null', async () => {
    const supabase = {
      rpc: jest.fn().mockReturnValue({
        single: jest.fn().mockResolvedValue({ data: null, error: { message: 'not found' } }),
      }),
      from: jest.fn(),
    };

    const useCase = new AcceptInviteUseCase(supabase as any, {} as any, {} as any, {
      code: 'BAD',
      userId: 'u1',
    });

    const result = await useCase.execute();
    expect(result.success).toBe(false);
    expect((result as any).error.code).toBe('INVITE_NOT_FOUND');
  });

  it('returns INVITE_EXPIRED when expires_at is in the past', async () => {
    const supabase = {
      rpc: jest.fn().mockReturnValue({
        single: jest.fn().mockResolvedValue({
          data: {
            id: 'i1',
            household_id: 'h1',
            expires_at: new Date(Date.now() - 1000).toISOString(),
            used_by: null,
          },
          error: null,
        }),
      }),
      from: jest.fn(),
    };

    const useCase = new AcceptInviteUseCase(supabase as any, {} as any, {} as any, {
      code: 'EXP',
      userId: 'u1',
    });

    const result = await useCase.execute();
    expect(result.success).toBe(false);
    expect((result as any).error.code).toBe('INVITE_EXPIRED');
  });
});
```

- [ ] **Step 3: Run the tests — confirm the RPC-path tests fail**

```bash
npx jest src/domain/households/AcceptInviteUseCase.test.ts
```

Expected: the new tests FAIL because `AcceptInviteUseCase` still does `supabase.from('invitations').select(...)`.

- [ ] **Step 4: Update `AcceptInviteUseCase.ts` to use the RPC**

Replace the `execute()` method's first step (`// 1. Fetch the invitation`) block in `src/domain/households/AcceptInviteUseCase.ts`:

```ts
  async execute(): Promise<Result<HouseholdSummary>> {
    // 1. Fetch the invitation via SECURITY DEFINER RPC (bypasses RLS so acceptors
    //    never need SELECT on the invitations table directly).
    const { data: invite, error: inviteError } = await this.supabase
      .rpc('lookup_invite_by_code', { invite_code: this.input.code.toUpperCase() })
      .single();

    if (inviteError || !invite) {
      return createFailure({ code: 'INVITE_NOT_FOUND', message: 'Invite code not found' });
    }

    if (new Date(invite.expires_at as string) < new Date()) {
      return createFailure({ code: 'INVITE_EXPIRED', message: 'This invite code has expired' });
    }

    if (invite.used_by) {
      return createFailure({
        code: 'INVITE_ALREADY_USED',
        message: 'This invite code has already been used',
      });
    }

    const householdId = invite.household_id as string;

    // 2. Add user to household_members in Supabase
    const memberId = randomUUID();
    const now = new Date().toISOString();

    const { error: insertError } = await this.supabase.from('household_members').insert({
      id: memberId,
      household_id: householdId,
      user_id: this.input.userId,
      role: 'member',
      joined_at: now,
    });

    if (insertError) {
      return createFailure({ code: 'JOIN_FAILED', message: insertError.message });
    }

    // 3. Mark invitation as used via SECURITY DEFINER RPC (validates caller owns the claim)
    const { error: markUsedError } = await this.supabase.rpc('claim_invite', {
      invite_id: invite.id as string,
    });

    if (markUsedError) {
      return createFailure({ code: 'INVITE_MARK_FAILED', message: markUsedError.message });
    }

    // 4. Insert member row locally
    const localMember: InferInsertModel<typeof householdMembers> = {
      id: memberId,
      householdId,
      userId: this.input.userId,
      role: 'member',
      joinedAt: now,
      updatedAt: now,
    };
    await this.db.insert(householdMembers).values(localMember);
    await this.enqueuer.enqueue('household_members', memberId, 'INSERT');

    // 5. Restore the household data locally
    const restored = await this.restoreService.restoreHousehold(
      householdId,
      'member',
      this.input.userId,
    );
    if (!restored) {
      return createFailure({
        code: 'RESTORE_FAILED',
        message: 'Joined but failed to restore household data',
      });
    }

    const summary: HouseholdSummary = {
      id: restored.id,
      name: restored.name,
      paydayDay: restored.paydayDay,
      userLevel: 1,
    };

    return createSuccess(summary);
  }
```

- [ ] **Step 5: Run tests — confirm they now pass**

```bash
npx jest src/domain/households/AcceptInviteUseCase.test.ts
```

Expected: all PASS.

- [ ] **Step 6: Full suite + typecheck**

```bash
npm run typecheck && npm test
```

Expected: green.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/008_phase2_data_integrity.sql \
        src/domain/households/AcceptInviteUseCase.ts \
        src/domain/households/AcceptInviteUseCase.test.ts
git commit -m "fix(sec): invitations RLS creator-only + lookup_invite_by_code RPC

Removes the policy that allowed any authenticated user to SELECT
invitations whose code is valid and unused (enumeration vector).
Acceptors now call a SECURITY DEFINER RPC that returns exactly the
one invite matching the code — no table scan possible.
AcceptInviteUseCase updated to use the RPC; three new tests added.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 3: OpenAI rate-limit TOCTOU — atomic check_and_reserve_slip_slot RPC

**Why:** Steps 6 and 7 of `extract-slip/index.ts` currently do two separate `COUNT` queries before marking the slip as `processing`. Two concurrent requests can both pass the count checks before either increments the counter, allowing bursts past the 50/day cap. The fix: one `SECURITY DEFINER` RPC that holds a per-household advisory lock for its entire transaction, atomically checks both counts, and transitions the slip to `processing` in the same transaction.

**Files:**

- Modify: `supabase/migrations/008_phase2_data_integrity.sql` (append)
- Modify: `supabase/functions/extract-slip/index.ts`
- Modify: `supabase/functions/extract-slip/__tests__/extract-slip.test.ts`

- [ ] **Step 1: Append the RPC to migration 008**

Append to `supabase/migrations/008_phase2_data_integrity.sql`:

```sql
-- ─── Atomic rate-limit check + slip reservation ────────────────────────────
-- Holds a per-household advisory lock for the full transaction lifetime so
-- concurrent requests for the same household are serialized. The lock is
-- released automatically when the transaction ends (Supabase autocommit per RPC).
CREATE OR REPLACE FUNCTION public.check_and_reserve_slip_slot(
  p_household_id text,
  p_user_id      text,
  p_slip_id      text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff        text;
  v_household_cnt int;
  v_user_cnt      int;
BEGIN
  -- Serialize all concurrent calls for this household.
  PERFORM pg_advisory_xact_lock(hashtext(p_household_id));

  v_cutoff := (NOW() - INTERVAL '24 hours')::text;

  SELECT COUNT(*) INTO v_household_cnt
  FROM public.slip_queue
  WHERE household_id = p_household_id
    AND created_at  >= v_cutoff;

  IF v_household_cnt >= 50 THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'household_limit');
  END IF;

  SELECT COUNT(*) INTO v_user_cnt
  FROM public.slip_queue
  WHERE household_id = p_household_id
    AND created_by  = p_user_id
    AND created_at  >= v_cutoff;

  IF v_user_cnt >= 25 THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'user_limit');
  END IF;

  -- Reserve the slot: transition slip from pending → processing atomically.
  UPDATE public.slip_queue
  SET status     = 'processing',
      updated_at = NOW()::text
  WHERE id     = p_slip_id
    AND status = 'pending';

  RETURN jsonb_build_object('allowed', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_and_reserve_slip_slot(text, text, text) TO authenticated;
```

- [ ] **Step 2: Write a failing Deno test for the new flow**

Open `supabase/functions/extract-slip/__tests__/extract-slip.test.ts` and locate the `makeBaseDeps` helper. The test currently mocks `adminFrom('slip_queue')` with a `gte` chain that simulates the COUNT queries. We need to add an `rpc` mock.

Add the following test **before** the closing `Deno.test` block (or alongside existing tests):

```ts
Deno.test(
  'returns 429 household_limit when check_and_reserve_slip_slot says not allowed',
  async () => {
    const deps = makeBaseDeps({
      createAdminClient: () => ({
        from: (table: string) => {
          if (table === 'user_households')
            return makeBaseDeps().createAdminClient().from('user_households');
          if (table === 'user_consent')
            return makeBaseDeps().createAdminClient().from('user_consent');
          if (table === 'slip_queue') {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    maybeSingle: () =>
                      Promise.resolve({
                        data: {
                          id: 'slip1',
                          status: 'pending',
                          raw_response_json: null,
                          created_by: 'u1',
                          household_id: 'h1',
                        },
                        error: null,
                      }),
                  }),
                }),
              }),
              update: () => ({ eq: () => Promise.resolve({ error: null }) }),
            };
          }
          if (table === 'envelopes') return makeBaseDeps().createAdminClient().from('envelopes');
          return {};
        },
        rpc: (name: string) => {
          if (name === 'check_and_reserve_slip_slot') {
            return Promise.resolve({
              data: { allowed: false, reason: 'household_limit' },
              error: null,
            });
          }
          return Promise.resolve({ data: null, error: null });
        },
      }),
    });

    const req = makeRequest(
      { slip_id: 'slip1', household_id: 'h1', images_base64: ['abc'] },
      'Bearer tok',
    );
    const resp = await handle(req, deps);
    assertEquals(resp.status, 429);
    assertEquals(await resp.text(), 'Household rate limit');
  },
);
```

- [ ] **Step 3: Run the new Deno test to confirm it fails**

```bash
cd supabase/functions/extract-slip
deno test --allow-env --allow-net __tests__/extract-slip.test.ts 2>&1 | tail -20
```

Expected: the new test FAILS because the current code does COUNT queries rather than calling the RPC.

- [ ] **Step 4: Update `extract-slip/index.ts` — replace steps 6 + 7 with the RPC**

In `supabase/functions/extract-slip/index.ts`, replace the two COUNT blocks (steps 6 and 7) and the idempotency block (step 5) with:

```ts
// 5. Idempotency + status guard
if (slipRow.status === 'completed' && slipRow.raw_response_json) {
  return new Response(slipRow.raw_response_json, {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
if (slipRow.status === 'processing') {
  return new Response('Slip already processing', { status: 409 });
}

// 6. Atomic rate-limit check + reserve slot (replaces two separate COUNT queries).
//    pg_advisory_xact_lock inside the RPC serializes concurrent household requests,
//    eliminating the TOCTOU window in the previous SELECT-then-UPDATE pattern.
const { data: rateCheck, error: rateError } = await adminSupabase.rpc(
  'check_and_reserve_slip_slot',
  { p_household_id: household_id, p_user_id: callerId, p_slip_id: slip_id },
);
if (rateError) return new Response('Rate limit check failed', { status: 500 });

const check = rateCheck as { allowed: boolean; reason?: string };
if (!check.allowed) {
  const msg = check.reason === 'user_limit' ? 'User rate limit' : 'Household rate limit';
  return new Response(msg, { status: 429 });
}
```

Remove the old step numbers 6 and 7 comment blocks (the two `.select('*', { count: 'exact', head: true })` chains) — they are fully replaced by the block above. Renumber the remaining steps in comments (old step 8 becomes step 7, etc.).

- [ ] **Step 5: Run Deno tests — confirm they pass**

```bash
cd supabase/functions/extract-slip
deno test --allow-env --allow-net __tests__/extract-slip.test.ts 2>&1 | tail -20
```

Expected: all PASS.

- [ ] **Step 6: Run Jest suite for any cross-references**

```bash
cd ../../../..   # back to repo root
npm run typecheck && npm test
```

Expected: green.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/008_phase2_data_integrity.sql \
        supabase/functions/extract-slip/index.ts \
        supabase/functions/extract-slip/__tests__/extract-slip.test.ts
git commit -m "fix(sec): atomic rate-limit via check_and_reserve_slip_slot RPC

Replaces the two-step SELECT COUNT + UPDATE pattern in extract-slip
with a single SECURITY DEFINER RPC that holds pg_advisory_xact_lock
for the whole transaction, eliminating the TOCTOU window that allowed
concurrent requests to exceed the 50/day household cap.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 4: Rename Ramsey Score → Habit Score

**Why:** The "Ramsey Score" brand name is being replaced with "Habit Score" per the Phase 2 scope. This is a pure string rename — no logic changes.

**Files (all modify):**

- `src/domain/scoring/RamseyScoreCalculator.ts`
- `src/domain/scoring/__tests__/RamseyScoreCalculator.test.ts`
- `src/presentation/screens/dashboard/components/RamseyScoreBadge.tsx`
- `src/presentation/screens/dashboard/DashboardScreen.tsx`
- `src/presentation/screens/auth/onboarding/ScoreIntroStep.tsx`
- `src/presentation/screens/auth/onboarding/__tests__/ScoreIntroStep.test.tsx`
- `src/presentation/screens/auth/onboarding/FinishStep.tsx`

- [ ] **Step 1: Update `RamseyScoreCalculator.ts`**

In `src/domain/scoring/RamseyScoreCalculator.ts`, rename the exported symbols:

```ts
export interface HabitScoreInput {
  loggingDaysCount: number; // days with at least one transaction logged
  totalDaysInPeriod: number; // calendar days in the current budget period
  envelopesOnBudget: number; // envelopes where spentCents <= allocatedCents
  totalEnvelopes: number;
  meterReadingsLoggedThisPeriod: boolean;
  babyStepIsActive: boolean;
}

export interface HabitScoreResult {
  score: number; // 0–100
  loggingPoints: number; // 0–30
  disciplinePoints: number; // 0–30
  metersPoints: number; // 0–20
  babyStepPoints: number; // 0–20
}

export class HabitScoreCalculator {
  calculate(input: HabitScoreInput): HabitScoreResult {
    const loggingPoints =
      input.totalDaysInPeriod > 0
        ? Math.min(30, Math.round((input.loggingDaysCount / input.totalDaysInPeriod) * 30))
        : 0;

    const disciplinePoints =
      input.totalEnvelopes > 0
        ? Math.min(30, Math.round((input.envelopesOnBudget / input.totalEnvelopes) * 30))
        : 30;

    const metersPoints = input.meterReadingsLoggedThisPeriod ? 20 : 0;
    const babyStepPoints = input.babyStepIsActive ? 20 : 0;

    const score = Math.min(100, loggingPoints + disciplinePoints + metersPoints + babyStepPoints);

    return { score, loggingPoints, disciplinePoints, metersPoints, babyStepPoints };
  }
}

// Back-compat aliases so callers can be migrated incrementally.
export type RamseyScoreInput = HabitScoreInput;
export type RamseyScoreResult = HabitScoreResult;
/** @deprecated Use HabitScoreCalculator */
export const RamseyScoreCalculator = HabitScoreCalculator;
```

- [ ] **Step 2: Update `DashboardScreen.tsx` imports**

In `src/presentation/screens/dashboard/DashboardScreen.tsx`, change:

```ts
// Old
import { RamseyScoreCalculator } from '../../../domain/scoring/RamseyScoreCalculator';
import { RamseyScoreBadge } from './components/RamseyScoreBadge';
// …
const scoreCalculator = new RamseyScoreCalculator();
```

to:

```ts
import { HabitScoreCalculator } from '../../../domain/scoring/RamseyScoreCalculator';
import { RamseyScoreBadge } from './components/RamseyScoreBadge';
// …
const scoreCalculator = new HabitScoreCalculator();
```

(The badge component retains its file name but we'll update its `accessibilityLabel` in Step 5.)

- [ ] **Step 3: Update `RamseyScoreCalculator.test.ts`**

In `src/domain/scoring/__tests__/RamseyScoreCalculator.test.ts`, update the import and describe block:

```ts
import { HabitScoreCalculator } from '../RamseyScoreCalculator';

describe('HabitScoreCalculator', () => {
  const calc = new HabitScoreCalculator();
  // ... all existing test cases unchanged — only the import + describe name changes
```

- [ ] **Step 4: Run tests to confirm no regressions**

```bash
npx jest src/domain/scoring/__tests__/RamseyScoreCalculator.test.ts
```

Expected: all 5 tests PASS.

- [ ] **Step 5: Update `RamseyScoreBadge.tsx` accessibility label**

In `src/presentation/screens/dashboard/components/RamseyScoreBadge.tsx`, change line 49:

```tsx
// Old
accessibilityLabel={`Ramsey score: ${score} — ${label}`}
// New
accessibilityLabel={`Habit score: ${score} — ${label}`}
```

- [ ] **Step 6: Update `ScoreIntroStep.tsx` user-visible text**

In `src/presentation/screens/auth/onboarding/ScoreIntroStep.tsx`:

```tsx
// Line 19 — title
<Text variant="headlineMedium" style={[styles.title, { color: colors.primary }]}>
  Your Habit Score
</Text>
// Line 21 — subtitle (no change needed, already generic)

// Line 30 — card body
Your Habit Score is calculated based on three factors:{'\n\n'}
```

- [ ] **Step 7: Update `FinishStep.tsx` body copy**

In `src/presentation/screens/auth/onboarding/FinishStep.tsx`, line 39:

```tsx
// Old
Start logging transactions to grow your Ramsey Score.
// New
Start logging transactions to grow your Habit Score.
```

- [ ] **Step 8: Update the ScoreIntroStep test**

In `src/presentation/screens/auth/onboarding/__tests__/ScoreIntroStep.test.tsx`, replace any assertion that matches `"Ramsey Score"` or `"Your Ramsey Score"` with `"Habit Score"` / `"Your Habit Score"`. The exact change depends on what the test checks — open the file and update string literals accordingly.

- [ ] **Step 9: Run the full test suite**

```bash
npm run typecheck && npm test
```

Expected: green.

- [ ] **Step 10: Commit**

```bash
git add \
  src/domain/scoring/RamseyScoreCalculator.ts \
  src/domain/scoring/__tests__/RamseyScoreCalculator.test.ts \
  src/presentation/screens/dashboard/components/RamseyScoreBadge.tsx \
  src/presentation/screens/dashboard/DashboardScreen.tsx \
  src/presentation/screens/auth/onboarding/ScoreIntroStep.tsx \
  src/presentation/screens/auth/onboarding/__tests__/ScoreIntroStep.test.tsx \
  src/presentation/screens/auth/onboarding/FinishStep.tsx
git commit -m "feat: rename Ramsey Score → Habit Score

Renames all user-visible strings and exported symbols.
Back-compat type aliases retained so callers can migrate at their own pace.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Final verification

- [ ] **Run full suite one last time**

```bash
npm run typecheck && npm test && npm run lint
```

Expected: all exit 0.

- [ ] **Manual smoke check — Supabase**

In the Supabase SQL editor (on the linked project), verify:

```sql
-- Must return 0 rows when run as any non-creator user:
SELECT * FROM invitations;

-- Must return correct function signature:
\df lookup_invite_by_code
\df check_and_reserve_slip_slot
```

- [ ] **Final commit message summary**

When opening the PR, the description body should link each commit to its roadmap exit criterion:

- Migration checksum → guards against corrupted migration state on device
- Invitations RLS → `SELECT * FROM invitations` as non-creator returns 0 rows ✓
- Atomic rate limit → pg_cron cost-audit cap is enforced even under burst ✓
- Habit Score rename → branding updated throughout ✓
