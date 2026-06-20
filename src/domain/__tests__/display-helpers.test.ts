import { getDebtTypeLabel, getPayoffProgressPercent } from '../debtSnowball/DebtEntity';
import type { DebtEntity } from '../debtSnowball/DebtEntity';
import {
  getMeterTypeLabel,
  getMeterUnitLabel,
  getMeterIcon,
  getReadingDisplayDate,
} from '../meterReadings/MeterReadingEntity';
import type { MeterReadingEntity } from '../meterReadings/MeterReadingEntity';
import { getPercentRemaining } from '../envelopes/EnvelopeEntity';
import type { EnvelopeEntity } from '../envelopes/EnvelopeEntity';
import {
  getTransactionDisplayDate,
  formatTransactionAmount,
} from '../transactions/TransactionEntity';
import type { TransactionEntity } from '../transactions/TransactionEntity';
import { groupBusinessExpenses } from '../transactions/BusinessExpenseReport';
import { LogMeterReadingUseCase } from '../meterReadings/LogMeterReadingUseCase';
import { RecordSlipConsentUseCase } from '../slipScanning/RecordSlipConsentUseCase';

jest.mock('expo-crypto', () => ({
  randomUUID: () => 'uuid-display-test',
}));

// ---------------------------------------------------------------------------
// DebtEntity helpers
// ---------------------------------------------------------------------------

describe('getDebtTypeLabel', () => {
  it('maps all debt types to readable labels', () => {
    expect(getDebtTypeLabel('credit_card')).toBe('Credit Card');
    expect(getDebtTypeLabel('personal_loan')).toBe('Personal Loan');
    expect(getDebtTypeLabel('store_account')).toBe('Store Account');
    expect(getDebtTypeLabel('vehicle_finance')).toBe('Vehicle Finance');
    expect(getDebtTypeLabel('bond')).toBe('Home Bond');
  });
});

