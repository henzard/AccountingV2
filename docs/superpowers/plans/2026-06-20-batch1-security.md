# Batch 1 Security (SEC-RT-001–005) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close five Critical/High security findings by hardening household membership, invite creation, slip merge guards, and revoking direct PostgREST DML.

**Architecture:** One Supabase migration (`019_batch1_security_hardening.sql`) adds SECURITY DEFINER RPCs and REVOKEs; mobile client routes invite-join and sync DELETE through those RPCs only.

**Tech Stack:** Supabase Postgres RLS, React Native/Expo, Drizzle SQLite, Jest

## Global Constraints

- Do not skip pre-commit hooks; TypeScript + ESLint must pass.
- Every security fix ships with a regression test referencing the finding ID.
- Migration numbering: next file is `019_batch1_security_hardening.sql`.
- Preserve existing `AcceptInviteUseCase` Result codes for UX compatibility.

---

### Task 1: Migration — invite join RPC + membership REVOKE

**Files:**

- Create: `supabase/migrations/019_batch1_security_hardening.sql`
- Test: `src/__tests__/security/019-batch1-security.test.ts`

**Interfaces:**

- Produces: `public.join_household_via_invite(p_invite_code text) RETURNS jsonb` with `{ member_id, household_id }`

- [ ] **Step 1: Write failing test**

```typescript
// src/__tests__/security/019-batch1-security.test.ts
import fs from 'fs';
import path from 'path';

const sql = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/019_batch1_security_hardening.sql'),
  'utf8',
);

describe('019 batch1 security migration', () => {
  it('SEC-RT-001/002: defines join_household_via_invite and revokes household_members insert', () => {
    expect(sql).toMatch(/join_household_via_invite/i);
    expect(sql).toMatch(/REVOKE INSERT.*household_members/i);
    expect(sql).toMatch(/REVOKE INSERT.*user_households/i);
  });

  it('SEC-RT-004: restores completed slip overwrite guard', () => {
    expect(sql).toMatch(/slip_queue\.status\s*!=\s*'completed'/i);
  });

  it('SEC-RT-005: inv_insert requires household owner membership', () => {
    expect(sql).toMatch(/inv_insert/i);
    expect(sql).toMatch(/role\s*=\s*'owner'/i);
  });

  it('SEC-RT-003: revokes DML on sync tables and adds delete_sync_row', () => {
    expect(sql).toMatch(/delete_sync_row/i);
    expect(sql).toMatch(/REVOKE INSERT, UPDATE, DELETE ON public\.envelopes/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/__tests__/security/019-batch1-security.test.ts -v`  
Expected: FAIL (migration file missing)

- [ ] **Step 3: Write migration** (core sections)

```sql
-- join_household_via_invite: validate invite, insert member, claim invite
-- DROP hm_insert; REVOKE INSERT ON household_members, user_households
-- Fix inv_insert WITH CHECK owner membership
-- merge_slip_queue: add completed guard from 007
-- REVOKE INSERT,UPDATE,DELETE on envelopes, transactions, debts, ...
-- delete_sync_row(p_table text, p_id text) SECURITY DEFINER
```

- [ ] **Step 4: Run test — PASS**

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/019_batch1_security_hardening.sql src/__tests__/security/019-batch1-security.test.ts
git commit -m "fix(security): migration 019 — membership invite RPC and DML revoke (SEC-RT-001–005)"
```

---

### Task 2: AcceptInviteUseCase → RPC

**Files:**

- Modify: `src/domain/households/AcceptInviteUseCase.ts:64-87`
- Modify: `src/domain/households/AcceptInviteUseCase.test.ts`

**Interfaces:**

- Consumes: `join_household_via_invite` returning `{ member_id, household_id }`

- [ ] **Step 1: Update test to expect rpc join call instead of insert**

- [ ] **Step 2: Replace direct insert + separate claim with single RPC**

```typescript
const { data, error } = await this.supabase.rpc('join_household_via_invite', {
  invite_code: this.input.code.toUpperCase(),
});
if (error || !data) {
  /* map failures */
}
const memberId = data.member_id as string;
const householdId = data.household_id as string;
```

- [ ] **Step 3: Run AcceptInviteUseCase tests — PASS**

- [ ] **Step 4: Commit**

---

### Task 3: SyncOrchestrator DELETE → delete_sync_row RPC

**Files:**

- Modify: `src/data/sync/SyncOrchestrator.ts:185-188`
- Modify: `src/data/sync/SyncOrchestrator.test.ts`

- [ ] **Step 1: Failing test — DELETE calls rpc delete_sync_row**

- [ ] **Step 2: Implement**

```typescript
if (item.operation === 'DELETE') {
  const { error } = await this.supabase.rpc('delete_sync_row', {
    p_table: item.tableName,
    p_id: item.recordId,
  });
  if (error) throw new Error(error.message);
  return;
}
```

- [ ] **Step 3: Full sync tests PASS**

- [ ] **Step 4: Commit**

---

### Task 4: QA gate + PR

**Files:**

- Modify: `docs/queue.md` (mark SEC-RT-001–005 fixed when verified)
- Modify: `docs/superpowers/batch-tracker.md`

- [ ] **Step 1:** `npm test` — 2013+ green
- [ ] **Step 2:** `npx tsc --noEmit` + lint
- [ ] **Step 3:** Push branch, `gh pr create` linking #88–#92
- [ ] **Step 4:** Close issues on merge

---

## Self-review

- Spec coverage: all five SEC-RT items mapped to Tasks 1–3 ✓
- No placeholders ✓
- `delete_sync_row` table allowlist must match `TABLE_MAP` keys ✓
