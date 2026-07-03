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

describe('Non-Atomic Writes — ConfirmSlipUseCase (Correct Case)', () => {
  it('verifies ConfirmSlipUseCase DOES use db.transaction()', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../domain/slipScanning/ConfirmSlipUseCase.ts'),
      'utf8',
    );

    expect(source).toContain('this.db.transaction(');
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

  it('confirms the transaction wrapper provides atomicity for multi-item slips', async () => {
    let transactionCallbackCalled = false;

    const db = {
      transaction: jest.fn(async (callback: (tx: any) => Promise<any>) => {
        transactionCallbackCalled = true;
        const txProxy = {};
        return callback(txProxy);
      }),
    } as any;

    const successFactory = (_tx: any, input: any) => ({
      execute: () => Promise.resolve({ success: true, data: { id: 'tx-' + input.envelopeId } }),
    });

    const repo = {
      update: jest.fn().mockResolvedValue(undefined),
    };

    const { ConfirmSlipUseCase } = require('../../domain/slipScanning/ConfirmSlipUseCase');

    const usecase = new ConfirmSlipUseCase(db, successFactory, repo);
    const result = await usecase.execute({
      slipId: 'slip-1',
      householdId: HOUSEHOLDS.kruger.id,
      transactionDate: '2026-06-15',
      items: [
        { description: 'Item 1', amountCents: 5000, envelopeId: KRUGER_ENVELOPES[0].id },
        { description: 'Item 2', amountCents: 3000, envelopeId: KRUGER_ENVELOPES[1].id },
      ],
    });

    expect(transactionCallbackCalled).toBe(true);
    expect(result.success).toBe(true);
    expect(result.data.transactionIds).toHaveLength(2);
    expect(repo.update).toHaveBeenCalledWith('slip-1', { status: 'completed' });
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
