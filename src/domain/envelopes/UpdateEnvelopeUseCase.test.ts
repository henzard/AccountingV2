jest.mock('expo-crypto', () => ({ randomUUID: () => 'test-uuid' }));

import { UpdateEnvelopeUseCase } from './UpdateEnvelopeUseCase';
import { ArchiveEnvelopeUseCase } from './ArchiveEnvelopeUseCase';
import type { EnvelopeEntity } from './EnvelopeEntity';
import type { SyncedRepo } from '../../data/uow/createSyncedRepo';

const mockDb = {} as any;
const makeAudit = () => ({ log: jest.fn().mockResolvedValue(undefined) });

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

const existing: EnvelopeEntity = {
  id: 'env-1',
  householdId: 'hh-1',
  name: 'Groceries',
  allocatedCents: 300000,
  spentCents: 50000,
  envelopeType: 'spending',
  isSavingsLocked: false,
  isArchived: false,
  periodStart: '2026-03-25',
  targetAmountCents: null,
  targetDate: null,
  createdAt: '2026-03-25T00:00:00.000Z',
  updatedAt: '2026-03-25T00:00:00.000Z',
};

describe('UpdateEnvelopeUseCase', () => {
  it('updates name and amount and returns updated envelope', async () => {
    const repo = makeFakeRepo();
    const audit = makeAudit();
    const uc = new UpdateEnvelopeUseCase(
      mockDb,
      audit as any,
      existing,
      { name: 'Food', allocatedCents: 400000 },
      { repo },
    );
    const result = await uc.execute();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('Food');
      expect(result.data.allocatedCents).toBe(400000);
      expect(result.data.spentCents).toBe(50000); // unchanged
      expect(result.data.id).toBe('env-1'); // unchanged
    }
    expect(repo.update).toHaveBeenCalledTimes(1);
    expect(audit.log).toHaveBeenCalled();
  });

  it('writes via the synced repo with snake_case fields, scoped to id + householdId, no envelope increment', async () => {
    const repo = makeFakeRepo();
    const uc = new UpdateEnvelopeUseCase(
      mockDb,
      makeAudit() as any,
      existing,
      { name: 'Food', allocatedCents: 400000 },
      { repo },
    );
    await uc.execute();
    expect(repo.increment).not.toHaveBeenCalled();
    expect(repo.insert).not.toHaveBeenCalled();
    const [id, householdId, fields] = repo.update.mock.calls[0];
    expect(id).toBe('env-1');
    expect(householdId).toBe('hh-1');
    expect(fields).toEqual(
      expect.objectContaining({
        name: 'Food',
        allocated_cents: 400000,
      }),
    );
    expect(JSON.stringify(fields)).not.toMatch(/spent_cents|spentCents|is_synced|isSynced/);
  });

  it('trims whitespace from name', async () => {
    const repo = makeFakeRepo();
    const uc = new UpdateEnvelopeUseCase(
      mockDb,
      makeAudit() as any,
      existing,
      { name: '  Food  ', allocatedCents: 400000 },
      { repo },
    );
    const result = await uc.execute();
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.name).toBe('Food');
  });

  it('rejects empty name', async () => {
    const repo = makeFakeRepo();
    const uc = new UpdateEnvelopeUseCase(
      mockDb,
      makeAudit() as any,
      existing,
      { name: '', allocatedCents: 400000 },
      { repo },
    );
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_NAME');
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('rejects zero amount', async () => {
    const repo = makeFakeRepo();
    const uc = new UpdateEnvelopeUseCase(
      mockDb,
      makeAudit() as any,
      existing,
      { name: 'Food', allocatedCents: 0 },
      { repo },
    );
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_AMOUNT');
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('logs audit event with previous and new values', async () => {
    const repo = makeFakeRepo();
    const audit = makeAudit();
    const uc = new UpdateEnvelopeUseCase(
      mockDb,
      audit as any,
      existing,
      { name: 'Food', allocatedCents: 400000 },
      { repo },
    );
    await uc.execute();
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'update',
        entityId: 'env-1',
      }),
    );
  });

  it('returns ENVELOPE_NOT_FOUND when the repo update matches 0 rows', async () => {
    const repo = makeFakeRepo();
    repo.update.mockImplementation(() => {
      throw new Error('createSyncedRepo: no row in "envelopes" matched id=env-1 household_id=hh-1');
    });
    const audit = makeAudit();
    const uc = new UpdateEnvelopeUseCase(
      mockDb,
      audit as any,
      existing,
      { name: 'Food', allocatedCents: 400000 },
      { repo },
    );
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('ENVELOPE_NOT_FOUND');
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('rethrows (does NOT report ENVELOPE_NOT_FOUND) when repo.update fails for a non-not-found reason', async () => {
    const repo = makeFakeRepo();
    repo.update.mockImplementation(() => {
      throw new Error('SQLITE_BUSY: database is locked');
    });
    const audit = makeAudit();
    const uc = new UpdateEnvelopeUseCase(
      mockDb,
      audit as any,
      existing,
      { name: 'Food', allocatedCents: 400000 },
      { repo },
    );

    await expect(uc.execute()).rejects.toThrow('SQLITE_BUSY: database is locked');
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('uses a default synced repo (createSyncedRepo over db) when none is injected', async () => {
    const dbWithRun = {
      transaction: jest.fn((fn: any) => fn({ run: jest.fn().mockReturnValue({ changes: 1 }) })),
    } as any;
    const uc = new UpdateEnvelopeUseCase(dbWithRun, makeAudit() as any, existing, {
      name: 'Food',
      allocatedCents: 400000,
    });
    const result = await uc.execute();
    expect(result.success).toBe(true);
  });

  it('applies explicit targetAmountCents and targetDate overrides', async () => {
    const repo = makeFakeRepo();
    const uc = new UpdateEnvelopeUseCase(
      mockDb,
      makeAudit() as any,
      existing,
      { name: 'Food', allocatedCents: 400000, targetAmountCents: 50000, targetDate: '2026-12-01' },
      { repo },
    );
    const result = await uc.execute();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.targetAmountCents).toBe(50000);
      expect(result.data.targetDate).toBe('2026-12-01');
    }
  });
});

describe('UpdateEnvelopeUseCase — recomputes is_savings_locked on envelope_type change (L3)', () => {
  // L3 (exhaustive audit, 2026-07-05): the use case used to change
  // envelope_type without ever recomputing/writing is_savings_locked, so an
  // envelope EDITED into 'savings'/'emergency_fund' persisted
  // is_savings_locked=0 (diverging from an envelope CREATED-AS
  // savings/emergency_fund via CreateEnvelopeUseCase, which persists 1) —
  // and the reverse edit left a stale 1 on a non-locked type.

  // UX-10 (deep-review): a type change that crosses scope (period-scoped
  // <-> persistent, per getEnvelopeScope) is now rejected outright — see the
  // 'rejects a type change across scope' describe block below. 'spending' is
  // period-scoped while 'savings'/'emergency_fund' are persistent, so these
  // three cases (previously exercising the recompute logic across a
  // spending<->savings/emergency_fund edit) are no longer reachable; the
  // recompute behavior itself is still covered below using same-scope pairs
  // (sinking_fund <-> emergency_fund, both persistent).

  it('sinking_fund -> emergency_fund (same scope): sets isSavingsLocked true and writes is_savings_locked=1', async () => {
    const sinkingFundEnvelope: EnvelopeEntity = {
      ...existing,
      envelopeType: 'sinking_fund',
      isSavingsLocked: false,
    };
    const repo = makeFakeRepo();
    const uc = new UpdateEnvelopeUseCase(
      mockDb,
      makeAudit() as any,
      sinkingFundEnvelope,
      { name: 'Emergency Buffer', allocatedCents: 400000, envelopeType: 'emergency_fund' },
      { repo },
    );
    const result = await uc.execute();
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.isSavingsLocked).toBe(true);

    const [, , fields] = repo.update.mock.calls[0];
    expect(fields.is_savings_locked).toBe(1);
  });

  it('emergency_fund -> sinking_fund (same scope): sets isSavingsLocked false and writes is_savings_locked=0 (no stale lock)', async () => {
    const emergencyFundEnvelope: EnvelopeEntity = {
      ...existing,
      envelopeType: 'emergency_fund',
      isSavingsLocked: true,
    };
    const repo = makeFakeRepo();
    const uc = new UpdateEnvelopeUseCase(
      mockDb,
      makeAudit() as any,
      emergencyFundEnvelope,
      { name: 'Holiday fund', allocatedCents: 400000, envelopeType: 'sinking_fund' },
      { repo },
    );
    const result = await uc.execute();
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.isSavingsLocked).toBe(false);

    const [, , fields] = repo.update.mock.calls[0];
    expect(fields.is_savings_locked).toBe(0);
  });

  it('leaving envelopeType unspecified preserves the current type and its locked flag', async () => {
    const savingsEnvelope: EnvelopeEntity = {
      ...existing,
      envelopeType: 'savings',
      isSavingsLocked: true,
    };
    const repo = makeFakeRepo();
    const uc = new UpdateEnvelopeUseCase(
      mockDb,
      makeAudit() as any,
      savingsEnvelope,
      { name: 'Groceries', allocatedCents: 400000 }, // envelopeType omitted
      { repo },
    );
    const result = await uc.execute();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.envelopeType).toBe('savings');
      expect(result.data.isSavingsLocked).toBe(true);
    }
    const [, , fields] = repo.update.mock.calls[0];
    expect(fields.is_savings_locked).toBe(1);
  });
});

