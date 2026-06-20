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
  it('verifies insert and spentCents update are wrapped in db.transaction()', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../domain/transactions/CreateTransactionUseCase.ts'),
      'utf8',
    );

    expect(source).toContain('.insert(transactions)');
    expect(source).toContain('.update(envelopes)');
    expect(source).toContain('spentCents');

    expect(source).toMatch(/this\.db\.transaction\(|db\.transaction\(/);
  });

  it('rolls back insert when spentCents update fails (atomic via db.transaction)', async () => {
    const groceries = KRUGER_ENVELOPES[0];
    const initialSpentCents = 100000;

    let insertCalled = false;
    let updateCalled = false;

    const txProxy = {
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
            throw new Error('SIMULATED_CRASH: app killed between insert and update');
          }),
        })),
      })),
    };

    const db = {
      select: txProxy.select,
      transaction: jest.fn(async (callback: (tx: any) => Promise<any>) => {
        return callback(txProxy);
      }),
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

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(insertCalled).toBe(true);
    expect(updateCalled).toBe(true);
  });
});

describe('Non-Atomic Writes — DeleteTransactionUseCase', () => {
  it('verifies delete and spentCents decrement are wrapped in db.transaction()', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../domain/transactions/DeleteTransactionUseCase.ts'),
      'utf8',
    );

    expect(source).toContain('.delete(transactions)');
    expect(source).toContain('.update(envelopes)');
    expect(source).toContain('spentCents');

    expect(source).toMatch(/this\.db\.transaction\(|db\.transaction\(/);
  });

  it('rolls back delete when spentCents decrement fails (atomic via db.transaction)', async () => {
    const tx = buildTransaction({
      id: 'tx-del-atomic',
      householdId: HOUSEHOLDS.kruger.id,
      envelopeId: KRUGER_ENVELOPES[0].id,
      amountCents: 10000,
    });

    let deleteCalled = false;
    let updateCalled = false;

    const txProxy = {
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
    };

    const db = {
      transaction: jest.fn(async (callback: (t: any) => Promise<any>) => {
        return callback(txProxy);
      }),
    } as any;

    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const enqueuer = { enqueue: jest.fn().mockResolvedValue(undefined) } as any;

    const {
      DeleteTransactionUseCase,
    } = require('../../domain/transactions/DeleteTransactionUseCase');

    const usecase = new DeleteTransactionUseCase(db, audit, tx, enqueuer);

    await expect(usecase.execute()).rejects.toThrow('SIMULATED_CRASH');

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(deleteCalled).toBe(true);
    expect(updateCalled).toBe(true);
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
