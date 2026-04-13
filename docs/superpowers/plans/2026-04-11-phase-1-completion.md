# Phase 1 Completion: Meters + Debt Snowball + Scoring & Notifications

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete all three remaining placeholder tabs (Meters, Debt Snowball, Settings) with full domain logic, hooks, screens, and local push notifications — shipping as one branch and one PR.

**Architecture:** Domain layer first (TDD), then infrastructure, then hooks, then navigation, then screens. Each feature follows the same layering: pure TypeScript domain classes → Drizzle hooks → react-native-paper screens. Two new columns on the `debts` table require a Drizzle migration. Notification preferences persist in AsyncStorage; `expo-notifications` (already installed) handles scheduling. A Ramsey Score badge is added to the existing Dashboard.

**Tech Stack:** Drizzle ORM (expo-sqlite), Zustand, React Navigation (native stack + bottom tabs), react-native-paper, date-fns, expo-notifications, @react-native-async-storage/async-storage

---

## File Structure

**New files — Domain:**
- `src/domain/meterReadings/MeterReadingEntity.ts`
- `src/domain/meterReadings/LogMeterReadingUseCase.ts`
- `src/domain/meterReadings/UnitRateCalculator.ts`
- `src/domain/meterReadings/AnomalyDetector.ts`
- `src/domain/meterReadings/__tests__/MeterReadingEntity.test.ts`
- `src/domain/meterReadings/__tests__/LogMeterReadingUseCase.test.ts`
- `src/domain/meterReadings/__tests__/UnitRateCalculator.test.ts`
- `src/domain/meterReadings/__tests__/AnomalyDetector.test.ts`
- `src/domain/debtSnowball/DebtEntity.ts`
- `src/domain/debtSnowball/CreateDebtUseCase.ts`
- `src/domain/debtSnowball/LogDebtPaymentUseCase.ts`
- `src/domain/debtSnowball/SnowballPayoffProjector.ts`
- `src/domain/debtSnowball/__tests__/DebtEntity.test.ts`
- `src/domain/debtSnowball/__tests__/CreateDebtUseCase.test.ts`
- `src/domain/debtSnowball/__tests__/LogDebtPaymentUseCase.test.ts`
- `src/domain/debtSnowball/__tests__/SnowballPayoffProjector.test.ts`
- `src/domain/scoring/RamseyScoreCalculator.ts`
- `src/domain/scoring/LevelAdvancementEvaluator.ts`
- `src/domain/scoring/__tests__/RamseyScoreCalculator.test.ts`
- `src/domain/scoring/__tests__/LevelAdvancementEvaluator.test.ts`

**New files — Infrastructure:**
- `src/infrastructure/notifications/NotificationPreferences.ts`
- `src/infrastructure/notifications/NotificationPreferencesRepository.ts`
- `src/infrastructure/notifications/LocalNotificationScheduler.ts`
- `src/infrastructure/notifications/__tests__/LocalNotificationScheduler.test.ts`

**New files — Presentation (stores/hooks):**
- `src/presentation/stores/notificationStore.ts`
- `src/presentation/hooks/useMeterReadings.ts`
- `src/presentation/hooks/useDebts.ts`

**New files — Navigation:**
- `src/presentation/navigation/MetersStackNavigator.tsx`
- `src/presentation/navigation/SnowballStackNavigator.tsx`

**New files — Screens (Meters):**
- `src/presentation/screens/meters/components/MeterReadingCard.tsx`
- `src/presentation/screens/meters/MeterDashboardScreen.tsx`
- `src/presentation/screens/meters/AddReadingScreen.tsx`
- `src/presentation/screens/meters/RateHistoryScreen.tsx`

**New files — Screens (Debt Snowball):**
- `src/presentation/screens/debtSnowball/components/DebtPayoffBar.tsx`
- `src/presentation/screens/debtSnowball/components/PayoffProjectionCard.tsx`
- `src/presentation/screens/debtSnowball/SnowballDashboardScreen.tsx`
- `src/presentation/screens/debtSnowball/AddDebtScreen.tsx`
- `src/presentation/screens/debtSnowball/DebtDetailScreen.tsx`
- `src/presentation/screens/debtSnowball/LogPaymentScreen.tsx`

**New files — Screens (Settings):**
- `src/presentation/screens/settings/SettingsStackNavigator.tsx`
- `src/presentation/screens/settings/SettingsScreen.tsx`
- `src/presentation/screens/settings/NotificationPreferencesScreen.tsx`

**New files — Screens (Dashboard update):**
- `src/presentation/screens/dashboard/components/RamseyScoreBadge.tsx`

**Modified files:**
- `src/data/local/schema/debts.ts` — add `initialBalanceCents` and `totalPaidCents` columns
- `src/presentation/navigation/types.ts` — add `MetersStackParamList`, `SnowballStackParamList`, `SettingsStackParamList` + screen props
- `src/presentation/navigation/MainTabNavigator.tsx` — wire all three real stack navigators
- `src/presentation/navigation/RootNavigator.tsx` — notification permissions + scheduling on auth
- `src/presentation/screens/dashboard/DashboardScreen.tsx` — add RamseyScoreBadge to header

**Schema already exists** (Sprint 0): `src/data/local/schema/meterReadings.ts`

**Migration required** after schema change: `npx drizzle-kit generate`

---

### Task 1: Update debts schema + generate migration + install AsyncStorage

**Files:**
- Modify: `src/data/local/schema/debts.ts`
- Run: `npx drizzle-kit generate` (creates new migration file)
- Run: `npx expo install @react-native-async-storage/async-storage`

The existing `debts` table needs `initialBalanceCents` (set at creation, never changes) and `totalPaidCents` (incremented with each payment) for the payoff progress bar. AsyncStorage is needed for notification preferences persistence.

- [ ] **Step 1: Update the schema file**

Replace `src/data/local/schema/debts.ts` with:

```typescript
import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

export const debts = sqliteTable('debts', {
  id: text('id').primaryKey(),
  householdId: text('household_id').notNull(),
  creditorName: text('creditor_name').notNull(),
  debtType: text('debt_type').notNull(),
  // 'credit_card' | 'personal_loan' | 'store_account' | 'vehicle_finance' | 'bond'
  outstandingBalanceCents: integer('outstanding_balance_cents').notNull(),
  initialBalanceCents: integer('initial_balance_cents').notNull().default(0),
  interestRatePercent: real('interest_rate_percent').notNull(),
  minimumPaymentCents: integer('minimum_payment_cents').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  isPaidOff: integer('is_paid_off', { mode: 'boolean' }).notNull().default(false),
  totalPaidCents: integer('total_paid_cents').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  isSynced: integer('is_synced', { mode: 'boolean' }).notNull().default(false),
});
```

- [ ] **Step 2: Generate the migration**

```
cd C:\Project\AccountingV2 && npx drizzle-kit generate 2>&1 | tail -10
```

Expected: A new SQL file appears in `src/data/local/migrations/` and `migrations.js` is updated.

- [ ] **Step 3: Verify migration file was created**

```
ls src/data/local/migrations/
```

Expected: A new `.sql` file (e.g. `0001_*.sql`) alongside the existing `0000_*.sql`.

- [ ] **Step 4: Install AsyncStorage**

```
cd C:\Project\AccountingV2 && npx expo install @react-native-async-storage/async-storage 2>&1 | tail -5
```

Expected: Package installed (or already present).

- [ ] **Step 5: Commit**

```bash
git add src/data/local/schema/debts.ts src/data/local/migrations/ package.json package-lock.json
git commit -m "chore: add initialBalanceCents/totalPaidCents to debts + install AsyncStorage"
```

---

### Task 2: MeterReadingEntity domain type

**Files:**
- Create: `src/domain/meterReadings/MeterReadingEntity.ts`
- Create: `src/domain/meterReadings/__tests__/MeterReadingEntity.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/domain/meterReadings/__tests__/MeterReadingEntity.test.ts`:

```typescript
import {
  getMeterTypeLabel,
  getMeterUnitLabel,
  getMeterIcon,
  getReadingDisplayDate,
} from '../MeterReadingEntity';
import type { MeterReadingEntity } from '../MeterReadingEntity';

const base: MeterReadingEntity = {
  id: 'm1',
  householdId: 'h1',
  meterType: 'electricity',
  readingValue: 1500,
  readingDate: '2026-04-01',
  costCents: null,
  vehicleId: null,
  notes: null,
  createdAt: '2026-04-01T08:00:00.000Z',
  updatedAt: '2026-04-01T08:00:00.000Z',
  isSynced: false,
};

describe('MeterReadingEntity', () => {
  it('getMeterTypeLabel returns human label for each type', () => {
    expect(getMeterTypeLabel('electricity')).toBe('Electricity');
    expect(getMeterTypeLabel('water')).toBe('Water');
    expect(getMeterTypeLabel('odometer')).toBe('Vehicle');
  });

  it('getMeterUnitLabel returns unit string for each type', () => {
    expect(getMeterUnitLabel('electricity')).toBe('kWh');
    expect(getMeterUnitLabel('water')).toBe('kL');
    expect(getMeterUnitLabel('odometer')).toBe('km');
  });

  it('getMeterIcon returns a non-empty string for each type', () => {
    expect(getMeterIcon('electricity').length).toBeGreaterThan(0);
    expect(getMeterIcon('water').length).toBeGreaterThan(0);
    expect(getMeterIcon('odometer').length).toBeGreaterThan(0);
  });

  it('getReadingDisplayDate formats date as "d MMM yyyy"', () => {
    expect(getReadingDisplayDate(base)).toBe('1 Apr 2026');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
cd C:\Project\AccountingV2 && npx jest src/domain/meterReadings/__tests__/MeterReadingEntity.test.ts --no-coverage 2>&1 | tail -10
```

Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

Create `src/domain/meterReadings/MeterReadingEntity.ts`:

```typescript
import { format, parseISO } from 'date-fns';

export type MeterType = 'electricity' | 'water' | 'odometer';

export interface MeterReadingEntity {
  id: string;
  householdId: string;
  meterType: MeterType;
  readingValue: number;      // kWh, kL, or km
  readingDate: string;       // ISO date YYYY-MM-DD
  costCents: number | null;  // cost associated with this billing period
  vehicleId: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  isSynced: boolean;
}

export function getMeterTypeLabel(meterType: MeterType): string {
  const labels: Record<MeterType, string> = {
    electricity: 'Electricity',
    water: 'Water',
    odometer: 'Vehicle',
  };
  return labels[meterType];
}

export function getMeterUnitLabel(meterType: MeterType): string {
  const units: Record<MeterType, string> = {
    electricity: 'kWh',
    water: 'kL',
    odometer: 'km',
  };
  return units[meterType];
}

export function getMeterIcon(meterType: MeterType): string {
  const icons: Record<MeterType, string> = {
    electricity: 'lightning-bolt',
    water: 'water',
    odometer: 'car',
  };
  return icons[meterType];
}

export function getReadingDisplayDate(reading: MeterReadingEntity): string {
  return format(parseISO(reading.readingDate), 'd MMM yyyy');
}
```

- [ ] **Step 4: Run test to verify it passes**

```
cd C:\Project\AccountingV2 && npx jest src/domain/meterReadings/__tests__/MeterReadingEntity.test.ts --no-coverage 2>&1 | tail -10
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/domain/meterReadings/MeterReadingEntity.ts src/domain/meterReadings/__tests__/MeterReadingEntity.test.ts
git commit -m "feat(domain): add MeterReadingEntity type and display helpers"
```

---

### Task 3: LogMeterReadingUseCase

**Files:**
- Create: `src/domain/meterReadings/LogMeterReadingUseCase.ts`
- Create: `src/domain/meterReadings/__tests__/LogMeterReadingUseCase.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/domain/meterReadings/__tests__/LogMeterReadingUseCase.test.ts`:

```typescript
import { LogMeterReadingUseCase } from '../LogMeterReadingUseCase';

jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-meter-1' }));

const mockInsert = jest.fn().mockReturnValue({ values: jest.fn().mockResolvedValue(undefined) });
const mockDb = { insert: mockInsert } as any;
const mockAudit = { log: jest.fn().mockResolvedValue(undefined) } as any;

const input = {
  householdId: 'h1',
  meterType: 'electricity' as const,
  readingValue: 1500,
  readingDate: '2026-04-01',
  costCents: 52500,
  vehicleId: null,
  notes: null,
};

describe('LogMeterReadingUseCase', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns failure when readingValue is 0', async () => {
    const uc = new LogMeterReadingUseCase(mockDb, mockAudit, { ...input, readingValue: 0 });
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_READING');
  });

  it('returns failure when readingValue is negative', async () => {
    const uc = new LogMeterReadingUseCase(mockDb, mockAudit, { ...input, readingValue: -10 });
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_READING');
  });

  it('inserts reading and logs audit on success', async () => {
    const uc = new LogMeterReadingUseCase(mockDb, mockAudit, input);
    const result = await uc.execute();
    expect(result.success).toBe(true);
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockAudit.log).toHaveBeenCalledTimes(1);
  });

  it('returns entity with correct id and fields', async () => {
    const uc = new LogMeterReadingUseCase(mockDb, mockAudit, input);
    const result = await uc.execute();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('uuid-meter-1');
      expect(result.data.meterType).toBe('electricity');
      expect(result.data.readingValue).toBe(1500);
      expect(result.data.costCents).toBe(52500);
      expect(result.data.isSynced).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
cd C:\Project\AccountingV2 && npx jest src/domain/meterReadings/__tests__/LogMeterReadingUseCase.test.ts --no-coverage 2>&1 | tail -10
```

Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

Create `src/domain/meterReadings/LogMeterReadingUseCase.ts`:

```typescript
import { randomUUID } from 'expo-crypto';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import { meterReadings } from '../../data/local/schema';
import type { AuditLogger } from '../../data/audit/AuditLogger';
import type { Result } from '../shared/types';
import { createSuccess, createFailure } from '../shared/types';
import type { MeterReadingEntity, MeterType } from './MeterReadingEntity';

export interface LogMeterReadingInput {
  householdId: string;
  meterType: MeterType;
  readingValue: number;
  readingDate: string; // YYYY-MM-DD
  costCents: number | null;
  vehicleId: string | null;
  notes: string | null;
}

export class LogMeterReadingUseCase {
  constructor(
    private readonly db: ExpoSQLiteDatabase<typeof schema>,
    private readonly audit: AuditLogger,
    private readonly input: LogMeterReadingInput,
  ) {}

  async execute(): Promise<Result<MeterReadingEntity>> {
    if (this.input.readingValue <= 0) {
      return createFailure({ code: 'INVALID_READING', message: 'Reading value must be greater than zero' });
    }

    const now = new Date().toISOString();
    const id = randomUUID();

    const reading: MeterReadingEntity = {
      id,
      householdId: this.input.householdId,
      meterType: this.input.meterType,
      readingValue: this.input.readingValue,
      readingDate: this.input.readingDate,
      costCents: this.input.costCents,
      vehicleId: this.input.vehicleId,
      notes: this.input.notes,
      createdAt: now,
      updatedAt: now,
      isSynced: false,
    };

    await this.db.insert(meterReadings).values(reading);

    await this.audit.log({
      householdId: this.input.householdId,
      entityType: 'meter_reading',
      entityId: id,
      action: 'create',
      previousValue: null,
      newValue: {
        id,
        meterType: this.input.meterType,
        readingValue: this.input.readingValue,
        readingDate: this.input.readingDate,
      },
    });

    return createSuccess(reading);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```
cd C:\Project\AccountingV2 && npx jest src/domain/meterReadings/__tests__/LogMeterReadingUseCase.test.ts --no-coverage 2>&1 | tail -10
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/domain/meterReadings/LogMeterReadingUseCase.ts src/domain/meterReadings/__tests__/LogMeterReadingUseCase.test.ts
git commit -m "feat(domain): add LogMeterReadingUseCase with validation and audit"
```

---

### Task 4: UnitRateCalculator

**Files:**
- Create: `src/domain/meterReadings/UnitRateCalculator.ts`
- Create: `src/domain/meterReadings/__tests__/UnitRateCalculator.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/domain/meterReadings/__tests__/UnitRateCalculator.test.ts`:

```typescript
import { UnitRateCalculator } from '../UnitRateCalculator';
import type { MeterReadingEntity } from '../MeterReadingEntity';

function makeReading(value: number, costCents: number | null, type: 'electricity' | 'water' | 'odometer' = 'electricity'): MeterReadingEntity {
  return {
    id: 'r1',
    householdId: 'h1',
    meterType: type,
    readingValue: value,
    readingDate: '2026-04-01',
    costCents,
    vehicleId: null,
    notes: null,
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
    isSynced: false,
  };
}

