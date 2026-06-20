import type { EnvelopeEntity, EnvelopeType } from '../domain/envelopes/EnvelopeEntity';
import type { TransactionEntity } from '../domain/transactions/TransactionEntity';
import type { DebtEntity, DebtType } from '../domain/debtSnowball/DebtEntity';
import type { MeterReadingEntity, MeterType } from '../domain/meterReadings/MeterReadingEntity';
import type { BabyStepStatus } from '../domain/babySteps/types';
import type { HouseholdRow } from '../domain/ports/IHouseholdRepository';
import type { PendingSyncRecord } from '../data/sync/PendingSyncTable';

// ── Lightweight user type (Supabase auth is external) ────────────────────────

export interface TestUser {
  id: string;
  email: string;
  displayName: string;
}

// ── Household member row (mirrors householdMembers schema) ───────────────────

export interface TestHouseholdMember {
  id: string;
  householdId: string;
  userId: string;
  role: 'owner' | 'member';
  joinedAt: string;
  updatedAt: string;
}

// ── Snowball payment (composite test type) ───────────────────────────────────

export interface SnowballPayment {
  debtId: string;
  householdId: string;
  paymentAmountCents: number;
  paymentDate: string;
}

// ── Counter for unique UUIDs ─────────────────────────────────────────────────

let _counter = 1;

export function resetFactoryCounter(): void {
  _counter = 1;
}

function nextUuid(): string {
  const n = (_counter++).toString().padStart(12, '0');
  return `00000000-0000-0000-0000-${n}`;
}

const ISO_NOW = '2026-01-15T00:00:00.000Z';

// ── Factory: User ────────────────────────────────────────────────────────────

export function buildUser(overrides?: Partial<TestUser>): TestUser {
  const id = overrides?.id ?? nextUuid();
  return {
    id,
    email: `user-${id.slice(-4)}@test.local`,
    displayName: `TestUser ${id.slice(-4)}`,
    ...overrides,
  };
}

// ── Factory: Household ───────────────────────────────────────────────────────

export function buildHousehold(overrides?: Partial<HouseholdRow>): HouseholdRow {
  return {
    id: nextUuid(),
    name: 'Test Household',
    paydayDay: 1,
    userLevel: 1,
    createdAt: ISO_NOW,
    updatedAt: ISO_NOW,
    isSynced: false,
    ...overrides,
  };
}

// ── Factory: Envelope ────────────────────────────────────────────────────────

export function buildEnvelope(overrides?: Partial<EnvelopeEntity>): EnvelopeEntity {
  return {
    id: nextUuid(),
    householdId: 'aaaa1111-aaaa-aaaa-aaaa-aaaa11111111',
    name: 'Test Envelope',
    allocatedCents: 500000,
    spentCents: 0,
    envelopeType: 'spending' as EnvelopeType,
    isSavingsLocked: false,
    isArchived: false,
    periodStart: '2026-01-01',
    targetAmountCents: null,
    targetDate: null,
    createdAt: ISO_NOW,
    updatedAt: ISO_NOW,
    ...overrides,
  };
}

// ── Factory: Transaction ─────────────────────────────────────────────────────

export function buildTransaction(overrides?: Partial<TransactionEntity>): TransactionEntity {
  return {
    id: nextUuid(),
    householdId: 'aaaa1111-aaaa-aaaa-aaaa-aaaa11111111',
    envelopeId: nextUuid(),
    amountCents: 10000,
    payee: 'Test Payee',
    description: null,
    transactionDate: '2026-01-15',
    isBusinessExpense: false,
    spendingTriggerNote: null,
    slipId: null,
    createdAt: ISO_NOW,
    updatedAt: ISO_NOW,
    ...overrides,
  };
}

// ── Factory: Debt ────────────────────────────────────────────────────────────

export function buildDebt(overrides?: Partial<DebtEntity>): DebtEntity {
  return {
    id: nextUuid(),
    householdId: 'aaaa1111-aaaa-aaaa-aaaa-aaaa11111111',
    creditorName: 'Test Creditor',
    debtType: 'credit_card' as DebtType,
    outstandingBalanceCents: 100000,
    initialBalanceCents: 100000,
    interestRatePercent: 18,
    minimumPaymentCents: 5000,
    sortOrder: 0,
    isPaidOff: false,
    totalPaidCents: 0,
    createdAt: ISO_NOW,
    updatedAt: ISO_NOW,
    isSynced: false,
    ...overrides,
  };
}

// ── Factory: MeterReading ────────────────────────────────────────────────────

export function buildMeterReading(overrides?: Partial<MeterReadingEntity>): MeterReadingEntity {
  return {
    id: nextUuid(),
    householdId: 'aaaa1111-aaaa-aaaa-aaaa-aaaa11111111',
    meterType: 'electricity' as MeterType,
    readingValue: 500,
    readingDate: '2026-01-31',
    costCents: 150000,
    vehicleId: null,
    notes: null,
    createdAt: ISO_NOW,
    updatedAt: ISO_NOW,
    isSynced: false,
    ...overrides,
  };
}

// ── Factory: BabyStepStatus ──────────────────────────────────────────────────

export function buildBabyStep(overrides?: Partial<BabyStepStatus>): BabyStepStatus {
  return {
    stepNumber: 1,
    isCompleted: false,
    isManual: false,
    progress: null,
    completedAt: null,
    celebratedAt: null,
    ...overrides,
  };
}

// ── Factory: PendingSyncRecord ───────────────────────────────────────────────

export function buildPendingSyncRow(overrides?: Partial<PendingSyncRecord>): PendingSyncRecord {
  return {
    id: nextUuid(),
    tableName: 'transactions',
    recordId: nextUuid(),
    operation: 'INSERT',
    retryCount: 0,
    lastAttemptedAt: null,
    createdAt: ISO_NOW,
    ...overrides,
  };
}
