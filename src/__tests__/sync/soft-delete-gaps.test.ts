/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('expo-crypto', () => ({
  randomUUID: () => 'mock-uuid-' + Math.random().toString(36).slice(2),
}));
jest.mock('../../infrastructure/logging/Logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));
jest.mock('../../domain/babySteps/ReconcileEmergencyFundTypeUseCase', () => ({
  ReconcileEmergencyFundTypeUseCase: jest.fn().mockImplementation(() => ({
    execute: jest.fn().mockResolvedValue({ success: true, data: { flipped: 0 } }),
  })),
}));

import { SyncOrchestrator } from '../../data/sync/SyncOrchestrator';
import { KRUGER_TRANSACTIONS } from '../../__test-utils__/scenarioSeed';

function makePendingQueueChain(rows: unknown[]) {
  const limitFn = () => Promise.resolve(rows);
  const orderByFn = () => ({ limit: limitFn });
  const whereChain = { where: () => ({ orderBy: orderByFn }), orderBy: orderByFn };
  return { from: () => whereChain };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Soft-Delete Gaps — Migration 0009 Not Registered', () => {
  /**
   * GAP: Migration 0009_soft_delete_tombstones.sql EXISTS on disk and adds
   * `deleted_at` columns to all domain tables. However, it is NOT registered
   * in migrations.js, so it never runs on the device.
   */
  it('verifies that migration 0009 IS registered in migrations.js', () => {
    const fs = require('fs');
    const path = require('path');
    const migrationsSource = fs.readFileSync(
      path.resolve(__dirname, '../../data/local/migrations/migrations.js'),
      'utf8',
    );

    expect(migrationsSource).toContain('m0008');
    expect(migrationsSource).toContain('m0009');
  });

  it('verifies that 0009 SQL file adds deleted_at to all domain tables', () => {
    const fs = require('fs');
    const path = require('path');
    const sql = fs.readFileSync(
      path.resolve(__dirname, '../../data/local/migrations/0009_soft_delete_tombstones.sql'),
      'utf8',
    );

    const expectedTables = [
      'envelopes',
      'transactions',
      'debts',
      'meter_readings',
      'baby_steps',
      'households',
      'household_members',
    ];

    expectedTables.forEach((table) => {
      expect(sql).toContain(`\`${table}\` ADD \`deleted_at\``);
    });
  });
});

describe('Soft-Delete Gaps — Hard Delete on Local', () => {
  /**
   * GAP: DeleteTransactionUseCase performs a hard DELETE (db.delete()),
   * not a soft delete (UPDATE SET deleted_at = now()). The row is physically
   * removed from SQLite.
   */
  it('documents that DeleteTransactionUseCase uses hard delete', () => {
    // DeleteTransactionUseCase.execute():
    //   await this.db.delete(transactions).where(...)
    // This is a hard delete — the row ceases to exist locally.
    // Without soft-delete, there is no tombstone to propagate to other devices.

    // Verify the source code uses .delete() not .update().set({ deletedAt: ... })
    const sourceCode = require('fs').readFileSync(
      require('path').resolve(__dirname, '../../domain/transactions/DeleteTransactionUseCase.ts'),
      'utf8',
    );

    // KNOWN-GAP: SOFTDEL-001 — DeleteTransactionUseCase uses hard DELETE instead of
    // soft delete (UPDATE SET deleted_at = now()). Fixing requires: updating schema
    // entity types, adding deleted_at filters to all queries, and coordinating with
    // SyncOrchestrator and RestoreService. See also SOFTDEL-002, SOFTDEL-003, SOFTDEL-004.
    expect(sourceCode).toContain('.delete(transactions)');
    expect(sourceCode).not.toContain('deletedAt');
    expect(sourceCode).not.toContain('deleted_at');
  });
});