describe('UnitRateCalculator', () => {
  const calculator = new UnitRateCalculator();

  it('returns TYPE_MISMATCH when meter types differ', () => {
    const result = calculator.calculate(makeReading(1200, 500, 'electricity'), makeReading(1000, null, 'water'));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('TYPE_MISMATCH');
  });

  it('returns INVALID_CONSUMPTION when current <= previous', () => {
    const result = calculator.calculate(makeReading(900, 500), makeReading(1000, null));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_CONSUMPTION');
  });

  it('returns INVALID_CONSUMPTION when readings are equal', () => {
    const result = calculator.calculate(makeReading(1000, 500), makeReading(1000, null));
    expect(result.success).toBe(false);
  });

  it('calculates correct consumption and unit rate', () => {
    // 200 kWh used, R525.00 cost → R2.625/kWh → 263 cents/kWh (rounded)
    const result = calculator.calculate(makeReading(1200, 52500), makeReading(1000, null));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.consumptionUnits).toBe(200);
      expect(result.data.costCents).toBe(52500);
      expect(result.data.unitRateCents).toBe(263);
    }
  });

  it('returns unitRateCents 0 when no cost provided', () => {
    const result = calculator.calculate(makeReading(1200, null), makeReading(1000, null));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.unitRateCents).toBe(0);
      expect(result.data.consumptionUnits).toBe(200);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
cd C:\Project\AccountingV2 && npx jest src/domain/meterReadings/__tests__/UnitRateCalculator.test.ts --no-coverage 2>&1 | tail -10
```

Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

Create `src/domain/meterReadings/UnitRateCalculator.ts`:

```typescript
import type { Result } from '../shared/types';
import { createSuccess, createFailure } from '../shared/types';
import type { MeterReadingEntity } from './MeterReadingEntity';

export interface RateCalculationResult {
  consumptionUnits: number;  // kWh, kL, or km consumed between readings
  unitRateCents: number;     // cents per unit (0 if no cost provided)
  costCents: number;
}

export class UnitRateCalculator {
  calculate(current: MeterReadingEntity, previous: MeterReadingEntity): Result<RateCalculationResult> {
    if (current.meterType !== previous.meterType) {
      return createFailure({ code: 'TYPE_MISMATCH', message: 'Both readings must be the same meter type' });
    }
    const consumptionUnits = current.readingValue - previous.readingValue;
    if (consumptionUnits <= 0) {
      return createFailure({ code: 'INVALID_CONSUMPTION', message: 'Current reading must exceed the previous reading' });
    }
    const costCents = current.costCents ?? 0;
    const unitRateCents = costCents > 0 ? Math.round(costCents / consumptionUnits) : 0;
    return createSuccess({ consumptionUnits, unitRateCents, costCents });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```
cd C:\Project\AccountingV2 && npx jest src/domain/meterReadings/__tests__/UnitRateCalculator.test.ts --no-coverage 2>&1 | tail -10
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/domain/meterReadings/UnitRateCalculator.ts src/domain/meterReadings/__tests__/UnitRateCalculator.test.ts
git commit -m "feat(domain): add UnitRateCalculator for meter cost-per-unit"
```

---

### Task 5: AnomalyDetector

**Files:**
- Create: `src/domain/meterReadings/AnomalyDetector.ts`
- Create: `src/domain/meterReadings/__tests__/AnomalyDetector.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/domain/meterReadings/__tests__/AnomalyDetector.test.ts`:

```typescript
import { AnomalyDetector } from '../AnomalyDetector';
import type { MeterReadingEntity } from '../MeterReadingEntity';

function makeReading(value: number, date: string): MeterReadingEntity {
  return {
    id: date,
    householdId: 'h1',
    meterType: 'electricity',
    readingValue: value,
    readingDate: date,
    costCents: null,
    vehicleId: null,
    notes: null,
    createdAt: `${date}T00:00:00.000Z`,
    updatedAt: `${date}T00:00:00.000Z`,
    isSynced: false,
  };
}

describe('AnomalyDetector', () => {
  const detector = new AnomalyDetector();

  it('returns isAnomaly false when fewer than 3 prior readings', () => {
    const current = makeReading(1200, '2026-04-01');
    const prior = [makeReading(1000, '2026-03-01'), makeReading(1100, '2026-02-01')];
    const result = detector.detect(current, prior);
    expect(result.isAnomaly).toBe(false);
  });

  it('returns isAnomaly false when consumption is within 20% of average', () => {
    // Rolling average consumption: 100, 100, 100 = 100. Current: 115 = 15% above → no anomaly
    const prior = [
      makeReading(1000, '2026-01-01'),
      makeReading(1100, '2026-02-01'),
      makeReading(1200, '2026-03-01'),
      makeReading(1300, '2026-04-01'),
    ];
    const current = makeReading(1415, '2026-05-01'); // 115 units consumed
    const result = detector.detect(current, prior);
    expect(result.isAnomaly).toBe(false);
    expect(result.currentConsumption).toBe(115);
  });

  it('returns isAnomaly true when consumption exceeds 20% above average', () => {
    // Rolling average: 100. Current: 150 = 50% above → anomaly
    const prior = [
      makeReading(1000, '2026-01-01'),
      makeReading(1100, '2026-02-01'),
      makeReading(1200, '2026-03-01'),
      makeReading(1300, '2026-04-01'),
    ];
    const current = makeReading(1450, '2026-05-01'); // 150 units consumed
    const result = detector.detect(current, prior);
    expect(result.isAnomaly).toBe(true);
    expect(result.currentConsumption).toBe(150);
    expect(result.rollingAverageConsumption).toBe(100);
    expect(result.deviationPercent).toBeCloseTo(0.5);
  });

  it('returns isAnomaly true when consumption is more than 20% below average', () => {
    // Rolling average: 100. Current: 50 = 50% below → anomaly
    const prior = [
      makeReading(1000, '2026-01-01'),
      makeReading(1100, '2026-02-01'),
      makeReading(1200, '2026-03-01'),
      makeReading(1300, '2026-04-01'),
    ];
    const current = makeReading(1350, '2026-05-01'); // 50 units consumed
    const result = detector.detect(current, prior);
    expect(result.isAnomaly).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
cd C:\Project\AccountingV2 && npx jest src/domain/meterReadings/__tests__/AnomalyDetector.test.ts --no-coverage 2>&1 | tail -10
```

Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

Create `src/domain/meterReadings/AnomalyDetector.ts`:

```typescript
import type { MeterReadingEntity } from './MeterReadingEntity';

export interface AnomalyResult {
  isAnomaly: boolean;
  currentConsumption: number;
  rollingAverageConsumption: number;
  deviationPercent: number; // e.g. 0.5 = 50% deviation
}

export class AnomalyDetector {
  private static readonly THRESHOLD = 0.20;

  /**
   * Detects if currentReading deviates >20% from the 3-month rolling average.
   * previousReadings must contain at least 3 entries (ordered oldest→newest).
   * Fewer than 3 prior readings always returns isAnomaly: false.
   */
  detect(current: MeterReadingEntity, previousReadings: MeterReadingEntity[]): AnomalyResult {
    const sorted = [...previousReadings].sort((a, b) => a.readingDate.localeCompare(b.readingDate));

    if (sorted.length < 3) {
      return { isAnomaly: false, currentConsumption: 0, rollingAverageConsumption: 0, deviationPercent: 0 };
    }

    // Compute sequential consumption deltas from prior readings
    const deltas: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      deltas.push(sorted[i].readingValue - sorted[i - 1].readingValue);
    }
    const lastThreeDeltas = deltas.slice(-3);
    const rollingAverageConsumption =
      lastThreeDeltas.reduce((sum, d) => sum + d, 0) / lastThreeDeltas.length;

    const lastPrior = sorted[sorted.length - 1];
    const currentConsumption = current.readingValue - lastPrior.readingValue;

    if (rollingAverageConsumption <= 0 || currentConsumption <= 0) {
      return { isAnomaly: false, currentConsumption, rollingAverageConsumption, deviationPercent: 0 };
    }

    const deviationPercent =
      Math.abs(currentConsumption - rollingAverageConsumption) / rollingAverageConsumption;

    return {
      isAnomaly: deviationPercent > AnomalyDetector.THRESHOLD,
      currentConsumption,
      rollingAverageConsumption,
      deviationPercent,
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```
cd C:\Project\AccountingV2 && npx jest src/domain/meterReadings/__tests__/AnomalyDetector.test.ts --no-coverage 2>&1 | tail -10
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/domain/meterReadings/AnomalyDetector.ts src/domain/meterReadings/__tests__/AnomalyDetector.test.ts
git commit -m "feat(domain): add AnomalyDetector for >20% meter reading deviation"
```

---

### Task 6: DebtEntity domain type

**Files:**
- Create: `src/domain/debtSnowball/DebtEntity.ts`
- Create: `src/domain/debtSnowball/__tests__/DebtEntity.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/domain/debtSnowball/__tests__/DebtEntity.test.ts`:

```typescript
import { getDebtTypeLabel, getPayoffProgressPercent } from '../DebtEntity';
import type { DebtEntity } from '../DebtEntity';

const base: DebtEntity = {
  id: 'd1',
  householdId: 'h1',
  creditorName: 'FNB Credit Card',
  debtType: 'credit_card',
  outstandingBalanceCents: 75000,
  initialBalanceCents: 100000,
  interestRatePercent: 22.5,
  minimumPaymentCents: 2500,
  sortOrder: 0,
  isPaidOff: false,
  totalPaidCents: 25000,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-04-01T00:00:00.000Z',
  isSynced: false,
};

describe('DebtEntity', () => {
  it('getDebtTypeLabel returns human label for each type', () => {
    expect(getDebtTypeLabel('credit_card')).toBe('Credit Card');
    expect(getDebtTypeLabel('personal_loan')).toBe('Personal Loan');
    expect(getDebtTypeLabel('store_account')).toBe('Store Account');
    expect(getDebtTypeLabel('vehicle_finance')).toBe('Vehicle Finance');
    expect(getDebtTypeLabel('bond')).toBe('Home Bond');
  });

  it('getPayoffProgressPercent returns correct percentage', () => {
    // R250 paid of R1000 initial = 25%
    expect(getPayoffProgressPercent(base)).toBe(25);
  });

  it('getPayoffProgressPercent returns 100 when fully paid off', () => {
    const paid = { ...base, outstandingBalanceCents: 0, totalPaidCents: 100000, isPaidOff: true };
    expect(getPayoffProgressPercent(paid)).toBe(100);
  });

  it('getPayoffProgressPercent returns 0 when no payments made', () => {
    const fresh = { ...base, totalPaidCents: 0, outstandingBalanceCents: 100000 };
    expect(getPayoffProgressPercent(fresh)).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
cd C:\Project\AccountingV2 && npx jest src/domain/debtSnowball/__tests__/DebtEntity.test.ts --no-coverage 2>&1 | tail -10
```

Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

Create `src/domain/debtSnowball/DebtEntity.ts`:

```typescript
export type DebtType =
  | 'credit_card'
  | 'personal_loan'
  | 'store_account'
  | 'vehicle_finance'
  | 'bond';

export interface DebtEntity {
  id: string;
  householdId: string;
  creditorName: string;
  debtType: DebtType;
  outstandingBalanceCents: number;
  initialBalanceCents: number;   // balance at creation — never changes
  interestRatePercent: number;
  minimumPaymentCents: number;
  sortOrder: number;             // 0 = smallest balance first (Ramsey default)
  isPaidOff: boolean;
  totalPaidCents: number;        // running total of all payments
  createdAt: string;
  updatedAt: string;
  isSynced: boolean;
}

export function getDebtTypeLabel(debtType: DebtType): string {
  const labels: Record<DebtType, string> = {
    credit_card: 'Credit Card',
    personal_loan: 'Personal Loan',
    store_account: 'Store Account',
    vehicle_finance: 'Vehicle Finance',
    bond: 'Home Bond',
  };
  return labels[debtType];
}

/** Returns 0–100. Based on totalPaidCents / initialBalanceCents. */
export function getPayoffProgressPercent(debt: DebtEntity): number {
  if (debt.initialBalanceCents <= 0) return 0;
  return Math.min(100, Math.round((debt.totalPaidCents / debt.initialBalanceCents) * 100));
}
```

- [ ] **Step 4: Run test to verify it passes**

```
cd C:\Project\AccountingV2 && npx jest src/domain/debtSnowball/__tests__/DebtEntity.test.ts --no-coverage 2>&1 | tail -10
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/domain/debtSnowball/DebtEntity.ts src/domain/debtSnowball/__tests__/DebtEntity.test.ts
git commit -m "feat(domain): add DebtEntity type and display helpers"
```

---

### Task 7: CreateDebtUseCase

**Files:**
- Create: `src/domain/debtSnowball/CreateDebtUseCase.ts`
- Create: `src/domain/debtSnowball/__tests__/CreateDebtUseCase.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/domain/debtSnowball/__tests__/CreateDebtUseCase.test.ts`:

```typescript
import { CreateDebtUseCase } from '../CreateDebtUseCase';

jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-debt-1' }));

const mockInsert = jest.fn().mockReturnValue({ values: jest.fn().mockResolvedValue(undefined) });
const mockSelect = jest.fn().mockReturnValue({
  from: jest.fn().mockReturnValue({
    where: jest.fn().mockResolvedValue([{ count: 0 }]),
  }),
});
const mockDb = { insert: mockInsert, select: mockSelect } as any;
const mockAudit = { log: jest.fn().mockResolvedValue(undefined) } as any;

const input = {
  householdId: 'h1',
  creditorName: 'FNB Credit Card',
  debtType: 'credit_card' as const,
  outstandingBalanceCents: 100000,
  interestRatePercent: 22.5,
  minimumPaymentCents: 2500,
};

describe('CreateDebtUseCase', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns INVALID_BALANCE when outstandingBalanceCents is 0', async () => {
    const uc = new CreateDebtUseCase(mockDb, mockAudit, { ...input, outstandingBalanceCents: 0 });
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_BALANCE');
  });

  it('returns INVALID_PAYMENT when minimumPaymentCents is 0', async () => {
    const uc = new CreateDebtUseCase(mockDb, mockAudit, { ...input, minimumPaymentCents: 0 });
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_PAYMENT');
  });

  it('returns INVALID_RATE when interestRatePercent is negative', async () => {
    const uc = new CreateDebtUseCase(mockDb, mockAudit, { ...input, interestRatePercent: -1 });
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_RATE');
  });

  it('inserts debt and logs audit on success', async () => {
    const uc = new CreateDebtUseCase(mockDb, mockAudit, input);
    const result = await uc.execute();
    expect(result.success).toBe(true);
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockAudit.log).toHaveBeenCalledTimes(1);
  });

  it('returns entity with initialBalanceCents equal to outstandingBalanceCents', async () => {
    const uc = new CreateDebtUseCase(mockDb, mockAudit, input);
    const result = await uc.execute();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.initialBalanceCents).toBe(100000);
      expect(result.data.totalPaidCents).toBe(0);
      expect(result.data.isPaidOff).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
cd C:\Project\AccountingV2 && npx jest src/domain/debtSnowball/__tests__/CreateDebtUseCase.test.ts --no-coverage 2>&1 | tail -10
```

Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

Create `src/domain/debtSnowball/CreateDebtUseCase.ts`:

```typescript
import { randomUUID } from 'expo-crypto';
import { count, eq } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import { debts } from '../../data/local/schema';
import type { AuditLogger } from '../../data/audit/AuditLogger';
import type { Result } from '../shared/types';
import { createSuccess, createFailure } from '../shared/types';
import type { DebtEntity, DebtType } from './DebtEntity';

export interface CreateDebtInput {
  householdId: string;
  creditorName: string;
  debtType: DebtType;
  outstandingBalanceCents: number;
  interestRatePercent: number;
  minimumPaymentCents: number;
}

export class CreateDebtUseCase {
  constructor(
    private readonly db: ExpoSQLiteDatabase<typeof schema>,
    private readonly audit: AuditLogger,
    private readonly input: CreateDebtInput,
  ) {}

  async execute(): Promise<Result<DebtEntity>> {
    if (this.input.outstandingBalanceCents <= 0) {
      return createFailure({ code: 'INVALID_BALANCE', message: 'Outstanding balance must be greater than zero' });
    }
    if (this.input.minimumPaymentCents <= 0) {
      return createFailure({ code: 'INVALID_PAYMENT', message: 'Minimum payment must be greater than zero' });
    }
    if (this.input.interestRatePercent < 0) {
      return createFailure({ code: 'INVALID_RATE', message: 'Interest rate cannot be negative' });
    }

    const countResult = await this.db
      .select({ count: count() })
      .from(debts)
      .where(eq(debts.householdId, this.input.householdId));
    const sortOrder = countResult[0]?.count ?? 0;

    const now = new Date().toISOString();
    const id = randomUUID();

    const debt: DebtEntity = {
      id,
      householdId: this.input.householdId,
      creditorName: this.input.creditorName,
      debtType: this.input.debtType,
      outstandingBalanceCents: this.input.outstandingBalanceCents,
      initialBalanceCents: this.input.outstandingBalanceCents,
      interestRatePercent: this.input.interestRatePercent,
      minimumPaymentCents: this.input.minimumPaymentCents,
      sortOrder,
      isPaidOff: false,
      totalPaidCents: 0,
      createdAt: now,
      updatedAt: now,
      isSynced: false,
    };

    await this.db.insert(debts).values(debt);

    await this.audit.log({
      householdId: this.input.householdId,
      entityType: 'debt',
      entityId: id,
      action: 'create',
      previousValue: null,
      newValue: {
        id,
        creditorName: debt.creditorName,
        debtType: debt.debtType,
        outstandingBalanceCents: debt.outstandingBalanceCents,
      },
    });

    return createSuccess(debt);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```
cd C:\Project\AccountingV2 && npx jest src/domain/debtSnowball/__tests__/CreateDebtUseCase.test.ts --no-coverage 2>&1 | tail -10
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/domain/debtSnowball/CreateDebtUseCase.ts src/domain/debtSnowball/__tests__/CreateDebtUseCase.test.ts
git commit -m "feat(domain): add CreateDebtUseCase with validation and audit"
```

---

### Task 8: LogDebtPaymentUseCase

**Files:**
- Create: `src/domain/debtSnowball/LogDebtPaymentUseCase.ts`
- Create: `src/domain/debtSnowball/__tests__/LogDebtPaymentUseCase.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/domain/debtSnowball/__tests__/LogDebtPaymentUseCase.test.ts`:

```typescript
import { LogDebtPaymentUseCase } from '../LogDebtPaymentUseCase';
import type { DebtEntity } from '../DebtEntity';

const mockUpdate = jest.fn().mockReturnValue({
  set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue(undefined) }),
});
const mockDb = { update: mockUpdate } as any;
const mockAudit = { log: jest.fn().mockResolvedValue(undefined) } as any;

const currentDebt: DebtEntity = {
  id: 'd1',
  householdId: 'h1',
  creditorName: 'FNB',
  debtType: 'credit_card',
  outstandingBalanceCents: 100000,
  initialBalanceCents: 100000,
  interestRatePercent: 22.5,
  minimumPaymentCents: 2500,
  sortOrder: 0,
  isPaidOff: false,
  totalPaidCents: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  isSynced: false,
};

describe('LogDebtPaymentUseCase', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns INVALID_PAYMENT when paymentAmountCents is 0', async () => {
    const uc = new LogDebtPaymentUseCase(mockDb, mockAudit, {
      householdId: 'h1',
      debtId: 'd1',
      paymentAmountCents: 0,
      currentDebt,
    });
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_PAYMENT');
  });

  it('decrements outstanding balance and increments totalPaidCents', async () => {
    const uc = new LogDebtPaymentUseCase(mockDb, mockAudit, {
      householdId: 'h1',
      debtId: 'd1',
      paymentAmountCents: 5000,
      currentDebt,
    });
    const result = await uc.execute();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.outstandingBalanceCents).toBe(95000);
      expect(result.data.totalPaidCents).toBe(5000);
      expect(result.data.isPaidOff).toBe(false);
    }
  });

  it('marks debt as isPaidOff when payment covers full balance', async () => {
    const uc = new LogDebtPaymentUseCase(mockDb, mockAudit, {
      householdId: 'h1',
      debtId: 'd1',
      paymentAmountCents: 100000,
      currentDebt,
    });
    const result = await uc.execute();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.outstandingBalanceCents).toBe(0);
      expect(result.data.isPaidOff).toBe(true);
    }
  });

  it('clamps balance to 0 when payment exceeds outstanding', async () => {
    const uc = new LogDebtPaymentUseCase(mockDb, mockAudit, {
      householdId: 'h1',
      debtId: 'd1',
      paymentAmountCents: 200000,
      currentDebt,
    });
    const result = await uc.execute();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.outstandingBalanceCents).toBe(0);
      expect(result.data.isPaidOff).toBe(true);
    }
  });

  it('logs audit with payment details', async () => {
    const uc = new LogDebtPaymentUseCase(mockDb, mockAudit, {
      householdId: 'h1',
      debtId: 'd1',
      paymentAmountCents: 5000,
      currentDebt,
    });
    await uc.execute();
    expect(mockAudit.log).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
cd C:\Project\AccountingV2 && npx jest src/domain/debtSnowball/__tests__/LogDebtPaymentUseCase.test.ts --no-coverage 2>&1 | tail -10
```

Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

Create `src/domain/debtSnowball/LogDebtPaymentUseCase.ts`:

```typescript
import { sql, eq } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import { debts } from '../../data/local/schema';
import type { AuditLogger } from '../../data/audit/AuditLogger';
import type { Result } from '../shared/types';
import { createSuccess, createFailure } from '../shared/types';
import type { DebtEntity } from './DebtEntity';

export interface LogDebtPaymentInput {
  householdId: string;
  debtId: string;
  paymentAmountCents: number;
  currentDebt: DebtEntity;
}

export class LogDebtPaymentUseCase {
  constructor(
    private readonly db: ExpoSQLiteDatabase<typeof schema>,
    private readonly audit: AuditLogger,
    private readonly input: LogDebtPaymentInput,
  ) {}

  async execute(): Promise<Result<DebtEntity>> {
    if (this.input.paymentAmountCents <= 0) {
      return createFailure({ code: 'INVALID_PAYMENT', message: 'Payment amount must be greater than zero' });
    }

    const now = new Date().toISOString();
    const newBalance = Math.max(
      0,
      this.input.currentDebt.outstandingBalanceCents - this.input.paymentAmountCents,
    );
    const isPaidOff = newBalance === 0;

    await this.db
      .update(debts)
      .set({
        outstandingBalanceCents: newBalance,
        totalPaidCents: sql`${debts.totalPaidCents} + ${this.input.paymentAmountCents}`,
        isPaidOff,
        updatedAt: now,
        isSynced: false,
      })
      .where(eq(debts.id, this.input.debtId));

    await this.audit.log({
      householdId: this.input.householdId,
      entityType: 'debt',
      entityId: this.input.debtId,
      action: 'payment',
      previousValue: {
        outstandingBalanceCents: this.input.currentDebt.outstandingBalanceCents,
        totalPaidCents: this.input.currentDebt.totalPaidCents,
      },
      newValue: {
        paymentAmountCents: this.input.paymentAmountCents,
        outstandingBalanceCents: newBalance,
        isPaidOff,
      },
    });

    const updated: DebtEntity = {
      ...this.input.currentDebt,
      outstandingBalanceCents: newBalance,
      totalPaidCents: this.input.currentDebt.totalPaidCents + this.input.paymentAmountCents,
      isPaidOff,
      updatedAt: now,
    };

    return createSuccess(updated);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```
cd C:\Project\AccountingV2 && npx jest src/domain/debtSnowball/__tests__/LogDebtPaymentUseCase.test.ts --no-coverage 2>&1 | tail -10
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/domain/debtSnowball/LogDebtPaymentUseCase.ts src/domain/debtSnowball/__tests__/LogDebtPaymentUseCase.test.ts
git commit -m "feat(domain): add LogDebtPaymentUseCase with balance decrement and paid-off detection"
```

---

### Task 9: SnowballPayoffProjector

**Files:**
- Create: `src/domain/debtSnowball/SnowballPayoffProjector.ts`
- Create: `src/domain/debtSnowball/__tests__/SnowballPayoffProjector.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/domain/debtSnowball/__tests__/SnowballPayoffProjector.test.ts`:

```typescript
import { SnowballPayoffProjector } from '../SnowballPayoffProjector';
import type { DebtEntity } from '../DebtEntity';

function makeDebt(id: string, balanceCents: number, minPayCents: number, sortOrder: number): DebtEntity {
  return {
    id,
    householdId: 'h1',
    creditorName: `Debt ${id}`,
    debtType: 'personal_loan',
    outstandingBalanceCents: balanceCents,
    initialBalanceCents: balanceCents,
    interestRatePercent: 0, // zero interest simplifies month-count assertions
    minimumPaymentCents: minPayCents,
    sortOrder,
    isPaidOff: false,
    totalPaidCents: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    isSynced: false,
  };
}

describe('SnowballPayoffProjector', () => {
  const projector = new SnowballPayoffProjector();

  it('returns empty plan when no active debts', () => {
    const result = projector.project([]);
    expect(result.projections).toHaveLength(0);
    expect(result.debtFreeDate).toBeNull();
  });

  it('skips debts that are already paid off', () => {
    const paid = { ...makeDebt('d1', 0, 1000, 0), isPaidOff: true };
    const result = projector.project([paid]);
    expect(result.projections).toHaveLength(0);
  });

  it('calculates correct months to payoff for a single zero-interest debt', () => {
    // R5000 balance, R1000/month min payment = 5 months
    const debt = makeDebt('d1', 500000, 100000, 0);
    const result = projector.project([debt], 0);
    expect(result.projections).toHaveLength(1);
    expect(result.projections[0].monthsToPayoff).toBe(5);
  });

  it('rolls paid-off minimum into snowball for next debt', () => {
    // Debt1: R1000, R500/month → paid off in 2 months
    // Debt2: R2000, R500/month. After debt1 paid off, payment = R1000/month → 2 months more
    const debt1 = makeDebt('d1', 100000, 50000, 0);
    const debt2 = makeDebt('d2', 200000, 50000, 1);
    const result = projector.project([debt1, debt2], 0);
    expect(result.projections[0].monthsToPayoff).toBe(2);
    expect(result.projections[1].monthsToPayoff).toBe(4); // 2 + 2 more after snowball
  });

  it('debtFreeDate is the payoff date of the last debt', () => {
    const debt = makeDebt('d1', 100000, 50000, 0);
    const result = projector.project([debt], 0);
    expect(result.debtFreeDate).toEqual(result.projections[0].payoffDate);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
cd C:\Project\AccountingV2 && npx jest src/domain/debtSnowball/__tests__/SnowballPayoffProjector.test.ts --no-coverage 2>&1 | tail -10
```

Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

Create `src/domain/debtSnowball/SnowballPayoffProjector.ts`:

```typescript
import { addMonths } from 'date-fns';
import type { DebtEntity } from './DebtEntity';

export interface DebtProjection {
  debtId: string;
  creditorName: string;
  monthsToPayoff: number;  // -1 if not payable with current payments
  payoffDate: Date;
}

export interface SnowballPlan {
  projections: DebtProjection[];
  debtFreeDate: Date | null;
}

export class SnowballPayoffProjector {
  private static readonly MAX_MONTHS = 600; // 50-year safety cap

  /**
   * Simulates the Dave Ramsey snowball method.
   * Debts are processed in sortOrder ascending (smallest balance first by default).
   * extraMonthlyPaymentCents is added to the first debt's payment and rolls forward.
   */
  project(debts: DebtEntity[], extraMonthlyPaymentCents = 0): SnowballPlan {
    const activeDebts = debts
      .filter((d) => !d.isPaidOff && d.outstandingBalanceCents > 0)
      .sort((a, b) => a.sortOrder - b.sortOrder);

    if (activeDebts.length === 0) {
      return { projections: [], debtFreeDate: null };
    }

    const today = new Date();
    const projections: DebtProjection[] = [];
    let snowballCents = extraMonthlyPaymentCents;

    for (const debt of activeDebts) {
      let balance = debt.outstandingBalanceCents;
      const monthlyRate = debt.interestRatePercent / 100 / 12;
      const payment = debt.minimumPaymentCents + snowballCents;
      let months = 0;

      while (balance > 0 && months < SnowballPayoffProjector.MAX_MONTHS) {
        const interest = Math.round(balance * monthlyRate);
        balance = balance + interest - payment;
        if (balance < 0) balance = 0;
        months++;
      }

      if (months >= SnowballPayoffProjector.MAX_MONTHS) {
        projections.push({
          debtId: debt.id,
          creditorName: debt.creditorName,
          monthsToPayoff: -1,
          payoffDate: addMonths(today, SnowballPayoffProjector.MAX_MONTHS),
        });
      } else {
        projections.push({
          debtId: debt.id,
          creditorName: debt.creditorName,
          monthsToPayoff: months,
          payoffDate: addMonths(today, months),
        });
        snowballCents += debt.minimumPaymentCents;
      }
    }

    const lastProjection = projections[projections.length - 1];
    const debtFreeDate = lastProjection ? lastProjection.payoffDate : null;

    return { projections, debtFreeDate };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```
cd C:\Project\AccountingV2 && npx jest src/domain/debtSnowball/__tests__/SnowballPayoffProjector.test.ts --no-coverage 2>&1 | tail -10
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/domain/debtSnowball/SnowballPayoffProjector.ts src/domain/debtSnowball/__tests__/SnowballPayoffProjector.test.ts
git commit -m "feat(domain): add SnowballPayoffProjector with month-by-month simulation"
```

---

### Task 10: RamseyScoreCalculator

**Files:**
- Create: `src/domain/scoring/RamseyScoreCalculator.ts`
- Create: `src/domain/scoring/__tests__/RamseyScoreCalculator.test.ts`

Score breakdown: 30 pts logging consistency + 30 pts envelope discipline + 20 pts meter reading + 20 pts Baby Step = 100 max.

- [ ] **Step 1: Write the failing test**

Create `src/domain/scoring/__tests__/RamseyScoreCalculator.test.ts`:

```typescript
import { RamseyScoreCalculator } from '../RamseyScoreCalculator';

describe('RamseyScoreCalculator', () => {
  const calc = new RamseyScoreCalculator();

  it('returns 100 for perfect inputs', () => {
    const result = calc.calculate({
      loggingDaysCount: 30,
      totalDaysInPeriod: 30,
      envelopesOnBudget: 5,
      totalEnvelopes: 5,
      meterReadingsLoggedThisPeriod: true,
      babyStepIsActive: true,
    });
    expect(result.score).toBe(100);
    expect(result.loggingPoints).toBe(30);
    expect(result.disciplinePoints).toBe(30);
    expect(result.metersPoints).toBe(20);
    expect(result.babyStepPoints).toBe(20);
  });

  it('returns 0 for all-zero inputs', () => {
    const result = calc.calculate({
      loggingDaysCount: 0,
      totalDaysInPeriod: 30,
      envelopesOnBudget: 0,
      totalEnvelopes: 5,
      meterReadingsLoggedThisPeriod: false,
      babyStepIsActive: false,
    });
    expect(result.score).toBe(0);
  });

  it('calculates logging points proportionally', () => {
    const result = calc.calculate({
      loggingDaysCount: 15,
      totalDaysInPeriod: 30,
      envelopesOnBudget: 5,
      totalEnvelopes: 5,
      meterReadingsLoggedThisPeriod: true,
      babyStepIsActive: true,
    });
    expect(result.loggingPoints).toBe(15); // 50% of 30
    expect(result.score).toBe(85);
  });

  it('calculates discipline points proportionally', () => {
    const result = calc.calculate({
      loggingDaysCount: 30,
      totalDaysInPeriod: 30,
      envelopesOnBudget: 2,
      totalEnvelopes: 4,
      meterReadingsLoggedThisPeriod: true,
      babyStepIsActive: true,
    });
    expect(result.disciplinePoints).toBe(15); // 50% of 30
    expect(result.score).toBe(85);
  });

  it('awards full discipline points when no envelopes exist', () => {
    const result = calc.calculate({
      loggingDaysCount: 30,
      totalDaysInPeriod: 30,
      envelopesOnBudget: 0,
      totalEnvelopes: 0,
      meterReadingsLoggedThisPeriod: true,
      babyStepIsActive: true,
    });
    expect(result.disciplinePoints).toBe(30);
  });

  it('does not exceed 100', () => {
    const result = calc.calculate({
      loggingDaysCount: 100,
      totalDaysInPeriod: 30,
      envelopesOnBudget: 10,
      totalEnvelopes: 5,
      meterReadingsLoggedThisPeriod: true,
      babyStepIsActive: true,
    });
    expect(result.score).toBeLessThanOrEqual(100);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
cd C:\Project\AccountingV2 && npx jest src/domain/scoring/__tests__/RamseyScoreCalculator.test.ts --no-coverage 2>&1 | tail -10
```

Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

Create `src/domain/scoring/RamseyScoreCalculator.ts`:

```typescript
export interface RamseyScoreInput {
  loggingDaysCount: number;     // days with at least one transaction logged
  totalDaysInPeriod: number;    // calendar days in the current budget period
  envelopesOnBudget: number;    // envelopes where spentCents <= allocatedCents
  totalEnvelopes: number;
  meterReadingsLoggedThisPeriod: boolean; // at least one reading logged this period
  babyStepIsActive: boolean;    // household has at least one Baby Step configured
}

export interface RamseyScoreResult {
  score: number;             // 0–100
  loggingPoints: number;     // 0–30
  disciplinePoints: number;  // 0–30
  metersPoints: number;      // 0–20
  babyStepPoints: number;    // 0–20
}

export class RamseyScoreCalculator {
  calculate(input: RamseyScoreInput): RamseyScoreResult {
    const loggingPoints =
      input.totalDaysInPeriod > 0
        ? Math.min(30, Math.round((input.loggingDaysCount / input.totalDaysInPeriod) * 30))
        : 0;

    const disciplinePoints =
      input.totalEnvelopes > 0
        ? Math.min(30, Math.round((input.envelopesOnBudget / input.totalEnvelopes) * 30))
        : 30; // no envelopes = nothing to overspend

    const metersPoints = input.meterReadingsLoggedThisPeriod ? 20 : 0;
    const babyStepPoints = input.babyStepIsActive ? 20 : 0;

    const score = Math.min(100, loggingPoints + disciplinePoints + metersPoints + babyStepPoints);

    return { score, loggingPoints, disciplinePoints, metersPoints, babyStepPoints };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```
cd C:\Project\AccountingV2 && npx jest src/domain/scoring/__tests__/RamseyScoreCalculator.test.ts --no-coverage 2>&1 | tail -10
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/domain/scoring/RamseyScoreCalculator.ts src/domain/scoring/__tests__/RamseyScoreCalculator.test.ts
git commit -m "feat(domain): add RamseyScoreCalculator (0-100 monthly discipline score)"
```

---

### Task 11: LevelAdvancementEvaluator

**Files:**
- Create: `src/domain/scoring/LevelAdvancementEvaluator.ts`
- Create: `src/domain/scoring/__tests__/LevelAdvancementEvaluator.test.ts`

Level 1 → Level 2 requires score >= 70 for 3 consecutive periods. Score < 60 for 2 consecutive periods triggers a coaching warning.

- [ ] **Step 1: Write the failing test**

Create `src/domain/scoring/__tests__/LevelAdvancementEvaluator.test.ts`:

```typescript
import { LevelAdvancementEvaluator } from '../LevelAdvancementEvaluator';

describe('LevelAdvancementEvaluator', () => {
  const evaluator = new LevelAdvancementEvaluator();

  it('advances when last 3 scores are all >= 70', () => {
    const result = evaluator.evaluate([55, 72, 75, 80]);
    expect(result.shouldAdvanceToLevel2).toBe(true);
    expect(result.shouldShowCoachingWarning).toBe(false);
  });

  it('does not advance when only 2 scores >= 70', () => {
    const result = evaluator.evaluate([55, 45, 75, 80]);
    expect(result.shouldAdvanceToLevel2).toBe(false);
  });

  it('does not advance when fewer than 3 scores provided', () => {
    const result = evaluator.evaluate([75, 80]);
    expect(result.shouldAdvanceToLevel2).toBe(false);
  });

  it('shows coaching warning when last 2 scores are both < 60', () => {
    const result = evaluator.evaluate([75, 80, 55, 45]);
    expect(result.shouldShowCoachingWarning).toBe(true);
    expect(result.shouldAdvanceToLevel2).toBe(false);
  });

  it('does not show coaching warning when only 1 of last 2 is < 60', () => {
    const result = evaluator.evaluate([75, 80, 55, 65]);
    expect(result.shouldShowCoachingWarning).toBe(false);
  });

  it('does not show coaching warning with fewer than 2 scores', () => {
    const result = evaluator.evaluate([45]);
    expect(result.shouldShowCoachingWarning).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
cd C:\Project\AccountingV2 && npx jest src/domain/scoring/__tests__/LevelAdvancementEvaluator.test.ts --no-coverage 2>&1 | tail -10
```

Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

Create `src/domain/scoring/LevelAdvancementEvaluator.ts`:

```typescript
export interface LevelEvaluationResult {
  shouldAdvanceToLevel2: boolean;
  shouldShowCoachingWarning: boolean;
}

export class LevelAdvancementEvaluator {
  private static readonly ADVANCE_THRESHOLD = 70;
  private static readonly WARNING_THRESHOLD = 60;

  evaluate(recentScores: number[]): LevelEvaluationResult {
    const lastThree = recentScores.slice(-3);
    const shouldAdvanceToLevel2 =
      lastThree.length >= 3 &&
      lastThree.every((s) => s >= LevelAdvancementEvaluator.ADVANCE_THRESHOLD);

    const lastTwo = recentScores.slice(-2);
    const shouldShowCoachingWarning =
      lastTwo.length >= 2 &&
      lastTwo.every((s) => s < LevelAdvancementEvaluator.WARNING_THRESHOLD);

    return { shouldAdvanceToLevel2, shouldShowCoachingWarning };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```
cd C:\Project\AccountingV2 && npx jest src/domain/scoring/__tests__/LevelAdvancementEvaluator.test.ts --no-coverage 2>&1 | tail -10
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/domain/scoring/LevelAdvancementEvaluator.ts src/domain/scoring/__tests__/LevelAdvancementEvaluator.test.ts
git commit -m "feat(domain): add LevelAdvancementEvaluator (advancement and coaching warning)"
```

---

### Task 12: NotificationPreferences + NotificationPreferencesRepository

**Files:**
- Create: `src/infrastructure/notifications/NotificationPreferences.ts`
- Create: `src/infrastructure/notifications/NotificationPreferencesRepository.ts`

- [ ] **Step 1: Create NotificationPreferences.ts**

Create `src/infrastructure/notifications/NotificationPreferences.ts`:

```typescript
export interface NotificationPreferences {
  eveningLogPromptEnabled: boolean;
  eveningLogPromptHour: number;    // 0–23 (default 19 = 7pm)
  eveningLogPromptMinute: number;  // 0–59 (default 0)
  meterReadingReminderEnabled: boolean;
  meterReadingReminderDay: number; // 1–28 (default 1)
  monthStartPreflightEnabled: boolean;
  envelopeWarningEnabled: boolean;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  eveningLogPromptEnabled: true,
  eveningLogPromptHour: 19,
  eveningLogPromptMinute: 0,
  meterReadingReminderEnabled: true,
  meterReadingReminderDay: 1,
  monthStartPreflightEnabled: true,
  envelopeWarningEnabled: true,
};
```

- [ ] **Step 2: Create NotificationPreferencesRepository.ts**

Create `src/infrastructure/notifications/NotificationPreferencesRepository.ts`:

```typescript
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { NotificationPreferences } from './NotificationPreferences';
import { DEFAULT_NOTIFICATION_PREFERENCES } from './NotificationPreferences';

const STORAGE_KEY = '@accountingv2:notification_preferences';

export class NotificationPreferencesRepository {
  async load(): Promise<NotificationPreferences> {
    const json = await AsyncStorage.getItem(STORAGE_KEY);
    if (!json) return { ...DEFAULT_NOTIFICATION_PREFERENCES };
    try {
      return { ...DEFAULT_NOTIFICATION_PREFERENCES, ...JSON.parse(json) } as NotificationPreferences;
    } catch {
      return { ...DEFAULT_NOTIFICATION_PREFERENCES };
    }
  }

  async save(prefs: NotificationPreferences): Promise<void> {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/infrastructure/notifications/NotificationPreferences.ts src/infrastructure/notifications/NotificationPreferencesRepository.ts
git commit -m "feat(infrastructure): add NotificationPreferences type and AsyncStorage repository"
```

---

### Task 13: LocalNotificationScheduler

**Files:**
- Create: `src/infrastructure/notifications/LocalNotificationScheduler.ts`
- Create: `src/infrastructure/notifications/__tests__/LocalNotificationScheduler.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/infrastructure/notifications/__tests__/LocalNotificationScheduler.test.ts`:

```typescript
import { LocalNotificationScheduler } from '../LocalNotificationScheduler';

const mockCancel = jest.fn().mockResolvedValue(undefined);
const mockSchedule = jest.fn().mockResolvedValue('id');
const mockCancelAll = jest.fn().mockResolvedValue(undefined);

jest.mock('expo-notifications', () => ({
  cancelScheduledNotificationAsync: (id: string) => mockCancel(id),
  scheduleNotificationAsync: (req: unknown) => mockSchedule(req),
  cancelAllScheduledNotificationsAsync: () => mockCancelAll(),
  SchedulableTriggerInputTypes: {
    DAILY: 'daily',
    MONTHLY: 'monthly',
  },
}));

describe('LocalNotificationScheduler', () => {
  const scheduler = new LocalNotificationScheduler();

  beforeEach(() => jest.clearAllMocks());

  it('scheduleEveningLogPrompt cancels then reschedules with identifier "evening-log"', async () => {
    await scheduler.scheduleEveningLogPrompt(19, 0);
    expect(mockCancel).toHaveBeenCalledWith('evening-log');
    expect(mockSchedule).toHaveBeenCalledWith(
      expect.objectContaining({ identifier: 'evening-log' }),
    );
  });

  it('scheduleMeterReadingReminder uses identifier "meter-reading"', async () => {
    await scheduler.scheduleMeterReadingReminder(1);
    expect(mockCancel).toHaveBeenCalledWith('meter-reading');
    expect(mockSchedule).toHaveBeenCalledWith(
      expect.objectContaining({ identifier: 'meter-reading' }),
    );
  });

  it('scheduleMonthStartPreflight uses identifier "month-start"', async () => {
    await scheduler.scheduleMonthStartPreflight(25);
    expect(mockCancel).toHaveBeenCalledWith('month-start');
    expect(mockSchedule).toHaveBeenCalledWith(
      expect.objectContaining({ identifier: 'month-start' }),
    );
  });

  it('cancelAll calls cancelAllScheduledNotificationsAsync', async () => {
    await scheduler.cancelAll();
    expect(mockCancelAll).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
cd C:\Project\AccountingV2 && npx jest src/infrastructure/notifications/__tests__/LocalNotificationScheduler.test.ts --no-coverage 2>&1 | tail -10
```

Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

Create `src/infrastructure/notifications/LocalNotificationScheduler.ts`:

```typescript
import * as Notifications from 'expo-notifications';

export class LocalNotificationScheduler {
  async scheduleEveningLogPrompt(hour: number, minute: number): Promise<void> {
    await Notifications.cancelScheduledNotificationAsync('evening-log').catch(() => {});
    await Notifications.scheduleNotificationAsync({
      identifier: 'evening-log',
      content: {
        title: 'Did you spend anything today?',
        body: 'Takes 10 seconds. Tap to log.',
        sound: true,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour,
        minute,
      },
    });
  }

  async scheduleMeterReadingReminder(dayOfMonth: number): Promise<void> {
    await Notifications.cancelScheduledNotificationAsync('meter-reading').catch(() => {});
    await Notifications.scheduleNotificationAsync({
      identifier: 'meter-reading',
      content: {
        title: 'Time to log your meter readings',
        body: 'Record electricity, water, and odometer readings.',
        sound: true,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.MONTHLY,
        day: dayOfMonth,
        hour: 8,
        minute: 0,
      },
    });
  }

  async scheduleMonthStartPreflight(paydayDay: number): Promise<void> {
    await Notifications.cancelScheduledNotificationAsync('month-start').catch(() => {});
    await Notifications.scheduleNotificationAsync({
      identifier: 'month-start',
      content: {
        title: 'Payday! Fill your envelopes.',
        body: 'Pre-flight checklist ready — 5 questions, 4 minutes.',
        sound: true,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.MONTHLY,
        day: paydayDay,
        hour: 7,
        minute: 0,
      },
    });
  }

  async cancelAll(): Promise<void> {
    await Notifications.cancelAllScheduledNotificationsAsync();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```
cd C:\Project\AccountingV2 && npx jest src/infrastructure/notifications/__tests__/LocalNotificationScheduler.test.ts --no-coverage 2>&1 | tail -10
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/notifications/LocalNotificationScheduler.ts src/infrastructure/notifications/__tests__/LocalNotificationScheduler.test.ts
git commit -m "feat(infrastructure): add LocalNotificationScheduler wrapping expo-notifications"
```

---

### Task 14: notificationStore

**Files:**
- Create: `src/presentation/stores/notificationStore.ts`

- [ ] **Step 1: Create the store**

Create `src/presentation/stores/notificationStore.ts`:

```typescript
import { create } from 'zustand';
import type { NotificationPreferences } from '../../infrastructure/notifications/NotificationPreferences';
import { DEFAULT_NOTIFICATION_PREFERENCES } from '../../infrastructure/notifications/NotificationPreferences';

interface NotificationState {
  preferences: NotificationPreferences;
  permissionsGranted: boolean;
}

interface NotificationActions {
  setPreferences: (prefs: NotificationPreferences) => void;
  setPermissionsGranted: (granted: boolean) => void;
}

export const useNotificationStore = create<NotificationState & NotificationActions>((set) => ({
  preferences: { ...DEFAULT_NOTIFICATION_PREFERENCES },
  permissionsGranted: false,
  setPreferences: (preferences): void => set({ preferences }),
  setPermissionsGranted: (permissionsGranted): void => set({ permissionsGranted }),
}));
```

- [ ] **Step 2: Commit**

```bash
git add src/presentation/stores/notificationStore.ts
git commit -m "feat(stores): add notificationStore Zustand slice"
```

---

### Task 15: useMeterReadings hook

**Files:**
- Create: `src/presentation/hooks/useMeterReadings.ts`

- [ ] **Step 1: Create the hook**

Create `src/presentation/hooks/useMeterReadings.ts`:

```typescript
import { useState, useCallback } from 'react';
import { and, eq, desc } from 'drizzle-orm';
import { db } from '../../data/local/db';
import { meterReadings as meterReadingsTable } from '../../data/local/schema';
import type { MeterReadingEntity, MeterType } from '../../domain/meterReadings/MeterReadingEntity';

export interface UseMeterReadingsResult {
  readings: MeterReadingEntity[];
  loading: boolean;
  error: Error | null;
  reload: () => Promise<void>;
}

export function useMeterReadings(
  householdId: string,
  meterType: MeterType,
  limit = 24,
): UseMeterReadingsResult {
  const [readings, setReadings] = useState<MeterReadingEntity[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await db
        .select()
        .from(meterReadingsTable)
        .where(
          and(
            eq(meterReadingsTable.householdId, householdId),
            eq(meterReadingsTable.meterType, meterType),
          ),
        )
        .orderBy(desc(meterReadingsTable.readingDate))
        .limit(limit);
      setReadings(rows as MeterReadingEntity[]);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setLoading(false);
    }
  }, [householdId, meterType, limit]);

  return { readings, loading, error, reload };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/presentation/hooks/useMeterReadings.ts
git commit -m "feat(presentation): add useMeterReadings hook"
```

---

### Task 16: useDebts hook

**Files:**
- Create: `src/presentation/hooks/useDebts.ts`

- [ ] **Step 1: Create the hook**

Create `src/presentation/hooks/useDebts.ts`:

```typescript
import { useState, useCallback } from 'react';
import { asc, eq } from 'drizzle-orm';
import { db } from '../../data/local/db';
import { debts as debtsTable } from '../../data/local/schema';
import type { DebtEntity } from '../../domain/debtSnowball/DebtEntity';

export interface UseDebtsResult {
  debts: DebtEntity[];
  loading: boolean;
  error: Error | null;
  reload: () => Promise<void>;
}

export function useDebts(householdId: string): UseDebtsResult {
  const [debts, setDebts] = useState<DebtEntity[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await db
        .select()
        .from(debtsTable)
        .where(eq(debtsTable.householdId, householdId))
        .orderBy(asc(debtsTable.sortOrder));
      setDebts(rows as DebtEntity[]);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setLoading(false);
    }
  }, [householdId]);

  return { debts, loading, error, reload };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/presentation/hooks/useDebts.ts
git commit -m "feat(presentation): add useDebts hook"
```

---

### Task 17: Navigation types + MetersStackNavigator + SnowballStackNavigator

**Files:**
- Modify: `src/presentation/navigation/types.ts` — add all new param lists + screen props
- Create: `src/presentation/navigation/MetersStackNavigator.tsx`
- Create: `src/presentation/navigation/SnowballStackNavigator.tsx`

The screen components imported by the navigators are created in later tasks. TypeScript will error until those tasks are complete — this is expected during sequential development.

- [ ] **Step 1: Update types.ts with all new param lists**

Replace `src/presentation/navigation/types.ts` with:

```typescript
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { MeterType } from '../../domain/meterReadings/MeterReadingEntity';

export type AuthStackParamList = {
  Login: undefined;
  OnboardingWizard: undefined;
};

export type DashboardStackParamList = {
  DashboardHome: undefined;
  AddEditEnvelope: { envelopeId?: string } | undefined;
};

export type TransactionsStackParamList = {
  TransactionList: undefined;
  AddTransaction: undefined;
};

export type MetersStackParamList = {
  MeterDashboard: undefined;
  AddReading: { meterType: MeterType };
  RateHistory: { meterType: MeterType };
};

export type SnowballStackParamList = {
  SnowballDashboard: undefined;
  AddDebt: undefined;
  DebtDetail: { debtId: string };
  LogPayment: { debtId: string };
};

export type SettingsStackParamList = {
  SettingsHome: undefined;
  NotificationPreferences: undefined;
};

export type MainTabParamList = {
  DashboardTab: undefined;
  Transactions: undefined;
  Meters: undefined;
  Snowball: undefined;
  Settings: undefined;
};

export type RootStackParamList = {
  Auth: undefined;
  Main: undefined;
};

// --- Screen props ---

export type LoginScreenProps = NativeStackScreenProps<AuthStackParamList, 'Login'>;

export type DashboardScreenProps = CompositeScreenProps<
  NativeStackScreenProps<DashboardStackParamList, 'DashboardHome'>,
  BottomTabScreenProps<MainTabParamList>
>;

export type AddEditEnvelopeScreenProps = NativeStackScreenProps<
  DashboardStackParamList,
  'AddEditEnvelope'
>;

export type TransactionListScreenProps = CompositeScreenProps<
  NativeStackScreenProps<TransactionsStackParamList, 'TransactionList'>,
  BottomTabScreenProps<MainTabParamList>
>;

export type AddTransactionScreenProps = NativeStackScreenProps<
  TransactionsStackParamList,
  'AddTransaction'
>;

export type MeterDashboardScreenProps = CompositeScreenProps<
  NativeStackScreenProps<MetersStackParamList, 'MeterDashboard'>,
  BottomTabScreenProps<MainTabParamList>
>;

export type AddReadingScreenProps = NativeStackScreenProps<MetersStackParamList, 'AddReading'>;

export type RateHistoryScreenProps = NativeStackScreenProps<MetersStackParamList, 'RateHistory'>;

export type SnowballDashboardScreenProps = CompositeScreenProps<
  NativeStackScreenProps<SnowballStackParamList, 'SnowballDashboard'>,
  BottomTabScreenProps<MainTabParamList>
>;

export type AddDebtScreenProps = NativeStackScreenProps<SnowballStackParamList, 'AddDebt'>;

export type DebtDetailScreenProps = NativeStackScreenProps<SnowballStackParamList, 'DebtDetail'>;

export type LogPaymentScreenProps = NativeStackScreenProps<SnowballStackParamList, 'LogPayment'>;

export type SettingsScreenProps = CompositeScreenProps<
  NativeStackScreenProps<SettingsStackParamList, 'SettingsHome'>,
  BottomTabScreenProps<MainTabParamList>
>;

export type NotificationPreferencesScreenProps = NativeStackScreenProps<
  SettingsStackParamList,
  'NotificationPreferences'
>;
```

- [ ] **Step 2: Create MetersStackNavigator.tsx**

Create `src/presentation/navigation/MetersStackNavigator.tsx`:

```typescript
import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { colours } from '../theme/tokens';
import type { MetersStackParamList } from './types';
import { MeterDashboardScreen } from '../screens/meters/MeterDashboardScreen';
import { AddReadingScreen } from '../screens/meters/AddReadingScreen';
import { RateHistoryScreen } from '../screens/meters/RateHistoryScreen';

const Stack = createNativeStackNavigator<MetersStackParamList>();

export function MetersStackNavigator(): React.JSX.Element {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colours.surface },
        headerTintColor: colours.primary,
        headerTitleStyle: { fontFamily: 'PlusJakartaSans_700Bold' },
      }}
    >
      <Stack.Screen
        name="MeterDashboard"
        component={MeterDashboardScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="AddReading"
        component={AddReadingScreen}
        options={{ title: 'Log Reading' }}
      />
      <Stack.Screen
        name="RateHistory"
        component={RateHistoryScreen}
        options={{ title: 'Rate History' }}
      />
    </Stack.Navigator>
  );
}
```

- [ ] **Step 3: Create SnowballStackNavigator.tsx**

Create `src/presentation/navigation/SnowballStackNavigator.tsx`:

```typescript
import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { colours } from '../theme/tokens';
import type { SnowballStackParamList } from './types';
import { SnowballDashboardScreen } from '../screens/debtSnowball/SnowballDashboardScreen';
import { AddDebtScreen } from '../screens/debtSnowball/AddDebtScreen';
import { DebtDetailScreen } from '../screens/debtSnowball/DebtDetailScreen';
import { LogPaymentScreen } from '../screens/debtSnowball/LogPaymentScreen';

const Stack = createNativeStackNavigator<SnowballStackParamList>();

export function SnowballStackNavigator(): React.JSX.Element {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colours.surface },
        headerTintColor: colours.primary,
        headerTitleStyle: { fontFamily: 'PlusJakartaSans_700Bold' },
      }}
    >
      <Stack.Screen
        name="SnowballDashboard"
        component={SnowballDashboardScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen name="AddDebt" component={AddDebtScreen} options={{ title: 'Add Debt' }} />
      <Stack.Screen name="DebtDetail" component={DebtDetailScreen} options={{ title: 'Debt Details' }} />
      <Stack.Screen name="LogPayment" component={LogPaymentScreen} options={{ title: 'Log Payment' }} />
    </Stack.Navigator>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add src/presentation/navigation/types.ts src/presentation/navigation/MetersStackNavigator.tsx src/presentation/navigation/SnowballStackNavigator.tsx
git commit -m "feat(navigation): add all new param lists + MetersStack + SnowballStack navigators"
```

---

### Task 18: MeterReadingCard component

**Files:**
- Create: `src/presentation/screens/meters/components/MeterReadingCard.tsx`

- [ ] **Step 1: Create the component**

Create `src/presentation/screens/meters/components/MeterReadingCard.tsx`:

```typescript
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Surface, Text, TouchableRipple } from 'react-native-paper';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { colours, spacing, radius } from '../../../theme/tokens';
import type { MeterReadingEntity, MeterType } from '../../../../domain/meterReadings/MeterReadingEntity';
import {
  getMeterTypeLabel,
  getMeterUnitLabel,
  getMeterIcon,
  getReadingDisplayDate,
} from '../../../../domain/meterReadings/MeterReadingEntity';
import { UnitRateCalculator } from '../../../../domain/meterReadings/UnitRateCalculator';

interface MeterReadingCardProps {
  meterType: MeterType;
  latestReading: MeterReadingEntity | null;
  previousReading: MeterReadingEntity | null;
  onPress: () => void;
  onRateHistoryPress: () => void;
}

const calculator = new UnitRateCalculator();

export function MeterReadingCard({
  meterType,
  latestReading,
  previousReading,
  onPress,
  onRateHistoryPress,
}: MeterReadingCardProps): React.JSX.Element {
  let consumptionText = '—';
  let rateText = '—';

  if (latestReading && previousReading) {
    const result = calculator.calculate(latestReading, previousReading);
    if (result.success) {
      const unit = getMeterUnitLabel(meterType);
      consumptionText = `${result.data.consumptionUnits.toFixed(1)} ${unit}`;
      if (result.data.unitRateCents > 0) {
        rateText = `R${(result.data.unitRateCents / 100).toFixed(2)}/${unit}`;
      }
    }
  }

  return (
    <Surface style={styles.card} elevation={1}>
      <TouchableRipple onPress={onPress} rippleColor={colours.primaryContainer} style={styles.main}>
        <View style={styles.row}>
          <View style={styles.iconContainer}>
            <MaterialCommunityIcons name={getMeterIcon(meterType)} size={24} color={colours.primary} />
          </View>
          <View style={styles.content}>
            <Text variant="titleMedium" style={styles.title}>{getMeterTypeLabel(meterType)}</Text>
            {latestReading ? (
              <>
                <Text variant="bodyMedium" style={styles.reading}>
                  {latestReading.readingValue.toLocaleString()} {getMeterUnitLabel(meterType)}
                </Text>
                <Text variant="bodySmall" style={styles.meta}>
                  {getReadingDisplayDate(latestReading)} · {consumptionText} · {rateText}
                </Text>
              </>
            ) : (
              <Text variant="bodyMedium" style={styles.noReading}>No readings yet — tap to add</Text>
            )}
          </View>
          <MaterialCommunityIcons name="plus-circle-outline" size={22} color={colours.primary} />
        </View>
      </TouchableRipple>
      {latestReading && (
        <TouchableRipple
          onPress={onRateHistoryPress}
          rippleColor={colours.surfaceVariant}
          style={styles.historyRow}
        >
          <Text variant="labelSmall" style={styles.historyLink}>View rate history →</Text>
        </TouchableRipple>
      )}
    </Surface>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.base,
    marginVertical: spacing.xs,
    borderRadius: radius.md,
    backgroundColor: colours.surface,
    overflow: 'hidden',
  },
  main: { borderRadius: radius.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.base,
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    backgroundColor: colours.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.base,
  },
  content: { flex: 1 },
  title: { color: colours.onSurface, fontFamily: 'PlusJakartaSans_600SemiBold' },
  reading: { color: colours.onSurface, marginTop: 2 },
  meta: { color: colours.onSurfaceVariant, marginTop: 2 },
  noReading: { color: colours.onSurfaceVariant, marginTop: 2 },
  historyRow: {
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colours.outlineVariant,
  },
  historyLink: { color: colours.primary, letterSpacing: 0.5 },
});
```

- [ ] **Step 2: Commit**

```bash
git add src/presentation/screens/meters/components/MeterReadingCard.tsx
git commit -m "feat(ui): add MeterReadingCard component"
```

---

### Task 19: MeterDashboardScreen

**Files:**
- Create: `src/presentation/screens/meters/MeterDashboardScreen.tsx`

- [ ] **Step 1: Create the screen**

Create `src/presentation/screens/meters/MeterDashboardScreen.tsx`:

```typescript
import React, { useCallback, useState } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { Text, ActivityIndicator, Surface } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import { and, eq, desc } from 'drizzle-orm';
import { db } from '../../../data/local/db';
import { meterReadings as meterReadingsTable } from '../../../data/local/schema';
import { useAppStore } from '../../stores/appStore';
import { BudgetPeriodEngine } from '../../../domain/shared/BudgetPeriodEngine';
import { colours, spacing } from '../../theme/tokens';
import { MeterReadingCard } from './components/MeterReadingCard';
import type { MeterReadingEntity, MeterType } from '../../../domain/meterReadings/MeterReadingEntity';
import type { MeterDashboardScreenProps } from '../../navigation/types';

const METER_TYPES: MeterType[] = ['electricity', 'water', 'odometer'];
const engine = new BudgetPeriodEngine();

type LatestPairByType = Record<MeterType, [MeterReadingEntity | null, MeterReadingEntity | null]>;

export const MeterDashboardScreen: React.FC<MeterDashboardScreenProps> = ({ navigation }) => {
  const householdId = useAppStore((s) => s.householdId)!;
  const paydayDay = useAppStore((s) => s.paydayDay);
  const period = engine.getCurrentPeriod(paydayDay);

  const [readingPairs, setReadingPairs] = useState<LatestPairByType>({
    electricity: [null, null],
    water: [null, null],
    odometer: [null, null],
  });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result: LatestPairByType = {
        electricity: [null, null],
        water: [null, null],
        odometer: [null, null],
      };
      for (const meterType of METER_TYPES) {
        const rows = await db
          .select()
          .from(meterReadingsTable)
          .where(
            and(
              eq(meterReadingsTable.householdId, householdId),
              eq(meterReadingsTable.meterType, meterType),
            ),
          )
          .orderBy(desc(meterReadingsTable.readingDate))
          .limit(2);
        result[meterType] = [
          (rows[0] as MeterReadingEntity) ?? null,
          (rows[1] as MeterReadingEntity) ?? null,
        ];
      }
      setReadingPairs(result);
    } finally {
      setLoading(false);
    }
  }, [householdId]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator animating color={colours.primary} />
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <Surface style={styles.header} elevation={0}>
        <Text variant="labelMedium" style={styles.headerLabel}>METER READINGS</Text>
        <Text variant="headlineSmall" style={styles.headerTitle}>{period.label}</Text>
      </Surface>
      <ScrollView contentContainerStyle={styles.list}>
        {METER_TYPES.map((meterType) => {
          const [latest, previous] = readingPairs[meterType];
          return (
            <MeterReadingCard
              key={meterType}
              meterType={meterType}
              latestReading={latest}
              previousReading={previous}
              onPress={() => navigation.navigate('AddReading', { meterType })}
              onRateHistoryPress={() => navigation.navigate('RateHistory', { meterType })}
            />
          );
        })}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colours.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    paddingHorizontal: spacing.base,
    paddingTop: spacing.xl,
    paddingBottom: spacing.base,
    backgroundColor: colours.surface,
  },
  headerLabel: { color: colours.onSurfaceVariant, letterSpacing: 1.5, marginBottom: spacing.xs },
  headerTitle: { color: colours.primary, fontFamily: 'PlusJakartaSans_700Bold' },
  list: { paddingVertical: spacing.sm, paddingBottom: spacing.xl },
});
```

- [ ] **Step 2: Commit**

```bash
git add src/presentation/screens/meters/MeterDashboardScreen.tsx
git commit -m "feat(screens): add MeterDashboardScreen"
```

---

### Task 20: AddReadingScreen

**Files:**
- Create: `src/presentation/screens/meters/AddReadingScreen.tsx`

- [ ] **Step 1: Create the screen**

Create `src/presentation/screens/meters/AddReadingScreen.tsx`:

```typescript
import React, { useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, TextInput, Button, SegmentedButtons, HelperText, Chip } from 'react-native-paper';
import { format } from 'date-fns';
import { and, eq, desc } from 'drizzle-orm';
import { db } from '../../../data/local/db';
import { meterReadings as meterReadingsTable } from '../../../data/local/schema';
import { AuditLogger } from '../../../data/audit/AuditLogger';
import { LogMeterReadingUseCase } from '../../../domain/meterReadings/LogMeterReadingUseCase';
import { AnomalyDetector } from '../../../domain/meterReadings/AnomalyDetector';
import { useAppStore } from '../../stores/appStore';
import { colours, spacing } from '../../theme/tokens';
import type { MeterReadingEntity, MeterType } from '../../../domain/meterReadings/MeterReadingEntity';
import { getMeterUnitLabel } from '../../../domain/meterReadings/MeterReadingEntity';
import type { AddReadingScreenProps } from '../../navigation/types';

const audit = new AuditLogger(db);
const anomalyDetector = new AnomalyDetector();

export const AddReadingScreen: React.FC<AddReadingScreenProps> = ({ navigation, route }) => {
  const householdId = useAppStore((s) => s.householdId)!;
  const [meterType, setMeterType] = useState<MeterType>(route.params.meterType);
  const [readingValue, setReadingValue] = useState('');
  const [costRands, setCostRands] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [anomalyWarning, setAnomalyWarning] = useState<string | null>(null);
  const [priorReadings, setPriorReadings] = useState<MeterReadingEntity[]>([]);

  const today = format(new Date(), 'yyyy-MM-dd');

  useEffect(() => {
    db.select()
      .from(meterReadingsTable)
      .where(
        and(
          eq(meterReadingsTable.householdId, householdId),
          eq(meterReadingsTable.meterType, meterType),
        ),
      )
      .orderBy(desc(meterReadingsTable.readingDate))
      .limit(10)
      .then((rows) => setPriorReadings(rows as MeterReadingEntity[]));
  }, [householdId, meterType]);

  const checkAnomaly = useCallback(
    (valueStr: string) => {
      const value = parseFloat(valueStr);
      if (isNaN(value) || priorReadings.length < 3) {
        setAnomalyWarning(null);
        return;
      }
      const preview: MeterReadingEntity = {
        id: 'preview',
        householdId,
        meterType,
        readingValue: value,
        readingDate: today,
        costCents: null,
        vehicleId: null,
        notes: null,
        createdAt: today,
        updatedAt: today,
        isSynced: false,
      };
      const result = anomalyDetector.detect(preview, priorReadings);
      if (result.isAnomaly) {
        const pct = Math.round(result.deviationPercent * 100);
        const unit = getMeterUnitLabel(meterType);
        const direction = result.currentConsumption > result.rollingAverageConsumption ? 'above' : 'below';
        setAnomalyWarning(
          `Consumption is ${pct}% ${direction} your ${result.rollingAverageConsumption.toFixed(1)} ${unit} average. Please verify before saving.`,
        );
      } else {
        setAnomalyWarning(null);
      }
    },
    [priorReadings, householdId, meterType, today],
  );

  const handleSave = async () => {
    const value = parseFloat(readingValue);
    if (isNaN(value) || value <= 0) {
      setError('Reading value must be a positive number');
      return;
    }
    const costCents = costRands.trim() ? Math.round(parseFloat(costRands) * 100) : null;
    setSaving(true);
    setError(null);
    const uc = new LogMeterReadingUseCase(db, audit, {
      householdId,
      meterType,
      readingValue: value,
      readingDate: today,
      costCents,
      vehicleId: null,
      notes: notes.trim() || null,
    });
    const result = await uc.execute();
    setSaving(false);
    if (result.success) {
      navigation.goBack();
    } else {
      setError(result.error.message);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text variant="titleMedium" style={styles.label}>Meter Type</Text>
      <SegmentedButtons
        value={meterType}
        onValueChange={(v) => { setMeterType(v as MeterType); setAnomalyWarning(null); }}
        buttons={[
          { value: 'electricity', label: 'Electricity', icon: 'lightning-bolt' },
          { value: 'water', label: 'Water', icon: 'water' },
          { value: 'odometer', label: 'Vehicle', icon: 'car' },
        ]}
        style={styles.segmented}
      />

      <TextInput
        label={`Current reading (${getMeterUnitLabel(meterType)})`}
        value={readingValue}
        onChangeText={(v) => { setReadingValue(v); checkAnomaly(v); }}
        keyboardType="numeric"
        mode="outlined"
        style={styles.input}
      />

      {anomalyWarning ? (
        <Chip icon="alert" style={styles.anomalyChip} textStyle={styles.anomalyText}>
          {anomalyWarning}
        </Chip>
      ) : null}

      <TextInput
        label="Cost this period (R) — optional"
        value={costRands}
        onChangeText={setCostRands}
        keyboardType="numeric"
        mode="outlined"
        style={styles.input}
      />

      <TextInput
        label="Notes — optional"
        value={notes}
        onChangeText={setNotes}
        mode="outlined"
        style={styles.input}
      />

      {error ? <HelperText type="error">{error}</HelperText> : null}

      <Button
        mode="contained"
        onPress={handleSave}
        loading={saving}
        disabled={saving}
        style={styles.button}
      >
        Save Reading
      </Button>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { padding: spacing.base, gap: spacing.sm },
  label: { color: colours.onSurface, fontFamily: 'PlusJakartaSans_600SemiBold' },
  segmented: { marginBottom: spacing.sm },
  input: { backgroundColor: colours.surface },
  anomalyChip: { backgroundColor: colours.warningContainer },
  anomalyText: { color: colours.warning, fontSize: 12, flexShrink: 1 },
  button: { marginTop: spacing.base, backgroundColor: colours.primary },
});
```

- [ ] **Step 2: Commit**

```bash
git add src/presentation/screens/meters/AddReadingScreen.tsx
git commit -m "feat(screens): add AddReadingScreen with live anomaly detection"
```

---

### Task 21: RateHistoryScreen

**Files:**
- Create: `src/presentation/screens/meters/RateHistoryScreen.tsx`

- [ ] **Step 1: Create the screen**

Create `src/presentation/screens/meters/RateHistoryScreen.tsx`:

```typescript
import React, { useCallback } from 'react';
import { View, FlatList, StyleSheet } from 'react-native';
import { Text, Surface, ActivityIndicator } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import { format, parseISO } from 'date-fns';
import { UnitRateCalculator } from '../../../domain/meterReadings/UnitRateCalculator';
import { getMeterTypeLabel, getMeterUnitLabel } from '../../../domain/meterReadings/MeterReadingEntity';
import { useMeterReadings } from '../../hooks/useMeterReadings';
import { useAppStore } from '../../stores/appStore';
import { colours, spacing, radius } from '../../theme/tokens';
import type { MeterReadingEntity } from '../../../domain/meterReadings/MeterReadingEntity';
import type { RateHistoryScreenProps } from '../../navigation/types';

const calculator = new UnitRateCalculator();

export const RateHistoryScreen: React.FC<RateHistoryScreenProps> = ({ route }) => {
  const { meterType } = route.params;
  const householdId = useAppStore((s) => s.householdId)!;
  const { readings, loading, reload } = useMeterReadings(householdId, meterType, 24);

  useFocusEffect(useCallback(() => { void reload(); }, [reload]));

  const unit = getMeterUnitLabel(meterType);

  const renderItem = useCallback(
    ({ item, index }: { item: MeterReadingEntity; index: number }) => {
      const previous = readings[index + 1] ?? null;
      const rateResult = previous ? calculator.calculate(item, previous) : null;

      return (
        <Surface style={styles.row} elevation={1}>
          <View style={styles.rowLeft}>
            <Text variant="bodyLarge" style={styles.reading}>
              {item.readingValue.toLocaleString()} {unit}
            </Text>
            <Text variant="bodySmall" style={styles.date}>
              {format(parseISO(item.readingDate), 'd MMM yyyy')}
            </Text>
          </View>
          <View style={styles.rowRight}>
            {rateResult?.success ? (
              <>
                <Text variant="bodyMedium" style={styles.consumption}>
                  {rateResult.data.consumptionUnits.toFixed(1)} {unit}
                </Text>
                {rateResult.data.unitRateCents > 0 ? (
                  <Text variant="bodySmall" style={styles.rate}>
                    R{(rateResult.data.unitRateCents / 100).toFixed(2)}/{unit}
                  </Text>
                ) : null}
              </>
            ) : (
              <Text variant="bodySmall" style={styles.firstReading}>First reading</Text>
            )}
          </View>
        </Surface>
      );
    },
    [readings, unit],
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator animating color={colours.primary} />
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <Surface style={styles.subHeader} elevation={0}>
        <Text variant="bodySmall" style={styles.subHeaderText}>
          {getMeterTypeLabel(meterType)} · rate per {unit} over time
        </Text>
      </Surface>
      {readings.length === 0 ? (
        <View style={styles.center}>
          <Text variant="titleMedium" style={styles.empty}>No readings yet</Text>
          <Text variant="bodyMedium" style={styles.emptySub}>Go back and log your first reading</Text>
        </View>
      ) : (
        <FlatList
          data={readings}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colours.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  subHeader: {
    padding: spacing.base,
    backgroundColor: colours.surfaceVariant,
  },
  subHeaderText: { color: colours.onSurfaceVariant },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: spacing.base,
    marginVertical: spacing.xs / 2,
    borderRadius: radius.md,
    padding: spacing.base,
    backgroundColor: colours.surface,
  },
  rowLeft: { flex: 1 },
  rowRight: { alignItems: 'flex-end' },
  reading: { color: colours.onSurface, fontFamily: 'PlusJakartaSans_600SemiBold' },
  date: { color: colours.onSurfaceVariant, marginTop: 2 },
  consumption: { color: colours.onSurface },
  rate: { color: colours.primary, marginTop: 2 },
  firstReading: { color: colours.onSurfaceVariant },
  empty: { color: colours.onSurface },
  emptySub: { color: colours.onSurfaceVariant, marginTop: spacing.xs },
  list: { paddingVertical: spacing.sm, paddingBottom: spacing.xl },
});
```

- [ ] **Step 2: Commit**

```bash
git add src/presentation/screens/meters/RateHistoryScreen.tsx
git commit -m "feat(screens): add RateHistoryScreen"
```

---

### Task 22: DebtPayoffBar + PayoffProjectionCard components

**Files:**
- Create: `src/presentation/screens/debtSnowball/components/DebtPayoffBar.tsx`
- Create: `src/presentation/screens/debtSnowball/components/PayoffProjectionCard.tsx`

- [ ] **Step 1: Create DebtPayoffBar**

Create `src/presentation/screens/debtSnowball/components/DebtPayoffBar.tsx`:

```typescript
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { colours, spacing, radius } from '../../../theme/tokens';

interface DebtPayoffBarProps {
  progressPercent: number; // 0–100
  label: string;
}

export function DebtPayoffBar({ progressPercent, label }: DebtPayoffBarProps): React.JSX.Element {
  const clamped = Math.min(100, Math.max(0, progressPercent));
  const isPaidOff = clamped >= 100;

  return (
    <View style={styles.container}>
      <View style={styles.track}>
        <View
          style={[
            styles.fill,
            {
              width: `${clamped}%`,
              backgroundColor: isPaidOff ? colours.debtBarPaid : colours.debtBar,
            },
          ]}
        />
      </View>
      <Text variant="labelSmall" style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginVertical: spacing.xs },
  track: {
    height: 8,
    borderRadius: radius.full,
    backgroundColor: colours.debtBarBackground,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: radius.full,
  },
  label: {
    color: colours.onSurfaceVariant,
    marginTop: spacing.xs / 2,
    textAlign: 'right',
  },
});
```

- [ ] **Step 2: Create PayoffProjectionCard**

Create `src/presentation/screens/debtSnowball/components/PayoffProjectionCard.tsx`:

```typescript
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Surface, Text } from 'react-native-paper';
import { format } from 'date-fns';
import { colours, spacing, radius } from '../../../theme/tokens';
import type { SnowballPlan } from '../../../../domain/debtSnowball/SnowballPayoffProjector';

interface PayoffProjectionCardProps {
  plan: SnowballPlan;
  totalDebtCents: number;
}

export function PayoffProjectionCard({ plan, totalDebtCents }: PayoffProjectionCardProps): React.JSX.Element | null {
  if (plan.projections.length === 0) return null;

  return (
    <Surface style={styles.card} elevation={1}>
      <Text variant="labelMedium" style={styles.label}>DEBT-FREE DATE</Text>
      {plan.debtFreeDate ? (
        <Text variant="headlineMedium" style={styles.date}>
          {format(plan.debtFreeDate, 'MMM yyyy')}
        </Text>
      ) : (
        <Text variant="bodyMedium" style={styles.unknown}>Increase payments to project</Text>
      )}
      <View style={styles.divider} />
      <View style={styles.row}>
        <View style={styles.stat}>
          <Text variant="labelSmall" style={styles.statLabel}>TOTAL DEBT</Text>
          <Text variant="titleMedium" style={styles.statValue}>
            R{(totalDebtCents / 100).toLocaleString('en-ZA', { minimumFractionDigits: 2 })}
          </Text>
        </View>
        <View style={styles.stat}>
          <Text variant="labelSmall" style={styles.statLabel}>DEBTS TO CLEAR</Text>
          <Text variant="titleMedium" style={styles.statValue}>
            {plan.projections.filter((p) => p.monthsToPayoff > 0).length}
          </Text>
        </View>
      </View>
    </Surface>
  );
}

const styles = StyleSheet.create({
  card: {
    margin: spacing.base,
    borderRadius: radius.lg,
    padding: spacing.base,
    backgroundColor: colours.primaryContainer,
  },
  label: { color: colours.onPrimaryContainer, letterSpacing: 1.2, marginBottom: spacing.xs },
  date: { color: colours.primary, fontFamily: 'PlusJakartaSans_700Bold' },
  unknown: { color: colours.onSurfaceVariant, marginTop: spacing.xs },
  divider: { height: 1, backgroundColor: colours.outlineVariant, marginVertical: spacing.base },
  row: { flexDirection: 'row' },
  stat: { flex: 1 },
  statLabel: { color: colours.onPrimaryContainer, letterSpacing: 0.8 },
  statValue: { color: colours.onPrimaryContainer, fontFamily: 'PlusJakartaSans_700Bold', marginTop: spacing.xs / 2 },
});
```

- [ ] **Step 3: Commit**

```bash
git add src/presentation/screens/debtSnowball/components/DebtPayoffBar.tsx src/presentation/screens/debtSnowball/components/PayoffProjectionCard.tsx
git commit -m "feat(ui): add DebtPayoffBar and PayoffProjectionCard components"
```

---

### Task 23: SnowballDashboardScreen

**Files:**
- Create: `src/presentation/screens/debtSnowball/SnowballDashboardScreen.tsx`

- [ ] **Step 1: Create the screen**

Create `src/presentation/screens/debtSnowball/SnowballDashboardScreen.tsx`:

```typescript
import React, { useCallback, useMemo } from 'react';
import { View, FlatList, StyleSheet } from 'react-native';
import { Text, FAB, ActivityIndicator, Surface, TouchableRipple } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppStore } from '../../stores/appStore';
import { useDebts } from '../../hooks/useDebts';
import { SnowballPayoffProjector } from '../../../domain/debtSnowball/SnowballPayoffProjector';
import { getDebtTypeLabel, getPayoffProgressPercent } from '../../../domain/debtSnowball/DebtEntity';
import { DebtPayoffBar } from './components/DebtPayoffBar';
import { PayoffProjectionCard } from './components/PayoffProjectionCard';
import { colours, spacing, radius } from '../../theme/tokens';
import type { DebtEntity } from '../../../domain/debtSnowball/DebtEntity';
import type { SnowballDashboardScreenProps } from '../../navigation/types';

const projector = new SnowballPayoffProjector();

export const SnowballDashboardScreen: React.FC<SnowballDashboardScreenProps> = ({ navigation }) => {
  const householdId = useAppStore((s) => s.householdId)!;
  const { debts, loading, reload } = useDebts(householdId);

  useFocusEffect(useCallback(() => { void reload(); }, [reload]));

  const plan = useMemo(() => projector.project(debts), [debts]);
  const totalDebtCents = debts.reduce((s, d) => s + d.outstandingBalanceCents, 0);
  const totalPaidCents = debts.reduce((s, d) => s + d.totalPaidCents, 0);

  const renderDebt = ({ item }: { item: DebtEntity }) => {
    const progress = getPayoffProgressPercent(item);
    const label = item.isPaidOff
      ? 'PAID OFF'
      : `R${(item.outstandingBalanceCents / 100).toLocaleString('en-ZA', { minimumFractionDigits: 2 })} remaining`;

    return (
      <TouchableRipple
        onPress={() => navigation.navigate('DebtDetail', { debtId: item.id })}
        rippleColor={colours.primaryContainer}
      >
        <Surface style={styles.debtRow} elevation={1}>
          <View style={styles.debtHeader}>
            <View style={styles.debtLeft}>
              <Text variant="titleSmall" style={styles.creditor}>{item.creditorName}</Text>
              <Text variant="bodySmall" style={styles.debtType}>{getDebtTypeLabel(item.debtType)}</Text>
            </View>
            {item.isPaidOff ? (
              <MaterialCommunityIcons name="check-circle" size={22} color={colours.success} />
            ) : (
              <MaterialCommunityIcons name="chevron-right" size={20} color={colours.onSurfaceVariant} />
            )}
          </View>
          <DebtPayoffBar progressPercent={progress} label={label} />
        </Surface>
      </TouchableRipple>
    );
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator animating color={colours.primary} />
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <Surface style={styles.header} elevation={0}>
        <Text variant="labelMedium" style={styles.headerLabel}>DEBT SNOWBALL</Text>
        {totalPaidCents > 0 && (
          <Text variant="bodySmall" style={styles.paidSoFar}>
            R{(totalPaidCents / 100).toLocaleString('en-ZA', { minimumFractionDigits: 2 })} paid off to date
          </Text>
        )}
      </Surface>

      <FlatList
        data={debts}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          debts.length > 0 ? (
            <PayoffProjectionCard plan={plan} totalDebtCents={totalDebtCents} />
          ) : null
        }
        renderItem={renderDebt}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.center}>
            <MaterialCommunityIcons name="snowflake" size={64} color={colours.outlineVariant} />
            <Text variant="titleMedium" style={styles.emptyTitle}>No debts entered</Text>
            <Text variant="bodyMedium" style={styles.emptyBody}>
              Tap + to add your first debt and start the snowball
            </Text>
          </View>
        }
      />

      <FAB
        icon="plus"
        style={styles.fab}
        onPress={() => navigation.navigate('AddDebt')}
        color={colours.onPrimary}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colours.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  header: {
    paddingHorizontal: spacing.base,
    paddingTop: spacing.xl,
    paddingBottom: spacing.base,
    backgroundColor: colours.surface,
  },
  headerLabel: { color: colours.onSurfaceVariant, letterSpacing: 1.5 },
  paidSoFar: { color: colours.success, marginTop: spacing.xs, fontFamily: 'PlusJakartaSans_600SemiBold' },
  debtRow: {
    marginHorizontal: spacing.base,
    marginVertical: spacing.xs / 2,
    borderRadius: radius.md,
    padding: spacing.base,
    backgroundColor: colours.surface,
  },
  debtHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  debtLeft: { flex: 1 },
  creditor: { color: colours.onSurface, fontFamily: 'PlusJakartaSans_600SemiBold' },
  debtType: { color: colours.onSurfaceVariant, marginTop: 2 },
  emptyTitle: { color: colours.onSurface, marginTop: spacing.base },
  emptyBody: { color: colours.onSurfaceVariant, textAlign: 'center', marginTop: spacing.sm },
  list: { paddingBottom: 100 },
  fab: { position: 'absolute', right: spacing.base, bottom: spacing.xl, backgroundColor: colours.primary },
});
```

- [ ] **Step 2: Commit**

```bash
git add src/presentation/screens/debtSnowball/SnowballDashboardScreen.tsx
git commit -m "feat(screens): add SnowballDashboardScreen with payoff projection"
```

---

### Task 24: AddDebtScreen

**Files:**
- Create: `src/presentation/screens/debtSnowball/AddDebtScreen.tsx`

- [ ] **Step 1: Create the screen**

Create `src/presentation/screens/debtSnowball/AddDebtScreen.tsx`:

```typescript
import React, { useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { TextInput, Button, HelperText, SegmentedButtons, Text } from 'react-native-paper';
import { db } from '../../../data/local/db';
import { AuditLogger } from '../../../data/audit/AuditLogger';
import { CreateDebtUseCase } from '../../../domain/debtSnowball/CreateDebtUseCase';
import { useAppStore } from '../../stores/appStore';
import { colours, spacing } from '../../theme/tokens';
import type { DebtType } from '../../../domain/debtSnowball/DebtEntity';
import type { AddDebtScreenProps } from '../../navigation/types';

const audit = new AuditLogger(db);

const DEBT_TYPES: { value: DebtType; label: string }[] = [
  { value: 'credit_card', label: 'Credit Card' },
  { value: 'personal_loan', label: 'Personal Loan' },
  { value: 'store_account', label: 'Store Account' },
  { value: 'vehicle_finance', label: 'Vehicle Finance' },
  { value: 'bond', label: 'Bond' },
];

export const AddDebtScreen: React.FC<AddDebtScreenProps> = ({ navigation }) => {
  const householdId = useAppStore((s) => s.householdId)!;
  const [creditorName, setCreditorName] = useState('');
  const [debtType, setDebtType] = useState<DebtType>('credit_card');
  const [balanceRands, setBalanceRands] = useState('');
  const [ratePercent, setRatePercent] = useState('');
  const [minPaymentRands, setMinPaymentRands] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!creditorName.trim()) { setError('Creditor name is required'); return; }
    const balanceCents = Math.round(parseFloat(balanceRands) * 100);
    const rate = parseFloat(ratePercent);
    const minPayCents = Math.round(parseFloat(minPaymentRands) * 100);

    if (isNaN(balanceCents) || balanceCents <= 0) { setError('Enter a valid outstanding balance'); return; }
    if (isNaN(rate) || rate < 0) { setError('Enter a valid interest rate (0 for interest-free)'); return; }
    if (isNaN(minPayCents) || minPayCents <= 0) { setError('Enter a valid minimum monthly payment'); return; }

    setSaving(true);
    setError(null);
    const uc = new CreateDebtUseCase(db, audit, {
      householdId,
      creditorName: creditorName.trim(),
      debtType,
      outstandingBalanceCents: balanceCents,
      interestRatePercent: rate,
      minimumPaymentCents: minPayCents,
    });
    const result = await uc.execute();
    setSaving(false);
    if (result.success) {
      navigation.goBack();
    } else {
      setError(result.error.message);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text variant="titleMedium" style={styles.sectionLabel}>Debt Type</Text>
      <SegmentedButtons
        value={debtType}
        onValueChange={(v) => setDebtType(v as DebtType)}
        buttons={DEBT_TYPES.map((dt) => ({ value: dt.value, label: dt.label }))}
        style={styles.segmented}
      />

      <TextInput
        label="Creditor / Account name"
        value={creditorName}
        onChangeText={setCreditorName}
        mode="outlined"
        style={styles.input}
      />
      <TextInput
        label="Outstanding balance (R)"
        value={balanceRands}
        onChangeText={setBalanceRands}
        keyboardType="numeric"
        mode="outlined"
        style={styles.input}
      />
      <TextInput
        label="Interest rate (%)"
        value={ratePercent}
        onChangeText={setRatePercent}
        keyboardType="numeric"
        mode="outlined"
        style={styles.input}
      />
      <TextInput
        label="Minimum monthly payment (R)"
        value={minPaymentRands}
        onChangeText={setMinPaymentRands}
        keyboardType="numeric"
        mode="outlined"
        style={styles.input}
      />

      {error ? <HelperText type="error">{error}</HelperText> : null}

      <Button
        mode="contained"
        onPress={handleSave}
        loading={saving}
        disabled={saving}
        style={styles.button}
      >
        Add Debt
      </Button>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { padding: spacing.base, gap: spacing.sm },
  sectionLabel: { color: colours.onSurface, fontFamily: 'PlusJakartaSans_600SemiBold' },
  segmented: { marginBottom: spacing.sm },
  input: { backgroundColor: colours.surface },
  button: { marginTop: spacing.base, backgroundColor: colours.primary },
});
```

- [ ] **Step 2: Commit**

```bash
git add src/presentation/screens/debtSnowball/AddDebtScreen.tsx
git commit -m "feat(screens): add AddDebtScreen"
```

---

### Task 25: DebtDetailScreen + LogPaymentScreen

**Files:**
- Create: `src/presentation/screens/debtSnowball/DebtDetailScreen.tsx`
- Create: `src/presentation/screens/debtSnowball/LogPaymentScreen.tsx`

- [ ] **Step 1: Create DebtDetailScreen**

Create `src/presentation/screens/debtSnowball/DebtDetailScreen.tsx`:

```typescript
import React, { useCallback, useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, Surface, Button, ActivityIndicator } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import { eq } from 'drizzle-orm';
import { format } from 'date-fns';
import { db } from '../../../data/local/db';
import { debts as debtsTable } from '../../../data/local/schema';
import { SnowballPayoffProjector } from '../../../domain/debtSnowball/SnowballPayoffProjector';
import { getDebtTypeLabel, getPayoffProgressPercent } from '../../../domain/debtSnowball/DebtEntity';
import { DebtPayoffBar } from './components/DebtPayoffBar';
import { colours, spacing, radius } from '../../theme/tokens';
import type { DebtEntity } from '../../../domain/debtSnowball/DebtEntity';
import type { DebtDetailScreenProps } from '../../navigation/types';

const projector = new SnowballPayoffProjector();

export const DebtDetailScreen: React.FC<DebtDetailScreenProps> = ({ navigation, route }) => {
  const { debtId } = route.params;
  const [debt, setDebt] = useState<DebtEntity | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const rows = await db.select().from(debtsTable).where(eq(debtsTable.id, debtId));
    setDebt((rows[0] as DebtEntity) ?? null);
    setLoading(false);
  }, [debtId]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  if (loading || !debt) {
    return <View style={styles.center}><ActivityIndicator animating color={colours.primary} /></View>;
  }

  const plan = projector.project([debt]);
  const projection = plan.projections[0];
  const progress = getPayoffProgressPercent(debt);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Surface style={styles.card} elevation={1}>
        <Text variant="titleLarge" style={styles.creditor}>{debt.creditorName}</Text>
        <Text variant="bodyMedium" style={styles.type}>{getDebtTypeLabel(debt.debtType)}</Text>

        <View style={styles.statsRow}>
          <View style={styles.stat}>
            <Text variant="labelSmall" style={styles.statLabel}>OUTSTANDING</Text>
            <Text variant="titleMedium" style={styles.statValue}>
              R{(debt.outstandingBalanceCents / 100).toLocaleString('en-ZA', { minimumFractionDigits: 2 })}
            </Text>
          </View>
          <View style={styles.stat}>
            <Text variant="labelSmall" style={styles.statLabel}>PAID TO DATE</Text>
            <Text variant="titleMedium" style={[styles.statValue, { color: colours.success }]}>
              R{(debt.totalPaidCents / 100).toLocaleString('en-ZA', { minimumFractionDigits: 2 })}
            </Text>
          </View>
        </View>

        <DebtPayoffBar progressPercent={progress} label={`${progress}% paid off`} />

        <View style={styles.detailsRow}>
          <Text variant="bodySmall" style={styles.detail}>
            Min payment: R{(debt.minimumPaymentCents / 100).toLocaleString('en-ZA', { minimumFractionDigits: 2 })}/month
          </Text>
          <Text variant="bodySmall" style={styles.detail}>
            Rate: {debt.interestRatePercent}% p.a.
          </Text>
        </View>

        {projection && projection.monthsToPayoff > 0 && (
          <Text variant="bodyMedium" style={styles.payoffDate}>
            Projected payoff: {format(projection.payoffDate, 'MMMM yyyy')} ({projection.monthsToPayoff} months)
          </Text>
        )}
      </Surface>

      {!debt.isPaidOff && (
        <Button
          mode="contained"
          icon="cash"
          onPress={() => navigation.navigate('LogPayment', { debtId: debt.id })}
          style={styles.payButton}
        >
          Log Payment
        </Button>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { padding: spacing.base },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: { borderRadius: radius.lg, padding: spacing.base, backgroundColor: colours.surface },
  creditor: { color: colours.onSurface, fontFamily: 'PlusJakartaSans_700Bold' },
  type: { color: colours.onSurfaceVariant, marginTop: 2, marginBottom: spacing.base },
  statsRow: { flexDirection: 'row', marginBottom: spacing.base },
  stat: { flex: 1 },
  statLabel: { color: colours.onSurfaceVariant, letterSpacing: 0.8 },
  statValue: { color: colours.onSurface, fontFamily: 'PlusJakartaSans_700Bold', marginTop: spacing.xs / 2 },
  detailsRow: { marginTop: spacing.sm, gap: spacing.xs },
  detail: { color: colours.onSurfaceVariant },
  payoffDate: { color: colours.primary, marginTop: spacing.sm, fontFamily: 'PlusJakartaSans_600SemiBold' },
  payButton: { marginTop: spacing.base, backgroundColor: colours.primary },
});
```

- [ ] **Step 2: Create LogPaymentScreen**

Create `src/presentation/screens/debtSnowball/LogPaymentScreen.tsx`:

```typescript
import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { TextInput, Button, HelperText, Text } from 'react-native-paper';
import { eq } from 'drizzle-orm';
import { db } from '../../../data/local/db';
import { debts as debtsTable } from '../../../data/local/schema';
import { AuditLogger } from '../../../data/audit/AuditLogger';
import { LogDebtPaymentUseCase } from '../../../domain/debtSnowball/LogDebtPaymentUseCase';
import { useAppStore } from '../../stores/appStore';
import { colours, spacing } from '../../theme/tokens';
import type { DebtEntity } from '../../../domain/debtSnowball/DebtEntity';
import type { LogPaymentScreenProps } from '../../navigation/types';

const audit = new AuditLogger(db);

export const LogPaymentScreen: React.FC<LogPaymentScreenProps> = ({ navigation, route }) => {
  const { debtId } = route.params;
  const householdId = useAppStore((s) => s.householdId)!;
  const [debt, setDebt] = useState<DebtEntity | null>(null);
  const [amountRands, setAmountRands] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    db.select().from(debtsTable).where(eq(debtsTable.id, debtId))
      .then((rows) => {
        const row = rows[0] as DebtEntity | undefined;
        if (row) setAmountRands((row.minimumPaymentCents / 100).toFixed(2));
        setDebt(row ?? null);
      });
  }, [debtId]);

  const handleSave = async () => {
    if (!debt) return;
    const amountCents = Math.round(parseFloat(amountRands) * 100);
    if (isNaN(amountCents) || amountCents <= 0) {
      setError('Enter a valid payment amount');
      return;
    }
    setSaving(true);
    setError(null);
    const uc = new LogDebtPaymentUseCase(db, audit, {
      householdId,
      debtId,
      paymentAmountCents: amountCents,
      currentDebt: debt,
    });
    const result = await uc.execute();
    setSaving(false);
    if (result.success) {
      navigation.goBack();
    } else {
      setError(result.error.message);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      {debt && (
        <Text variant="bodyMedium" style={styles.hint}>
          Outstanding: R{(debt.outstandingBalanceCents / 100).toLocaleString('en-ZA', { minimumFractionDigits: 2 })}
        </Text>
      )}
      <TextInput
        label="Payment amount (R)"
        value={amountRands}
        onChangeText={setAmountRands}
        keyboardType="numeric"
        mode="outlined"
        style={styles.input}
        autoFocus
      />
      {error ? <HelperText type="error">{error}</HelperText> : null}
      <Button
        mode="contained"
        onPress={handleSave}
        loading={saving}
        disabled={saving || !debt}
        style={styles.button}
      >
        Record Payment
      </Button>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { padding: spacing.base, gap: spacing.sm },
  hint: { color: colours.onSurfaceVariant, marginBottom: spacing.sm },
  input: { backgroundColor: colours.surface },
  button: { marginTop: spacing.base, backgroundColor: colours.primary },
});
```

- [ ] **Step 3: Commit**

```bash
git add src/presentation/screens/debtSnowball/DebtDetailScreen.tsx src/presentation/screens/debtSnowball/LogPaymentScreen.tsx
git commit -m "feat(screens): add DebtDetailScreen and LogPaymentScreen"
```

---

### Task 26: SettingsStackNavigator + SettingsScreen + NotificationPreferencesScreen

**Files:**
- Create: `src/presentation/screens/settings/SettingsStackNavigator.tsx`
- Create: `src/presentation/screens/settings/SettingsScreen.tsx`
- Create: `src/presentation/screens/settings/NotificationPreferencesScreen.tsx`

- [ ] **Step 1: Create SettingsStackNavigator.tsx**

Create `src/presentation/screens/settings/SettingsStackNavigator.tsx`:

```typescript
import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { colours } from '../../theme/tokens';
import type { SettingsStackParamList } from '../../navigation/types';
import { SettingsScreen } from './SettingsScreen';
import { NotificationPreferencesScreen } from './NotificationPreferencesScreen';

const Stack = createNativeStackNavigator<SettingsStackParamList>();

export function SettingsStackNavigator(): React.JSX.Element {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colours.surface },
        headerTintColor: colours.primary,
        headerTitleStyle: { fontFamily: 'PlusJakartaSans_700Bold' },
      }}
    >
      <Stack.Screen name="SettingsHome" component={SettingsScreen} options={{ title: 'Settings' }} />
      <Stack.Screen
        name="NotificationPreferences"
        component={NotificationPreferencesScreen}
        options={{ title: 'Notifications' }}
      />
    </Stack.Navigator>
  );
}
```

- [ ] **Step 2: Create SettingsScreen.tsx**

Create `src/presentation/screens/settings/SettingsScreen.tsx`:

```typescript
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { List, Surface, Divider } from 'react-native-paper';
import { useAppStore } from '../../stores/appStore';
import { colours, spacing } from '../../theme/tokens';
import type { SettingsScreenProps } from '../../navigation/types';

