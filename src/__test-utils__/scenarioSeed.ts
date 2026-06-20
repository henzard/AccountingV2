/**
 * Full scenario seed data for integration / QA tests.
 *
 * Two households (Kruger & Hetzel) with realistic South African Rand
 * transactions spanning Jan-Jun 2026.  All monetary values are in CENTS.
 */
import {
  buildUser,
  buildHousehold,
  buildEnvelope,
  buildTransaction,
  buildDebt,
  buildMeterReading,
  type TestUser,
  type SnowballPayment,
} from './factories';
import type { HouseholdRow } from '../domain/ports/IHouseholdRepository';
import type { EnvelopeEntity } from '../domain/envelopes/EnvelopeEntity';
import type { TransactionEntity } from '../domain/transactions/TransactionEntity';
import type { DebtEntity } from '../domain/debtSnowball/DebtEntity';
import type { MeterReadingEntity } from '../domain/meterReadings/MeterReadingEntity';

// ═══════════════════════════════════════════════════════════════════════════════
// FIXED UUIDs
// ═══════════════════════════════════════════════════════════════════════════════

const USER_IDS = {
  henzard: '11111111-1111-1111-1111-111111111111',
  alicia: '22222222-2222-2222-2222-222222222222',
  giel: '33333333-3333-3333-3333-333333333333',
  thirza: '44444444-4444-4444-4444-444444444444',
} as const;

const HOUSEHOLD_IDS = {
  kruger: 'aaaa1111-aaaa-aaaa-aaaa-aaaa11111111',
  hetzel: 'bbbb2222-bbbb-bbbb-bbbb-bbbb22222222',
} as const;

// ═══════════════════════════════════════════════════════════════════════════════
// USERS
// ═══════════════════════════════════════════════════════════════════════════════

export const USERS: Record<'henzard' | 'alicia' | 'giel' | 'thirza', TestUser> = {
  henzard: buildUser({
    id: USER_IDS.henzard,
    email: 'henzard@kruger.co.za',
    displayName: 'Henzard',
  }),
  alicia: buildUser({ id: USER_IDS.alicia, email: 'alicia@kruger.co.za', displayName: 'Alicia' }),
  giel: buildUser({ id: USER_IDS.giel, email: 'giel@hetzel.co.za', displayName: 'Giel' }),
  thirza: buildUser({ id: USER_IDS.thirza, email: 'thirza@hetzel.co.za', displayName: 'Thirza' }),
};

// ═══════════════════════════════════════════════════════════════════════════════
// HOUSEHOLDS
// ═══════════════════════════════════════════════════════════════════════════════

export const HOUSEHOLDS: Record<'kruger' | 'hetzel', HouseholdRow> = {
  kruger: buildHousehold({
    id: HOUSEHOLD_IDS.kruger,
    name: 'Kruger',
    paydayDay: 20,
  }),
  hetzel: buildHousehold({
    id: HOUSEHOLD_IDS.hetzel,
    name: 'Hetzel',
    paydayDay: 1,
  }),
};

// ═══════════════════════════════════════════════════════════════════════════════
// ENVELOPE IDs (deterministic for cross-referencing)
// ═══════════════════════════════════════════════════════════════════════════════

const KRUGER_ENV_IDS = {
  groceries: 'e0000001-0000-0000-0000-000000000001',
  fuel: 'e0000001-0000-0000-0000-000000000002',
  medicalAid: 'e0000001-0000-0000-0000-000000000003',
  insurance: 'e0000001-0000-0000-0000-000000000004',
  entertainment: 'e0000001-0000-0000-0000-000000000005',
  nedbankClaims: 'e0000001-0000-0000-0000-000000000006',
  emergencyFund: 'e0000001-0000-0000-0000-000000000007',
  sinkingFundHoliday: 'e0000001-0000-0000-0000-000000000008',
  incomeHenzard: 'e0000001-0000-0000-0000-000000000009',
  incomeAlicia: 'e0000001-0000-0000-0000-000000000010',
};