describe('Soft-Delete Gaps — Hard Delete on Server', () => {
  /**
   * GAP: SyncOrchestrator.processItem() for DELETE operations calls
   * supabase.from(tableName).delete().eq('id', recordId) — a hard delete
   * on the server. No tombstone row is preserved.
   */
  it('documents that SyncOrchestrator DELETE uses supabase hard delete', async () => {
    const deleteItem = {
      id: 'del-1',
      tableName: 'transactions',
      recordId: KRUGER_TRANSACTIONS[0].id,
      operation: 'DELETE',
      retryCount: 0,
      createdAt: new Date().toISOString(),
      deadLetteredAt: null,
      lastAttemptedAt: null,
    };

    const deleteMock = jest.fn().mockReturnValue({
      eq: jest.fn(() => Promise.resolve({ error: null })),
    });
    const fromMock = jest.fn().mockReturnValue({ delete: deleteMock });

    const db = {
      select: jest.fn().mockReturnValueOnce(makePendingQueueChain([deleteItem])),
      delete: () => ({ where: () => Promise.resolve() }),
    } as any;

    const supabase = { from: fromMock, rpc: jest.fn() } as any;

    const orch = new SyncOrchestrator(db, supabase);
    const result = await orch.syncPending();

    expect(result.synced).toBe(1);

    // KNOWN-GAP: SOFTDEL-002 — supabase.from(tableName).delete() performs a hard delete
    // on the server. No tombstone record is preserved. Other devices have no way to know
    // the record was deleted — they only discover it's missing on full restore.
    expect(fromMock).toHaveBeenCalledWith('transactions');
    expect(deleteMock).toHaveBeenCalled();
  });

  it('verifies the processItem DELETE path does NOT use RPC', async () => {
    const deleteItem = {
      id: 'del-rpc-check',
      tableName: 'envelopes',
      recordId: 'env-del-1',
      operation: 'DELETE',
      retryCount: 0,
      createdAt: new Date().toISOString(),
      deadLetteredAt: null,
      lastAttemptedAt: null,
    };

    const rpcMock = jest.fn();
    const deleteMock = jest.fn().mockReturnValue({
      eq: jest.fn(() => Promise.resolve({ error: null })),
    });

    const db = {
      select: jest.fn().mockReturnValueOnce(makePendingQueueChain([deleteItem])),
      delete: () => ({ where: () => Promise.resolve() }),
    } as any;

    const supabase = {
      rpc: rpcMock,
      from: () => ({ delete: deleteMock }),
    } as any;

    const orch = new SyncOrchestrator(db, supabase);
    await orch.syncPending();

    // DELETE bypasses merge RPCs entirely — goes straight to .delete()
    expect(rpcMock).not.toHaveBeenCalled();
    expect(deleteMock).toHaveBeenCalled();
  });
});

describe('Soft-Delete Gaps — Cross-Device Data Resurrection Risk', () => {
  /**
   * GAP: Without soft-delete tombstones, deleted records can resurrect:
   *
   * 1. Device A deletes transaction T1 (hard delete locally + enqueue DELETE)
   * 2. Device A syncs → server hard-deletes T1
   * 3. Device B (offline) still has T1 locally
   * 4. Device B comes online → RestoreService doesn't delete missing rows
   *    (it only UPSERTs what the server sends; it doesn't purge orphans)
   * 5. Device B's local T1 row still has isSynced=true from last restore
   *    → no pending_sync entry → T1 stays as a ghost record on Device B
   *
   * If Device B EDITS the record (changing isSynced=false), it will be
   * re-synced to the server, effectively resurrecting the deleted record.
   */
  it('documents the data resurrection risk from missing tombstones', () => {
    const tx = KRUGER_TRANSACTIONS[0];

    // Device A deletes tx → server hard-deletes tx
    // Device B still has tx locally. RestoreService does not purge orphans.

    // KNOWN-GAP: SOFTDEL-003 — Without tombstones, there is no mechanism to propagate
    // deletes across devices. Full solution requires:
    // 1. Soft-delete in DeleteTransactionUseCase (SOFTDEL-001)
    // 2. Soft-delete in SyncOrchestrator server push (SOFTDEL-002)
    // 3. Orphan purge in RestoreService (SOFTDEL-004)
    // Until all three are implemented, deleted records can resurrect on offline devices.

    // Assert current behavior: no deleted_at column in the entity type
    expect(tx).not.toHaveProperty('deletedAt');
    expect(tx).not.toHaveProperty('deleted_at');
  });

  it('documents that RestoreService does not purge orphan rows', () => {
    // RestoreService.restoreTable() uses INSERT ... ON CONFLICT DO UPDATE.
    // It only processes rows that EXIST on the server.
    // Rows that were deleted from the server are simply not touched locally.
    // There is no SELECT to find local rows missing from the remote set.

    const sourceCode = require('fs').readFileSync(
      require('path').resolve(__dirname, '../../data/sync/RestoreService.ts'),
      'utf8',
    );

    // No purge/delete logic in restoreTable
    // KNOWN-GAP: SOFTDEL-004 — restoreTable should delete local rows whose IDs are not
    // in the remote set (orphan purge). Currently it only UPSERTs rows the server sends;
    // rows deleted from the server remain as ghost records locally.
    expect(sourceCode).not.toContain('.delete(');
    expect(sourceCode).toContain('onConflictDoUpdate');
  });
});
