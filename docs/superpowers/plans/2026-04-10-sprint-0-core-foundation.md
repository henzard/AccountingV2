# Sprint 0 + Core Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold AccountingV2 from zero to a running React Native app with SQLite initialised, Supabase auth working, BudgetPeriodEngine tested, SyncOrchestrator wired, and CI green — ready for feature epic development.

**Architecture:** Clean Architecture with four layers (domain / data / presentation / infrastructure). SQLite via Drizzle ORM is the source of truth; Supabase is sync-only. Every write is atomic: SQLite → audit_events → pending_sync. All business rules live in `src/domain/`; screens contain zero financial logic.

**Tech Stack:** Expo SDK 55, React Native 0.83, TypeScript strict, expo-sqlite, drizzle-orm, @supabase/supabase-js, expo-secure-store, Zustand, React Native Paper, react-navigation v6, date-fns, expo-crypto, @react-native-firebase/messaging, expo-local-authentication, Jest + React Native Testing Library, Maestro (E2E), EAS Build, GitHub Actions.

---

## Task 1: Project Initialisation

**Files:**
- Create: `AccountingV2/` (root — from create-expo-app)
- Modify: `tsconfig.json`
- Create: `.env.example`
- Create: `.gitignore` (add `.env`)

- [ ] **Step 1: Create the Expo project**

```bash
npx create-expo-app@latest AccountingV2 --template blank-typescript
cd AccountingV2
```

Expected: project directory created, `package.json` present, `app.json` present.

- [ ] **Step 2: Enable TypeScript strict mode**

Open `tsconfig.json`. Replace its contents with:

```json
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "noImplicitReturns": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "paths": {
      "@domain/*": ["./src/domain/*"],
      "@data/*": ["./src/data/*"],
      "@presentation/*": ["./src/presentation/*"],
      "@infrastructure/*": ["./src/infrastructure/*"]
    }
  }
}
```

- [ ] **Step 3: Create `.env.example`**

Create `.env.example`:

```
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

Create `.env` (not committed — add `.env` to `.gitignore`):

```
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors (blank template is clean).

- [ ] **Step 5: Commit**

```bash
git init
git add .
git commit -m "feat: initialise AccountingV2 Expo TypeScript project"
```

---

## Task 2: Install All Libraries

**Files:**
- Modify: `package.json` (via installs)

- [ ] **Step 1: Install Expo-managed native libraries**

```bash
npx expo install expo-sqlite expo-secure-store expo-local-authentication expo-crypto expo-camera expo-image-picker expo-notifications @react-native-community/netinfo
```

Expected: all installed, no peer warnings.

- [ ] **Step 2: Install npm libraries**

```bash
npm install @supabase/supabase-js zustand react-native-paper react-native-vector-icons date-fns drizzle-orm
npm install --save-dev drizzle-kit
```

- [ ] **Step 3: Install react-navigation**

```bash
npm install @react-navigation/native @react-navigation/native-stack @react-navigation/bottom-tabs
npx expo install react-native-screens react-native-safe-area-context
```

- [ ] **Step 4: Install Firebase (requires dev build — Expo Go will not work after this)**

```bash
npx expo install @react-native-firebase/app @react-native-firebase/messaging
```

- [ ] **Step 5: Install testing libraries**

```bash
npm install --save-dev jest jest-expo @testing-library/react-native @testing-library/jest-native @types/jest
```

- [ ] **Step 6: Install ESLint + Prettier**

```bash
npm install --save-dev eslint prettier @typescript-eslint/parser @typescript-eslint/eslint-plugin eslint-plugin-react eslint-plugin-react-hooks eslint-config-prettier
```

- [ ] **Step 7: Verify install**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: install all MVP dependencies"
```

---

## Task 3: Configure ESLint, Prettier, and Jest

**Files:**
- Create: `.eslintrc.js`
- Create: `.prettierrc`
- Modify: `jest.config.js` (replace default)
- Create: `babel.config.js` (update for path aliases)

- [ ] **Step 1: Create `.eslintrc.js`**

```js
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint', 'react', 'react-hooks'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
    'prettier',
  ],
  rules: {
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/explicit-function-return-type': 'warn',
    'react/react-in-jsx-scope': 'off',
  },
  settings: { react: { version: 'detect' } },
};
```

- [ ] **Step 2: Create `.prettierrc`**

```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2
}
```

- [ ] **Step 3: Update `jest.config.js`**

```js
module.exports = {
  preset: 'jest-expo',
  setupFilesAfterFramework: ['@testing-library/jest-native/extend-expect'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg)',
  ],
  moduleNameMapper: {
    '^@domain/(.*)$': '<rootDir>/src/domain/$1',
    '^@data/(.*)$': '<rootDir>/src/data/$1',
    '^@presentation/(.*)$': '<rootDir>/src/presentation/$1',
    '^@infrastructure/(.*)$': '<rootDir>/src/infrastructure/$1',
  },
  collectCoverageFrom: ['src/domain/**/*.ts', '!src/domain/**/index.ts'],
  coverageThreshold: { global: { lines: 80 } },
};
```

- [ ] **Step 4: Verify ESLint runs**

```bash
npx eslint src/ --ext .ts,.tsx 2>/dev/null || echo "no src yet - ok"
```

Expected: `no src yet - ok` (src doesn't exist yet).

- [ ] **Step 5: Commit**

```bash
git add .eslintrc.js .prettierrc jest.config.js babel.config.js
git commit -m "chore: configure ESLint, Prettier, and Jest"
```

---

## Task 4: Create `src/` Directory Structure

**Files:**
- Create: all directories and barrel `index.ts` files per the architecture

- [ ] **Step 1: Create domain directories**

```bash
mkdir -p src/domain/shared
mkdir -p src/domain/budgets
mkdir -p src/domain/transactions
mkdir -p src/domain/meterReadings
mkdir -p src/domain/debtSnowball
mkdir -p src/domain/scoring
mkdir -p src/domain/slipScanning
mkdir -p src/domain/household
```

- [ ] **Step 2: Create data directories**

```bash
mkdir -p src/data/local/schema
mkdir -p src/data/local/migrations
mkdir -p src/data/local/budgets
mkdir -p src/data/local/transactions
mkdir -p src/data/local/meterReadings
mkdir -p src/data/local/debtSnowball
mkdir -p src/data/local/slipScanning
mkdir -p src/data/local/household
mkdir -p src/data/remote
mkdir -p src/data/sync
mkdir -p src/data/audit
```

- [ ] **Step 3: Create presentation directories**

```bash
mkdir -p src/presentation/navigation
mkdir -p src/presentation/stores
mkdir -p src/presentation/screens/auth/onboarding
mkdir -p src/presentation/screens/dashboard/components
mkdir -p src/presentation/screens/budgets/components
mkdir -p src/presentation/screens/transactions/components
mkdir -p src/presentation/screens/meters/components
mkdir -p src/presentation/screens/debtSnowball/components
mkdir -p src/presentation/screens/settings
mkdir -p src/presentation/components/shared
```

- [ ] **Step 4: Create infrastructure directories**

```bash
mkdir -p src/infrastructure/di
mkdir -p src/infrastructure/crypto
mkdir -p src/infrastructure/network
mkdir -p src/infrastructure/notifications
mkdir -p src/infrastructure/storage
```

- [ ] **Step 5: Create Supabase and E2E directories**

```bash
mkdir -p supabase/migrations
mkdir -p supabase/functions/process-slip
mkdir -p supabase/functions/ask-advisor
mkdir -p e2e
mkdir -p .github/workflows
```

- [ ] **Step 6: Commit**

```bash
git add src/ supabase/ e2e/ .github/
git commit -m "chore: scaffold Clean Architecture directory structure"
```

---

## Task 5: Domain Shared Types (`Result<T,E>`, `Command<T>`, `DomainError`)

**Files:**
- Create: `src/domain/shared/types.ts`
- Create: `src/domain/shared/Command.ts`
- Create: `src/domain/shared/types.test.ts`
- Create: `src/domain/shared/index.ts`

- [ ] **Step 1: Write the failing test**

Create `src/domain/shared/types.test.ts`:

```typescript
import { createSuccess, createFailure, isSuccess } from './types';