const HETZEL_ENV_IDS = {
  groceries: 'e0000002-0000-0000-0000-000000000001',
  fuel: 'e0000002-0000-0000-0000-000000000002',
  schoolFees: 'e0000002-0000-0000-0000-000000000003',
  utilities: 'e0000002-0000-0000-0000-000000000004',
  entertainment: 'e0000002-0000-0000-0000-000000000005',
  emergencyFund: 'e0000002-0000-0000-0000-000000000006',
  incomeGiel: 'e0000002-0000-0000-0000-000000000007',
  incomeThirza: 'e0000002-0000-0000-0000-000000000008',
};

// ═══════════════════════════════════════════════════════════════════════════════
// KRUGER ENVELOPES
// ═══════════════════════════════════════════════════════════════════════════════

export const KRUGER_ENVELOPES: EnvelopeEntity[] = [
  buildEnvelope({
    id: KRUGER_ENV_IDS.groceries,
    householdId: HOUSEHOLD_IDS.kruger,
    name: 'Groceries',
    allocatedCents: 800000,
    envelopeType: 'spending',
  }),
  buildEnvelope({
    id: KRUGER_ENV_IDS.fuel,
    householdId: HOUSEHOLD_IDS.kruger,
    name: 'Fuel',
    allocatedCents: 400000,
    envelopeType: 'spending',
  }),
  buildEnvelope({
    id: KRUGER_ENV_IDS.medicalAid,
    householdId: HOUSEHOLD_IDS.kruger,
    name: 'Medical Aid',
    allocatedCents: 350000,
    envelopeType: 'spending',
  }),
  buildEnvelope({
    id: KRUGER_ENV_IDS.insurance,
    householdId: HOUSEHOLD_IDS.kruger,
    name: 'Insurance',
    allocatedCents: 250000,
    envelopeType: 'spending',
  }),
  buildEnvelope({
    id: KRUGER_ENV_IDS.entertainment,
    householdId: HOUSEHOLD_IDS.kruger,
    name: 'Entertainment',
    allocatedCents: 200000,
    envelopeType: 'spending',
  }),
  buildEnvelope({
    id: KRUGER_ENV_IDS.nedbankClaims,
    householdId: HOUSEHOLD_IDS.kruger,
    name: 'Nedbank Claims',
    allocatedCents: 500000,
    envelopeType: 'spending',
  }),
  buildEnvelope({
    id: KRUGER_ENV_IDS.emergencyFund,
    householdId: HOUSEHOLD_IDS.kruger,
    name: 'Emergency Fund',
    allocatedCents: 0,
    envelopeType: 'emergency_fund',
    isSavingsLocked: true,
    targetAmountCents: 1000000,
  }),
  buildEnvelope({
    id: KRUGER_ENV_IDS.sinkingFundHoliday,
    householdId: HOUSEHOLD_IDS.kruger,
    name: 'Dec Holiday Sinking Fund',
    allocatedCents: 0,
    envelopeType: 'sinking_fund',
    isSavingsLocked: true,
    targetAmountCents: 1500000,
    targetDate: '2026-12-01',
  }),
  buildEnvelope({
    id: KRUGER_ENV_IDS.incomeHenzard,
    householdId: HOUSEHOLD_IDS.kruger,
    name: 'Henzard Income',
    allocatedCents: 4500000,
    envelopeType: 'income',
  }),
  buildEnvelope({
    id: KRUGER_ENV_IDS.incomeAlicia,
    householdId: HOUSEHOLD_IDS.kruger,
    name: 'Alicia Income',
    allocatedCents: 2500000,
    envelopeType: 'income',
  }),
];

// ═══════════════════════════════════════════════════════════════════════════════
// HETZEL ENVELOPES
// ═══════════════════════════════════════════════════════════════════════════════

