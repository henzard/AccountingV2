# Known Gap: LWW (Last-Write-Wins) Data Loss

**Status:** Open  
**Discovered:** 2026-06-19  
**Test file:** `src/__tests__/sync/concurrent-user-sync.test.ts`  
**Affected RPCs:** `merge_envelope`, `merge_debt`, all `merge_*` RPCs

## Summary

All Supabase merge RPCs use row-level Last-Write-Wins (LWW) based on `updated_at` timestamps. When two devices edit the same record concurrently, the device with the older timestamp silently loses its changes. There is no conflict detection, no notification, and no field-level merge.

## Gap Inventory

| ID      | Severity | Description                                                                       | Affected Data            |
| ------- | -------- | --------------------------------------------------------------------------------- | ------------------------ |
| LWW-001 | HIGH     | `merge_envelope` drops losing device's spentCents increment                       | Envelope spending totals |
| LWW-002 | HIGH     | Same as LWW-001 — Kruger household real-world scenario                            | Envelope spending totals |
| LWW-003 | HIGH     | `outstandingBalanceCents` uses absolute LWW overwrite instead of atomic decrement | Debt balances            |
| LWW-004 | MEDIUM   | No field-level merge — entire row from loser is dropped                           | All envelope fields      |
| LWW-005 | MEDIUM   | merge RPCs return success even when LWW silently rejects the row                  | All tables — UX gap      |

## Impact

- **Multi-device households** (Henzard + Alicia both tracking spending): spending increments silently lost
- **Concurrent debt payments**: one user's payment disappears from outstanding balance
- **Offline edits to different fields**: rename on Device A + allocation change on Device B → one edit lost entirely
- **No user notification**: both devices believe their edit saved successfully

## Root Cause

The `merge_*` RPCs on Supabase use this pattern:

```sql
INSERT INTO table (...) VALUES (...)
ON CONFLICT (id) DO UPDATE SET ...
WHERE excluded.updated_at > table.updated_at;
```

This is pure row-level LWW. No delta tracking, no vector clocks, no per-field timestamps.

## Proposed Fixes (by priority)

### 1. Counter fields → delta-based SQL operations (LWW-001, LWW-002, LWW-003)

Change `merge_envelope` to accept **deltas** rather than absolute values for counter fields:

```sql
-- Instead of: SET spent_cents = excluded.spent_cents
-- Use:        SET spent_cents = spent_cents + p_delta_spent_cents
```

Similarly, `merge_debt` should compute `outstanding_balance_cents` server-side:

```sql
SET outstanding_balance_cents = original_balance_cents - total_paid_cents
```

**Effort:** Medium — requires RPC signature changes + client-side delta tracking.

### 2. Field-level merge with per-column timestamps (LWW-004)

Track `updated_at` per column (or per column group). On conflict, merge at field level:

```sql
SET name = CASE WHEN excluded.name_updated_at > table.name_updated_at
           THEN excluded.name ELSE table.name END,
    allocated_cents = CASE WHEN excluded.alloc_updated_at > table.alloc_updated_at
                      THEN excluded.allocated_cents ELSE table.allocated_cents END
```

**Effort:** High — schema migration, client tracking, RPC rewrite.

### 3. Conflict detection response (LWW-005)

Modify merge RPCs to return a `conflict: boolean` flag when LWW rejects the incoming row. Client can then surface a toast or conflict resolution UI.

```sql
RETURNING (xmax = 0) AS was_inserted,
          (updated_at != excluded.updated_at) AS had_conflict
```

**Effort:** Low-Medium — RPC return type change + client UI for conflict notification.

## Workarounds (Current)

- Single-device usage avoids all LWW issues
- `totalPaidCents` in debt merge already uses SQL `+` (atomic increment) — this pattern should be extended
- High sync frequency reduces the conflict window (but doesn't eliminate it)

## Related

- DLQ notification gap (see `docs/known-gaps/restore-ordering.md` for restore issues)
- Sync architecture in `src/data/sync/SyncOrchestrator.ts`
