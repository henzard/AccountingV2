/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('expo-crypto', () => ({
  randomUUID: () => 'mock-uuid-' + Math.random().toString(36).slice(2),
}));
jest.mock('../../infrastructure/logging/Logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

import { buildEnvelope, buildTransaction } from '../../__test-utils__/factories';
import { KRUGER_ENVELOPES, HOUSEHOLDS } from '../../__test-utils__/scenarioSeed';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Non-Atomic Writes — CreateTransactionUseCase', () => {
  /**
   * GAP: CreateTransactionUseCase performs two separate SQL statements:
   *   1. db.insert(transactions).values(row)           ← Statement 1
   *   2. db.update(envelopes).set({ spentCents: ... }) ← Statement 2
   *
   * These are NOT wrapped in db.transaction(). If the app crashes between
   * Statement 1 and Statement 2, the transaction row exists but spentCents
   * is not incremented — causing a local drift.
   */
  it('verifies insert and spentCents update are SEPARATE statements (not in db.transaction)', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../domain/transactions/CreateTransactionUseCase.ts'),
      'utf8',
    );

    // Confirm the two operations exist
    expect(source).toContain('.insert(transactions)');
    expect(source).toContain('.update(envelopes)');
    expect(source).toContain('spentCents');

    // TODO: FIX — These two operations are NOT in a db.transaction() block.
    // If the app crashes after insert but before the spentCents update,
    // the transaction exists but the envelope balance is wrong (local drift).
    expect(source).not.toContain('db.transaction(');
    expect(source).not.toContain('this.db.transaction(');
  });

  it('demonstrates the partial failure scenario with mocked DB', async () => {
    const groceries = KRUGER_ENVELOPES[0];
    const initialSpentCents = 100000;

    let insertCalled = false;
    let updateCalled = false;

    const db = {
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            limit: jest.fn(() =>
              Promise.resolve([
                {
                  ...groceries,
                  spentCents: initialSpentCents,
                  envelopeType: 'spending',
                },
              ]),
            ),
          })),
        })),
      })),
      insert: jest.fn(() => ({
        values: jest.fn(() => {
          insertCalled = true;
          return Promise.resolve();
        }),
      })),
      update: jest.fn(() => ({
        set: jest.fn(() => ({
          where: jest.fn(() => {
            updateCalled = true;
            // Simulate crash: update FAILS after insert succeeded
            throw new Error('SIMULATED_CRASH: app killed between insert and update');
          }),
        })),
      })),
    } as any;

    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const enqueuer = { enqueue: jest.fn().mockResolvedValue(undefined) } as any;

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
      enqueuer,
    );

    await expect(usecase.execute()).rejects.toThrow('SIMULATED_CRASH');

    // Insert succeeded but update failed — partial write
    // TODO: FIX — Without db.transaction(), the transaction row exists
    // but spentCents was never incremented. Local data is now inconsistent.
    expect(insertCalled).toBe(true);
    expect(updateCalled).toBe(true);
  });
});

describe('Non-Atomic Writes — DeleteTransactionUseCase', () => {
  /**
   * GAP: DeleteTransactionUseCase performs two separate SQL statements:
   *   1. db.delete(transactions).where(...)             ← Statement 1
   *   2. db.update(envelopes).set({ spentCents: ... })  ← Statement 2
   *
   * Same problem as CreateTransactionUseCase — not wrapped in db.transaction().
   */
  it('verifies delete and spentCents decrement are SEPARATE statements', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../domain/transactions/DeleteTransactionUseCase.ts'),
      'utf8',
    );

    expect(source).toContain('.delete(transactions)');
    expect(source).toContain('.update(envelopes)');
    expect(source).toContain('spentCents');

    // TODO: FIX — Delete and spentCents decrement are not atomic.
    // If the app crashes after delete but before the spentCents decrement,
    // the transaction is gone but the envelope still shows the old (higher) spentCents.
    expect(source).not.toContain('db.transaction(');
    expect(source).not.toContain('this.db.transaction(');
  });

  it('demonstrates the partial failure scenario on delete', async () => {
    const tx = buildTransaction({
      id: 'tx-del-atomic',
      householdId: HOUSEHOLDS.kruger.id,
      envelopeId: KRUGER_ENVELOPES[0].id,
      amountCents: 10000,
    });

    let deleteCalled = false;
    let updateCalled = false;

    const db = {
      delete: jest.fn(() => ({
        where: jest.fn(() => {
          deleteCalled = true;
          return Promise.resolve();
        }),
      })),
      update: jest.fn(() => ({
        set: jest.fn(() => ({
          where: jest.fn(() => {
            updateCalled = true;
            throw new Error('SIMULATED_CRASH: app killed between delete and update');
          }),
        })),
      })),
    } as any;

    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const enqueuer = { enqueue: jest.fn().mockResolvedValue(undefined) } as any;

    const {
      DeleteTransactionUseCase,
    } = require('../../domain/transactions/DeleteTransactionUseCase');

    const usecase = new DeleteTransactionUseCase(db, audit, tx, enqueuer);

    await expect(usecase.execute()).rejects.toThrow('SIMULATED_CRASH');

    // Delete succeeded but spentCents decrement failed — partial write
    // TODO: FIX — Transaction row is gone but spentCents still reflects it.
    // The envelope shows more spent than actually exists in transactions.
    expect(deleteCalled).toBe(true);
    expect(updateCalled).toBe(true);
  });
});

