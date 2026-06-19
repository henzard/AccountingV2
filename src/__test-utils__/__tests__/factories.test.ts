import {
  buildUser,
  buildHousehold,
  buildEnvelope,
  buildTransaction,
  buildDebt,
  buildMeterReading,
  buildBabyStep,
  buildPendingSyncRow,
  resetFactoryCounter,
} from '../factories';

import type { MeterReadingEntity } from '../../domain/meterReadings/MeterReadingEntity';
import {
  USERS,
  HOUSEHOLDS,
  KRUGER_ENVELOPES,
  HETZEL_ENVELOPES,
  KRUGER_DEBTS,
  HETZEL_DEBTS,
  KRUGER_TRANSACTIONS,
  HETZEL_TRANSACTIONS,
  KRUGER_METER_READINGS,
  HETZEL_METER_READINGS,
  SNOWBALL_PAYMENTS,
} from '../scenarioSeed';

beforeEach(() => {
  resetFactoryCounter();
});

// ═══════════════════════════════════════════════════════════════════════════════
// Factory validity
// ═══════════════════════════════════════════════════════════════════════════════

describe('Factory functions produce valid objects', () => {
  it('buildUser returns required fields', () => {
    const user = buildUser();
    expect(user.id).toBeTruthy();
    expect(user.email).toContain('@');
    expect(user.displayName).toBeTruthy();
  });

  it('buildHousehold returns required fields', () => {
    const hh = buildHousehold();
    expect(hh.id).toBeTruthy();
    expect(hh.name).toBeTruthy();
    expect(hh.paydayDay).toBeGreaterThanOrEqual(1);
    expect(hh.paydayDay).toBeLessThanOrEqual(28);
    expect(hh.createdAt).toBeTruthy();
    expect(hh.updatedAt).toBeTruthy();
  });

  it('buildEnvelope returns required fields with correct types', () => {
    const env = buildEnvelope();
    expect(env.id).toBeTruthy();
    expect(env.householdId).toBeTruthy();
    expect(env.name).toBeTruthy();
    expect(typeof env.allocatedCents).toBe('number');
    expect(typeof env.spentCents).toBe('number');
    expect(env.envelopeType).toBeTruthy();
    expect(typeof env.isSavingsLocked).toBe('boolean');
    expect(typeof env.isArchived).toBe('boolean');
    expect(env.periodStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('buildTransaction returns required fields', () => {
    const tx = buildTransaction();
    expect(tx.id).toBeTruthy();
    expect(tx.householdId).toBeTruthy();
    expect(tx.envelopeId).toBeTruthy();
    expect(tx.amountCents).toBeGreaterThan(0);
    expect(tx.transactionDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(typeof tx.isBusinessExpense).toBe('boolean');
  });

  it('buildDebt returns required fields', () => {
    const debt = buildDebt();
    expect(debt.id).toBeTruthy();
    expect(debt.householdId).toBeTruthy();
    expect(debt.creditorName).toBeTruthy();
    expect(debt.debtType).toBeTruthy();
    expect(debt.outstandingBalanceCents).toBeGreaterThanOrEqual(0);
    expect(debt.initialBalanceCents).toBeGreaterThanOrEqual(0);
    expect(debt.interestRatePercent).toBeGreaterThan(0);
    expect(debt.minimumPaymentCents).toBeGreaterThan(0);
    expect(typeof debt.sortOrder).toBe('number');
    expect(typeof debt.isPaidOff).toBe('boolean');
    expect(typeof debt.totalPaidCents).toBe('number');
    expect(typeof debt.isSynced).toBe('boolean');
  });

  it('buildMeterReading returns required fields', () => {
    const mr = buildMeterReading();
    expect(mr.id).toBeTruthy();
    expect(mr.householdId).toBeTruthy();
    expect(['electricity', 'water', 'odometer']).toContain(mr.meterType);
    expect(mr.readingValue).toBeGreaterThan(0);
    expect(mr.readingDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(typeof mr.isSynced).toBe('boolean');
  });

  it('buildBabyStep returns required fields', () => {
    const bs = buildBabyStep();
    expect(bs.stepNumber).toBeGreaterThanOrEqual(1);
    expect(bs.stepNumber).toBeLessThanOrEqual(7);
    expect(typeof bs.isCompleted).toBe('boolean');
    expect(typeof bs.isManual).toBe('boolean');
  });

  it('buildPendingSyncRow returns required fields', () => {
    const ps = buildPendingSyncRow();
    expect(ps.id).toBeTruthy();
    expect(ps.tableName).toBeTruthy();
    expect(ps.recordId).toBeTruthy();
    expect(['INSERT', 'UPDATE', 'DELETE']).toContain(ps.operation);
    expect(typeof ps.retryCount).toBe('number');
  });

  it('factories accept partial overrides', () => {
    const env = buildEnvelope({ name: 'Custom', allocatedCents: 999 });
    expect(env.name).toBe('Custom');
    expect(env.allocatedCents).toBe(999);

    const tx = buildTransaction({ payee: 'Override Payee', amountCents: 42 });
    expect(tx.payee).toBe('Override Payee');
    expect(tx.amountCents).toBe(42);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Scenario seed: counts
// ═══════════════════════════════════════════════════════════════════════════════

describe('Scenario seed counts', () => {
  it('has 4 users', () => {
    expect(Object.keys(USERS)).toHaveLength(4);
  });

  it('has 2 households', () => {
    expect(Object.keys(HOUSEHOLDS)).toHaveLength(2);
  });

  it('has 120 Kruger transactions', () => {
    expect(KRUGER_TRANSACTIONS).toHaveLength(120);
  });

  it('has 80 Hetzel transactions', () => {
    expect(HETZEL_TRANSACTIONS).toHaveLength(80);
  });

  it('has correct envelope counts', () => {
    expect(KRUGER_ENVELOPES.length).toBe(10);
    expect(HETZEL_ENVELOPES.length).toBe(8);
  });

  it('has correct debt counts', () => {
    expect(KRUGER_DEBTS).toHaveLength(5);
    expect(HETZEL_DEBTS).toHaveLength(2);
  });

  it('has 12 Kruger meter readings (6 elec + 6 water)', () => {
    expect(KRUGER_METER_READINGS).toHaveLength(12);
  });

  it('has 12 Hetzel meter readings (6 elec + 6 water)', () => {
    expect(HETZEL_METER_READINGS).toHaveLength(12);
  });

  it('has snowball payments (15 Kruger + 4 Hetzel = 19)', () => {
    expect(SNOWBALL_PAYMENTS).toHaveLength(19);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// UUID uniqueness
// ═══════════════════════════════════════════════════════════════════════════════

describe('UUID uniqueness', () => {
  it('all entity IDs are unique across the full scenario', () => {
    const allIds: string[] = [
      ...Object.values(USERS).map((u) => u.id),
      ...Object.values(HOUSEHOLDS).map((h) => h.id),
      ...KRUGER_ENVELOPES.map((e) => e.id),
      ...HETZEL_ENVELOPES.map((e) => e.id),
      ...KRUGER_DEBTS.map((d) => d.id),
      ...HETZEL_DEBTS.map((d) => d.id),
      ...KRUGER_TRANSACTIONS.map((t) => t.id),
      ...HETZEL_TRANSACTIONS.map((t) => t.id),
      ...KRUGER_METER_READINGS.map((m) => m.id),
      ...HETZEL_METER_READINGS.map((m) => m.id),
    ];

    const unique = new Set(allIds);
    expect(unique.size).toBe(allIds.length);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Referential integrity
// ═══════════════════════════════════════════════════════════════════════════════

describe('Referential integrity', () => {
  const krugerEnvIds = new Set(KRUGER_ENVELOPES.map((e) => e.id));
  const hetzelEnvIds = new Set(HETZEL_ENVELOPES.map((e) => e.id));

  it('all Kruger transactions reference valid Kruger envelope IDs', () => {
    for (const tx of KRUGER_TRANSACTIONS) {
      expect(krugerEnvIds.has(tx.envelopeId)).toBe(true);
    }
  });

  it('all Hetzel transactions reference valid Hetzel envelope IDs', () => {
    for (const tx of HETZEL_TRANSACTIONS) {
      expect(hetzelEnvIds.has(tx.envelopeId)).toBe(true);
    }
  });

  it('all Kruger transactions belong to Kruger household', () => {
    for (const tx of KRUGER_TRANSACTIONS) {
      expect(tx.householdId).toBe(HOUSEHOLDS.kruger.id);
    }
  });

  it('all Hetzel transactions belong to Hetzel household', () => {
    for (const tx of HETZEL_TRANSACTIONS) {
      expect(tx.householdId).toBe(HOUSEHOLDS.hetzel.id);
    }
  });

  it('Kruger debts are in snowball order', () => {
    for (let i = 0; i < KRUGER_DEBTS.length; i++) {
      expect(KRUGER_DEBTS[i].sortOrder).toBe(i);
    }
  });

  it('Hetzel debts are in snowball order', () => {
    for (let i = 0; i < HETZEL_DEBTS.length; i++) {
      expect(HETZEL_DEBTS[i].sortOrder).toBe(i);
    }
  });

  it('snowball payments reference valid debt IDs', () => {
    const allDebtIds = new Set([
      ...KRUGER_DEBTS.map((d) => d.id),
      ...HETZEL_DEBTS.map((d) => d.id),
    ]);
    for (const p of SNOWBALL_PAYMENTS) {
      expect(allDebtIds.has(p.debtId)).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Amounts are positive integers
// ═══════════════════════════════════════════════════════════════════════════════

describe('All amounts are positive integers (cents)', () => {
  it('Kruger transaction amounts', () => {
    for (const tx of KRUGER_TRANSACTIONS) {
      expect(Number.isInteger(tx.amountCents)).toBe(true);
      expect(tx.amountCents).toBeGreaterThan(0);
    }
  });

  it('Hetzel transaction amounts', () => {
    for (const tx of HETZEL_TRANSACTIONS) {
      expect(Number.isInteger(tx.amountCents)).toBe(true);
      expect(tx.amountCents).toBeGreaterThan(0);
    }
  });

  it('envelope allocatedCents are non-negative integers', () => {
    const allEnvelopes = [...KRUGER_ENVELOPES, ...HETZEL_ENVELOPES];
    for (const env of allEnvelopes) {
      expect(Number.isInteger(env.allocatedCents)).toBe(true);
      expect(env.allocatedCents).toBeGreaterThanOrEqual(0);
    }
  });

  it('debt amounts are positive integers', () => {
    const allDebts = [...KRUGER_DEBTS, ...HETZEL_DEBTS];
    for (const debt of allDebts) {
      expect(Number.isInteger(debt.outstandingBalanceCents)).toBe(true);
      expect(debt.outstandingBalanceCents).toBeGreaterThan(0);
      expect(Number.isInteger(debt.minimumPaymentCents)).toBe(true);
      expect(debt.minimumPaymentCents).toBeGreaterThan(0);
    }
  });

  it('snowball payment amounts are positive integers', () => {
    for (const p of SNOWBALL_PAYMENTS) {
      expect(Number.isInteger(p.paymentAmountCents)).toBe(true);
      expect(p.paymentAmountCents).toBeGreaterThan(0);
    }
  });

  it('meter reading costs are positive integers', () => {
    const allReadings = [...KRUGER_METER_READINGS, ...HETZEL_METER_READINGS];
    for (const mr of allReadings) {
      if (mr.costCents !== null) {
        expect(Number.isInteger(mr.costCents)).toBe(true);
        expect(mr.costCents).toBeGreaterThan(0);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Date range
// ═══════════════════════════════════════════════════════════════════════════════

describe('Transaction dates span Jan-Jun 2026', () => {
  it('all Kruger transactions are within range', () => {
    for (const tx of KRUGER_TRANSACTIONS) {
      expect(tx.transactionDate >= '2026-01-01').toBe(true);
      expect(tx.transactionDate <= '2026-06-30').toBe(true);
    }
  });

  it('all Hetzel transactions are within range', () => {
    for (const tx of HETZEL_TRANSACTIONS) {
      expect(tx.transactionDate >= '2026-01-01').toBe(true);
      expect(tx.transactionDate <= '2026-06-30').toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Business expenses
// ═══════════════════════════════════════════════════════════════════════════════

describe('Business expense flagging', () => {
  it('Kruger has business-expense transactions in Nedbank Claims envelope', () => {
    const bizTxns = KRUGER_TRANSACTIONS.filter((tx) => tx.isBusinessExpense);
    expect(bizTxns.length).toBeGreaterThanOrEqual(24);
    const nedbankEnvId = KRUGER_ENVELOPES.find((e) => e.name === 'Nedbank Claims')?.id;
    for (const tx of bizTxns) {
      expect(tx.envelopeId).toBe(nedbankEnvId);
    }
  });

  it('Hetzel has no business-expense transactions', () => {
    const bizTxns = HETZEL_TRANSACTIONS.filter((tx) => tx.isBusinessExpense);
    expect(bizTxns).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Meter reading anomalies
// ═══════════════════════════════════════════════════════════════════════════════

describe('Meter reading anomalies', () => {
  function hasAnomaly(readings: MeterReadingEntity[]): boolean {
    for (let i = 1; i < readings.length; i++) {
      const pct =
        (readings[i].readingValue - readings[i - 1].readingValue) / readings[i - 1].readingValue;
      if (pct > 0.2) return true;
    }
    return false;
  }

  it('Kruger electricity has at least one anomaly spike > 20%', () => {
    const elec = KRUGER_METER_READINGS.filter((r) => r.meterType === 'electricity');
    expect(hasAnomaly(elec)).toBe(true);
  });

  it('Kruger water has at least one anomaly spike > 20%', () => {
    const water = KRUGER_METER_READINGS.filter((r) => r.meterType === 'water');
    expect(hasAnomaly(water)).toBe(true);
  });

  it('Hetzel electricity has at least one anomaly spike > 20%', () => {
    const elec = HETZEL_METER_READINGS.filter((r) => r.meterType === 'electricity');
    expect(hasAnomaly(elec)).toBe(true);
  });

  it('Hetzel water has at least one anomaly spike > 20%', () => {
    const water = HETZEL_METER_READINGS.filter((r) => r.meterType === 'water');
    expect(hasAnomaly(water)).toBe(true);
  });
});