export const SettingsScreen: React.FC<SettingsScreenProps> = ({ navigation }) => {
  const session = useAppStore((s) => s.session);
  const email = session?.user?.email ?? 'Unknown';

  return (
    <View style={styles.flex}>
      <Surface style={styles.section} elevation={0}>
        <List.Item
          title={email}
          description="Signed in account"
          left={(props) => <List.Icon {...props} icon="account-circle-outline" />}
        />
        <Divider />
        <List.Item
          title="Notifications"
          description="Manage reminders and alerts"
          left={(props) => <List.Icon {...props} icon="bell-outline" />}
          right={(props) => <List.Icon {...props} icon="chevron-right" />}
          onPress={() => navigation.navigate('NotificationPreferences')}
        />
      </Surface>
    </View>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colours.background },
  section: {
    marginTop: spacing.base,
    marginHorizontal: spacing.base,
    borderRadius: 8,
    backgroundColor: colours.surface,
  },
});
```

- [ ] **Step 3: Create NotificationPreferencesScreen.tsx**

Create `src/presentation/screens/settings/NotificationPreferencesScreen.tsx`:

```typescript
import React, { useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { List, Switch, Divider, Text, TextInput, Surface } from 'react-native-paper';
import { NotificationPreferencesRepository } from '../../../infrastructure/notifications/NotificationPreferencesRepository';
import { LocalNotificationScheduler } from '../../../infrastructure/notifications/LocalNotificationScheduler';
import { useNotificationStore } from '../../stores/notificationStore';
import { colours, spacing } from '../../theme/tokens';
import { useAppStore } from '../../stores/appStore';
import type { NotificationPreferences } from '../../../infrastructure/notifications/NotificationPreferences';
import type { NotificationPreferencesScreenProps } from '../../navigation/types';

const repo = new NotificationPreferencesRepository();
const scheduler = new LocalNotificationScheduler();

export const NotificationPreferencesScreen: React.FC<NotificationPreferencesScreenProps> = () => {
  const { preferences, setPreferences, permissionsGranted } = useNotificationStore();
  const paydayDay = useAppStore((s) => s.paydayDay);
  const [saving, setSaving] = useState(false);

  const updatePref = async (update: Partial<NotificationPreferences>) => {
    const updated = { ...preferences, ...update };
    setPreferences(updated);
    setSaving(true);
    await repo.save(updated);

    if (permissionsGranted) {
      if (updated.eveningLogPromptEnabled) {
        await scheduler.scheduleEveningLogPrompt(updated.eveningLogPromptHour, updated.eveningLogPromptMinute);
      }
      if (updated.meterReadingReminderEnabled) {
        await scheduler.scheduleMeterReadingReminder(updated.meterReadingReminderDay);
      }
      if (updated.monthStartPreflightEnabled) {
        await scheduler.scheduleMonthStartPreflight(paydayDay);
      }
    }
    setSaving(false);
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {!permissionsGranted && (
        <Surface style={styles.permWarning} elevation={0}>
          <Text variant="bodySmall" style={styles.permWarningText}>
            Notification permissions not granted. Enable in device Settings to receive reminders.
          </Text>
        </Surface>
      )}

      <List.Section>
        <List.Subheader style={styles.subheader}>Daily Log Prompt</List.Subheader>
        <Surface style={styles.section} elevation={0}>
          <List.Item
            title="Evening log reminder"
            description="Daily prompt to log transactions"
            right={() => (
              <Switch
                value={preferences.eveningLogPromptEnabled}
                onValueChange={(v) => updatePref({ eveningLogPromptEnabled: v })}
                color={colours.primary}
              />
            )}
          />
          {preferences.eveningLogPromptEnabled && (
            <View style={styles.timeRow}>
              <TextInput
                label="Hour (0-23)"
                value={String(preferences.eveningLogPromptHour)}
                onChangeText={(v) => {
                  const n = parseInt(v, 10);
                  if (!isNaN(n) && n >= 0 && n <= 23) updatePref({ eveningLogPromptHour: n });
                }}
                keyboardType="numeric"
                mode="outlined"
                style={styles.timeInput}
              />
              <TextInput
                label="Minute (0-59)"
                value={String(preferences.eveningLogPromptMinute)}
                onChangeText={(v) => {
                  const n = parseInt(v, 10);
                  if (!isNaN(n) && n >= 0 && n <= 59) updatePref({ eveningLogPromptMinute: n });
                }}
                keyboardType="numeric"
                mode="outlined"
                style={styles.timeInput}
              />
            </View>
          )}
        </Surface>
      </List.Section>

      <List.Section>
        <List.Subheader style={styles.subheader}>Meter Reading Reminder</List.Subheader>
        <Surface style={styles.section} elevation={0}>
          <List.Item
            title="Monthly meter reminder"
            description="Prompt to log readings each month"
            right={() => (
              <Switch
                value={preferences.meterReadingReminderEnabled}
                onValueChange={(v) => updatePref({ meterReadingReminderEnabled: v })}
                color={colours.primary}
              />
            )}
          />
          {preferences.meterReadingReminderEnabled && (
            <View style={styles.dayRow}>
              <TextInput
                label="Day of month (1-28)"
                value={String(preferences.meterReadingReminderDay)}
                onChangeText={(v) => {
                  const n = parseInt(v, 10);
                  if (!isNaN(n) && n >= 1 && n <= 28) updatePref({ meterReadingReminderDay: n });
                }}
                keyboardType="numeric"
                mode="outlined"
                style={styles.dayInput}
              />
            </View>
          )}
        </Surface>
      </List.Section>

      <List.Section>
        <List.Subheader style={styles.subheader}>Budget Period</List.Subheader>
        <Surface style={styles.section} elevation={0}>
          <List.Item
            title="Month-start pre-flight"
            description={`Reminder on payday (day ${paydayDay}) to fill envelopes`}
            right={() => (
              <Switch
                value={preferences.monthStartPreflightEnabled}
                onValueChange={(v) => updatePref({ monthStartPreflightEnabled: v })}
                color={colours.primary}
              />
            )}
          />
          <Divider />
          <List.Item
            title="Envelope overspend warning"
            description="Alert when an envelope nears its limit"
            right={() => (
              <Switch
                value={preferences.envelopeWarningEnabled}
                onValueChange={(v) => updatePref({ envelopeWarningEnabled: v })}
                color={colours.primary}
              />
            )}
          />
        </Surface>
      </List.Section>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { padding: spacing.base },
  permWarning: {
    backgroundColor: colours.warningContainer,
    padding: spacing.base,
    borderRadius: 8,
    marginBottom: spacing.base,
  },
  permWarningText: { color: colours.warning },
  subheader: { color: colours.onSurfaceVariant, letterSpacing: 1 },
  section: { backgroundColor: colours.surface, borderRadius: 8, marginBottom: spacing.sm },
  timeRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.base, paddingBottom: spacing.sm },
  timeInput: { flex: 1, backgroundColor: colours.surface },
  dayRow: { paddingHorizontal: spacing.base, paddingBottom: spacing.sm },
  dayInput: { backgroundColor: colours.surface },
});
```

- [ ] **Step 4: Commit**

```bash
git add src/presentation/screens/settings/SettingsStackNavigator.tsx src/presentation/screens/settings/SettingsScreen.tsx src/presentation/screens/settings/NotificationPreferencesScreen.tsx
git commit -m "feat(screens): add Settings tab with notification preferences"
```

---

### Task 27: Wire MainTabNavigator — replace all placeholders

**Files:**
- Modify: `src/presentation/navigation/MainTabNavigator.tsx`

- [ ] **Step 1: Update MainTabNavigator.tsx**

Replace `src/presentation/navigation/MainTabNavigator.tsx` with:

```typescript
import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { DashboardStackNavigator } from './DashboardStackNavigator';
import { TransactionsStackNavigator } from './TransactionsStackNavigator';
import { MetersStackNavigator } from './MetersStackNavigator';
import { SnowballStackNavigator } from './SnowballStackNavigator';
import { SettingsStackNavigator } from '../screens/settings/SettingsStackNavigator';
import { colours } from '../theme/tokens';
import type { MainTabParamList } from './types';