describe('Non-Atomic Writes — ConfirmSlipUseCase (Correct Case)', () => {
  /**
   * CORRECT: ConfirmSlipUseCase wraps all operations in db.transaction().
   * If any sub-operation fails, the entire batch rolls back.
   * This is the pattern the other use cases should follow.
   */
  it('verifies ConfirmSlipUseCase DOES use db.transaction()', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../domain/slipScanning/ConfirmSlipUseCase.ts'),
      'utf8',
    );

    // ConfirmSlipUseCase correctly uses db.transaction()
    expect(source).toContain('this.db.transaction(');
  });

  it('verifies ConfirmSlipUseCase marks slip as failed on rollback', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../domain/slipScanning/ConfirmSlipUseCase.ts'),
      'utf8',
    );

    // On failure, the slip status is set to 'failed' so user can retry
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

describe('Non-Atomic Writes — Gap Documentation', () => {
  it('documents the local drift risk from partial CreateTransaction failure', () => {
    // Scenario:
    //   1. User creates transaction for R50 on Groceries envelope
    //   2. INSERT into transactions succeeds (row exists)
    //   3. App crashes before UPDATE envelopes SET spentCents = spentCents + 5000
    //   4. Result: transaction exists but spentCents is too low
    //   5. User sees: Groceries has more remaining budget than it should
    //   6. On next sync: server gets the transaction but spentCents on the envelope
    //      is out of sync with the sum of transaction amounts

    // TODO: FIX — Wrap insert + spentCents update in db.transaction() like ConfirmSlipUseCase does.
    // This ensures either both succeed or both roll back.
    const groceries = buildEnvelope({
      householdId: HOUSEHOLDS.kruger.id,
      spentCents: 100000,
      allocatedCents: 800000,
    });

    const afterPartialFailure = { ...groceries }; // spentCents NOT incremented
    expect(afterPartialFailure.spentCents).toBe(100000);
    // Should be 105000 if the transaction for R50 had completed atomically
    expect(afterPartialFailure.spentCents).not.toBe(105000);
  });

  it('documents the local drift risk from partial DeleteTransaction failure', () => {
    // Scenario:
    //   1. User deletes R100 transaction from Groceries envelope
    //   2. DELETE from transactions succeeds (row gone)
    //   3. App crashes before UPDATE envelopes SET spentCents = spentCents - 10000
    //   4. Result: transaction gone but spentCents is too high
    //   5. User sees: Groceries has less remaining budget than it should

    // TODO: FIX — Wrap delete + spentCents decrement in db.transaction()
    const groceries = buildEnvelope({
      householdId: HOUSEHOLDS.kruger.id,
      spentCents: 200000,
      allocatedCents: 800000,
    });

    const afterPartialFailure = { ...groceries }; // spentCents NOT decremented
    expect(afterPartialFailure.spentCents).toBe(200000);
    // Should be 190000 if the R100 delete had completed atomically
    expect(afterPartialFailure.spentCents).not.toBe(190000);
  });
});