export const HETZEL_ENVELOPES: EnvelopeEntity[] = [
  buildEnvelope({
    id: HETZEL_ENV_IDS.groceries,
    householdId: HOUSEHOLD_IDS.hetzel,
    name: 'Groceries',
    allocatedCents: 600000,
    envelopeType: 'spending',
  }),
  buildEnvelope({
    id: HETZEL_ENV_IDS.fuel,
    householdId: HOUSEHOLD_IDS.hetzel,
    name: 'Fuel',
    allocatedCents: 300000,
    envelopeType: 'spending',
  }),
  buildEnvelope({
    id: HETZEL_ENV_IDS.schoolFees,
    householdId: HOUSEHOLD_IDS.hetzel,
    name: 'School Fees',
    allocatedCents: 450000,
    envelopeType: 'spending',
  }),
  buildEnvelope({
    id: HETZEL_ENV_IDS.utilities,
    householdId: HOUSEHOLD_IDS.hetzel,
    name: 'Utilities',
    allocatedCents: 200000,
    envelopeType: 'spending',
  }),
  buildEnvelope({
    id: HETZEL_ENV_IDS.entertainment,
    householdId: HOUSEHOLD_IDS.hetzel,
    name: 'Entertainment',
    allocatedCents: 150000,
    envelopeType: 'spending',
  }),
  buildEnvelope({
    id: HETZEL_ENV_IDS.emergencyFund,
    householdId: HOUSEHOLD_IDS.hetzel,
    name: 'Emergency Fund',
    allocatedCents: 0,
    envelopeType: 'emergency_fund',
    isSavingsLocked: true,
    targetAmountCents: 500000,
  }),
  buildEnvelope({
    id: HETZEL_ENV_IDS.incomeGiel,
    householdId: HOUSEHOLD_IDS.hetzel,
    name: 'Giel Income',
    allocatedCents: 2200000,
    envelopeType: 'income',
  }),
  buildEnvelope({
    id: HETZEL_ENV_IDS.incomeThirza,
    householdId: HOUSEHOLD_IDS.hetzel,
    name: 'Thirza Income',
    allocatedCents: 1800000,
    envelopeType: 'income',
  }),
];

// ═══════════════════════════════════════════════════════════════════════════════
// KRUGER DEBTS (snowball order)
// ═══════════════════════════════════════════════════════════════════════════════

const KRUGER_DEBT_IDS = {
  woolworths: 'd0000001-0000-0000-0000-000000000001',
  nedbank: 'd0000001-0000-0000-0000-000000000002',
  capitec: 'd0000001-0000-0000-0000-000000000003',
  wesbank: 'd0000001-0000-0000-0000-000000000004',
  fnb: 'd0000001-0000-0000-0000-000000000005',
};

export const KRUGER_DEBTS: DebtEntity[] = [
  buildDebt({
    id: KRUGER_DEBT_IDS.woolworths,
    householdId: HOUSEHOLD_IDS.kruger,
    creditorName: 'Woolworths Store Account',
    debtType: 'store_account',
    outstandingBalanceCents: 320000,
    initialBalanceCents: 320000,
    interestRatePercent: 18,
    minimumPaymentCents: 15000,
    sortOrder: 0,
  }),
  buildDebt({
    id: KRUGER_DEBT_IDS.nedbank,
    householdId: HOUSEHOLD_IDS.kruger,
    creditorName: 'Nedbank Credit Card',
    debtType: 'credit_card',
    outstandingBalanceCents: 850000,
    initialBalanceCents: 850000,
    interestRatePercent: 21,
    minimumPaymentCents: 25000,
    sortOrder: 1,
  }),
  buildDebt({
    id: KRUGER_DEBT_IDS.capitec,
    householdId: HOUSEHOLD_IDS.kruger,
    creditorName: 'Capitec Personal Loan',
    debtType: 'personal_loan',
    outstandingBalanceCents: 4500000,
    initialBalanceCents: 4500000,
    interestRatePercent: 12,
    minimumPaymentCents: 150000,
    sortOrder: 2,
  }),
  buildDebt({
    id: KRUGER_DEBT_IDS.wesbank,
    householdId: HOUSEHOLD_IDS.kruger,
    creditorName: 'WesBank Vehicle Finance',
    debtType: 'vehicle_finance',
    outstandingBalanceCents: 18500000,
    initialBalanceCents: 18500000,
    interestRatePercent: 10.5,
    minimumPaymentCents: 380000,
    sortOrder: 3,
  }),
  buildDebt({
    id: KRUGER_DEBT_IDS.fnb,
    householdId: HOUSEHOLD_IDS.kruger,
    creditorName: 'FNB Home Bond',
    debtType: 'bond',
    outstandingBalanceCents: 120000000,
    initialBalanceCents: 120000000,
    interestRatePercent: 11.25,
    minimumPaymentCents: 1250000,
    sortOrder: 4,
  }),
];

