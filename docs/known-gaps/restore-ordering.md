# Known Gap: Restore Overwrites Local Dirty Data

**Status:** RESOLVED (2026-09-20)  
**Discovered:** 2026-06-19  
**Test file:** `src/__tests__/sync/restore-ordering.test.ts` (rewritten to pin the fix)  
**Affected code:** `src/data/sync/RestoreService.ts`

## Resolution

RESTORE-001, -002 and -003 are all closed, by three changes to `RestoreService` that together remove both the opportunity and the mechanism for the overwrite. First, a snapshot restore now runs **only while the household has no `sync_cursor` row**: it is a one-time bootstrap for a device that has never synced this household (reinstall, invite join, household switch), and once that cursor exists the oplog puller owns local state — so the recurring "every app open re-applies a stale server snapshot" behaviour that RESTORE-001 described no longer happens at all. Second, even during that one bootstrap, restore reads the local oplog outbox first and **skips any row that still has an unpushed, non-dead-lettered op**, so a queued offline edit is never overwritten and its op is left untouched in the outbox to push normally — which is precisely what RESTORE-002 asked for, without deleting queue entries. Third, the snapshot upserts and the pull cursor (the household's max server oplog `seq`, read _before_ the tables are fetched) commit in **one local transaction**, and every network fetch happens before that transaction opens, so a failed restore writes nothing at all and a cursor can never point past data that did not land. RESTORE-003's contradictory `isSynced=false`-with-remote-data state is moot: `pending_sync` and the per-row `isSynced` flag were both retired (migration 0014) in favour of the oplog outbox, which is now the single source of "this row owes the server something".

## Gap Inventory (all resolved)

| ID          | Severity | Description                                                                   | Status                                                                                             |
| ----------- | -------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| RESTORE-001 | HIGH     | `restoreTable()` overwrites all data columns for locally dirty rows           | RESOLVED — rows with unpushed oplog ops are skipped; restore runs once per household               |
| RESTORE-002 | MEDIUM   | `pending_sync` entries not cleared after restore overwrites their target rows | RESOLVED — the row is not overwritten, so its queued op stays valid; `pending_sync` itself is gone |
| RESTORE-003 | HIGH     | Contradictory state: row has `isSynced=false` but contains remote data        | RESOLVED — dirty rows keep local data; sync state lives in the oplog outbox, not a row flag        |

## Historical record

Everything below describes the ORIGINAL behaviour and the fixes considered at the time. It is kept for context; none of it describes current code.

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

## Workarounds (no longer needed)

- Sync immediately after every edit (reduces window where restore can overwrite)
- Don't close the app while offline edits are pending (unreliable)
- The `isSynced=false` flag is preserved, so theoretically a post-restore reconciliation step could detect and fix these rows (not implemented)

## Related

- LWW data loss gaps: `docs/known-gaps/lww-data-loss.md`
- RestoreService implementation: `src/data/sync/RestoreService.ts`
- `SyncOrchestrator` no longer exists — it was replaced by `src/data/sync/SyncEngine.ts` (push/pull over the oplog) and `src/data/sync/SyncScheduler.ts` (triggers)
