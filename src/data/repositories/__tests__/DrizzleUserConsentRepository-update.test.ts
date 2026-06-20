jest.mock('../PendingSyncEnqueuerAdapter', () => ({
  PendingSyncEnqueuerAdapter: jest.fn().mockImplementation(() => ({
    enqueue: jest.fn().mockResolvedValue(undefined),
  })),
}));

import { DrizzleUserConsentRepository } from '../DrizzleUserConsentRepository';

describe('DrizzleUserConsentRepository', () => {
  describe('setSlipScanConsent — UPDATE path', () => {
    it('when row already exists -> updates consent timestamp + enqueues UPDATE', async () => {
      const existingRow = {
        userId: 'u1',
        slipScanConsentAt: '2026-01-01T00:00:00Z',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      };

      const onConflictDoUpdate = jest.fn().mockResolvedValue(undefined);
      const enqueuer = { enqueue: jest.fn().mockResolvedValue(undefined) };

      // First call: select (get existing row) — returns existing
      // Second call: insert with onConflictDoUpdate
      const selectChain = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([existingRow]),
      };

      const insertChain = {
        values: jest.fn().mockReturnValue({ onConflictDoUpdate }),
      };

      const db = {
        select: jest.fn().mockReturnValue(selectChain),
        insert: jest.fn().mockReturnValue(insertChain),
      } as any;

      const repo = new DrizzleUserConsentRepository(db, enqueuer);
      await repo.setSlipScanConsent('u1', '2026-06-19T12:00:00Z');

      // Should have called insert (upsert pattern)
      expect(db.insert).toHaveBeenCalled();
      expect(onConflictDoUpdate).toHaveBeenCalled();

      // The insert values should include the new consent timestamp
      const insertValues = insertChain.values.mock.calls[0][0];
      expect(insertValues.slipScanConsentAt).toBe('2026-06-19T12:00:00Z');
      expect(insertValues.isSynced).toBe(false);

      // Enqueue should be called with 'UPDATE' (not 'INSERT') since row exists
      expect(enqueuer.enqueue).toHaveBeenCalledWith('user_consent', 'u1', 'UPDATE');
    });
  });

  describe('setSlipScanConsent — INSERT path', () => {
    it('when no row exists -> enqueues INSERT', async () => {
      const onConflictDoUpdate = jest.fn().mockResolvedValue(undefined);
      const enqueuer = { enqueue: jest.fn().mockResolvedValue(undefined) };

      const selectChain = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([]), // no existing row
      };

      const insertChain = {
        values: jest.fn().mockReturnValue({ onConflictDoUpdate }),
      };

      const db = {
        select: jest.fn().mockReturnValue(selectChain),
        insert: jest.fn().mockReturnValue(insertChain),
      } as any;

      const repo = new DrizzleUserConsentRepository(db, enqueuer);
      await repo.setSlipScanConsent('u1', '2026-06-19T12:00:00Z');

      expect(enqueuer.enqueue).toHaveBeenCalledWith('user_consent', 'u1', 'INSERT');
    });
  });

  describe('get', () => {
    it('returns row when found', async () => {
      const row = {
        userId: 'u1',
        slipScanConsentAt: '2026-01-01T00:00:00Z',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      };
      const selectChain = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([row]),
      };
      const db = { select: jest.fn().mockReturnValue(selectChain) } as any;

      const repo = new DrizzleUserConsentRepository(db);
      const result = await repo.get('u1');

      expect(result).toEqual(row);
    });

    it('returns null when not found', async () => {
      const selectChain = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([]),
      };
      const db = { select: jest.fn().mockReturnValue(selectChain) } as any;

      const repo = new DrizzleUserConsentRepository(db);
      const result = await repo.get('missing');

      expect(result).toBeNull();
    });
  });
});