describe('getPayoffProgressPercent', () => {
  const baseDebt: DebtEntity = {
    id: 'd1',
    householdId: 'hh-1',
    creditorName: 'Bank',
    debtType: 'credit_card',
    outstandingBalanceCents: 50000,
    initialBalanceCents: 100000,
    interestRatePercent: 20,
    minimumPaymentCents: 2500,
    sortOrder: 0,
    isPaidOff: false,
    totalPaidCents: 50000,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-04-01T00:00:00Z',
    isSynced: false,
  };

  it('returns correct percentage based on totalPaid/initial', () => {
    expect(getPayoffProgressPercent(baseDebt)).toBe(50);
  });

  it('returns 0 when initialBalanceCents is 0', () => {
    expect(getPayoffProgressPercent({ ...baseDebt, initialBalanceCents: 0 })).toBe(0);
  });

  it('returns 0 when nothing paid', () => {
    expect(getPayoffProgressPercent({ ...baseDebt, totalPaidCents: 0 })).toBe(0);
  });

  it('caps at 100', () => {
    expect(getPayoffProgressPercent({ ...baseDebt, totalPaidCents: 200000 })).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// MeterReadingEntity helpers
// ---------------------------------------------------------------------------

describe('getMeterTypeLabel', () => {
  it('returns labels for all meter types', () => {
    expect(getMeterTypeLabel('electricity')).toBe('Electricity');
    expect(getMeterTypeLabel('water')).toBe('Water');
    expect(getMeterTypeLabel('odometer')).toBe('Vehicle');
  });
});

describe('getMeterUnitLabel', () => {
  it('returns unit labels for all meter types', () => {
    expect(getMeterUnitLabel('electricity')).toBe('kWh');
    expect(getMeterUnitLabel('water')).toBe('kL');
    expect(getMeterUnitLabel('odometer')).toBe('km');
  });
});

describe('getMeterIcon', () => {
  it('returns icon names for all meter types', () => {
    expect(getMeterIcon('electricity')).toBe('lightning-bolt');
    expect(getMeterIcon('water')).toBe('water');
    expect(getMeterIcon('odometer')).toBe('car');
  });
});

describe('getReadingDisplayDate', () => {
  it('formats date as "d MMM yyyy"', () => {
    const reading: MeterReadingEntity = {
      id: 'm1',
      householdId: 'hh-1',
      meterType: 'electricity',
      readingValue: 1500,
      readingDate: '2026-04-15',
      costCents: null,
      vehicleId: null,
      notes: null,
      createdAt: '2026-04-15T00:00:00Z',
      updatedAt: '2026-04-15T00:00:00Z',
      isSynced: false,
    };
    expect(getReadingDisplayDate(reading)).toBe('15 Apr 2026');
  });
});

// ---------------------------------------------------------------------------
// EnvelopeEntity helpers
// ---------------------------------------------------------------------------

describe('getPercentRemaining', () => {
  const baseEnvelope: EnvelopeEntity = {
    id: 'e1',
    householdId: 'hh-1',
    name: 'Groceries',
    allocatedCents: 100000,
    spentCents: 25000,
    envelopeType: 'spending',
    isSavingsLocked: false,
    isArchived: false,
    periodStart: '2026-04-01',
    targetAmountCents: null,
    targetDate: null,
    createdAt: '2026-04-01T00:00:00Z',
    updatedAt: '2026-04-01T00:00:00Z',
  };

  it('returns correct percent remaining', () => {
    expect(getPercentRemaining(baseEnvelope)).toBe(75);
  });

  it('returns 100 when allocatedCents is 0', () => {
    expect(getPercentRemaining({ ...baseEnvelope, allocatedCents: 0 })).toBe(100);
  });

  it('returns 0 when fully spent', () => {
    expect(getPercentRemaining({ ...baseEnvelope, spentCents: 100000 })).toBe(0);
  });

  it('returns 0 (clamped) when overspent', () => {
    expect(getPercentRemaining({ ...baseEnvelope, spentCents: 150000 })).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// TransactionEntity helpers
// ---------------------------------------------------------------------------

describe('getTransactionDisplayDate', () => {
  const baseTx: TransactionEntity = {
    id: 't1',
    householdId: 'hh-1',
    envelopeId: 'e1',
    amountCents: 5000,
    payee: 'Shop',
    description: null,
    transactionDate: '2026-03-22',
    isBusinessExpense: false,
    spendingTriggerNote: null,
    createdAt: '2026-03-22T10:00:00Z',
    updatedAt: '2026-03-22T10:00:00Z',
  };

  it('formats transaction date as "d MMM yyyy"', () => {
    expect(getTransactionDisplayDate(baseTx)).toBe('22 Mar 2026');
  });
});

describe('formatTransactionAmount', () => {
  it('returns amountCents as-is', () => {
    const tx: TransactionEntity = {
      id: 't1',
      householdId: 'hh-1',
      envelopeId: 'e1',
      amountCents: 7500,
      payee: null,
      description: null,
      transactionDate: '2026-04-01',
      isBusinessExpense: false,
      spendingTriggerNote: null,
      createdAt: '2026-04-01T00:00:00Z',
      updatedAt: '2026-04-01T00:00:00Z',
    };
    expect(formatTransactionAmount(tx)).toBe(7500);
  });
});

// ---------------------------------------------------------------------------
// groupBusinessExpenses
// ---------------------------------------------------------------------------

describe('groupBusinessExpenses', () => {
  function tx(overrides: Partial<TransactionEntity> = {}): TransactionEntity {
    return {
      id: 'tx-1',
      householdId: 'hh-1',
      envelopeId: 'env-1',
      amountCents: 10000,
      payee: 'Supplier',
      description: null,
      transactionDate: '2026-03-15',
      isBusinessExpense: true,
      spendingTriggerNote: null,
      createdAt: '2026-03-15T10:00:00Z',
      updatedAt: '2026-03-15T10:00:00Z',
      ...overrides,
    };
  }

  it('returns empty for no transactions', () => {
    expect(groupBusinessExpenses([])).toEqual([]);
  });

  it('filters out non-business expenses', () => {
    const result = groupBusinessExpenses([tx({ isBusinessExpense: false })]);
    expect(result).toEqual([]);
  });

  it('groups by month and sums amounts', () => {
    const txs = [
      tx({ id: '1', transactionDate: '2026-03-10', amountCents: 5000 }),
      tx({ id: '2', transactionDate: '2026-03-20', amountCents: 3000 }),
      tx({ id: '3', transactionDate: '2026-04-05', amountCents: 7000 }),
    ];
    const result = groupBusinessExpenses(txs);
    expect(result).toHaveLength(2);
    expect(result[0].monthKey).toBe('2026-04');
    expect(result[0].totalCents).toBe(7000);
    expect(result[1].monthKey).toBe('2026-03');
    expect(result[1].totalCents).toBe(8000);
  });

  it('sorts months descending', () => {
    const txs = [
      tx({ id: '1', transactionDate: '2026-01-15' }),
      tx({ id: '2', transactionDate: '2026-06-15' }),
      tx({ id: '3', transactionDate: '2026-03-15' }),
    ];
    const keys = groupBusinessExpenses(txs).map((g) => g.monthKey);
    expect(keys).toEqual(['2026-06', '2026-03', '2026-01']);
  });

  it('produces correct monthLabel format', () => {
    const result = groupBusinessExpenses([tx({ transactionDate: '2026-11-10' })]);
    expect(result[0].monthLabel).toBe('November 2026');
  });
});

// ---------------------------------------------------------------------------
// LogMeterReadingUseCase
// ---------------------------------------------------------------------------

describe('LogMeterReadingUseCase', () => {
  const mockRepo = {
    insert: jest.fn().mockResolvedValue(undefined),
    findByDate: jest.fn().mockResolvedValue(null),
  };
  const mockAudit = { log: jest.fn().mockResolvedValue(undefined) };
  const mockEnqueuer = { enqueue: jest.fn().mockResolvedValue(undefined) };

  const validInput = {
    householdId: 'hh-1',
    meterType: 'electricity' as const,
    readingValue: 1500,
    readingDate: '2026-04-01',
    costCents: 52500,
    vehicleId: null,
    notes: null,
  };

  beforeEach(() => jest.clearAllMocks());

  it('succeeds when readingValue > 0', async () => {
    const uc = new LogMeterReadingUseCase(
      {} as any,
      mockAudit as any,
      validInput,
      mockEnqueuer,
      mockRepo as any,
    );
    const result = await uc.execute();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.readingValue).toBe(1500);
      expect(result.data.isSynced).toBe(false);
    }
  });

  it('fails when readingValue is 0', async () => {
    const uc = new LogMeterReadingUseCase(
      {} as any,
      mockAudit as any,
      { ...validInput, readingValue: 0 },
      mockEnqueuer,
      mockRepo as any,
    );
    const result = await uc.execute();

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_READING');
  });

  it('fails when readingValue is negative', async () => {
    const uc = new LogMeterReadingUseCase(
      {} as any,
      mockAudit as any,
      { ...validInput, readingValue: -5 },
      mockEnqueuer,
      mockRepo as any,
    );
    const result = await uc.execute();

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_READING');
  });
});

// ---------------------------------------------------------------------------
// RecordSlipConsentUseCase
// ---------------------------------------------------------------------------

describe('RecordSlipConsentUseCase', () => {
  it('records consent successfully', async () => {
    const repo = { setSlipScanConsent: jest.fn().mockResolvedValue(undefined) };
    const uc = new RecordSlipConsentUseCase(repo as any);
    const result = await uc.execute({ userId: 'u1' });

    expect(result.success).toBe(true);
    expect(repo.setSlipScanConsent).toHaveBeenCalledWith('u1', expect.any(String));
  });

  it('returns DB_ERROR when repo throws', async () => {
    const repo = { setSlipScanConsent: jest.fn().mockRejectedValue(new Error('connection lost')) };
    const uc = new RecordSlipConsentUseCase(repo as any);
    const result = await uc.execute({ userId: 'u1' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('DB_ERROR');
      expect(result.error.message).toContain('connection lost');
    }
  });
});