const Tab = createBottomTabNavigator<MainTabParamList>();

function TabIcon({ name, color, size }: { name: string; color: string; size: number }): React.JSX.Element {
  return <MaterialCommunityIcons name={name} color={color} size={size} />;
}

export function MainTabNavigator(): React.JSX.Element {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colours.primary,
        tabBarInactiveTintColor: colours.onSurfaceVariant,
        tabBarStyle: { backgroundColor: colours.surface, borderTopColor: colours.outlineVariant },
        tabBarShowLabel: false,
      }}
    >
      <Tab.Screen
        name="DashboardTab"
        component={DashboardStackNavigator}
        options={{
          tabBarIcon: ({ color, size }) => <TabIcon name="wallet-outline" color={color} size={size} />,
        }}
      />
      <Tab.Screen
        name="Transactions"
        component={TransactionsStackNavigator}
        options={{
          tabBarIcon: ({ color, size }) => <TabIcon name="swap-horizontal" color={color} size={size} />,
        }}
      />
      <Tab.Screen
        name="Meters"
        component={MetersStackNavigator}
        options={{
          tabBarIcon: ({ color, size }) => <TabIcon name="gauge" color={color} size={size} />,
        }}
      />
      <Tab.Screen
        name="Snowball"
        component={SnowballStackNavigator}
        options={{
          tabBarIcon: ({ color, size }) => <TabIcon name="snowflake" color={color} size={size} />,
        }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsStackNavigator}
        options={{
          tabBarIcon: ({ color, size }) => <TabIcon name="cog-outline" color={color} size={size} />,
        }}
      />
    </Tab.Navigator>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/presentation/navigation/MainTabNavigator.tsx
