import { DrizzleSlipQueueRepository } from '../DrizzleSlipQueueRepository';
import type { SyncedRepo } from '../../uow/createSyncedRepo';

function makeFakeRepo(): SyncedRepo & {
  insert: jest.Mock;
  update: jest.Mock;
  softDelete: jest.Mock;
  increment: jest.Mock;
} {
  return {
    insert: jest.fn(),
    update: jest.fn(),
    softDelete: jest.fn(),
    increment: jest.fn(),
  };
}

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

      const repo = new DrizzleSlipQueueRepository(db);
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

      const repo = new DrizzleSlipQueueRepository(db);
      const result = await repo.get('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('update', () => {
    function makeUpdateDb() {
      const selectChain = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([makeRow()]),
      };
      return {
        db: { select: jest.fn().mockReturnValue(selectChain) } as any,
        repo: makeFakeRepo(),
      };
    }

    const patchFields: Array<{
      field: string;
      value: unknown;
      column: string;
      expected?: unknown;
    }> = [
      { field: 'status', value: 'completed', column: 'status' },
      { field: 'errorMessage', value: 'parse error', column: 'error_message' },
      { field: 'merchant', value: 'Pick n Pay', column: 'merchant' },
      { field: 'slipDate', value: '2026-06-01', column: 'slip_date' },
      { field: 'totalCents', value: 9999, column: 'total_cents' },
      { field: 'rawResponseJson', value: '{"items":[]}', column: 'raw_response_json' },
      { field: 'imagesDeletedAt', value: '2026-06-19T00:00:00Z', column: 'images_deleted_at' },
      { field: 'openaiCostCents', value: 42, column: 'openai_cost_cents' },
      {
        field: 'imageUris',
        value: ['a.jpg', 'b.jpg'],
        column: 'image_uris',
        expected: '["a.jpg","b.jpg"]',
      },
    ];

    it.each(patchFields)(
      'patch field "$field" included in the synced-repo update payload',
      async ({ field, value, column, expected }) => {
        const { db, repo } = makeUpdateDb();
        const slipRepo = new DrizzleSlipQueueRepository(db, { repo });

        await slipRepo.update('s1', { [field]: value } as any);

        expect(repo.update).toHaveBeenCalledTimes(1);
        const [id, householdId, setArg] = repo.update.mock.calls[0];
        expect(id).toBe('s1');
        expect(householdId).toBe('h1');
        const check = expected ?? value;
        expect(setArg[column]).toBe(check);
        expect(setArg.updated_at).toBeDefined();
      },
    );

    it('no-ops when the row does not exist (no repo.update call)', async () => {
      const selectChain = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([]),
      };
      const db = { select: jest.fn().mockReturnValue(selectChain) } as any;
      const repo = makeFakeRepo();
      const slipRepo = new DrizzleSlipQueueRepository(db, { repo });

      await slipRepo.update('missing', { status: 'completed' });

      expect(repo.update).not.toHaveBeenCalled();
    });
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

      const repo = new DrizzleSlipQueueRepository(db);
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

      const repo = new DrizzleSlipQueueRepository(db);
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

      const repo = new DrizzleSlipQueueRepository(db);
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

      const repo = new DrizzleSlipQueueRepository(db);
      await expect(repo.get('s1')).rejects.toThrow();
    });
  });
});
