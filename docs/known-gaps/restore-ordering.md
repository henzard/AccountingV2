# Known Gap: Restore Overwrites Local Dirty Data

**Status:** Open  
**Discovered:** 2026-06-19  
**Test file:** `src/__tests__/sync/restore-ordering.test.ts`  
**Affected code:** `src/data/sync/RestoreService.ts` → `restoreTable()`

## Summary

When the app opens online after offline use, `RestoreService.restore()` runs BEFORE `SyncOrchestrator.syncPending()`. The restore uses `onConflictDoUpdate` with all non-id columns (except `isSynced`), overwriting local dirty data with stale remote values. Offline edits are silently lost.

## Gap Inventory

| ID          | Severity | Description                                                                   | Impact                                                                     |
| ----------- | -------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| RESTORE-001 | HIGH     | `restoreTable()` overwrites all data columns for locally dirty rows           | Offline edits silently replaced with stale remote data                     |
| RESTORE-002 | MEDIUM   | `pending_sync` entries not cleared after restore overwrites their target rows | Stale data pushed back to server on next sync; wasted bandwidth            |
| RESTORE-003 | HIGH     | Contradictory state: row has `isSynced=false` but contains remote data        | Sync pushes stale remote values back to server as if they were local edits |

## Sequence of Failure

```
1. User edits envelope offline → isSynced=false, pending_sync entry created
2. App reconnects → RestoreService.restore() runs first
3. restoreTable() fetches remote data (stale — doesn't have offline edit)
4. onConflictDoUpdate overwrites name, allocatedCents, spentCents with remote values
5. isSynced stays false (excluded from conflict set)
6. SyncOrchestrator.syncPending() runs next
7. Reads local row (now contains stale remote data)
8. Pushes stale data to server via merge RPC
9. User's offline edit is permanently lost with no notification
```

## Root Cause

`RestoreService.restoreTable()` (line ~177) builds its conflict-update column set as:

```typescript
const columns = Object.keys(getTableColumns(localTable)).filter(
  (col) => col !== 'id' && col !== 'isSynced',
);
```

This excludes only `id` and `isSynced` from the overwrite set. All data columns are overwritten unconditionally.

## Proposed Fixes (by priority)

### 1. Skip conflict-update for rows with isSynced=false (RESTORE-001, RESTORE-003)

The most targeted fix. Before `onConflictDoUpdate`, check if the local row has `isSynced=false`. If so, use `onConflictDoNothing` for that row:

```typescript
// In restoreTable, after grouping rows:
const dirtyIds = await db
  .select({ id: table.id })
  .from(table)
  .where(and(inArray(table.id, incomingIds), eq(table.isSynced, false)));

const dirtyIdSet = new Set(dirtyIds.map((r) => r.id));
const cleanRows = remoteRows.filter((r) => !dirtyIdSet.has(r.id));
const dirtyRows = remoteRows.filter((r) => dirtyIdSet.has(r.id));

// Clean rows: normal onConflictDoUpdate
// Dirty rows: onConflictDoNothing (preserve local edit)
```

**Effort:** Medium — requires splitting the upsert batch + an extra SELECT.

### 2. Clear pending_sync for overwritten rows (RESTORE-002)

If fix #1 is not implemented (i.e., we accept that restore overwrites data), at minimum clear the corresponding `pending_sync` entries to avoid pushing stale data back:

```typescript
await db
  .delete(pendingSync)
  .where(and(eq(pendingSync.tableName, tableName), inArray(pendingSync.recordId, restoredIds)));
```

**Effort:** Low — simple DELETE after restore completes per table.

### 3. updatedAt comparison in conflict clause (RESTORE-003)

Add a WHERE clause to onConflictDoUpdate that only overwrites when remote is newer:

```typescript
onConflictDoUpdate({
  target: [table.id],
  set: conflictColumns,
  where: sql`excluded.updated_at > ${table.updatedAt}`,
});
```

**Effort:** Low-Medium — may require Drizzle ORM support for conditional conflict updates.

## Workarounds (Current)

- Sync immediately after every edit (reduces window where restore can overwrite)
- Don't close the app while offline edits are pending (unreliable)
- The `isSynced=false` flag is preserved, so theoretically a post-restore reconciliation step could detect and fix these rows (not implemented)

## Related

- LWW data loss gaps: `docs/known-gaps/lww-data-loss.md`
- RestoreService implementation: `src/data/sync/RestoreService.ts`
- SyncOrchestrator: `src/data/sync/SyncOrchestrator.ts`
