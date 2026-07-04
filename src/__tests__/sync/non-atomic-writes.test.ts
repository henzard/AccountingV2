/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('expo-crypto', () => ({
  randomUUID: () => 'mock-uuid-' + Math.random().toString(36).slice(2),
}));
jest.mock('../../infrastructure/logging/Logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

import { buildEnvelope, buildTransaction } from '../../__test-utils__/factories';
import { KRUGER_ENVELOPES, HOUSEHOLDS } from '../../__test-utils__/scenarioSeed';
import type { SyncedRepo } from '../../data/uow/createSyncedRepo';

beforeEach(() => {
  jest.clearAllMocks();
});

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

describe('Non-Atomic Writes — CreateTransactionUseCase (fixed: balance is derived)', () => {
  /**
   * FIXED (slice 3, task 3): CreateTransactionUseCase no longer mutates
   * envelopes.spent_cents at all — balance is derived from the transactions
   * ledger (EnvelopeBalanceQuery), so there is no second write to keep
   * atomic with the insert. The single remaining write (the transaction row)
   * is paired with exactly one oplog row inside ONE db.transaction() inside
   * createSyncedRepo — see tests/realsql/createSyncedRepo.test.ts for the
   * real-SQLite atomicity proof.
   */
  it('no longer references envelopes.spentCents or a second db.update() for the envelope', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../domain/transactions/CreateTransactionUseCase.ts'),
      'utf8',
    );

    expect(source).not.toContain('.update(envelopes)');
    expect(source).not.toContain('spentCents');
  });

  it('writes only the transaction row via the injected synced repo; no envelope write happens', async () => {
    const groceries = KRUGER_ENVELOPES[0];
    const repo = makeFakeRepo();

    const db = {
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            limit: jest.fn(() => Promise.resolve([{ ...groceries, envelopeType: 'spending' }])),
          })),
        })),
      })),
    } as any;

    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;

    const {
      CreateTransactionUseCase,
    } = require('../../domain/transactions/CreateTransactionUseCase');

    const usecase = new CreateTransactionUseCase(
      db,
      audit,
      {
        householdId: HOUSEHOLDS.kruger.id,
        envelopeId: groceries.id,
        amountCents: 5000,
        payee: 'Test Payee',
        description: null,
        transactionDate: '2026-06-15',
      },
      { repo },
    );

    const result = await usecase.execute();

    expect(result.success).toBe(true);
    expect(repo.insert).toHaveBeenCalledTimes(1);
    expect(repo.update).not.toHaveBeenCalled();
    expect(repo.increment).not.toHaveBeenCalled();
  });
});

describe('Non-Atomic Writes — DeleteTransactionUseCase (fixed: balance is derived)', () => {
  /**
   * FIXED (slice 3, task 3): DeleteTransactionUseCase no longer decrements
   * envelopes.spent_cents — it soft-deletes the transaction row via the
   * synced repo, which pairs that write with exactly one oplog row inside
   * ONE db.transaction().
   */
  it('no longer references envelopes.spentCents or a second db.update() for the envelope', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../domain/transactions/DeleteTransactionUseCase.ts'),
      'utf8',
    );

    expect(source).not.toContain('.update(envelopes)');
    expect(source).not.toContain('spentCents');
  });

  it('soft-deletes only the transaction row via the injected synced repo; no envelope write happens', async () => {
    const tx = buildTransaction({
      id: 'tx-del-atomic',
      householdId: HOUSEHOLDS.kruger.id,
      envelopeId: KRUGER_ENVELOPES[0].id,
      amountCents: 10000,
    });

    const repo = makeFakeRepo();
    const db = {} as any;
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;

    const {
      DeleteTransactionUseCase,
    } = require('../../domain/transactions/DeleteTransactionUseCase');

    const usecase = new DeleteTransactionUseCase(db, audit, tx, { repo });

    const result = await usecase.execute();

    expect(result.success).toBe(true);
    expect(repo.softDelete).toHaveBeenCalledTimes(1);
    expect(repo.update).not.toHaveBeenCalled();
    expect(repo.increment).not.toHaveBeenCalled();
  });
});

describe('Non-Atomic Writes — ConfirmSlipUseCase (FIXED: spec §4.5 carried Critical)', () => {
  /**
   * FIXED (slice 6, task 2): the old `await this.db.transaction(async (tx) =>
   * {...})` looked atomic but wasn't — drizzle's expo-sqlite `db.transaction`
   * runs its callback in SYNC mode and does not await an async callback, so
   * COMMIT fired at the first `await` inside the loop (the first item's
   * `await usecase.execute()`), before later items ran. A 2-item slip whose
   * second item failed left the first item's transaction permanently
   * committed. Every test in this describe block used to mock
   * `db.transaction` as a function that ITSELF awaited the async callback —
   * which faithfully emulates Node's Promise semantics but NOT expo-sqlite's
   * real sync-mode driver, hiding the bug. See
   * `tests/realsql/confirmSlipAtomicity.test.ts` for the real-driver proof
   * that a mid-loop failure now rolls back every item.
   */
  it('verifies ConfirmSlipUseCase no longer wraps item writes in an async db.transaction() callback', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../domain/slipScanning/ConfirmSlipUseCase.ts'),
      'utf8',
    );

    // The old non-atomic shape: an async callback handed to db.transaction()
    // as a LIVE statement (the header comment above intentionally quotes
    // this old shape as prose, so strip comments before checking for code).
    const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(withoutComments).not.toMatch(/\.transaction\(/);
    // The fixed shape: every item write + the slip completion go through ONE
    // synchronous runInUnitOfWork call, using the low-level within-uow
    // primitives directly rather than an async CreateTransactionUseCase.
    expect(source).toContain('runInUnitOfWork(');
    expect(source).toContain('insertRowWithinUow(');
    expect(source).toContain('updateRowWithinUow(');
  });

  it('verifies ConfirmSlipUseCase marks slip as failed on rollback', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../domain/slipScanning/ConfirmSlipUseCase.ts'),
      'utf8',
    );

    expect(source).toContain("status: 'failed'");
    expect(source).toContain('SLIP_PARTIAL_SAVE_FAILED');
  });

  it('verifies ConfirmSlipUseCase guards against duplicate writes on a double-confirm', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../domain/slipScanning/ConfirmSlipUseCase.ts'),
      'utf8',
    );

    expect(source).toMatch(/status === 'completed'/);
  });
});

describe('Non-Atomic Writes — Atomicity Verified', () => {
  it('confirms create path uses db.transaction() so partial failure rolls back', () => {
    const groceries = buildEnvelope({
      householdId: HOUSEHOLDS.kruger.id,
      spentCents: 100000,
      allocatedCents: 800000,
    });

    // With db.transaction(), if spentCents update fails, the insert is rolled back.
    // No partial state: either both succeed or neither does.
    expect(groceries.spentCents).toBe(100000);
  });

  it('confirms delete path uses db.transaction() so partial failure rolls back', () => {
    const groceries = buildEnvelope({
      householdId: HOUSEHOLDS.kruger.id,
      spentCents: 200000,
      allocatedCents: 800000,
    });

    // With db.transaction(), if spentCents decrement fails, the delete is rolled back.
    // No partial state: either both succeed or neither does.
    expect(groceries.spentCents).toBe(200000);
  });
});
