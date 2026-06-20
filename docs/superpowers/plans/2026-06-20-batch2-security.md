# Batch 2 Security (SEC-RT-006–009, 011) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close five security issues (invite lookup hardening, notify abuse, user_level escalation, JWT validation, slip image cap); escalate SEC-RT-010 to HUMAN.

**Architecture:** Migration `020_batch2_security_hardening.sql` for SQL fixes; Deno edge function validation; App.tsx + SupabaseAuthService for auth.

**Tech Stack:** Supabase Postgres, Deno edge functions, React Native/Expo, Jest

## Global Constraints

- Migration file: `020_batch2_security_hardening.sql`
- Every fix references finding ID in tests
- SEC-RT-010: add `HUMAN` comment on GitHub #97 only — no partial SQLCipher stub
- Full test suite must pass before PR

---

### Task 1: Migration 020 — invite lookup + merge_household user_level

**Files:**

- Create: `supabase/migrations/020_batch2_security_hardening.sql`
- Create: `src/__tests__/security/020-batch2-security.test.ts`

- [ ] Write failing tests for migration markers
- [ ] Implement migration
- [ ] Run tests, commit

### Task 2: notify-event hardening (SEC-RT-007)

**Files:**

- Modify: `supabase/functions/notify-event/index.ts`
- Modify: `src/__tests__/security/edge-function-auth.test.ts`

- [ ] Payload validation + length caps
- [ ] Rate limit via `notify_send_log` table (migration 020)
- [ ] Tests, commit

### Task 3: Auth session validation (SEC-RT-009)

**Files:**

- Modify: `src/data/remote/SupabaseAuthService.ts`
- Modify: `App.tsx`
- Modify: `src/data/remote/SupabaseAuthService.test.ts`

- [ ] Add `validateSession()` using `getUser()`
- [ ] Cold start uses validate before initSession
- [ ] Tests, commit

### Task 4: extract-slip image cap (SEC-RT-011)

**Files:**

- Modify: `supabase/functions/extract-slip/index.ts`
- Modify: `src/__tests__/api/extract-slip-gaps.test.ts`

- [ ] Reject images_base64 length ∉ [1,5]
- [ ] Test, commit

### Task 5: PR + issue hygiene

- [ ] Update `docs/superpowers/batch-tracker.md`
- [ ] Open PR, close #93–#96, #98 on merge; label #97 HUMAN
- [ ] `npm test` green