// ═══════════════════════════════════════════════════════════════════════════════
// HETZEL DEBTS (snowball order)
// ═══════════════════════════════════════════════════════════════════════════════

const HETZEL_DEBT_IDS = {
  edgars: 'd0000002-0000-0000-0000-000000000001',
  standardBank: 'd0000002-0000-0000-0000-000000000002',
};

export const HETZEL_DEBTS: DebtEntity[] = [
  buildDebt({
    id: HETZEL_DEBT_IDS.edgars,
    householdId: HOUSEHOLD_IDS.hetzel,
    creditorName: 'Edgars Store Account',
    debtType: 'store_account',
    outstandingBalanceCents: 210000,
    initialBalanceCents: 210000,
    interestRatePercent: 20,
    minimumPaymentCents: 10000,
    sortOrder: 0,
  }),
  buildDebt({
    id: HETZEL_DEBT_IDS.standardBank,
    householdId: HOUSEHOLD_IDS.hetzel,
    creditorName: 'Standard Bank Credit Card',
    debtType: 'credit_card',
    outstandingBalanceCents: 1200000,
    initialBalanceCents: 1200000,
    interestRatePercent: 22,
    minimumPaymentCents: 35000,
    sortOrder: 1,
  }),
];

// ═══════════════════════════════════════════════════════════════════════════════
// TRANSACTION HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

let _txCounter = 1;

function txId(prefix: string): string {
  return `t${prefix}-0000-0000-0000-${(_txCounter++).toString().padStart(12, '0')}`;
}

// Seeded pseudo-random for determinism: use fixed day sequences instead
const KRUGER_DAYS: number[][] = [
  [2, 5, 8, 10, 12, 14, 16, 18, 20, 22, 24, 25, 26, 27, 28, 3, 7, 11, 15, 19],
  [1, 3, 6, 8, 10, 13, 15, 17, 19, 21, 23, 24, 25, 26, 27, 2, 7, 12, 16, 20],
  [1, 4, 6, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 28, 29, 3, 8, 14, 18, 22],
  [1, 3, 5, 8, 10, 12, 14, 16, 18, 20, 22, 24, 25, 26, 28, 2, 7, 11, 15, 19],
  [1, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 29, 3, 7, 13, 17, 21],
  [1, 3, 5, 8, 10, 12, 14, 16, 18, 20, 22, 24, 25, 26, 28, 2, 6, 11, 15, 19],
];

const HETZEL_DAYS: number[][] = [
  [2, 5, 8, 11, 14, 17, 20, 22, 24, 26, 28, 3, 7],
  [1, 4, 7, 10, 13, 16, 19, 21, 23, 25, 27, 3, 8],
  [1, 4, 7, 10, 13, 16, 19, 22, 24, 26, 28, 5, 9],
  [1, 3, 6, 9, 12, 15, 18, 20, 22, 24, 26, 4, 8],
  [1, 4, 7, 10, 13, 16, 19, 21, 23, 25, 27, 3, 8],
  [1, 3, 6, 9, 12, 15, 18, 20, 22, 24, 26, 4, 7],
];

