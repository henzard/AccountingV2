jest.mock('../PendingSyncEnqueuerAdapter', () => ({
  PendingSyncEnqueuerAdapter: jest.fn().mockImplementation(() => ({
    enqueue: jest.fn().mockResolvedValue(undefined),
  })),
}));

import { DrizzleSlipQueueRepository } from '../DrizzleSlipQueueRepository';

const noopEnqueuer = { enqueue: jest.fn().mockResolvedValue(undefined) };

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 's1',
    householdId: 'h1',
    createdBy: 'u1',
    imageUris: '["img1.jpg","img2.jpg"]',
    status: 'processing',
    errorMessage: null,
    merchant: null,
    slipDate: null,
    totalCents: null,
    rawResponseJson: null,
    imagesDeletedAt: null,
    openaiCostCents: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('DrizzleSlipQueueRepository', () => {
  describe('get', () => {
    it('row found -> domain object with parsed imageUris', async () => {
      const selectChain = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([makeRow()]),
      };
      const db = { select: jest.fn().mockReturnValue(selectChain) } as any;

      const repo = new DrizzleSlipQueueRepository(db, noopEnqueuer);
      const result = await repo.get('s1');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('s1');
      expect(result!.imageUris).toEqual(['img1.jpg', 'img2.jpg']);
      expect(result!.status).toBe('processing');
    });

    it('not found -> null', async () => {
      const selectChain = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([]),
      };
      const db = { select: jest.fn().mockReturnValue(selectChain) } as any;

      const repo = new DrizzleSlipQueueRepository(db, noopEnqueuer);
      const result = await repo.get('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('update', () => {
    function makeUpdateDb() {
      const setMock = jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue(undefined),
      });
      const updateMock = jest.fn().mockReturnValue({ set: setMock });
      return {
        db: { update: updateMock } as any,
        updateMock,
        setMock,
        enqueuer: { enqueue: jest.fn().mockResolvedValue(undefined) },
      };
    }

    const patchFields: Array<{ field: string; value: unknown; expected?: unknown }> = [
      { field: 'status', value: 'completed' },
      { field: 'errorMessage', value: 'parse error' },
      { field: 'merchant', value: 'Pick n Pay' },
      { field: 'slipDate', value: '2026-06-01' },
      { field: 'totalCents', value: 9999 },
      { field: 'rawResponseJson', value: '{"items":[]}' },
      { field: 'imagesDeletedAt', value: '2026-06-19T00:00:00Z' },
      { field: 'openaiCostCents', value: 42 },
      { field: 'imageUris', value: ['a.jpg', 'b.jpg'], expected: '["a.jpg","b.jpg"]' },
    ];

    it.each(patchFields)(
      'patch field "$field" included in SET clause',
      async ({ field, value, expected }) => {
        const { db, setMock, enqueuer } = makeUpdateDb();
        const repo = new DrizzleSlipQueueRepository(db, enqueuer);

        await repo.update('s1', { [field]: value } as any);

        const setArg = setMock.mock.calls[0][0];
        const check = expected ?? value;
        expect(setArg[field]).toBe(check);
        expect(setArg.isSynced).toBe(false);
        expect(setArg.updatedAt).toBeDefined();
        expect(enqueuer.enqueue).toHaveBeenCalledWith('slip_queue', 's1', 'UPDATE');
      },
    );
  });

  describe('listByHousehold', () => {
    it('returns filtered list', async () => {
      const rows = [makeRow({ id: 's1' }), makeRow({ id: 's2' })];
      const selectChain = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        offset: jest.fn().mockResolvedValue(rows),
      };
      const db = { select: jest.fn().mockReturnValue(selectChain) } as any;

      const repo = new DrizzleSlipQueueRepository(db, noopEnqueuer);
      const result = await repo.listByHousehold('h1', 10, 0);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('s1');
      expect(result[1].id).toBe('s2');
      expect(result[0].imageUris).toEqual(['img1.jpg', 'img2.jpg']);
    });
  });

  describe('listExpired', () => {
    it('filters by age + imagesDeletedAt IS NULL', async () => {
      const rows = [makeRow({ id: 's-old', imagesDeletedAt: null })];
      const selectChain = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue(rows),
      };
      const db = { select: jest.fn().mockReturnValue(selectChain) } as any;

      const repo = new DrizzleSlipQueueRepository(db, noopEnqueuer);
      const result = await repo.listExpired('2026-06-01T00:00:00Z');

      expect(result).toHaveLength(1);
      expect(result[0].imagesDeletedAt).toBeNull();
    });
  });

  describe('listProcessingOlderThan', () => {
    it('filters by status + timestamp', async () => {
      const rows = [makeRow({ status: 'processing' })];
      const selectChain = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue(rows),
      };
      const db = { select: jest.fn().mockReturnValue(selectChain) } as any;

      const repo = new DrizzleSlipQueueRepository(db, noopEnqueuer);
      const result = await repo.listProcessingOlderThan('2026-06-01T00:00:00Z');

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('processing');
    });
  });

  describe('rowToDomain', () => {
    it('malformed JSON imageUris -> error', async () => {
      const selectChain = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([makeRow({ imageUris: 'not-json{' })]),
      };
      const db = { select: jest.fn().mockReturnValue(selectChain) } as any;

      const repo = new DrizzleSlipQueueRepository(db, noopEnqueuer);
      await expect(repo.get('s1')).rejects.toThrow();
    });
  });
});