describe('Result type helpers', () => {
  it('createSuccess wraps a value', () => {
    const result = createSuccess(42);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe(42);
  });

  it('createFailure wraps an error', () => {
    const result = createFailure({ code: 'NOT_FOUND', message: 'Missing' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('NOT_FOUND');
  });

  it('isSuccess returns true for success result', () => {
    expect(isSuccess(createSuccess('hello'))).toBe(true);
    expect(isSuccess(createFailure({ code: 'ERR', message: '' }))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest src/domain/shared/types.test.ts --no-coverage
```

Expected: FAIL — `Cannot find module './types'`

- [ ] **Step 3: Implement `src/domain/shared/types.ts`**

```typescript
export interface DomainError {
  code: string;
  message: string;
  context?: Record<string, unknown>;
}

export type Result<T, E extends DomainError = DomainError> =
  | { success: true; data: T }
  | { success: false; error: E };

export function createSuccess<T>(data: T): Result<T, never> {
  return { success: true, data };
}

export function createFailure<E extends DomainError>(error: E): Result<never, E> {
  return { success: false, error };
}

export function isSuccess<T, E extends DomainError>(
  result: Result<T, E>,
): result is { success: true; data: T } {
  return result.success;
}

export interface BudgetPeriod {
  startDate: Date;
  endDate: Date;
  label: string; // e.g. "20 Mar – 19 Apr"
}

export interface AuditEvent {
  id: string;
  householdId: string;
  entityType: string;
  entityId: string;
  action: string;
  previousValueJson: string | null;
  newValueJson: string | null;
  createdAt: string; // ISO 8601
  isSynced: boolean;
}
```

- [ ] **Step 4: Implement `src/domain/shared/Command.ts`**

```typescript
import type { Result, DomainError } from './types';

export interface Command<T, E extends DomainError = DomainError> {
  execute(): Promise<Result<T, E>>;
  undo?(): Promise<Result<void, E>>;
}
```

- [ ] **Step 5: Create barrel `src/domain/shared/index.ts`**

```typescript
export * from './types';
export * from './Command';
export { BudgetPeriodEngine } from './BudgetPeriodEngine';
```

> Note: `BudgetPeriodEngine` is created in Task 6 — leave this export and implement the file next.

- [ ] **Step 6: Run test to verify it passes**

```bash
npx jest src/domain/shared/types.test.ts --no-coverage
```

Expected: PASS — 3 tests passing.

- [ ] **Step 7: Commit**

```bash
git add src/domain/shared/
git commit -m "feat(domain): add Result<T,E>, DomainError, Command<T>, BudgetPeriod types"
```

---

## Task 6: `BudgetPeriodEngine` (FR-68 — payslip-to-payslip periods)

**Files:**
- Create: `src/domain/shared/BudgetPeriodEngine.ts`
- Create: `src/domain/shared/BudgetPeriodEngine.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/domain/shared/BudgetPeriodEngine.test.ts`:

```typescript
import { BudgetPeriodEngine } from './BudgetPeriodEngine';
import type { BudgetPeriod } from './types';

describe('BudgetPeriodEngine', () => {
  const engine = new BudgetPeriodEngine();

  describe('getCurrentPeriod with payday=20', () => {
    it('returns correct period when today is before payday', () => {
      // Today is 15 April → period is 20 Mar – 19 Apr
      const period = engine.getCurrentPeriod(20, new Date('2026-04-15'));
      expect(period.startDate).toEqual(new Date('2026-03-20'));
      expect(period.endDate).toEqual(new Date('2026-04-19'));
    });

    it('returns correct period when today IS payday', () => {
      // Today is 20 April → new period starts: 20 Apr – 19 May
      const period = engine.getCurrentPeriod(20, new Date('2026-04-20'));
      expect(period.startDate).toEqual(new Date('2026-04-20'));
      expect(period.endDate).toEqual(new Date('2026-05-19'));
    });

    it('returns correct period when today is after payday', () => {
      // Today is 25 April → period is 20 Apr – 19 May
      const period = engine.getCurrentPeriod(20, new Date('2026-04-25'));
      expect(period.startDate).toEqual(new Date('2026-04-20'));
      expect(period.endDate).toEqual(new Date('2026-05-19'));
    });

    it('handles month boundary: payday 20, today 19 Dec', () => {
      // Today is 19 Dec → period is 20 Nov – 19 Dec
      const period = engine.getCurrentPeriod(20, new Date('2026-12-19'));
      expect(period.startDate).toEqual(new Date('2026-11-20'));
      expect(period.endDate).toEqual(new Date('2026-12-19'));
    });

    it('generates human-readable label', () => {
      const period = engine.getCurrentPeriod(20, new Date('2026-04-15'));
      expect(period.label).toBe('20 Mar – 19 Apr');
    });
  });

  describe('isDateInPeriod', () => {
    it('returns true for date within period', () => {
      const period: BudgetPeriod = {
        startDate: new Date('2026-03-20'),
        endDate: new Date('2026-04-19'),
        label: '20 Mar – 19 Apr',
      };
      expect(engine.isDateInPeriod(new Date('2026-04-01'), period)).toBe(true);
    });

    it('returns false for date outside period', () => {
      const period: BudgetPeriod = {
        startDate: new Date('2026-03-20'),
        endDate: new Date('2026-04-19'),
        label: '20 Mar – 19 Apr',
      };
      expect(engine.isDateInPeriod(new Date('2026-04-20'), period)).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest src/domain/shared/BudgetPeriodEngine.test.ts --no-coverage
```

Expected: FAIL — `Cannot find module './BudgetPeriodEngine'`

- [ ] **Step 3: Implement `src/domain/shared/BudgetPeriodEngine.ts`**

```typescript
import { format } from 'date-fns';
import type { BudgetPeriod } from './types';

export class BudgetPeriodEngine {
  getCurrentPeriod(paydayDay: number, referenceDate: Date = new Date()): BudgetPeriod {
    return this.getPeriodForDate(paydayDay, referenceDate);
  }

  getPeriodForDate(paydayDay: number, date: Date): BudgetPeriod {
    const day = date.getDate();
    let startYear = date.getFullYear();
    let startMonth = date.getMonth(); // 0-based

    if (day >= paydayDay) {
      // We are in or past this month's payday — period starts this month
    } else {
      // We haven't reached this month's payday — period started last month
      startMonth -= 1;
      if (startMonth < 0) {
        startMonth = 11;
        startYear -= 1;
      }
    }

    const startDate = new Date(startYear, startMonth, paydayDay);

    // End date is one day before next month's payday
    let endMonth = startMonth + 1;
    let endYear = startYear;
    if (endMonth > 11) {
      endMonth = 0;
      endYear += 1;
    }
    const endDate = new Date(endYear, endMonth, paydayDay - 1);

    const label = `${format(startDate, 'd MMM')} – ${format(endDate, 'd MMM')}`;

    return { startDate, endDate, label };
  }

  isDateInPeriod(date: Date, period: BudgetPeriod): boolean {
    return date >= period.startDate && date <= period.endDate;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx jest src/domain/shared/BudgetPeriodEngine.test.ts --no-coverage
```

Expected: PASS — 7 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/domain/shared/BudgetPeriodEngine.ts src/domain/shared/BudgetPeriodEngine.test.ts
git commit -m "feat(domain): implement BudgetPeriodEngine for payslip-to-payslip periods (FR-68)"
```

---

## Task 7: Drizzle Schema — All Tables

**Files:**
- Create: `drizzle.config.ts`
- Create: `src/data/local/schema/households.ts`
- Create: `src/data/local/schema/envelopes.ts`
- Create: `src/data/local/schema/transactions.ts`
- Create: `src/data/local/schema/meterReadings.ts`
- Create: `src/data/local/schema/debts.ts`
- Create: `src/data/local/schema/babySteps.ts`
- Create: `src/data/local/schema/slipQueue.ts`
- Create: `src/data/local/schema/auditEvents.ts`
- Create: `src/data/local/schema/pendingSync.ts`
- Create: `src/data/local/schema/index.ts`
- Create: `src/data/local/db.ts`

- [ ] **Step 1: Create `drizzle.config.ts`**

```typescript
import type { Config } from 'drizzle-kit';

export default {
  schema: './src/data/local/schema/index.ts',
  out: './src/data/local/migrations',
  driver: 'expo',
  dialect: 'sqlite',
} satisfies Config;
```

- [ ] **Step 2: Create `src/data/local/schema/households.ts`**

```typescript
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const households = sqliteTable('households', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  paydayDay: integer('payday_day').notNull().default(1),
  userLevel: integer('user_level').notNull().default(1), // 1=Learner, 2=Practitioner, 3=Mentor
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  isSynced: integer('is_synced', { mode: 'boolean' }).notNull().default(false),
});
```

- [ ] **Step 3: Create `src/data/local/schema/envelopes.ts`**

```typescript
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const envelopes = sqliteTable('envelopes', {
  id: text('id').primaryKey(),
  householdId: text('household_id').notNull(),
  name: text('name').notNull(),
  allocatedCents: integer('allocated_cents').notNull().default(0),
  spentCents: integer('spent_cents').notNull().default(0),
  envelopeType: text('envelope_type').notNull().default('spending'),
  // 'spending' | 'savings' | 'emergency_fund' | 'baby_step' | 'utility'
  isSavingsLocked: integer('is_savings_locked', { mode: 'boolean' }).notNull().default(false),
  isArchived: integer('is_archived', { mode: 'boolean' }).notNull().default(false),
  periodStart: text('period_start').notNull(), // ISO date of budget period start
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  isSynced: integer('is_synced', { mode: 'boolean' }).notNull().default(false),
});
```

- [ ] **Step 4: Create `src/data/local/schema/transactions.ts`**

```typescript
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const transactions = sqliteTable('transactions', {
  id: text('id').primaryKey(),
  householdId: text('household_id').notNull(),
  envelopeId: text('envelope_id').notNull(),
  amountCents: integer('amount_cents').notNull(),
  payee: text('payee'),
  description: text('description'),
  transactionDate: text('transaction_date').notNull(), // ISO date
  isBusinessExpense: integer('is_business_expense', { mode: 'boolean' }).notNull().default(false),
  spendingTriggerNote: text('spending_trigger_note'), // FR-72
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  isSynced: integer('is_synced', { mode: 'boolean' }).notNull().default(false),
});
```

- [ ] **Step 5: Create `src/data/local/schema/meterReadings.ts`**

```typescript
import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

export const meterReadings = sqliteTable('meter_readings', {
  id: text('id').primaryKey(),
  householdId: text('household_id').notNull(),
  meterType: text('meter_type').notNull(), // 'electricity' | 'water' | 'odometer'
  readingValue: real('reading_value').notNull(), // kWh, kL, or km
  readingDate: text('reading_date').notNull(), // ISO date
  costCents: integer('cost_cents'), // associated expense amount in cents
  vehicleId: text('vehicle_id'), // for odometer readings
  notes: text('notes'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  isSynced: integer('is_synced', { mode: 'boolean' }).notNull().default(false),
});
```

- [ ] **Step 6: Create `src/data/local/schema/debts.ts`**

```typescript
import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

export const debts = sqliteTable('debts', {
  id: text('id').primaryKey(),
  householdId: text('household_id').notNull(),
  creditorName: text('creditor_name').notNull(),
  debtType: text('debt_type').notNull(),
  // 'credit_card' | 'personal_loan' | 'store_account' | 'vehicle_finance' | 'bond'
  outstandingBalanceCents: integer('outstanding_balance_cents').notNull(),
  interestRatePercent: real('interest_rate_percent').notNull(),
  minimumPaymentCents: integer('minimum_payment_cents').notNull(),
  sortOrder: integer('sort_order').notNull().default(0), // smallest-first by default
  isPaidOff: integer('is_paid_off', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  isSynced: integer('is_synced', { mode: 'boolean' }).notNull().default(false),
});
```

- [ ] **Step 7: Create remaining schema files**

Create `src/data/local/schema/babySteps.ts`:

```typescript
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const babySteps = sqliteTable('baby_steps', {
  id: text('id').primaryKey(),
  householdId: text('household_id').notNull(),
  stepNumber: integer('step_number').notNull(), // 1-7
  isCompleted: integer('is_completed', { mode: 'boolean' }).notNull().default(false),
  completedAt: text('completed_at'), // ISO date when completed
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  isSynced: integer('is_synced', { mode: 'boolean' }).notNull().default(false),
});
```

Create `src/data/local/schema/slipQueue.ts`:

```typescript
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const slipQueue = sqliteTable('slip_queue', {
  id: text('id').primaryKey(),
  householdId: text('household_id').notNull(),
  imageBase64: text('image_base64').notNull(),
  status: text('status').notNull().default('pending'),
  // 'pending' | 'processing' | 'completed' | 'failed'
  extractedJson: text('extracted_json'), // SlipExtraction JSON once processed
  retryCount: integer('retry_count').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});
```

Create `src/data/local/schema/auditEvents.ts`:

```typescript
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const auditEvents = sqliteTable('audit_events', {
  id: text('id').primaryKey(),
  householdId: text('household_id').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  action: text('action').notNull(),
  previousValueJson: text('previous_value_json'),
  newValueJson: text('new_value_json'),
  createdAt: text('created_at').notNull(),
  isSynced: integer('is_synced', { mode: 'boolean' }).notNull().default(false),
});
```

Create `src/data/local/schema/pendingSync.ts`:

```typescript
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const pendingSync = sqliteTable('pending_sync', {
  id: text('id').primaryKey(),
  tableName: text('table_name').notNull(),
  recordId: text('record_id').notNull(),
  operation: text('operation').notNull(), // 'INSERT' | 'UPDATE' | 'DELETE'
  retryCount: integer('retry_count').notNull().default(0),
  lastAttemptedAt: text('last_attempted_at'),
  createdAt: text('created_at').notNull(),
});
```

- [ ] **Step 8: Create `src/data/local/schema/index.ts`**

```typescript
export { households } from './households';
export { envelopes } from './envelopes';
export { transactions } from './transactions';
export { meterReadings } from './meterReadings';
export { debts } from './debts';
export { babySteps } from './babySteps';
export { slipQueue } from './slipQueue';
export { auditEvents } from './auditEvents';
export { pendingSync } from './pendingSync';
```

- [ ] **Step 9: Generate Drizzle migration**

```bash
npx drizzle-kit generate
```

Expected: migration SQL file created in `src/data/local/migrations/`.

- [ ] **Step 10: Create `src/data/local/db.ts`**

```typescript
import * as SQLite from 'expo-sqlite';
import { drizzle } from 'drizzle-orm/expo-sqlite';
import { useMigrations } from 'drizzle-orm/expo-sqlite/migrator';
import migrations from './migrations/migrations';
import * as schema from './schema';

const expo = SQLite.openDatabaseSync('accountingv2.db');
export const db = drizzle(expo, { schema });

export function useDatabaseMigrations(): { success: boolean; error: Error | undefined } {
  return useMigrations(db, migrations);
}
```

- [ ] **Step 11: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 12: Commit**

```bash
git add src/data/local/schema/ src/data/local/migrations/ src/data/local/db.ts drizzle.config.ts
git commit -m "feat(data): define all Drizzle SQLite schemas and generate initial migration"
```

---

## Task 8: AuditLogger and PendingSyncTable

**Files:**
- Create: `src/data/audit/AuditLogger.ts`
- Create: `src/data/audit/AuditLogger.test.ts`
- Create: `src/data/sync/PendingSyncTable.ts`
- Create: `src/data/sync/PendingSyncTable.test.ts`

- [ ] **Step 1: Write failing test for AuditLogger**

Create `src/data/audit/AuditLogger.test.ts`:

```typescript
import { AuditLogger } from './AuditLogger';
import { db } from '../local/db';
import { auditEvents } from '../local/schema';

// Use in-memory DB for tests
jest.mock('../local/db', () => ({
  db: {
    insert: jest.fn().mockReturnValue({
      values: jest.fn().mockResolvedValue(undefined),
    }),
  },
}));

describe('AuditLogger', () => {
  const logger = new AuditLogger(db as any);

  it('inserts an audit event row', async () => {
    await logger.log({
      householdId: 'hh-1',
      entityType: 'envelope',
      entityId: 'env-1',
      action: 'CREATE',
      previousValue: null,
      newValue: { name: 'Groceries', allocatedCents: 200000 },
    });

    expect(db.insert).toHaveBeenCalledWith(auditEvents);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest src/data/audit/AuditLogger.test.ts --no-coverage
```

Expected: FAIL — `Cannot find module './AuditLogger'`

- [ ] **Step 3: Implement `src/data/audit/AuditLogger.ts`**

```typescript
import { randomUUID } from 'expo-crypto';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import { auditEvents } from '../local/schema';
import type * as schema from '../local/schema';

interface LogInput {
  householdId: string;
  entityType: string;
  entityId: string;
  action: string;
  previousValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
}

export class AuditLogger {
  constructor(private readonly db: ExpoSQLiteDatabase<typeof schema>) {}

  async log(input: LogInput): Promise<void> {
    const now = new Date().toISOString();
    await this.db.insert(auditEvents).values({
      id: randomUUID(),
      householdId: input.householdId,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      previousValueJson: input.previousValue ? JSON.stringify(input.previousValue) : null,
      newValueJson: input.newValue ? JSON.stringify(input.newValue) : null,
      createdAt: now,
      isSynced: false,
    });
  }
}
```

- [ ] **Step 4: Write failing test for PendingSyncTable**

Create `src/data/sync/PendingSyncTable.test.ts`:

```typescript
import { PendingSyncTable } from './PendingSyncTable';
import { db } from '../local/db';
import { pendingSync } from '../local/schema';

jest.mock('../local/db', () => ({
  db: {
    insert: jest.fn().mockReturnValue({ values: jest.fn().mockResolvedValue(undefined) }),
    delete: jest.fn().mockReturnValue({
      where: jest.fn().mockResolvedValue(undefined),
    }),
    select: jest.fn().mockReturnValue({
      from: jest.fn().mockResolvedValue([]),
    }),
  },
}));

describe('PendingSyncTable', () => {
  const table = new PendingSyncTable(db as any);

  it('enqueues a record for sync', async () => {
    await table.enqueue({ tableName: 'envelopes', recordId: 'env-1', operation: 'INSERT' });
    expect(db.insert).toHaveBeenCalledWith(pendingSync);
  });

  it('dequeues a record by id', async () => {
    await table.dequeue('sync-row-id');
    expect(db.delete).toHaveBeenCalledWith(pendingSync);
  });

  it('returns pending items', async () => {
    const items = await table.getPending();
    expect(Array.isArray(items)).toBe(true);
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

```bash
npx jest src/data/sync/PendingSyncTable.test.ts --no-coverage
```

Expected: FAIL — `Cannot find module './PendingSyncTable'`

- [ ] **Step 6: Implement `src/data/sync/PendingSyncTable.ts`**

```typescript
import { randomUUID } from 'expo-crypto';
import { eq } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import { pendingSync } from '../local/schema';
import type * as schema from '../local/schema';

export interface PendingSyncRecord {
  id: string;
  tableName: string;
  recordId: string;
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  retryCount: number;
  lastAttemptedAt: string | null;
  createdAt: string;
}

export class PendingSyncTable {
  constructor(private readonly db: ExpoSQLiteDatabase<typeof schema>) {}

  async enqueue(input: {
    tableName: string;
    recordId: string;
    operation: 'INSERT' | 'UPDATE' | 'DELETE';
  }): Promise<void> {
    await this.db.insert(pendingSync).values({
      id: randomUUID(),
      tableName: input.tableName,
      recordId: input.recordId,
      operation: input.operation,
      retryCount: 0,
      lastAttemptedAt: null,
      createdAt: new Date().toISOString(),
    });
  }

  async dequeue(syncRowId: string): Promise<void> {
    await this.db.delete(pendingSync).where(eq(pendingSync.id, syncRowId));
  }

  async getPending(): Promise<PendingSyncRecord[]> {
    return this.db.select().from(pendingSync) as Promise<PendingSyncRecord[]>;
  }

  async incrementRetry(syncRowId: string): Promise<void> {
    const row = await this.db
      .select()
      .from(pendingSync)
      .where(eq(pendingSync.id, syncRowId))
      .get();
    if (!row) return;
    // drizzle update
    await this.db
      .update(pendingSync)
      .set({
        retryCount: (row as PendingSyncRecord).retryCount + 1,
        lastAttemptedAt: new Date().toISOString(),
      })
      .where(eq(pendingSync.id, syncRowId));
  }
}
```

- [ ] **Step 7: Run both tests**

```bash
npx jest src/data/audit/ src/data/sync/PendingSyncTable.test.ts --no-coverage
```

Expected: PASS — all tests passing.

- [ ] **Step 8: Commit**

```bash
git add src/data/audit/ src/data/sync/PendingSyncTable.ts src/data/sync/PendingSyncTable.test.ts
git commit -m "feat(data): implement AuditLogger and PendingSyncTable"
```

---

## Task 9: Supabase Client + Auth Service + SecureStore Adapter

**Files:**
- Create: `src/infrastructure/storage/SecureStorageAdapter.ts`
- Create: `src/data/remote/supabaseClient.ts`
- Create: `src/data/remote/SupabaseAuthService.ts`
- Create: `src/data/remote/SupabaseAuthService.test.ts`

- [ ] **Step 1: Create `src/infrastructure/storage/SecureStorageAdapter.ts`**

```typescript
import * as SecureStore from 'expo-secure-store';
import type { SupportedStorage } from '@supabase/supabase-js';

export const SecureStorageAdapter: SupportedStorage = {
  getItem: (key: string): Promise<string | null> => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string): Promise<void> =>
    SecureStore.setItemAsync(key, value).then(() => undefined),
  removeItem: (key: string): Promise<void> =>
    SecureStore.deleteItemAsync(key).then(() => undefined),
};
```

- [ ] **Step 2: Create `src/data/remote/supabaseClient.ts`**

```typescript
import { createClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import { SecureStorageAdapter } from '../../infrastructure/storage/SecureStorageAdapter';

const supabaseUrl = Constants.expoConfig?.extra?.supabaseUrl as string;
const supabaseAnonKey = Constants.expoConfig?.extra?.supabaseAnonKey as string;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Supabase URL and anon key must be set in app.config.ts extra');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: SecureStorageAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
```

- [ ] **Step 3: Update `app.config.ts` to expose env vars**

Create `app.config.ts` (replace `app.json` if it exists):

```typescript
import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'AccountingV2',
  slug: 'accountingv2',
  version: '1.0.0',
  orientation: 'portrait',
  platforms: ['android'],
  android: {
    package: 'com.henza.accountingv2',
    adaptiveIcon: { foregroundImage: './assets/icon.png', backgroundColor: '#00695C' },
    googleServicesFile: './google-services.json',
  },
  plugins: [
    '@react-native-firebase/app',
    ['expo-notifications', { icon: './assets/icon.png', color: '#00695C' }],
  ],
  extra: {
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  },
};

export default config;
```

- [ ] **Step 4: Write failing test for SupabaseAuthService**

Create `src/data/remote/SupabaseAuthService.test.ts`:

```typescript
import { SupabaseAuthService } from './SupabaseAuthService';

const mockSupabase = {
  auth: {
    signInWithPassword: jest.fn().mockResolvedValue({
      data: { session: { access_token: 'tok', user: { id: 'u1' } } },
      error: null,
    }),
    signOut: jest.fn().mockResolvedValue({ error: null }),
    getSession: jest.fn().mockResolvedValue({
      data: { session: { access_token: 'tok', user: { id: 'u1' } } },
      error: null,
    }),
  },
};

describe('SupabaseAuthService', () => {
  const service = new SupabaseAuthService(mockSupabase as any);

  it('signIn returns success with session', async () => {
    const result = await service.signIn('henza@example.com', 'password');
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.access_token).toBe('tok');
  });

  it('signOut returns success', async () => {
    const result = await service.signOut();
    expect(result.success).toBe(true);
  });

  it('getSession returns current session', async () => {
    const result = await service.getSession();
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

```bash
npx jest src/data/remote/SupabaseAuthService.test.ts --no-coverage
```

Expected: FAIL — `Cannot find module './SupabaseAuthService'`

- [ ] **Step 6: Implement `src/data/remote/SupabaseAuthService.ts`**

```typescript
import type { SupabaseClient, Session } from '@supabase/supabase-js';
import { createSuccess, createFailure, type Result, type DomainError } from '../../domain/shared/types';

export class SupabaseAuthService {
  constructor(private readonly client: SupabaseClient) {}

  async signIn(email: string, password: string): Promise<Result<Session>> {
    const { data, error } = await this.client.auth.signInWithPassword({ email, password });
    if (error || !data.session) {
      return createFailure<DomainError>({
        code: 'AUTH_SIGN_IN_FAILED',
        message: error?.message ?? 'Sign in failed',
      });
    }
    return createSuccess(data.session);
  }

  async signOut(): Promise<Result<void>> {
    const { error } = await this.client.auth.signOut();
    if (error) {
      return createFailure<DomainError>({ code: 'AUTH_SIGN_OUT_FAILED', message: error.message });
    }
    return createSuccess(undefined);
  }

  async getSession(): Promise<Result<Session | null>> {
    const { data, error } = await this.client.auth.getSession();
    if (error) {
      return createFailure<DomainError>({ code: 'AUTH_GET_SESSION_FAILED', message: error.message });
    }
    return createSuccess(data.session);
  }
}
```

- [ ] **Step 7: Run test to verify it passes**

```bash
npx jest src/data/remote/SupabaseAuthService.test.ts --no-coverage
```

Expected: PASS — 3 tests passing.

- [ ] **Step 8: Commit**

```bash
git add src/infrastructure/storage/ src/data/remote/ app.config.ts
git commit -m "feat(data): implement Supabase client, SecureStore adapter, and AuthService"
```

---

## Task 10: `appStore` (Zustand — auth, level, period, sync status)

**Files:**
- Create: `src/presentation/stores/appStore.ts`
- Create: `src/presentation/stores/appStore.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/presentation/stores/appStore.test.ts`:

```typescript
import { act, renderHook } from '@testing-library/react-native';
import { useAppStore } from './appStore';

describe('appStore', () => {
  beforeEach(() => {
    useAppStore.setState({
      session: null,
      userLevel: 1,
      currentPeriod: null,
      syncStatus: 'idle',
    });
  });

  it('initial state has no session', () => {
    const { result } = renderHook(() => useAppStore());
    expect(result.current.session).toBeNull();
    expect(result.current.userLevel).toBe(1);
  });

  it('setSession updates session', () => {
    const { result } = renderHook(() => useAppStore());
    act(() => {
      result.current.setSession({ access_token: 'tok' } as any);
    });
    expect(result.current.session?.access_token).toBe('tok');
  });

  it('setSyncStatus updates status', () => {
    const { result } = renderHook(() => useAppStore());
    act(() => { result.current.setSyncStatus('syncing'); });
    expect(result.current.syncStatus).toBe('syncing');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest src/presentation/stores/appStore.test.ts --no-coverage
```

Expected: FAIL — `Cannot find module './appStore'`

- [ ] **Step 3: Implement `src/presentation/stores/appStore.ts`**

```typescript
import { create } from 'zustand';
import type { Session } from '@supabase/supabase-js';
import type { BudgetPeriod } from '../../domain/shared/types';

export type SyncStatus = 'idle' | 'syncing' | 'error' | 'success';

interface AppState {
  session: Session | null;
  userLevel: 1 | 2 | 3;
  currentPeriod: BudgetPeriod | null;
  syncStatus: SyncStatus;
  lastSyncAt: string | null;
  pendingSyncCount: number;
}

interface AppActions {
  setSession: (session: Session | null) => void;
  setUserLevel: (level: 1 | 2 | 3) => void;
  setCurrentPeriod: (period: BudgetPeriod) => void;
  setSyncStatus: (status: SyncStatus) => void;
  setLastSyncAt: (isoDate: string) => void;
  setPendingSyncCount: (count: number) => void;
}

export const useAppStore = create<AppState & AppActions>((set) => ({
  session: null,
  userLevel: 1,
  currentPeriod: null,
  syncStatus: 'idle',
  lastSyncAt: null,
  pendingSyncCount: 0,
  setSession: (session) => set({ session }),
  setUserLevel: (userLevel) => set({ userLevel }),
  setCurrentPeriod: (currentPeriod) => set({ currentPeriod }),
  setSyncStatus: (syncStatus) => set({ syncStatus }),
  setLastSyncAt: (lastSyncAt) => set({ lastSyncAt }),
  setPendingSyncCount: (pendingSyncCount) => set({ pendingSyncCount }),
}));
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx jest src/presentation/stores/appStore.test.ts --no-coverage
```

Expected: PASS — 3 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/presentation/stores/appStore.ts src/presentation/stores/appStore.test.ts
git commit -m "feat(presentation): implement appStore with auth, level, period, sync status"
```

---

## Task 11: NetworkObserver (connectivity → sync trigger)

**Files:**
- Create: `src/infrastructure/network/NetworkObserver.ts`

- [ ] **Step 1: Implement `src/infrastructure/network/NetworkObserver.ts`**

```typescript
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';

type OnConnectedCallback = () => Promise<void>;

export class NetworkObserver {
  private unsubscribe: (() => void) | null = null;
  private callbacks: OnConnectedCallback[] = [];

  onConnected(callback: OnConnectedCallback): void {
    this.callbacks.push(callback);
  }

  start(): void {
    this.unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
      if (state.isConnected && state.isInternetReachable) {
        this.callbacks.forEach((cb) => cb().catch(console.warn));
      }
    });
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }
}

export const networkObserver = new NetworkObserver();
```

- [ ] **Step 2: Commit**

```bash
git add src/infrastructure/network/NetworkObserver.ts
git commit -m "feat(infrastructure): implement NetworkObserver for connectivity-triggered sync"
```

---

## Task 12: GitHub Actions CI

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: ['*']
  pull_request:

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: TypeScript check
        run: npx tsc --noEmit

      - name: ESLint
        run: npx eslint src/ --ext .ts,.tsx --max-warnings 0

      - name: Jest
        run: npx jest --coverage --coverageThreshold='{"global":{"lines":80}}'
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "chore: add GitHub Actions CI (tsc + eslint + jest)"
```

---

## Task 13: Supabase Project Setup (manual steps)

**Files:**
- Create: `supabase/migrations/001_initial_schema.sql`
- Create: `supabase/migrations/002_rls_policies.sql`

> These steps require access to the Supabase dashboard and the Supabase CLI.

- [ ] **Step 1: Install Supabase CLI**

```bash
npm install --save-dev supabase
npx supabase login
npx supabase init
```

- [ ] **Step 2: Create `supabase/migrations/001_initial_schema.sql`**

```sql
-- households
CREATE TABLE households (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  payday_day INTEGER NOT NULL DEFAULT 1,
  user_level INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- envelopes
CREATE TABLE envelopes (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  name TEXT NOT NULL,
  allocated_cents INTEGER NOT NULL DEFAULT 0,
  spent_cents INTEGER NOT NULL DEFAULT 0,
  envelope_type TEXT NOT NULL DEFAULT 'spending',
  is_savings_locked BOOLEAN NOT NULL DEFAULT FALSE,
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  period_start TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- transactions
CREATE TABLE transactions (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  envelope_id TEXT NOT NULL REFERENCES envelopes(id),
  amount_cents INTEGER NOT NULL,
  payee TEXT,
  description TEXT,
  transaction_date TEXT NOT NULL,
  is_business_expense BOOLEAN NOT NULL DEFAULT FALSE,
  spending_trigger_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- meter_readings
CREATE TABLE meter_readings (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  meter_type TEXT NOT NULL,
  reading_value REAL NOT NULL,
  reading_date TEXT NOT NULL,
  cost_cents INTEGER,
  vehicle_id TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- debts
CREATE TABLE debts (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  creditor_name TEXT NOT NULL,
  debt_type TEXT NOT NULL,
  outstanding_balance_cents INTEGER NOT NULL,
  interest_rate_percent REAL NOT NULL,
  minimum_payment_cents INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_paid_off BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- baby_steps
CREATE TABLE baby_steps (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  step_number INTEGER NOT NULL,
  is_completed BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- audit_events
CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  previous_value_json TEXT,
  new_value_json TEXT,
  created_at TEXT NOT NULL,
  is_synced BOOLEAN NOT NULL DEFAULT FALSE
);
```

- [ ] **Step 3: Create `supabase/migrations/002_rls_policies.sql`**

```sql
-- Enable RLS on all tables
ALTER TABLE households ENABLE ROW LEVEL SECURITY;
ALTER TABLE envelopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE meter_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE debts ENABLE ROW LEVEL SECURITY;
ALTER TABLE baby_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;

-- Households: user can only access their own household
-- (household.id maps to a user_households junction or auth.uid via app logic)
-- For MVP single-household: user can CRUD their own household record
CREATE POLICY "household_owner_access" ON households
  FOR ALL USING (id = (
    SELECT household_id FROM user_households WHERE user_id = auth.uid() LIMIT 1
  ));

-- All other tables: scoped to household_id the user owns
CREATE POLICY "envelope_household_access" ON envelopes
  FOR ALL USING (household_id IN (
    SELECT household_id FROM user_households WHERE user_id = auth.uid()
  ));

CREATE POLICY "transaction_household_access" ON transactions
  FOR ALL USING (household_id IN (
    SELECT household_id FROM user_households WHERE user_id = auth.uid()
  ));

CREATE POLICY "meter_household_access" ON meter_readings
  FOR ALL USING (household_id IN (
    SELECT household_id FROM user_households WHERE user_id = auth.uid()
  ));

CREATE POLICY "debt_household_access" ON debts
  FOR ALL USING (household_id IN (
    SELECT household_id FROM user_households WHERE user_id = auth.uid()
  ));

CREATE POLICY "baby_step_household_access" ON baby_steps
  FOR ALL USING (household_id IN (
    SELECT household_id FROM user_households WHERE user_id = auth.uid()
  ));

CREATE POLICY "audit_household_access" ON audit_events
  FOR ALL USING (household_id IN (
    SELECT household_id FROM user_households WHERE user_id = auth.uid()
  ));

-- user_households junction table
CREATE TABLE user_households (
  user_id UUID REFERENCES auth.users(id),
  household_id TEXT REFERENCES households(id),
  PRIMARY KEY (user_id, household_id)
);
ALTER TABLE user_households ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_owns_mapping" ON user_households
  FOR ALL USING (user_id = auth.uid());
```

- [ ] **Step 4: Apply migrations to Supabase project**

```bash
npx supabase db push
```

Expected: migrations applied, tables visible in Supabase dashboard.

- [ ] **Step 5: Commit**

```bash
git add supabase/
git commit -m "feat(supabase): initial schema + RLS policies for all tables"
```

---

## Task 14: Firebase Dev Build Setup (FCM)

> Required because `@react-native-firebase/messaging` is a native module. Expo Go cannot be used after this step.

- [ ] **Step 1: Create a Firebase project**

Go to [console.firebase.google.com](https://console.firebase.google.com), create project `AccountingV2`, add an Android app with package name `com.henza.accountingv2`, download `google-services.json`, place it at the project root.

- [ ] **Step 2: Verify `app.config.ts` references it**

`app.config.ts` already includes:
```typescript
android: { googleServicesFile: './google-services.json' }
plugins: ['@react-native-firebase/app', ...]
```

Confirm `google-services.json` is present at project root.

- [ ] **Step 3: Install EAS CLI and log in**

```bash
npm install --global eas-cli
eas login
```

- [ ] **Step 4: Configure EAS**

```bash
eas build:configure
```

Expected: `eas.json` created. Edit it to add a development profile:

```json
{
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "android": { "buildType": "apk" }
    },
    "preview": {
      "distribution": "internal",
      "android": { "buildType": "apk" }
    },
    "production": {
      "android": { "buildType": "app-bundle" }
    }
  }
}
```

- [ ] **Step 5: Create EAS development build**

```bash
eas build --profile development --platform android
```

Expected: APK built and available for download. Install on physical Android device.

- [ ] **Step 6: Commit**

```bash
git add eas.json
git commit -m "chore: configure EAS Build profiles for development and production"
```

---

## Task 15: Smoke Test — App Launches, DB Initialises, Auth Connects

- [ ] **Step 1: Update `App.tsx` to initialise DB and show status**

Replace `App.tsx`:

```typescript
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useDatabaseMigrations } from './src/data/local/db';

export default function App(): React.JSX.Element {
  const { success, error } = useDatabaseMigrations();

  if (error) {
    return (
      <View style={styles.container}>
        <Text style={styles.error}>DB Error: {error.message}</Text>
      </View>
    );
  }

  if (!success) {
    return (
      <View style={styles.container}>
        <Text>Initialising database...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.ready}>AccountingV2 — DB Ready ✓</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  ready: { fontSize: 18, color: '#00695C', fontWeight: 'bold' },
  error: { fontSize: 16, color: '#C62828' },
});
```

- [ ] **Step 2: Run on development build (physical device)**

```bash
npx expo start --dev-client
```

Scan QR with physical device running the dev build APK.

Expected: screen shows "AccountingV2 — DB Ready ✓" in deep teal — no red errors.

- [ ] **Step 3: Run full test suite**

```bash
npx jest --coverage
```

Expected: all tests PASS; domain layer coverage ≥ 80%.

- [ ] **Step 4: Run ESLint and TypeScript**

```bash
npx eslint src/ --ext .ts,.tsx --max-warnings 0
npx tsc --noEmit
```

Expected: zero errors, zero warnings.

- [ ] **Step 5: Final Sprint 0 commit**

```bash
git add App.tsx
git commit -m "feat: Sprint 0 complete — app launches, SQLite initialised, all checks green"
```

---

## Task 16: Design System Foundation (Theme, Tokens, Fonts, Navigation Shell, Shared Components)

> **See:** `docs/superpowers/plans/2026-04-10-frontend-design-spec.md` for the complete design specification. This task wires that spec into the running app.

**Files:**
- Create: `src/presentation/theme/tokens.ts`
- Create: `src/presentation/theme/theme.ts`
- Create: `src/presentation/theme/useFonts.ts`
- Create: `src/presentation/components/shared/CurrencyText.tsx`
- Create: `src/presentation/components/shared/CurrencyText.test.tsx`
- Create: `src/presentation/components/shared/DateText.tsx`
- Create: `src/presentation/components/shared/EnvelopeFillBar.tsx`
- Create: `src/presentation/components/shared/LoadingSkeletonCard.tsx`
- Create: `src/presentation/components/shared/ErrorSnackbar.tsx`
- Create: `src/presentation/navigation/RootNavigator.tsx`
- Create: `src/presentation/navigation/AuthNavigator.tsx`
- Create: `src/presentation/navigation/MainTabNavigator.tsx`
- Create: `src/presentation/navigation/types.ts`
- Create: `src/presentation/screens/auth/LoginScreen.tsx`
- Create: `src/presentation/screens/dashboard/DashboardScreen.tsx`
- Modify: `App.tsx` (replace smoke test with real app root)

- [ ] **Step 1: Install fonts**

```bash
npx expo install @expo-google-fonts/fraunces @expo-google-fonts/plus-jakarta-sans expo-font expo-haptics
```

- [ ] **Step 2: Create `src/presentation/theme/tokens.ts`**

```typescript
export const colours = {
  primary: '#00695C',
  primaryContainer: '#E0F2F0',
  onPrimary: '#FFFFFF',
  onPrimaryContainer: '#003D35',
  secondary: '#FFB300',
  secondaryContainer: '#FFF8E1',
  onSecondary: '#1A1200',
  onSecondaryContainer: '#3D2C00',
  success: '#2E7D32',
  successContainer: '#E8F5E9',
  onSuccess: '#FFFFFF',
  error: '#C62828',
  errorContainer: '#FFEBEE',
  onError: '#FFFFFF',
  warning: '#E65100',
  warningContainer: '#FFF3E0',
  onWarning: '#FFFFFF',
  surface: '#FAFAFA',
  surfaceVariant: '#F0F4F4',
  onSurface: '#1A2422',
  onSurfaceVariant: '#3D5451',
  background: '#FAFAFA',
  outline: '#6B8A87',
  outlineVariant: '#C4D7D4',
  envelopeFull: '#2E7D32',
  envelopeMid: '#FFB300',
  envelopeWarning: '#E65100',
  envelopeDanger: '#C62828',
  envelopeEmpty: '#E0E0E0',
  debtBar: '#C62828',
  debtBarPaid: '#2E7D32',
  debtBarBackground: '#FFEBEE',
  scoreExcellent: '#2E7D32',
  scoreGood: '#00695C',
  scoreFair: '#FFB300',
  scorePoor: '#C62828',
  scrim: 'rgba(0, 0, 0, 0.4)',
  shimmer: 'rgba(255, 255, 255, 0.6)',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
  xxxl: 64,
} as const;

export const radius = {
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  xxl: 24,
  full: 9999,
} as const;

export const elevation = {
  none: 0,
  low: 1,
  medium: 3,
  high: 6,
} as const;
```

- [ ] **Step 3: Create `src/presentation/theme/theme.ts`**

```typescript
import { MD3LightTheme, configureFonts } from 'react-native-paper';
import { colours } from './tokens';

const fontConfig = {
  displayLarge: { fontFamily: 'Fraunces_700Bold', fontSize: 48, fontWeight: '700' as const, letterSpacing: -0.5 },
  displayMedium: { fontFamily: 'Fraunces_700Bold', fontSize: 36, fontWeight: '700' as const, letterSpacing: -0.5 },
  headlineLarge: { fontFamily: 'Fraunces_700Bold', fontSize: 28, fontWeight: '700' as const, letterSpacing: -0.25 },
  headlineMedium: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 22, fontWeight: '700' as const, letterSpacing: 0 },
  titleLarge: { fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 18, fontWeight: '600' as const, letterSpacing: 0 },
  titleMedium: { fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 16, fontWeight: '600' as const, letterSpacing: 0.15 },
  bodyLarge: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 16, fontWeight: '400' as const, letterSpacing: 0.15 },
  bodyMedium: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 14, fontWeight: '400' as const, letterSpacing: 0.25 },
  labelLarge: { fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14, fontWeight: '600' as const, letterSpacing: 0.1 },
  labelMedium: { fontFamily: 'PlusJakartaSans_500Medium', fontSize: 12, fontWeight: '500' as const, letterSpacing: 0.5 },
  labelSmall: { fontFamily: 'PlusJakartaSans_500Medium', fontSize: 11, fontWeight: '500' as const, letterSpacing: 0.5 },
};

export const appTheme = {
  ...MD3LightTheme,
  fonts: configureFonts({ config: fontConfig }),
  colors: {
    ...MD3LightTheme.colors,
    primary: colours.primary,
    primaryContainer: colours.primaryContainer,
    onPrimary: colours.onPrimary,
    onPrimaryContainer: colours.onPrimaryContainer,
    secondary: colours.secondary,
    secondaryContainer: colours.secondaryContainer,
    onSecondary: colours.onSecondary,
    onSecondaryContainer: colours.onSecondaryContainer,
    error: colours.error,
    errorContainer: colours.errorContainer,
    onError: colours.onError,
    surface: colours.surface,
    surfaceVariant: colours.surfaceVariant,
    onSurface: colours.onSurface,
    onSurfaceVariant: colours.onSurfaceVariant,
    background: colours.background,
    outline: colours.outline,
    outlineVariant: colours.outlineVariant,
  },
  roundness: 3,
};
```

- [ ] **Step 4: Create `src/presentation/theme/useFonts.ts`**

```typescript
import { useFonts as useExpoFonts } from 'expo-font';
import { Fraunces_700Bold } from '@expo-google-fonts/fraunces';
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
} from '@expo-google-fonts/plus-jakarta-sans';

export function useFonts(): { fontsLoaded: boolean; fontError: Error | null } {
  const [fontsLoaded, fontError] = useExpoFonts({
    Fraunces_700Bold,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });

  return { fontsLoaded, fontError };
}
```

- [ ] **Step 5: Write failing test for CurrencyText**

Create `src/presentation/components/shared/CurrencyText.test.tsx`:

```typescript
import React from 'react';
import { render } from '@testing-library/react-native';
import { CurrencyText } from './CurrencyText';

describe('CurrencyText', () => {
  it('renders positive rand amount from cents', () => {
    const { getByText } = render(<CurrencyText amountCents={12345} />);
    // R123.45 in en-ZA locale
    expect(getByText(/R\s?123[,.]45/)).toBeTruthy();
  });

  it('renders negative amount with minus sign', () => {
    const { getByText } = render(<CurrencyText amountCents={-5000} />);
    expect(getByText(/-R\s?50/)).toBeTruthy();
  });

  it('renders zero amount', () => {
    const { getByText } = render(<CurrencyText amountCents={0} />);
    expect(getByText(/R\s?0[,.]00/)).toBeTruthy();
  });

  it('renders positive sign when showSign=true and amount is positive', () => {
    const { getByText } = render(<CurrencyText amountCents={10000} showSign />);
    expect(getByText(/\+R/)).toBeTruthy();
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

```bash
npx jest src/presentation/components/shared/CurrencyText.test.tsx --no-coverage
```

Expected: FAIL — `Cannot find module './CurrencyText'`

- [ ] **Step 7: Implement `src/presentation/components/shared/CurrencyText.tsx`**

```typescript
import React from 'react';
import { Text } from 'react-native';
import type { TextStyle } from 'react-native';

interface Props {
  amountCents: number;
  style?: TextStyle;
  showSign?: boolean;
}

export function CurrencyText({ amountCents, style, showSign = false }: Props): React.JSX.Element {
  const isNegative = amountCents < 0;
  const absAmount = Math.abs(amountCents);
  const rand = (absAmount / 100).toLocaleString('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const prefix = isNegative ? '-' : showSign ? '+' : '';
  return (
    <Text
      style={[
        { fontFamily: 'PlusJakartaSans_600SemiBold', fontVariant: ['tabular-nums'] },
        style,
      ]}
    >
      {`${prefix}${rand}`}
    </Text>
  );
}
```

- [ ] **Step 8: Run test to verify it passes**

```bash
npx jest src/presentation/components/shared/CurrencyText.test.tsx --no-coverage
```

Expected: PASS — 4 tests passing.

- [ ] **Step 9: Implement `src/presentation/components/shared/DateText.tsx`**

```typescript
import React from 'react';
import { Text } from 'react-native';
import type { TextStyle } from 'react-native';
import { format, parseISO } from 'date-fns';

interface Props {
  isoDate: string;      // ISO 8601 string from SQLite
  formatStr?: string;   // date-fns format string, default 'dd MMM yyyy'
  style?: TextStyle;
}

export function DateText({
  isoDate,
  formatStr = 'dd MMM yyyy',
  style,
}: Props): React.JSX.Element {
  const date = parseISO(isoDate);
  return (
    <Text style={[{ fontFamily: 'PlusJakartaSans_400Regular' }, style]}>
      {format(date, formatStr)}
    </Text>
  );
}
```

- [ ] **Step 10: Implement `src/presentation/components/shared/EnvelopeFillBar.tsx`**

```typescript
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { colours, radius } from '../../theme/tokens';

interface Props {
  percentRemaining: number;
  height?: number;
}

function getFillColour(pct: number): string {
  if (pct > 60) return colours.envelopeFull;
  if (pct > 20) return colours.envelopeMid;
  if (pct > 10) return colours.envelopeWarning;
  if (pct > 0) return colours.envelopeDanger;
  return colours.envelopeEmpty;
}

export function EnvelopeFillBar({ percentRemaining, height = 8 }: Props): React.JSX.Element {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: percentRemaining,
      duration: 600,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [percentRemaining]);

  const width = anim.interpolate({
    inputRange: [0, 100],
    outputRange: ['0%', '100%'],
    extrapolate: 'clamp',
  });

  return (
    <View style={[styles.track, { height, borderRadius: radius.full }]}>
      <Animated.View
        style={[
          styles.fill,
          { width, height, borderRadius: radius.full, backgroundColor: getFillColour(percentRemaining) },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { width: '100%', backgroundColor: colours.outlineVariant, overflow: 'hidden' },
  fill: { position: 'absolute', left: 0, top: 0 },
});
```

- [ ] **Step 11: Implement `src/presentation/components/shared/LoadingSkeletonCard.tsx`**

```typescript
import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { colours, radius, spacing } from '../../theme/tokens';

export function LoadingSkeletonCard(): React.JSX.Element {
  const shimmer = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, { toValue: 1, duration: 600, useNativeDriver: true }),
        Animated.timing(shimmer, { toValue: 0, duration: 600, useNativeDriver: true }),
      ]),
    ).start();
  }, []);

  const opacity = shimmer.interpolate({ inputRange: [0, 1], outputRange: [0.4, 0.9] });

  return (
    <View style={styles.card}>
      <Animated.View style={[styles.titleLine, { opacity }]} />
      <Animated.View style={[styles.amountLine, { opacity }]} />
      <Animated.View style={[styles.barLine, { opacity }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colours.surface, borderRadius: radius.lg, padding: spacing.base, marginBottom: spacing.md },
  titleLine: { height: 16, width: '60%', backgroundColor: colours.outlineVariant, borderRadius: radius.sm, marginBottom: spacing.sm },
  amountLine: { height: 22, width: '40%', backgroundColor: colours.outlineVariant, borderRadius: radius.sm, marginBottom: spacing.md },
  barLine: { height: 8, width: '100%', backgroundColor: colours.outlineVariant, borderRadius: radius.full },
});
```

- [ ] **Step 12: Implement `src/presentation/components/shared/ErrorSnackbar.tsx`**

```typescript
import React from 'react';
import { Snackbar } from 'react-native-paper';
import { colours } from '../../theme/tokens';

interface Props {
  visible: boolean;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss: () => void;
}

export function ErrorSnackbar({
  visible,
  message,
  actionLabel = 'Dismiss',
  onAction,
  onDismiss,
}: Props): React.JSX.Element {
  return (
    <Snackbar
      visible={visible}
      onDismiss={onDismiss}
      duration={4000}
      action={{ label: actionLabel, onPress: onAction ?? onDismiss }}
      style={{ backgroundColor: colours.onSurface }}
    >
      {message}
    </Snackbar>
  );
}
```

- [ ] **Step 13: Create `src/presentation/navigation/types.ts`**

```typescript
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';

export type AuthStackParamList = {
  Login: undefined;
  OnboardingWizard: undefined;
};

export type MainTabParamList = {
  Dashboard: undefined;
  Transactions: undefined;
  Meters: undefined;
  Snowball: undefined;
  Settings: undefined;
};

export type RootStackParamList = {
  Auth: undefined;
  Main: undefined;
};

export type LoginScreenProps = NativeStackScreenProps<AuthStackParamList, 'Login'>;
export type DashboardScreenProps = BottomTabScreenProps<MainTabParamList, 'Dashboard'>;
```

- [ ] **Step 14: Create placeholder screens**

Create `src/presentation/screens/auth/LoginScreen.tsx`:

```typescript
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { colours, spacing } from '../../theme/tokens';
import type { LoginScreenProps } from '../../navigation/types';

export function LoginScreen(_props: LoginScreenProps): React.JSX.Element {
  return (
    <View style={styles.container}>
      <Text variant="headlineLarge" style={{ color: colours.primary }}>
        AccountingV2
      </Text>
      <Text variant="bodyMedium" style={{ color: colours.onSurfaceVariant, marginTop: spacing.sm }}>
        Login screen — placeholder
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colours.surface, padding: spacing.base },
});
```

Create `src/presentation/screens/dashboard/DashboardScreen.tsx`:

```typescript
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { colours, spacing } from '../../theme/tokens';
import type { DashboardScreenProps } from '../../navigation/types';

export function DashboardScreen(_props: DashboardScreenProps): React.JSX.Element {
  return (
    <View style={styles.container}>
      <Text variant="headlineLarge" style={{ color: colours.primary }}>
        Dashboard
      </Text>
      <Text variant="bodyMedium" style={{ color: colours.onSurfaceVariant, marginTop: spacing.sm }}>
        Envelope list will render here
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colours.surface, padding: spacing.base },
});
```

- [ ] **Step 15: Create `src/presentation/navigation/AuthNavigator.tsx`**

```typescript
import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { LoginScreen } from '../screens/auth/LoginScreen';
import type { AuthStackParamList } from './types';

const Stack = createNativeStackNavigator<AuthStackParamList>();

export function AuthNavigator(): React.JSX.Element {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Login" component={LoginScreen} />
    </Stack.Navigator>
  );
}
```

- [ ] **Step 16: Create `src/presentation/navigation/MainTabNavigator.tsx`**

```typescript
import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { DashboardScreen } from '../screens/dashboard/DashboardScreen';
import { colours } from '../theme/tokens';
import type { MainTabParamList } from './types';

const Tab = createBottomTabNavigator<MainTabParamList>();

// Placeholder screen for tabs not yet implemented
function PlaceholderScreen({ name }: { name: string }): React.JSX.Element {
  const { View, Text } = require('react-native');
  return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><Text>{name} — coming soon</Text></View>;
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
      <Tab.Screen name="Dashboard" component={DashboardScreen} />
      <Tab.Screen name="Transactions" children={() => <PlaceholderScreen name="Transactions" />} />
      <Tab.Screen name="Meters" children={() => <PlaceholderScreen name="Meters" />} />
      <Tab.Screen name="Snowball" children={() => <PlaceholderScreen name="Snowball" />} />
      <Tab.Screen name="Settings" children={() => <PlaceholderScreen name="Settings" />} />
    </Tab.Navigator>
  );
}
```

- [ ] **Step 17: Create `src/presentation/navigation/RootNavigator.tsx`**

```typescript
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { AuthNavigator } from './AuthNavigator';
import { MainTabNavigator } from './MainTabNavigator';
import { useAppStore } from '../stores/appStore';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator(): React.JSX.Element {
  const session = useAppStore((state) => state.session);

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {session ? (
          <Stack.Screen name="Main" component={MainTabNavigator} />
        ) : (
          <Stack.Screen name="Auth" component={AuthNavigator} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
```

- [ ] **Step 18: Replace `App.tsx` with real app root**

```typescript
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { PaperProvider } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useDatabaseMigrations } from './src/data/local/db';
import { useFonts } from './src/presentation/theme/useFonts';
import { appTheme } from './src/presentation/theme/theme';
import { RootNavigator } from './src/presentation/navigation/RootNavigator';
import { colours } from './src/presentation/theme/tokens';
import { Text } from 'react-native-paper';

export default function App(): React.JSX.Element {
  const { fontsLoaded, fontError } = useFonts();
  const { success: dbReady, error: dbError } = useDatabaseMigrations();

  if (fontError || dbError) {
    return (
      <View style={styles.center}>
        <Text>Error: {(fontError ?? dbError)?.message}</Text>
      </View>
    );
  }

  if (!fontsLoaded || !dbReady) {
    return <View style={styles.center} />;
  }

  return (
    <SafeAreaProvider>
      <PaperProvider theme={appTheme}>
        <RootNavigator />
      </PaperProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colours.surface },
});
```

- [ ] **Step 19: Run tests**

```bash
npx jest src/presentation/components/shared/ --no-coverage
npx tsc --noEmit
```

Expected: all tests pass, TypeScript clean.

- [ ] **Step 20: Verify on device — fonts and navigation load**

```bash
npx expo start --dev-client
```

Expected: app launches showing the Login placeholder screen in correct Deep Teal brand colour, Fraunces and Plus Jakarta Sans fonts loaded, bottom tab bar visible after login (manually set `session` in appStore for testing).

- [ ] **Step 21: Commit**

```bash
git add src/presentation/theme/ src/presentation/components/shared/ src/presentation/navigation/ src/presentation/screens/auth/ src/presentation/screens/dashboard/ App.tsx
git commit -m "feat(presentation): design system — tokens, theme, fonts, navigation shell, shared components"
```

---

## Self-Review

**Spec coverage check:**

| Architecture requirement | Task covering it |
|--------------------------|----------------|
| `create-expo-app blank-typescript` | Task 1 |
| TypeScript strict mode | Task 1 Step 2 |
| All libraries installed | Task 2 |
| ESLint + Prettier + Jest config | Task 3 |
| Clean Architecture directory structure | Task 4 |
| `Result<T,E>`, `DomainError`, `Command<T>` | Task 5 |
| `BudgetPeriodEngine` (FR-68) | Task 6 |
| Drizzle schema — all 9 tables | Task 7 |
| `AuditLogger` | Task 8 |
| `PendingSyncTable` | Task 8 |
| Supabase client + SecureStore adapter | Task 9 |
| `SupabaseAuthService` | Task 9 |
| `app.config.ts` with env vars | Task 9 |
| `appStore` (auth, level, period, sync) | Task 10 |
| `NetworkObserver` | Task 11 |
| GitHub Actions CI | Task 12 |
| Supabase schema + RLS | Task 13 |
| Firebase / EAS dev build | Task 14 |
| Smoke test verification | Task 15 |
| Design tokens + brand palette | Task 16 |
| React Native Paper theme (Fraunces + Plus Jakarta Sans) | Task 16 |
| Font installation and loading hook | Task 16 |
| `CurrencyText` shared component (TDD) | Task 16 |
| `DateText` shared component | Task 16 |
| `EnvelopeFillBar` animated component | Task 16 |
| `LoadingSkeletonCard` component | Task 16 |
| `ErrorSnackbar` component | Task 16 |
| Navigation shell (Root + Auth + Tab navigators) | Task 16 |
| Login + Dashboard placeholder screens | Task 16 |
| Real `App.tsx` root with PaperProvider + fonts + DB | Task 16 |

**Placeholder scan:** None found — all code steps contain complete implementations.

**Type consistency:** `Result<T,E>` from Task 5 used in Task 9's `SupabaseAuthService`. `BudgetPeriod` from Task 5 used in Task 10's `appStore`. `PendingSyncTable` types consistent throughout. `colours`/`spacing`/`radius` tokens from Task 16 used consistently in all shared components — no hardcoded values. ✓