function dateStr(month: number, day: number): string {
  return `2026-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// KRUGER TRANSACTIONS -- 20 per month × 6 months = 120
// ═══════════════════════════════════════════════════════════════════════════════

interface TxTemplate {
  envelopeId: string;
  payee: string;
  amountCents: number;
  isBusinessExpense?: boolean;
}

const KRUGER_TX_TEMPLATES: TxTemplate[] = [
  // Groceries (5 per month)
  { envelopeId: KRUGER_ENV_IDS.groceries, payee: 'Checkers Centurion', amountCents: 185000 },
  { envelopeId: KRUGER_ENV_IDS.groceries, payee: 'Pick n Pay Menlyn', amountCents: 142000 },
  { envelopeId: KRUGER_ENV_IDS.groceries, payee: 'Woolworths Food', amountCents: 95000 },
  { envelopeId: KRUGER_ENV_IDS.groceries, payee: 'Spar Montana', amountCents: 67500 },
  { envelopeId: KRUGER_ENV_IDS.groceries, payee: 'Makro Silverton', amountCents: 210500 },
  // Fuel (3 per month)
  { envelopeId: KRUGER_ENV_IDS.fuel, payee: 'Engen Lynnwood', amountCents: 125000 },
  { envelopeId: KRUGER_ENV_IDS.fuel, payee: 'Shell Menlyn', amountCents: 98000 },
  { envelopeId: KRUGER_ENV_IDS.fuel, payee: 'BP Centurion', amountCents: 110000 },
  // Medical Aid (1 per month — debit order)
  { envelopeId: KRUGER_ENV_IDS.medicalAid, payee: 'Discovery Health', amountCents: 350000 },
  // Insurance (1 per month — debit order)
  { envelopeId: KRUGER_ENV_IDS.insurance, payee: 'Old Mutual', amountCents: 250000 },
  // Entertainment (3 per month)
  { envelopeId: KRUGER_ENV_IDS.entertainment, payee: 'Ster-Kinekor', amountCents: 32000 },
  { envelopeId: KRUGER_ENV_IDS.entertainment, payee: 'Mugg & Bean', amountCents: 48500 },
  { envelopeId: KRUGER_ENV_IDS.entertainment, payee: 'Ocean Basket', amountCents: 62000 },
  // Nedbank Claims — business (4 per month)
  {
    envelopeId: KRUGER_ENV_IDS.nedbankClaims,
    payee: 'MTN Business',
    amountCents: 89900,
    isBusinessExpense: true,
  },
  {
    envelopeId: KRUGER_ENV_IDS.nedbankClaims,
    payee: 'Takealot Office Supplies',
    amountCents: 125000,
    isBusinessExpense: true,
  },
  {
    envelopeId: KRUGER_ENV_IDS.nedbankClaims,
    payee: 'Uber Business Travel',
    amountCents: 45000,
    isBusinessExpense: true,
  },
  // Varying business txn amounts per month
  {
    envelopeId: KRUGER_ENV_IDS.nedbankClaims,
    payee: 'Client Lunch - Kream',
    amountCents: 78000,
    isBusinessExpense: true,
  },
  // Savings deposits (2 per month)
  {
    envelopeId: KRUGER_ENV_IDS.emergencyFund,
    payee: 'Transfer to Emergency Fund',
    amountCents: 150000,
  },
  {
    envelopeId: KRUGER_ENV_IDS.sinkingFundHoliday,
    payee: 'Transfer to Holiday Fund',
    amountCents: 200000,
  },
  // Extra grocery top-up (1 per month)
  { envelopeId: KRUGER_ENV_IDS.groceries, payee: 'Food Lovers Market', amountCents: 78500 },
];

function buildKrugerTransactions(): TransactionEntity[] {
  const txns: TransactionEntity[] = [];
  for (let m = 1; m <= 6; m++) {
    const days = KRUGER_DAYS[m - 1];
    for (let i = 0; i < 20; i++) {
      const tpl = KRUGER_TX_TEMPLATES[i];
      const variation = Math.round(tpl.amountCents * (0.92 + ((m * 7 + i * 13) % 17) / 100));
      txns.push(
        buildTransaction({
          id: txId('kr'),
          householdId: HOUSEHOLD_IDS.kruger,
          envelopeId: tpl.envelopeId,
          payee: tpl.payee,
          amountCents: variation,
          transactionDate: dateStr(m, days[i]),
          isBusinessExpense: tpl.isBusinessExpense ?? false,
        }),
      );
    }
  }
  return txns;
}

// ═══════════════════════════════════════════════════════════════════════════════
// HETZEL TRANSACTIONS -- ~13 per month × 6 months ≈ 80 (78 + 2 extras)
// ═══════════════════════════════════════════════════════════════════════════════

const HETZEL_TX_TEMPLATES: TxTemplate[] = [
  // Groceries (4 per month)
  { envelopeId: HETZEL_ENV_IDS.groceries, payee: 'Checkers Bloemfontein', amountCents: 155000 },
  { envelopeId: HETZEL_ENV_IDS.groceries, payee: 'Pick n Pay Mimosa', amountCents: 125000 },
  { envelopeId: HETZEL_ENV_IDS.groceries, payee: 'Woolworths Loch Logan', amountCents: 85000 },
  { envelopeId: HETZEL_ENV_IDS.groceries, payee: 'Spar Langenhoven', amountCents: 72000 },
  // Fuel (2 per month)
  { envelopeId: HETZEL_ENV_IDS.fuel, payee: 'Engen N1 Bloem', amountCents: 95000 },
  { envelopeId: HETZEL_ENV_IDS.fuel, payee: 'Caltex Second Ave', amountCents: 82000 },
  // School Fees (1 per month — debit order)
  { envelopeId: HETZEL_ENV_IDS.schoolFees, payee: 'Grey College', amountCents: 450000 },
  // Utilities (1 per month)
  { envelopeId: HETZEL_ENV_IDS.utilities, payee: 'Centlec Electricity', amountCents: 120000 },
  // Entertainment (2 per month)
  { envelopeId: HETZEL_ENV_IDS.entertainment, payee: 'Mimosa Mall Cinema', amountCents: 28000 },
  { envelopeId: HETZEL_ENV_IDS.entertainment, payee: 'Primi Piatti', amountCents: 45000 },
  // Savings (1 per month)
  {
    envelopeId: HETZEL_ENV_IDS.emergencyFund,
    payee: 'Transfer to Emergency Fund',
    amountCents: 100000,
  },
  // Extra utilities/groceries (2 per month)
  { envelopeId: HETZEL_ENV_IDS.utilities, payee: 'Bloem Water', amountCents: 65000 },
  { envelopeId: HETZEL_ENV_IDS.groceries, payee: 'Fruit & Veg City', amountCents: 48000 },
];

function buildHetzelTransactions(): TransactionEntity[] {
  const txns: TransactionEntity[] = [];
  for (let m = 1; m <= 6; m++) {
    const days = HETZEL_DAYS[m - 1];
    for (let i = 0; i < 13; i++) {
      const tpl = HETZEL_TX_TEMPLATES[i];
      const variation = Math.round(tpl.amountCents * (0.93 + ((m * 5 + i * 11) % 15) / 100));
      txns.push(
        buildTransaction({
          id: txId('hz'),
          householdId: HOUSEHOLD_IDS.hetzel,
          envelopeId: tpl.envelopeId,
          payee: tpl.payee,
          amountCents: variation,
          transactionDate: dateStr(m, days[i]),
          isBusinessExpense: false,
        }),
      );
    }
  }
  // 2 extra transactions to hit exactly 80
  txns.push(
    buildTransaction({
      id: txId('hz'),
      householdId: HOUSEHOLD_IDS.hetzel,
      envelopeId: HETZEL_ENV_IDS.groceries,
      payee: 'Shoprite Langenhoven Park',
      amountCents: 98500,
      transactionDate: '2026-03-15',
      isBusinessExpense: false,
    }),
    buildTransaction({
      id: txId('hz'),
      householdId: HOUSEHOLD_IDS.hetzel,
      envelopeId: HETZEL_ENV_IDS.entertainment,
      payee: 'Loch Logan Waterfront',
      amountCents: 35000,
      transactionDate: '2026-05-20',
      isBusinessExpense: false,
    }),
  );
  return txns;
}

export const KRUGER_TRANSACTIONS: TransactionEntity[] = buildKrugerTransactions();
export const HETZEL_TRANSACTIONS: TransactionEntity[] = buildHetzelTransactions();

// ═══════════════════════════════════════════════════════════════════════════════
// METER READINGS  (6 monthly readings each for elec + water per household)
// ═══════════════════════════════════════════════════════════════════════════════

function buildReadingSet(
  householdId: string,
  prefix: string,
  meterType: 'electricity' | 'water',
  baseValues: number[],
  costs: number[],
): MeterReadingEntity[] {
  return baseValues.map((val, i) =>
    buildMeterReading({
      id: `m${prefix}-${meterType.slice(0, 4)}-0000-0000-${(i + 1).toString().padStart(12, '0')}`,
      householdId,
      meterType,
      readingValue: val,
      readingDate: dateStr(i + 1, 28),
      costCents: costs[i],
    }),
  );
}

// Kruger electricity: ~450 kWh/mo, month 4 spike (anomaly > 20%)
const krugerElecValues = [452, 438, 461, 620, 448, 455];
const krugerElecCosts = [135600, 131400, 138300, 186000, 134400, 136500];

// Kruger water: ~22 kL/mo, month 5 spike (anomaly > 20%)
const krugerWaterValues = [22, 21, 23, 20, 30, 22];
const krugerWaterCosts = [55000, 52500, 57500, 50000, 75000, 55000];

// Hetzel electricity: ~380 kWh/mo, month 2 spike (anomaly > 20%)
const hetzelElecValues = [375, 510, 382, 388, 370, 385];
const hetzelElecCosts = [112500, 153000, 114600, 116400, 111000, 115500];

// Hetzel water: ~18 kL/mo, month 6 spike (anomaly > 20%)
const hetzelWaterValues = [18, 17, 19, 18, 17, 25];
const hetzelWaterCosts = [45000, 42500, 47500, 45000, 42500, 62500];

export const KRUGER_METER_READINGS: MeterReadingEntity[] = [
  ...buildReadingSet(HOUSEHOLD_IDS.kruger, 'kr', 'electricity', krugerElecValues, krugerElecCosts),
  ...buildReadingSet(HOUSEHOLD_IDS.kruger, 'kr', 'water', krugerWaterValues, krugerWaterCosts),
];

export const HETZEL_METER_READINGS: MeterReadingEntity[] = [
  ...buildReadingSet(HOUSEHOLD_IDS.hetzel, 'hz', 'electricity', hetzelElecValues, hetzelElecCosts),
  ...buildReadingSet(HOUSEHOLD_IDS.hetzel, 'hz', 'water', hetzelWaterValues, hetzelWaterCosts),
];

// ═══════════════════════════════════════════════════════════════════════════════
// SNOWBALL PAYMENTS (3 months Kruger, 2 months Hetzel)
// ═══════════════════════════════════════════════════════════════════════════════

export const SNOWBALL_PAYMENTS: SnowballPayment[] = [
  // Kruger — Jan minimum payments on all debts
  {
    debtId: KRUGER_DEBT_IDS.woolworths,
    householdId: HOUSEHOLD_IDS.kruger,
    paymentAmountCents: 15000,
    paymentDate: '2026-01-25',
  },
  {
    debtId: KRUGER_DEBT_IDS.nedbank,
    householdId: HOUSEHOLD_IDS.kruger,
    paymentAmountCents: 25000,
    paymentDate: '2026-01-25',
  },
  {
    debtId: KRUGER_DEBT_IDS.capitec,
    householdId: HOUSEHOLD_IDS.kruger,
    paymentAmountCents: 150000,
    paymentDate: '2026-01-25',
  },
  {
    debtId: KRUGER_DEBT_IDS.wesbank,
    householdId: HOUSEHOLD_IDS.kruger,
    paymentAmountCents: 380000,
    paymentDate: '2026-01-25',
  },
  {
    debtId: KRUGER_DEBT_IDS.fnb,
    householdId: HOUSEHOLD_IDS.kruger,
    paymentAmountCents: 1250000,
    paymentDate: '2026-01-25',
  },
  // Kruger — Feb (extra R500 snowball to Woolworths)
  {
    debtId: KRUGER_DEBT_IDS.woolworths,
    householdId: HOUSEHOLD_IDS.kruger,
    paymentAmountCents: 65000,
    paymentDate: '2026-02-25',
  },
  {
    debtId: KRUGER_DEBT_IDS.nedbank,
    householdId: HOUSEHOLD_IDS.kruger,
    paymentAmountCents: 25000,
    paymentDate: '2026-02-25',
  },
  {
    debtId: KRUGER_DEBT_IDS.capitec,
    householdId: HOUSEHOLD_IDS.kruger,
    paymentAmountCents: 150000,
    paymentDate: '2026-02-25',
  },
  {
    debtId: KRUGER_DEBT_IDS.wesbank,
    householdId: HOUSEHOLD_IDS.kruger,
    paymentAmountCents: 380000,
    paymentDate: '2026-02-25',
  },
  {
    debtId: KRUGER_DEBT_IDS.fnb,
    householdId: HOUSEHOLD_IDS.kruger,
    paymentAmountCents: 1250000,
    paymentDate: '2026-02-25',
  },
  // Kruger — Mar (extra R500 snowball to Woolworths)
  {
    debtId: KRUGER_DEBT_IDS.woolworths,
    householdId: HOUSEHOLD_IDS.kruger,
    paymentAmountCents: 65000,
    paymentDate: '2026-03-25',
  },
  {
    debtId: KRUGER_DEBT_IDS.nedbank,
    householdId: HOUSEHOLD_IDS.kruger,
    paymentAmountCents: 25000,
    paymentDate: '2026-03-25',
  },
  {
    debtId: KRUGER_DEBT_IDS.capitec,
    householdId: HOUSEHOLD_IDS.kruger,
    paymentAmountCents: 150000,
    paymentDate: '2026-03-25',
  },
  {
    debtId: KRUGER_DEBT_IDS.wesbank,
    householdId: HOUSEHOLD_IDS.kruger,
    paymentAmountCents: 380000,
    paymentDate: '2026-03-25',
  },
  {
    debtId: KRUGER_DEBT_IDS.fnb,
    householdId: HOUSEHOLD_IDS.kruger,
    paymentAmountCents: 1250000,
    paymentDate: '2026-03-25',
  },
  // Hetzel — Jan minimum payments
  {
    debtId: HETZEL_DEBT_IDS.edgars,
    householdId: HOUSEHOLD_IDS.hetzel,
    paymentAmountCents: 10000,
    paymentDate: '2026-01-05',
  },
  {
    debtId: HETZEL_DEBT_IDS.standardBank,
    householdId: HOUSEHOLD_IDS.hetzel,
    paymentAmountCents: 35000,
    paymentDate: '2026-01-05',
  },
  // Hetzel — Feb (extra R200 snowball to Edgars)
  {
    debtId: HETZEL_DEBT_IDS.edgars,
    householdId: HOUSEHOLD_IDS.hetzel,
    paymentAmountCents: 30000,
    paymentDate: '2026-02-05',
  },
  {
    debtId: HETZEL_DEBT_IDS.standardBank,
    householdId: HOUSEHOLD_IDS.hetzel,
    paymentAmountCents: 35000,
    paymentDate: '2026-02-05',
  },
];