git commit -m "feat(navigation): wire all three tabs — Meters, Snowball, Settings"
```

---

### Task 28: RamseyScoreBadge + DashboardScreen update

**Files:**
- Create: `src/presentation/screens/dashboard/components/RamseyScoreBadge.tsx`
- Modify: `src/presentation/screens/dashboard/DashboardScreen.tsx`

- [ ] **Step 1: Create RamseyScoreBadge.tsx**

Create `src/presentation/screens/dashboard/components/RamseyScoreBadge.tsx`:

```typescript
import React from 'react';
import { StyleSheet } from 'react-native';
import { Surface, Text } from 'react-native-paper';
import { colours, spacing, radius } from '../../../theme/tokens';

interface RamseyScoreBadgeProps {
  score: number; // 0–100
}

function getScoreColour(score: number): string {
  if (score >= 80) return colours.scoreExcellent;
  if (score >= 60) return colours.scoreGood;
  if (score >= 40) return colours.scoreFair;
  return colours.scorePoor;
}

function getScoreLabel(score: number): string {
  if (score >= 80) return 'Excellent';
  if (score >= 60) return 'Good';
  if (score >= 40) return 'Fair';
  return 'Keep going';
}

export function RamseyScoreBadge({ score }: RamseyScoreBadgeProps): React.JSX.Element {
  const colour = getScoreColour(score);
  return (
    <Surface style={[styles.badge, { borderColor: colour }]} elevation={0}>
      <Text variant="headlineMedium" style={[styles.score, { color: colour }]}>
        {score}
      </Text>
      <Text variant="labelSmall" style={[styles.label, { color: colour }]}>
        {getScoreLabel(score)}
      </Text>
      <Text variant="bodySmall" style={styles.sub}>Ramsey Score</Text>
    </Surface>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.base,
    borderRadius: radius.xl,
    borderWidth: 2,
    backgroundColor: colours.surface,
  },
  score: { fontFamily: 'PlusJakartaSans_700Bold' },
  label: { fontFamily: 'PlusJakartaSans_600SemiBold' },
  sub: { color: colours.onSurfaceVariant, marginTop: 2 },
});
```

- [ ] **Step 2: Update DashboardScreen.tsx**

In `src/presentation/screens/dashboard/DashboardScreen.tsx`:

1. Add imports at the top:

```typescript
import { RamseyScoreCalculator } from '../../../domain/scoring/RamseyScoreCalculator';
import { RamseyScoreBadge } from './components/RamseyScoreBadge';
```

2. Add calculator instance (after the `engine` declaration):

```typescript
const scoreCalculator = new RamseyScoreCalculator();
```

3. Inside the component body, compute the score after envelopes are loaded:

```typescript
const envelopesOnBudget = envelopes.filter((e) => e.spentCents <= e.allocatedCents).length;
const scoreResult = scoreCalculator.calculate({
  loggingDaysCount: 0,        // placeholder — full logging streak later
  totalDaysInPeriod: 30,
  envelopesOnBudget,
  totalEnvelopes: envelopes.length,
  meterReadingsLoggedThisPeriod: false, // placeholder — link to meters later
  babyStepIsActive: false,              // placeholder — link to debts later
});
```

4. Update the header to a row layout with the badge:

```typescript
<Surface style={styles.header} elevation={0}>
  <View style={styles.headerRow}>
    <View style={styles.headerLeft}>
      <Text variant="labelMedium" style={styles.periodLabel}>
        BUDGET PERIOD
      </Text>
      <Text variant="headlineSmall" style={styles.periodTitle}>
        {period.label}
      </Text>
    </View>
    <RamseyScoreBadge score={scoreResult.score} />
  </View>