describe('UpdateEnvelopeUseCase — income envelope guard', () => {
  const incomeEnvelope: EnvelopeEntity = {
    ...existing,
    id: 'income-1',
    envelopeType: 'income',
    spentCents: 0,
  };

  it('rejects spentCents != 0 on income envelope with INVALID_INCOME_MUTATION', async () => {
    const repo = makeFakeRepo();
    const uc = new UpdateEnvelopeUseCase(
      mockDb,
      makeAudit() as any,
      incomeEnvelope,
      { name: 'Salary', allocatedCents: 100000, spentCents: 500 },
      { repo },
    );
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('INVALID_INCOME_MUTATION');
    }
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('accepts update with spentCents = 0 on income envelope', async () => {
    const repo = makeFakeRepo();
    const uc = new UpdateEnvelopeUseCase(
      mockDb,
      makeAudit() as any,
      incomeEnvelope,
      { name: 'Salary', allocatedCents: 100000, spentCents: 0 },
      { repo },
    );
    const result = await uc.execute();
    expect(result.success).toBe(true);
  });

  it('accepts update without spentCents field on income envelope (no-op default)', async () => {
    const repo = makeFakeRepo();
    const uc = new UpdateEnvelopeUseCase(
      mockDb,
      makeAudit() as any,
      incomeEnvelope,
      { name: 'Salary', allocatedCents: 100000 },
      { repo },
    );
    const result = await uc.execute();
    expect(result.success).toBe(true);
  });
});

describe('UpdateEnvelopeUseCase — rejects a type change across scope (UX-10)', () => {
  // getEnvelopeScope: 'spending'/'income'/'utility' are period-scoped;
  // 'sinking_fund'/'emergency_fund'/'savings'/'baby_step' are persistent.
  // AddEditEnvelopeScreen's SegmentedButtons only listed 4 of the 7 types
  // and was enabled in edit mode, so editing a persistent-type envelope
  // showed nothing selected and one tap silently converted it — this guard
  // is the actual enforcement backstop (the screen now also locks the type
  // control in edit mode).

  it('rejects spending -> savings (period -> persistent) with INVALID_TYPE_CHANGE', async () => {
    const repo = makeFakeRepo();
    const uc = new UpdateEnvelopeUseCase(
      mockDb,
      makeAudit() as any,
      existing, // envelopeType: 'spending'
      { name: 'Emergency Buffer', allocatedCents: 400000, envelopeType: 'savings' },
      { repo },
    );
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_TYPE_CHANGE');
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('rejects savings -> spending (persistent -> period) with INVALID_TYPE_CHANGE', async () => {
    const savingsEnvelope: EnvelopeEntity = { ...existing, envelopeType: 'savings' };
    const repo = makeFakeRepo();
    const uc = new UpdateEnvelopeUseCase(
      mockDb,
      makeAudit() as any,
      savingsEnvelope,
      { name: 'Groceries', allocatedCents: 400000, envelopeType: 'spending' },
      { repo },
    );
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_TYPE_CHANGE');
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('allows a same-scope type change (sinking_fund -> savings, both persistent)', async () => {
    const sinkingFundEnvelope: EnvelopeEntity = { ...existing, envelopeType: 'sinking_fund' };
    const repo = makeFakeRepo();
    const uc = new UpdateEnvelopeUseCase(
      mockDb,
      makeAudit() as any,
      sinkingFundEnvelope,
      { name: 'Savings', allocatedCents: 400000, envelopeType: 'savings' },
      { repo },
    );
    const result = await uc.execute();
    expect(result.success).toBe(true);
  });

  it('rejects converting an envelope with recorded spending to income with INVALID_TYPE_CHANGE', async () => {
    // existing.spentCents === 50000, envelopeType: 'spending' (both period-
    // scoped as 'income', so the scope guard above does not fire here).
    const repo = makeFakeRepo();
    const uc = new UpdateEnvelopeUseCase(
      mockDb,
      makeAudit() as any,
      existing,
      { name: 'Salary', allocatedCents: 400000, envelopeType: 'income' },
      { repo },
    );
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_TYPE_CHANGE');
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('allows converting a zero-spend envelope to income', async () => {
    const unspentEnvelope: EnvelopeEntity = { ...existing, spentCents: 0 };
    const repo = makeFakeRepo();
    const uc = new UpdateEnvelopeUseCase(
      mockDb,
      makeAudit() as any,
      unspentEnvelope,
      { name: 'Salary', allocatedCents: 400000, envelopeType: 'income' },
      { repo },
    );
    const result = await uc.execute();
    expect(result.success).toBe(true);
  });
});

describe('UpdateEnvelopeUseCase — targetDate validation (DOM-9)', () => {
  it('rejects a malformed targetDate with INVALID_TARGET_DATE', async () => {
    const repo = makeFakeRepo();
    const uc = new UpdateEnvelopeUseCase(
      mockDb,
      makeAudit() as any,
      existing,
      { name: 'Holiday', allocatedCents: 400000, targetDate: 'not-a-date' },
      { repo },
    );
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_TARGET_DATE');
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('rejects an impossible calendar date with INVALID_TARGET_DATE', async () => {
    const repo = makeFakeRepo();
    const uc = new UpdateEnvelopeUseCase(
      mockDb,
      makeAudit() as any,
      existing,
      { name: 'Holiday', allocatedCents: 400000, targetDate: '2027-13-40' },
      { repo },
    );
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_TARGET_DATE');
  });

  it('accepts a valid targetDate', async () => {
    const repo = makeFakeRepo();
    const uc = new UpdateEnvelopeUseCase(
      mockDb,
      makeAudit() as any,
      existing,
      { name: 'Holiday', allocatedCents: 400000, targetDate: '2027-12-01' },
      { repo },
    );
    const result = await uc.execute();
    expect(result.success).toBe(true);
  });

  it('accepts a null targetDate (clearing it)', async () => {
    const repo = makeFakeRepo();
    const uc = new UpdateEnvelopeUseCase(
      mockDb,
      makeAudit() as any,
      existing,
      { name: 'Holiday', allocatedCents: 400000, targetDate: null },
      { repo },
    );
    const result = await uc.execute();
    expect(result.success).toBe(true);
  });
});

describe('UpdateEnvelopeUseCase — best-effort audit (DOM-10)', () => {
  it('still returns success when audit.log rejects after the write has committed', async () => {
    const repo = makeFakeRepo();
    const audit = { log: jest.fn().mockRejectedValue(new Error('audit db down')) };
    const uc = new UpdateEnvelopeUseCase(
      mockDb,
      audit as any,
      existing,
      { name: 'Food', allocatedCents: 400000 },
      { repo },
    );
    const result = await uc.execute();
    expect(result.success).toBe(true);
    expect(repo.update).toHaveBeenCalledTimes(1);
  });
});

describe('ArchiveEnvelopeUseCase', () => {
  it('sets isArchived to true and calls repo.update', async () => {
    const repo = makeFakeRepo();
    const audit = makeAudit();
    const uc = new ArchiveEnvelopeUseCase(mockDb, audit as any, existing, { repo });
    const result = await uc.execute();
    expect(result.success).toBe(true);
    expect(repo.update).toHaveBeenCalledTimes(1);
    expect(repo.update).toHaveBeenCalledWith(
      'env-1',
      'hh-1',
      expect.objectContaining({ is_archived: 1 }),
      expect.any(Object),
    );
  });

  it('logs audit event with action=archive', async () => {
    const repo = makeFakeRepo();
    const audit = makeAudit();
    const uc = new ArchiveEnvelopeUseCase(mockDb, audit as any, existing, { repo });
    await uc.execute();
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'archive',
        entityId: 'env-1',
      }),
    );
  });
});
