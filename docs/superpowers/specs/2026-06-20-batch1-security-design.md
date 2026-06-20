# Batch 1 Security Remediation — Design Spec

**Date:** 2026-06-20  
**Issues:** SEC-RT-001, SEC-RT-002, SEC-RT-003, SEC-RT-004, SEC-RT-005 (#88–#92)  
**Branch target:** `fix/batch1-security-membership-dml`  
**Status:** Approved scope (user chose full five in batch 1)

## Problem

Any authenticated user can join arbitrary households and read/write financial data because:

1. `household_members` INSERT only checks `user_id = auth.uid()` (no invite).
2. `user_households` allows INSERT for any `household_id` when `user_id = auth.uid()`.
3. Direct PostgREST INSERT/UPDATE/DELETE on data tables bypasses merge RPC LWW guards.
4. Migration 018 regressed completed-slip overwrite protection from 007.
5. `inv_insert` allows creating invites for households the caller does not belong to.

## Recommended approach (Approach A)

**Single migration `019_batch1_security_hardening.sql` + client RPC routing.**

| Issue          | Fix                                                                                                                                                                                                                                                   |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SEC-RT-001/002 | New `join_household_via_invite(p_code text)` SECURITY DEFINER RPC: validate invite, insert `household_members`, trigger fills `user_households`, call `claim_invite`. REVOKE INSERT on `household_members` and `user_households` for `authenticated`. |
| SEC-RT-005     | Replace `inv_insert` WITH CHECK: caller is owner of `household_id` via existing membership.                                                                                                                                                           |
| SEC-RT-004     | Restore 007 `merge_slip_queue` completed-row guard in ON CONFLICT WHERE clause.                                                                                                                                                                       |
| SEC-RT-003     | REVOKE INSERT, UPDATE, DELETE on all sync data tables from `authenticated`. Add `delete_sync_row(p_table, p_id)` SECURITY DEFINER with household membership check. Route `SyncOrchestrator` DELETE through it.                                        |

### Alternatives considered

- **B — RLS-only tightening:** Cheaper but `hm_insert` cannot express invite validation in pure RLS; rejected.
- **C — Defer SEC-RT-003:** User rejected; full DML revoke ships in batch 1.

## Client changes

- `AcceptInviteUseCase`: replace direct `from('household_members').insert` with `rpc('join_household_via_invite', { invite_code })`.
- `SyncOrchestrator.processItem`: DELETE → `rpc('delete_sync_row', { p_table, p_id })`.
- `CreateHouseholdUseCase` / owner bootstrap: continue via `merge_household` + `merge_household_member` sync queue (no direct INSERT).

## Data flow (invite join)

```
AcceptInviteUseCase
  → rpc join_household_via_invite(code)
      → lookup valid invite (internal)
      → INSERT household_members (DEFINER)
      → TRIGGER → user_households
      → claim_invite
  → local SQLite insert + restore
```

## Error handling

- RPC failures map to existing `Result` failure codes (`INVITE_NOT_FOUND`, `JOIN_FAILED`, etc.).
- Sync DELETE: if `delete_sync_row` returns 0 rows → throw (fail loud, not silent).

## Testing

- Extend `security-audit-findings.test.ts` with migration 019 marker assertions.
- New `join-household-via-invite.test.ts` (Jest): documents RLS + RPC contract.
- SQL migration test: `019-batch1-security.test.ts` parses migration for REVOKE, invite RPC, slip guard.
- Full suite must stay green (2013+ tests).

## Out of scope (later batches)

- SEC-RT-006 invite brute-force rate limit
- Tombstone soft-delete pipeline (SOFTDEL-\*)
- Pull service (QR-SYNC-001)

## Success criteria

- [ ] Unauthenticated join path blocked in migration + tests
- [ ] Direct PostgREST upsert on `envelopes` fails for authenticated role (integration test or SQL doc test)
- [ ] Completed slip rows cannot be overwritten by stale client
- [ ] Only household owners can create invites
- [ ] All tests green; queue.md issues marked fixed when merged