</Surface>
```

5. Add new style entries:

```typescript
headerRow: {
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
},
headerLeft: { flex: 1 },
```

- [ ] **Step 3: Commit**

```bash
git add src/presentation/screens/dashboard/components/RamseyScoreBadge.tsx src/presentation/screens/dashboard/DashboardScreen.tsx
git commit -m "feat(dashboard): add RamseyScoreBadge to budget period header"
```

---

### Task 29: Wire notifications at app startup (RootNavigator)

**Files:**
- Modify: `src/presentation/navigation/RootNavigator.tsx`

On app start, when the user is authenticated, request notification permissions and apply stored preferences to schedule notifications.

- [ ] **Step 1: Update RootNavigator.tsx**

Replace `src/presentation/navigation/RootNavigator.tsx` with:

```typescript
import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as Notifications from 'expo-notifications';
import { AuthNavigator } from './AuthNavigator';
import { MainTabNavigator } from './MainTabNavigator';
import { useAppStore } from '../stores/appStore';
import { useNotificationStore } from '../stores/notificationStore';
import { NotificationPreferencesRepository } from '../../infrastructure/notifications/NotificationPreferencesRepository';
import { LocalNotificationScheduler } from '../../infrastructure/notifications/LocalNotificationScheduler';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();
const prefsRepo = new NotificationPreferencesRepository();
const scheduler = new LocalNotificationScheduler();

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export function RootNavigator(): React.JSX.Element {
  const session = useAppStore((s) => s.session);
  const householdId = useAppStore((s) => s.householdId);
  const paydayDay = useAppStore((s) => s.paydayDay);
  const { setPreferences, setPermissionsGranted } = useNotificationStore();
  const isAuthenticated = Boolean(session && householdId);

  useEffect(() => {
    if (!isAuthenticated) return;

    const initNotifications = async () => {
      const { status } = await Notifications.requestPermissionsAsync();
      const granted = status === 'granted';
      setPermissionsGranted(granted);

      const prefs = await prefsRepo.load();
      setPreferences(prefs);

      if (!granted) return;

      if (prefs.eveningLogPromptEnabled) {
        await scheduler.scheduleEveningLogPrompt(prefs.eveningLogPromptHour, prefs.eveningLogPromptMinute);
      }
      if (prefs.meterReadingReminderEnabled) {
        await scheduler.scheduleMeterReadingReminder(prefs.meterReadingReminderDay);
      }
      if (prefs.monthStartPreflightEnabled) {
        await scheduler.scheduleMonthStartPreflight(paydayDay);
      }
    };

    void initNotifications();
  }, [isAuthenticated, paydayDay, setPreferences, setPermissionsGranted]);

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {isAuthenticated ? (
          <Stack.Screen name="Main" component={MainTabNavigator} />
        ) : (
          <Stack.Screen name="Auth" component={AuthNavigator} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/presentation/navigation/RootNavigator.tsx
git commit -m "feat(infrastructure): request notification permissions and schedule on auth"
```

---

### Task 30: Final integration — run all tests

- [ ] **Step 1: Run all tests**

```
cd C:\Project\AccountingV2 && npx jest --no-coverage 2>&1 | tail -20
```

Expected: All PASS (domain tests from Tasks 2–13 + all existing Sprint 0/1/2 tests)

- [ ] **Step 2: Start Expo and verify the app loads**

```
cd C:\Project\AccountingV2 && npx expo start 2>&1 | head -20
```

Expected: Metro bundler starts without compile errors. Open the app on a device/simulator and verify:
- Meters tab shows 3 cards (Electricity, Water, Vehicle) — tap to add a reading
- Snowball tab shows empty state — tap + to add a debt
- Settings tab shows account + notifications — toggle a switch
- Dashboard shows the Ramsey Score badge in the header

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat(phase-1): Meters + Debt Snowball + Scoring & Notifications — complete"
```
