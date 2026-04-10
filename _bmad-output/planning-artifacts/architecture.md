---
stepsCompleted: [step-01-init, step-02-context, step-03-starter, step-04-decisions, step-05-patterns, step-06-structure, step-07-validation, step-08-complete]
lastStep: 8
status: complete
completedAt: '2026-04-10'
inputDocuments: ['_bmad-output/planning-artifacts/prd.md']
workflowType: 'architecture'
project_name: 'AccountingV2'
user_name: 'Henza'
date: '2026-04-09'
---

# Architecture Decision Document

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

---

## 1. Project Context Analysis

**Date:** 2026-04-09
**PRD Source:** `_bmad-output/planning-artifacts/prd.md` (74 FRs, 38 NFRs)

### Scale Assessment

**Medium-High Complexity** — four interlocking complexity dimensions:

| Dimension | Complexity Driver |
|-----------|------------------|
| Offline-first dual-store | SQLite (truth) + Supabase (sync) with conflict resolution, pending queue, delta sync |
| AI pipeline | Async offline queue → Supabase Edge Function → OpenAI Vision → structured extraction |
| Budget mechanics | Configurable pay-period boundaries, savings-first constraint, no-rollover enforcement, Ramsey Score |
| Progressive UX system | Three-tier user levels affecting UI density, feature exposure, and navigation across every screen |

### Critical Architectural Constraints

| Constraint | Source | Architectural Impact |
|-----------|--------|---------------------|
| 100% offline functionality | FR-54, NFR-R01 | Every feature must work against SQLite; Supabase is never required for core use |
| OpenAI API key never in app bundle | NFR-S04 | All OpenAI calls route via Supabase Edge Function (server-side proxy) |
| Device-level encryption at rest | NFR-S01 (revised) | Android 10+ file-based encryption (FBE) provides OS-level SQLite protection; no application-layer SQLCipher added — `expo-sqlite` retained |
| Configurable pay-period (e.g. 20th→19th) | FR-68 | Central `BudgetPeriodEngine` — all date calculations reference it |
| Savings-first allocation | FR-69 | Envelope fill flow is non-linear; savings locked before spending distributable |
| No rollover without deliberate decision | FR-70 | Period close requires blocking routing prompt — cannot be bypassed |
| Command Pattern for all mutations | NFR-Q04 | Every state-mutating action is a discrete command object enabling undo and audit |
| User Level drives UI | FR-35 | Level lives in root Zustand store, consulted by navigation and all screens |
| RLS per household | NFR-S03, FR-53 | All Supabase tables keyed by `household_id` matching `auth.uid()` |
| GUID + `updated_at` last-write-wins | NFR-R03, FR-63 | Every entity gets `id UUID`, `updated_at TIMESTAMP`, `synced BOOLEAN` |

### NFR-S01 Deviation Record

> **Decision:** `expo-sqlite` is used without SQLCipher application-layer encryption.
> **Rationale:** Android 10 (API 29) minimum target enforces file-based encryption (FBE) at the OS level, providing equivalent protection for SQLite files when the device is locked. Adding SQLCipher via `op-sqlite` would require ejecting from Expo Managed Workflow, increasing build complexity and maintenance overhead disproportionate to the risk profile of a household-use app with a device PIN/biometric lock requirement (NFR-S06).
> **Residual risk:** A device with a compromised OS or physical root access could theoretically read SQLite files. Mitigated by: device PIN/biometric enforced on resume (NFR-S06), no cloud credentials stored locally, and user advisory at onboarding.

### Cross-Cutting Concerns

These concerns span all layers and are resolved architecturally before feature work:

1. **Budget Period Boundary** — All envelopes, balances, reports, scores, and audit events are scoped to a `BudgetPeriod`. The `BudgetPeriodEngine` (payday date → current start/end range) is initialised at app launch and consulted by every financial query.

2. **Audit Log** — Every Command writes to an `audit_events` table before returning. No mutation is complete without its audit record. Audit events sync to Supabase.

3. **User Level** — Checked at every navigation entry point and feature gate. Stored in Zustand root store, hydrated from SQLite at launch. Level changes persist to SQLite and Supabase.

4. **Connectivity Observer** — Single `NetworkObserver` service triggers: (a) Supabase delta sync, (b) OpenAI queue drain, (c) FCM token registration check. All three subscribe to the same connectivity event.

5. **Pending Sync Queue** — A `pending_sync` table in SQLite tracks every unsynced entity by `table_name` and `record_id`. Cleared row-by-row on confirmed Supabase write. Never cleared optimistically.

### Technology Stack (Confirmed)

| Concern | Technology | Notes |
|---------|-----------|-------|
| Framework | React Native + Expo Managed Workflow | Eject only if Expo SDK ceiling hit |
| Local DB | `expo-sqlite` | No SQLCipher; OS-level FBE relied upon |
| Cloud | Supabase (JS client + Edge Functions) | RLS required on every table |
| AI proxy | Supabase Edge Function | OpenAI API key server-side only; never in app bundle |
| State | Zustand | One slice per domain; root store for user/level/period |
| UI | React Native Paper (Material Design 3) | Fixed brand palette; no dynamic Material You |
| Navigation | react-navigation v6 | Stack + Tab; level-gated screen registration |
| Notifications | expo-notifications + @react-native-firebase/messaging | Local scheduled + Supabase-triggered FCM coaching |
| Network | @react-native-community/netinfo | Reconnect trigger for sync + queue drain |
| Testing | Jest + React Native Testing Library + Maestro | 80% Domain layer coverage minimum |
| Language | TypeScript strict mode | No `any`; full type coverage |

### Architecture Style: Feature-Sliced Clean Architecture

Mandated by NFR-Q01 through NFR-Q06. Layers import only downward — never sideways or upward.

```
src/
├── domain/           # Business rules, use cases, repository interfaces — zero RN/Expo imports
│   ├── budgets/
│   ├── transactions/
│   ├── meters/
│   ├── debts/
│   ├── scoring/
│   └── shared/       # BudgetPeriodEngine, Command base, Strategy interfaces
├── data/             # SQLite repos, Supabase repos, sync engine, AI queue
│   ├── local/        # SQLite implementations of repository interfaces
│   ├── remote/       # Supabase implementations + Edge Function client
│   ├── sync/         # SyncOrchestrator, PendingSyncTable, ConflictResolver
│   └── ai/           # SlipQueue, ExtractionClient, ResultMapper
├── presentation/     # Screens, components, Zustand stores — no direct data access
│   ├── screens/
│   ├── components/
│   └── stores/       # Zustand slices per domain
└── infrastructure/   # DI container, navigation, crypto/auth, network observer, notifications
```

### Phase 1 MVP Architectural Surface

| Epic Area | Key Components |
|-----------|---------------|
| Budget & Envelopes | `BudgetPeriodEngine`, `EnvelopeRepository`, `EnvelopeAllocationCommand`, `SavingsFirstAllocator`, `RolloverRoutingFlow` |
| Transactions | `TransactionRepository`, `CreateTransactionCommand`, `SplitTransactionCommand`, `AuditLogger` |
| Meter Readings | `MeterReadingRepository`, `UnitRateCalculator`, `AnomalyDetector` |
| AI Slip Scan | `SlipQueue` (SQLite-backed), `EdgeFunctionClient`, `ExtractionConfirmationFlow` |
| Sync | `SyncOrchestrator`, `PendingSyncTable`, `ConflictResolver` (GUID + last-write-wins) |
| Scoring & Levels | `RamseyScoreCalculator`, `LevelAdvancementEvaluator`, `LevelStore` (Zustand root) |
| Notifications | `LocalNotificationScheduler`, `FCMHandler`, `NotificationPreferencesRepository` |
| Debt Snowball | `DebtRepository`, `SnowballPayoffProjector`, `DebtPaymentCommand` |

---

## 2. Starter Template

**Date:** 2026-04-09

### Primary Technology Domain

Mobile App — React Native + Expo Managed Workflow (confirmed from PRD; Expo SDK 55 / React Native 0.83)

### Starter Options Evaluated

| Option | Description | Decision |
|--------|-------------|----------|
| `create-expo-app --template blank-typescript` | Official Expo minimal starter; TypeScript; no pre-wired routing/state/UI | **Selected** |
| Obytes Starter | Zustand + SQLite + TS pre-configured; uses NativeWind + Expo Router — wrong UI/routing stack | Rejected |
| react-native-template-clean-architecture | Clean Architecture layers pre-configured; uses Ui-Kitten, not Expo Managed | Rejected |
| Expo + Supabase community starters | Expo Router + NativeWind; good auth patterns but incompatible stack | Rejected |

**Rationale:** No community template matches our full stack without more rework than a clean start. The blank TypeScript template provides full architectural freedom with no pre-wired decisions to unwire.

### Routing Decision

**Selected: react-navigation v6** (as specified in PRD) over Expo Router v6.

Expo Router's file-based routing derives route structure from the `app/` directory filesystem, which conflicts with Clean Architecture's deliberate presentation layer design. react-navigation v6 gives explicit, programmatic navigation control — the right fit for a domain-driven screen architecture.

### Selected Starter: `create-expo-app` blank-typescript

**Initialization Command:**

```bash
npx create-expo-app@latest AccountingV2 --template blank-typescript
```

**Immediate post-init configuration:**

```bash
# Navigation
npx expo install @react-navigation/native @react-navigation/native-stack @react-navigation/bottom-tabs

# SQLite (local DB — offline source of truth)
npx expo install expo-sqlite

# Supabase (cloud sync + Edge Functions)
npm install @supabase/supabase-js

# UI — React Native Paper (Material Design 3)
npm install react-native-paper react-native-vector-icons

# State management
npm install zustand

# Network + Camera + Notifications
npx expo install @react-native-community/netinfo expo-camera expo-image-picker expo-notifications

# Firebase Cloud Messaging (coaching notifications — Phase 2, wired now)
npx expo install @react-native-firebase/app @react-native-firebase/messaging

# Testing
npm install --save-dev jest @testing-library/react-native @types/jest

# Linting + formatting
npm install --save-dev eslint prettier @typescript-eslint/parser @typescript-eslint/eslint-plugin
```

**TypeScript strict mode** — applied to `tsconfig.json` immediately after init:

```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "noImplicitReturns": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true
  }
}
```

**Architectural Decisions Established by Starter:**

- **Language:** TypeScript (strict mode enforced from day one)
- **Runtime:** React Native 0.83 via Expo SDK 55
- **Build tooling:** Expo CLI + EAS Build (Expo Application Services)
- **Module resolution:** Expo Managed — no custom native modules without a dev build
- **Development client:** `expo-dev-client` for development builds (required once any native module beyond Expo SDK is added)
- **Testing infrastructure:** Jest configured separately (not included in blank template)
- **Code organisation:** Fully custom — Clean Architecture `src/` structure imposed by us

**Note:** Project initialization plus library installation above constitutes Sprint 0, Story 0 — the scaffolding story before any feature work begins.

---

## 3. Core Architectural Decisions

**Date:** 2026-04-09

### Decision Priority Analysis

**Critical Decisions (Block Implementation):**
- SQLite migration strategy — must be chosen before first schema is written
- Auth method — gates all Supabase RLS configuration
- Session persistence — required for offline-resumable auth
- Budget period storage design — referenced by every financial query

**Important Decisions (Shape Architecture):**
- Sync delta strategy — determines `pending_sync` table design
- Error handling standard — applied consistently across all layers
- Navigation structure — determines screen registration pattern
- Component structure — determines folder layout before first screen

**Deferred Decisions (Post-MVP):**
- Crash reporting (prohibited by NFR-S05 — reconsidered only if POPIA-compliant option found)
- Multiple build variants (debug/staging/prod EAS profiles — can be added as needed)
- WhatsApp/Telegram bot infrastructure (Phase 2)

---

### Data Architecture

| # | Decision | Choice | Rationale |
|---|---------|--------|-----------|
| 1.1 | SQLite migration runner | **Drizzle ORM** (`drizzle-orm` + `drizzle-kit`) | TypeScript-first schema with type-safe query builder; migration files generated by drizzle-kit; compatible with expo-sqlite; strict mode aligned |
| 1.2 | Budget period storage | **Derived on demand** | Store only `payday_day: number` in household config; `BudgetPeriodEngine` computes `period_start`/`period_end` for any given date at query time; no period rows in DB for MVP |
| 1.3 | Sync delta strategy | **`pending_sync` queue table** | On every SQLite write (INSERT/UPDATE/DELETE), a row is added: `(table_name, record_id, operation, created_at, retry_count, last_attempted_at)`. On reconnect, `SyncOrchestrator` processes queue in order, upserts to Supabase, removes row on success. Queue is authoritative — no timestamp watermark needed |

**Drizzle library addition:**
```bash
npm install drizzle-orm
npm install --save-dev drizzle-kit
```

**`BudgetPeriodEngine` contract:**
```typescript
interface BudgetPeriodEngine {
  getCurrentPeriod(paydayDay: number, referenceDate?: Date): BudgetPeriod;
  getPeriodForDate(paydayDay: number, date: Date): BudgetPeriod;
}

interface BudgetPeriod {
  startDate: Date; // e.g. 2026-03-20
  endDate: Date;   // e.g. 2026-04-19
  label: string;   // e.g. "20 Mar – 19 Apr"
}
```

---

### Authentication & Security

| # | Decision | Choice | Rationale |
|---|---------|--------|-----------|
| 2.1 | Auth method | **Supabase email/password** | Household app with two known users; no social login needed; offline-resumable with stored JWT; simple RLS integration |
| 2.2 | Session persistence | **`expo-secure-store` adapter** | Supabase JS client accepts custom storage; expo-secure-store writes to device keychain; survives restarts; works offline |
| 2.3 | App resume auth | **`expo-local-authentication`** | Biometric/PIN gate on foreground after 5-minute inactivity (NFR-S06); local check only — does not re-authenticate against Supabase |

**Session adapter pattern:**
```typescript
import * as SecureStore from 'expo-secure-store';
import { createClient } from '@supabase/supabase-js';

const supabaseStorage = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { storage: supabaseStorage, autoRefreshToken: true, persistSession: true },
});
```

**Additional library:**
```bash
npx expo install expo-secure-store expo-local-authentication
```

---

### API & Communication Patterns

| # | Decision | Choice | Rationale |
|---|---------|--------|-----------|
| 3.1 | OpenAI proxy | **Supabase Edge Function (Deno)** | API key never leaves server; function receives base64 image, calls OpenAI, returns structured JSON; stateless and scalable |
| 3.2 | Error handling | **Result type → Snackbar → full-screen fatal** | Domain use cases return `Result<T, DomainError>` (no thrown exceptions in business logic); infrastructure errors mapped to domain errors at repository boundary; UI renders Snackbar for transient errors, inline validation for forms, full-screen for fatal (e.g. DB init failure) |
| 3.3 | Sync retry | **Exponential backoff, max 5 retries / 30s cap** | `delay = min(baseDelay * 2^attempt + jitter, 30_000ms)`; retry state tracked in `pending_sync.retry_count` + `last_attempted_at`; after 5 failures the record stays queued and is surfaced in sync status indicator (FR-64) |

**Result type:**
```typescript
type Result<T, E = DomainError> =
  | { success: true; data: T }
  | { success: false; error: E };
```

**Edge Function MVP surface:**
- `process-slip` — receives base64 image, returns `SlipExtraction` JSON
- (Phase 2) `send-coaching-notification` — FCM push triggered by Supabase database function

---

### Frontend Architecture

| # | Decision | Choice | Rationale |
|---|---------|--------|-----------|
| 4.1 | Component structure | **Feature-sliced** | Each feature owns its screens + feature-specific components under `presentation/screens/<feature>/`; shared components in `presentation/components/shared/`; no strict atomic hierarchy |
| 4.2 | Navigation structure | **Root Stack → Auth Stack / Main Tab** | Clean separation of authenticated and unauthenticated surfaces; level-gated tabs registered conditionally from `appStore.userLevel`; no duplicate navigation trees per level |

**Navigation tree:**
```
RootNavigator (Stack)
├── AuthNavigator (Stack) — shown when !session
│   ├── LoginScreen
│   └── OnboardingWizardNavigator (Stack)
│       ├── WizardStep1_Income
│       ├── WizardStep2_Expenses
│       ├── WizardStep3_Envelopes
│       ├── WizardStep4_MeterBaselines
│       └── WizardStep5_BabyStepStart
└── MainNavigator (BottomTab) — shown when session exists
    ├── DashboardStack
    ├── TransactionsStack
    ├── MetersStack
    ├── SnowballStack
    └── SettingsStack
```

**Zustand store slices:**
```
appStore       — authSession, userLevel, currentBudgetPeriod, syncStatus
budgetStore    — envelopes, currentPeriodAllocations
transactionStore — transactions, pendingSlips
meterStore     — readings, rateHistory
debtStore      — debts, snowballPlan
notificationStore — preferences, scheduledReminders
```

---

### Infrastructure & Deployment

| # | Decision | Choice | Rationale |
|---|---------|--------|-----------|
| 5.1 | Build service | **EAS Build** | Expo-managed Android builds; no local Android SDK required; generates AAB for Play Store |
| 5.2 | Distribution path | **Google Play Internal Test → Production** | Internal track for pilot household testing (Henza + sister) before public release |
| 5.3 | Environment config | **expo-constants via `app.config.ts`** | Supabase URL + anon key in `.env`; read via `process.env` in `app.config.ts`; exposed via `Constants.expoConfig.extra`; OpenAI key never on client |
| 5.4 | CI/CD | **GitHub Actions + EAS CLI** | On `main` push: ESLint + TypeScript check + Jest; on release tag: EAS Build → Play Store Internal Track |
| 5.5 | Monitoring | **Supabase dashboard + EAS Build logs** | No crash reporters (NFR-S05 prohibits data-transmitting services); Supabase logs Edge Function errors and sync patterns |

**GitHub Actions pipeline (minimal):**
```yaml
# .github/workflows/ci.yml
on: [push]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npx tsc --noEmit
      - run: npx eslint src/
      - run: npx jest --coverage
```

---

### Decision Impact Analysis

**Implementation Sequence (order matters):**
1. Drizzle schema + migration setup (before any feature code — everything depends on the DB)
2. Supabase project + RLS policies (before auth can be tested)
3. `BudgetPeriodEngine` (before any financial query can be scoped)
4. Auth flow + session persistence (gates all authenticated screens)
5. `pending_sync` table + `SyncOrchestrator` skeleton (before any write can be trusted offline)
6. Feature epics in order: Budget → Transactions → Meters → Debt Snowball → Notifications

**Cross-Component Dependencies:**
- `BudgetPeriodEngine` → consumed by `budgetStore`, `transactionStore`, `meterStore`, `RamseyScoreCalculator`
- `SyncOrchestrator` → reads from all repositories, writes to `pending_sync`; triggered by `NetworkObserver`
- `appStore.userLevel` → consumed by navigation (tab visibility), all screens (guidance density), `RamseyScoreCalculator` (advancement logic)
- `Result<T, DomainError>` type → used by every use case return value and every Zustand action handler

---

## 4. Implementation Patterns & Consistency Rules

**Date:** 2026-04-09

### Naming Patterns

**Database Naming (SQLite via Drizzle + Supabase — column names must match exactly):**

| Rule | Convention | Example |
|------|-----------|---------|
| Table names | `snake_case`, plural | `households`, `envelopes`, `meter_readings`, `audit_events` |
| Column names | `snake_case` | `household_id`, `payday_day`, `updated_at` |
| Primary key | always `id` (UUID TEXT) | `id TEXT PRIMARY KEY` |
| Foreign keys | `<singular_table>_id` | `envelope_id`, `household_id` |
| Timestamps | `created_at`, `updated_at` on every table | `updated_at TEXT NOT NULL` |
| Booleans | `is_<state>` | `is_synced`, `is_archived`, `is_business_expense` |
| Sync queue table | `pending_sync` — never renamed | — |

**Code Naming (TypeScript):**

| Construct | Convention | Example |
|-----------|-----------|---------|
| Interfaces / Types | `PascalCase` | `Envelope`, `BudgetPeriod`, `DomainError` |
| Classes | `PascalCase` | `BudgetPeriodEngine`, `SyncOrchestrator` |
| Repository interfaces | `<Entity>Repository` | `EnvelopeRepository`, `TransactionRepository` |
| Repository implementations | `SQLite<Entity>Repository` | `SQLiteEnvelopeRepository` |
| Use cases | `<Action><Entity>UseCase` | `CreateEnvelopeUseCase`, `LogMeterReadingUseCase` |
| Commands | `<Action><Entity>Command` | `TransferEnvelopeFundsCommand`, `CreateTransactionCommand` |
| React hooks | `use<Name>` | `useBudgetPeriod`, `useEnvelopes` |
| Functions / methods | `camelCase` | `getCurrentPeriod()`, `createTransaction()` |
| Variables | `camelCase` | `envelopeBalance`, `paydayDay` |
| Constants | `SCREAMING_SNAKE_CASE` | `MAX_RETRY_COUNT`, `INACTIVITY_TIMEOUT_MS` |

**File Naming:**

| File type | Convention | Example |
|-----------|-----------|---------|
| React components / screens | `PascalCase.tsx` | `EnvelopeCard.tsx`, `BudgetDashboardScreen.tsx` |
| Zustand stores | `camelCaseStore.ts` | `budgetStore.ts`, `appStore.ts` |
| Use cases / engines / services | `PascalCase.ts` | `BudgetPeriodEngine.ts`, `SyncOrchestrator.ts` |
| React hooks | `useCamelCase.ts` | `useBudgetPeriod.ts` |
| Test files | `<FileName>.test.ts(x)` — co-located | `EnvelopeCard.test.tsx` |
| Drizzle schema | `schema.ts` per feature data folder | `src/data/local/budgets/schema.ts` |
| Barrel exports | `index.ts` per domain feature folder | `src/domain/budgets/index.ts` |
| Directories | `camelCase` | `budgets/`, `meterReadings/`, `debtSnowball/` |

---

### Structure Patterns

**Domain feature folder layout (all features follow this template):**
```
src/domain/<feature>/
  <Entity>.ts                    # domain type / entity interface
  <Entity>Repository.ts          # repository interface (no implementation)
  <Action><Entity>UseCase.ts     # one use case per file
  types.ts                       # shared domain types for this feature
  index.ts                       # barrel: export all public domain items
```

**Data layer folder layout:**
```
src/data/local/<feature>/
  schema.ts                              # Drizzle table definitions for this feature
  SQLite<Entity>Repository.ts            # implements <Entity>Repository
  SQLite<Entity>Repository.test.ts       # in-memory SQLite tests
```

**Presentation folder layout:**
```
src/presentation/screens/<feature>/
  <Feature>DashboardScreen.tsx
  <SubFeature>Screen.tsx
  components/
    <FeatureComponent>.tsx
    <FeatureComponent>.test.tsx
```

**Test locations:**
- Unit tests (use cases, engines): co-located `.test.ts` alongside source file — no separate `__tests__/` directory
- Component tests: co-located `.test.tsx` alongside component
- E2E Maestro scripts: `/e2e/*.yaml` at project root — never inside `src/`

---

### Format Patterns

**Currency — integer cents throughout:**

| Rule | Detail |
|------|--------|
| Storage | `INTEGER` column in SQLite — R123.45 stored as `12345` |
| Display | `(cents / 100).toLocaleString('en-ZA', { style: 'currency', currency: 'ZAR' })` |
| Arithmetic | Always in cents — never `parseFloat` on a currency string |
| User input | Parse decimal string → `Math.round(parseFloat(input) * 100)` → store as integer |

**Dates:**

| Rule | Detail |
|------|--------|
| Storage | ISO 8601 string (`TEXT` column) — `2026-03-20T00:00:00.000Z` |
| Manipulation | `date-fns` library — never native `Date` display methods |
| Display | `format(date, 'dd MMM yyyy')` via date-fns |
| Period comparison | Always compare as `Date` objects — never raw string comparison |

**UUIDs:**
```typescript
import { randomUUID } from 'expo-crypto'; // built into Expo SDK — no extra install
const id = randomUUID(); // called at entity creation, client-side
// Never: Math.random(), Date.now(), or auto-increment integers as primary keys
```

**SQLite ↔ TypeScript field mapping:**
- SQLite / Supabase columns: `snake_case` (database convention)
- TypeScript access: `camelCase` (TS convention)
- Drizzle handles the mapping automatically — define both in schema

---

### Communication Patterns

**Zustand store structure — every store follows this template exactly:**

```typescript
interface <Feature>State {
  items: Item[];
  isLoading<Operation>: boolean;   // per-operation loading flag
  <operation>Error: DomainError | null;
}

interface <Feature>Actions {
  fetch<Items>: () => Promise<void>;
  create<Item>: (input: Create<Item>Input) => Promise<void>;
}

export const use<Feature>Store = create<FeatureState & FeatureActions>((set) => ({
  items: [],
  isLoadingItems: false,
  fetchItemsError: null,
  fetchItems: async () => {
    set({ isLoadingItems: true, fetchItemsError: null });
    const result = await repository.getAll();
    if (result.success) set({ items: result.data, isLoadingItems: false });
    else set({ fetchItemsError: result.error, isLoadingItems: false });
  },
}));
```

**Rules:**
- Loading flags: per-operation (`isLoadingEnvelopes`, `isCreatingTransaction`) — never a single `isLoading`
- Error state: per-operation, cleared on next action attempt
- Actions never throw — set error state and return
- State updates via `set()` with spread — no direct mutation

**Command template — all state-mutating operations:**
```typescript
interface Command<T> {
  execute(): Promise<Result<T, DomainError>>;
  undo?(): Promise<Result<void, DomainError>>;
}
// Every Command.execute() MUST atomically:
// 1. Complete the SQLite write
// 2. Write an audit_events row
// 3. Add a pending_sync row
// If any step fails, all three are rolled back
```

---

### Process Patterns

**Error handling chain — all agents must follow:**
```
Use Case → Result<T, DomainError>  (never throws)
Store Action → unwraps Result → sets error state or updates data state
Screen → reads store error →
  transient/recoverable  → <Snackbar> (auto-dismiss)
  form validation error  → inline field error text
  fatal (DB unreachable) → full-screen ErrorBoundary with retry button
Error cleared on: next action attempt OR component unmount
```

**Loading state — UI rules:**
- Skeleton loaders preferred over spinners where layout is known
- Spinner only for indeterminate operations (sync, OCR processing)
- Never block the entire screen with a modal loading overlay

**Form validation — two-layer rule:**

| Layer | Validates | When |
|-------|----------|------|
| UI layer | Required fields, basic format (is this a number?) | On blur + submit |
| Domain use case | Business rules (transfer ≤ balance, period dates valid) | On `execute()` — authoritative |

Domain layer always re-validates. UI validation is UX; domain validation is correctness.

**Audit log — mandatory for every Command:**
```typescript
// audit_events table: id, household_id, entity_type, entity_id,
//   action, previous_value_json, new_value_json, created_at, is_synced
await auditLogger.log({
  entityType: 'envelope',
  entityId: envelope.id,
  action: 'TRANSFER_FUNDS',
  previousValue: { balanceCents: before },
  newValue: { balanceCents: after },
});
```

**Pending sync — mandatory after every SQLite write:**
```typescript
await pendingSyncTable.enqueue({
  tableName: 'envelopes',
  recordId: envelope.id,
  operation: 'UPDATE', // 'INSERT' | 'UPDATE' | 'DELETE'
});
// SyncOrchestrator drains on connectivity — never write directly to Supabase from a use case
```

---

### Enforcement Guidelines

**All agents MUST:**
- Store currency as integer cents — never `REAL`/`FLOAT` in SQLite
- Use `randomUUID()` from `expo-crypto` for all entity IDs
- Return `Result<T, DomainError>` from use cases — never throw from domain layer
- Write to `audit_events` and `pending_sync` atomically with every Command execution
- Use `date-fns` for all date formatting and arithmetic
- Follow `<Entity>Repository` / `SQLite<Entity>Repository` naming split
- Co-locate `.test.ts(x)` files with source — no separate test directories
- Use per-operation loading flags — never a global `isLoading`
- Keep all business rules in domain use cases — screens are display only

**Forbidden anti-patterns:**

| Anti-pattern | Reason |
|-------------|--------|
| `parseFloat(amountString)` for currency | Float precision errors on ZAR values |
| Auto-increment integer primary keys | Breaks GUID-based last-write-wins sync |
| `new Date().toLocaleDateString()` for display | Inconsistent output across Android versions |
| Direct Supabase calls from screens or stores | Violates Clean Architecture — must go through repository |
| `any` TypeScript type | Violates NFR-Q09 strict mode |
| Throwing exceptions from use cases | Breaks `Result<T, E>` contract |
| Clearing `pending_sync` optimistically | Queue is authoritative — clear only on confirmed Supabase write |
| OpenAI key in `.env` or app bundle | NFR-S04 — key lives in Supabase Edge Function only |
| Single global loading spinner blocking screen | UX violation — skeleton loaders preferred |

---

## 5. Project Structure & Boundaries

**Date:** 2026-04-10

### Complete Project Directory Structure

```
AccountingV2/
├── .env                            # SUPABASE_URL, SUPABASE_ANON_KEY — never committed
├── .env.example                    # template (committed)
├── .eslintrc.js
├── .gitignore
├── .prettierrc
├── app.config.ts                   # Expo config — reads process.env, exposes via Constants.expoConfig.extra
├── app.json
├── babel.config.js
├── drizzle.config.ts               # drizzle-kit config (SQLite dialect, schema path, migrations path)
├── jest.config.js
├── package.json
├── tsconfig.json                   # strict: true, noImplicitAny, noImplicitReturns
│
├── .github/
│   └── workflows/
│       ├── ci.yml                  # lint + tsc + jest on every push
│       └── release.yml             # EAS Build + Play Store Internal Track on release tag
│
├── e2e/                            # Maestro YAML test scripts
│   ├── onboarding.yaml
│   ├── addTransaction.yaml
│   ├── envelopeTransfer.yaml
│   ├── meterReading.yaml
│   ├── slipCapture.yaml            # mocked Edge Function response
│   └── syncStatus.yaml
│
├── supabase/
│   ├── config.toml
│   ├── migrations/
│   │   ├── 001_initial_schema.sql  # households, envelopes, transactions, meter_readings
│   │   ├── 002_debt_snowball.sql
│   │   └── 003_audit_sync.sql      # audit_events, pending_sync
│   └── functions/
│       └── process-slip/
│           └── index.ts            # Deno Edge Function — receives image, calls OpenAI, returns SlipExtraction JSON
│
├── assets/
│   ├── icon.png
│   ├── splash.png
│   └── fonts/
│
└── src/
    │
    ├── domain/                     # Pure business logic — zero React Native / Expo imports
    │   ├── shared/
    │   │   ├── types.ts            # Result<T,E>, DomainError, BudgetPeriod, AuditEvent
    │   │   ├── Command.ts          # Command<T> interface
    │   │   ├── BudgetPeriodEngine.ts
    │   │   └── BudgetPeriodEngine.test.ts
    │   │
    │   ├── budgets/
    │   │   ├── Envelope.ts
    │   │   ├── EnvelopeRepository.ts
    │   │   ├── CreateEnvelopeUseCase.ts
    │   │   ├── CreateEnvelopeUseCase.test.ts
    │   │   ├── TransferEnvelopeFundsUseCase.ts
    │   │   ├── TransferEnvelopeFundsUseCase.test.ts
    │   │   ├── AllocateSavingsFirstUseCase.ts   # FR-69
    │   │   ├── ClosePeriodWithRolloverRoutingUseCase.ts  # FR-70
    │   │   └── index.ts
    │   │
    │   ├── transactions/
    │   │   ├── Transaction.ts
    │   │   ├── TransactionRepository.ts
    │   │   ├── CreateTransactionUseCase.ts
    │   │   ├── CreateTransactionUseCase.test.ts
    │   │   ├── SplitTransactionUseCase.ts
    │   │   ├── EditTransactionUseCase.ts
    │   │   ├── SpendingTriggerUseCase.ts        # FR-72
    │   │   └── index.ts
    │   │
    │   ├── meterReadings/
    │   │   ├── MeterReading.ts
    │   │   ├── MeterReadingRepository.ts
    │   │   ├── LogMeterReadingUseCase.ts
    │   │   ├── LogMeterReadingUseCase.test.ts
    │   │   ├── UnitRateCalculator.ts            # FR-25
    │   │   ├── UnitRateCalculator.test.ts
    │   │   ├── AnomalyDetector.ts               # FR-28 >20% deviation
    │   │   └── index.ts
    │   │
    │   ├── debtSnowball/
    │   │   ├── Debt.ts
    │   │   ├── DebtRepository.ts
    │   │   ├── CreateDebtUseCase.ts
    │   │   ├── LogDebtPaymentUseCase.ts
    │   │   ├── SnowballPayoffProjector.ts       # FR-74
    │   │   ├── SnowballPayoffProjector.test.ts
    │   │   └── index.ts
    │   │
    │   ├── scoring/
    │   │   ├── RamseyScore.ts
    │   │   ├── RamseyScoreCalculator.ts         # FR-33
    │   │   ├── RamseyScoreCalculator.test.ts
    │   │   ├── LevelAdvancementEvaluator.ts     # FR-34 ≥70 for 3 periods
    │   │   └── index.ts
    │   │
    │   ├── slipScanning/
    │   │   ├── SlipExtraction.ts
    │   │   ├── SlipScanRepository.ts
    │   │   ├── QueueSlipForScanningUseCase.ts   # FR-17 offline queue
    │   │   ├── ConfirmExtractionUseCase.ts      # FR-16 user review + commit
    │   │   └── index.ts
    │   │
    │   └── household/
    │       ├── Household.ts
    │       ├── HouseholdRepository.ts
    │       ├── SetupHouseholdUseCase.ts
    │       └── index.ts
    │
    ├── data/
    │   ├── local/
    │   │   ├── db.ts                            # Drizzle client init + runMigrations()
    │   │   ├── schema/
    │   │   │   ├── households.ts
    │   │   │   ├── envelopes.ts
    │   │   │   ├── transactions.ts
    │   │   │   ├── meterReadings.ts
    │   │   │   ├── debts.ts
    │   │   │   ├── slipQueue.ts
    │   │   │   ├── auditEvents.ts
    │   │   │   ├── pendingSync.ts
    │   │   │   └── index.ts
    │   │   ├── migrations/                      # drizzle-kit generated SQL
    │   │   │   └── 0001_initial.sql
    │   │   ├── budgets/
    │   │   │   ├── SQLiteEnvelopeRepository.ts
    │   │   │   └── SQLiteEnvelopeRepository.test.ts
    │   │   ├── transactions/
    │   │   │   ├── SQLiteTransactionRepository.ts
    │   │   │   └── SQLiteTransactionRepository.test.ts
    │   │   ├── meterReadings/
    │   │   │   ├── SQLiteMeterReadingRepository.ts
    │   │   │   └── SQLiteMeterReadingRepository.test.ts
    │   │   ├── debtSnowball/
    │   │   │   ├── SQLiteDebtRepository.ts
    │   │   │   └── SQLiteDebtRepository.test.ts
    │   │   ├── slipScanning/
    │   │   │   ├── SQLiteSlipQueueRepository.ts
    │   │   │   └── SQLiteSlipQueueRepository.test.ts
    │   │   └── household/
    │   │       ├── SQLiteHouseholdRepository.ts
    │   │       └── SQLiteHouseholdRepository.test.ts
    │   │
    │   ├── remote/
    │   │   ├── supabaseClient.ts                # createClient() with SecureStore adapter
    │   │   ├── SupabaseAuthService.ts
    │   │   ├── SupabaseHouseholdRepository.ts   # restore from cloud
    │   │   └── EdgeFunctionClient.ts            # calls process-slip
    │   │
    │   ├── sync/
    │   │   ├── SyncOrchestrator.ts
    │   │   ├── SyncOrchestrator.test.ts
    │   │   ├── ConflictResolver.ts              # GUID + updated_at last-write-wins
    │   │   └── PendingSyncTable.ts              # enqueue() / drain()
    │   │
    │   └── audit/
    │       ├── AuditLogger.ts
    │       └── AuditLogger.test.ts
    │
    ├── presentation/
    │   ├── navigation/
    │   │   ├── RootNavigator.tsx
    │   │   ├── AuthNavigator.tsx
    │   │   ├── MainTabNavigator.tsx
    │   │   └── types.ts                         # RootStackParamList, TabParamList
    │   │
    │   ├── stores/
    │   │   ├── appStore.ts                      # authSession, userLevel, currentBudgetPeriod, syncStatus
    │   │   ├── budgetStore.ts
    │   │   ├── transactionStore.ts
    │   │   ├── meterStore.ts
    │   │   ├── debtStore.ts
    │   │   └── notificationStore.ts
    │   │
    │   ├── screens/
    │   │   ├── auth/
    │   │   │   ├── LoginScreen.tsx
    │   │   │   ├── LoginScreen.test.tsx
    │   │   │   └── onboarding/
    │   │   │       ├── WizardStep1_Income.tsx
    │   │   │       ├── WizardStep2_Expenses.tsx
    │   │   │       ├── WizardStep3_Envelopes.tsx
    │   │   │       ├── WizardStep4_MeterBaselines.tsx
    │   │   │       └── WizardStep5_BabyStepStart.tsx
    │   │   │
    │   │   ├── dashboard/
    │   │   │   ├── DashboardScreen.tsx
    │   │   │   ├── DashboardScreen.test.tsx
    │   │   │   └── components/
    │   │   │       ├── EnvelopeSummaryCard.tsx
    │   │   │       ├── SyncStatusBar.tsx
    │   │   │       └── RamseyScoreBadge.tsx
    │   │   │
    │   │   ├── budgets/
    │   │   │   ├── EnvelopeListScreen.tsx
    │   │   │   ├── EnvelopeDetailScreen.tsx
    │   │   │   ├── CreateEnvelopeScreen.tsx
    │   │   │   ├── TransferFundsScreen.tsx
    │   │   │   ├── PeriodCloseScreen.tsx        # FR-70 rollover routing prompt
    │   │   │   ├── SurplusCelebrationScreen.tsx # FR-71
    │   │   │   └── components/
    │   │   │       ├── EnvelopeCard.tsx
    │   │   │       ├── EnvelopeCard.test.tsx
    │   │   │       └── EnvelopeFillBar.tsx
    │   │   │
    │   │   ├── transactions/
    │   │   │   ├── TransactionListScreen.tsx
    │   │   │   ├── AddTransactionScreen.tsx     # 3-tap quick entry FR-12
    │   │   │   ├── EditTransactionScreen.tsx
    │   │   │   ├── SlipCaptureScreen.tsx
    │   │   │   ├── SlipConfirmScreen.tsx        # FR-16 review before save
    │   │   │   ├── SpendingTriggerScreen.tsx    # FR-72
    │   │   │   └── components/
    │   │   │       ├── TransactionRow.tsx
    │   │   │       ├── AmountInput.tsx
    │   │   │       └── EnvelopePicker.tsx
    │   │   │
    │   │   ├── meters/
    │   │   │   ├── MeterDashboardScreen.tsx     # FR-29
    │   │   │   ├── AddReadingScreen.tsx
    │   │   │   ├── RateHistoryScreen.tsx        # FR-26
    │   │   │   └── components/
    │   │   │       ├── MeterReadingCard.tsx
    │   │   │       └── RateTrendChart.tsx
    │   │   │
    │   │   ├── debtSnowball/
    │   │   │   ├── SnowballDashboardScreen.tsx  # FR-74
    │   │   │   ├── AddDebtScreen.tsx            # FR-73
    │   │   │   ├── DebtDetailScreen.tsx
    │   │   │   ├── LogPaymentScreen.tsx
    │   │   │   └── components/
    │   │   │       ├── DebtPayoffBar.tsx        # animated reducing bar
    │   │   │       └── PayoffProjectionCard.tsx
    │   │   │
    │   │   └── settings/
    │   │       ├── SettingsScreen.tsx
    │   │       ├── NotificationPreferencesScreen.tsx
    │   │       ├── SyncStatusScreen.tsx         # FR-64
    │   │       ├── HouseholdSetupScreen.tsx     # payday date config FR-68
    │   │       └── DataExportScreen.tsx         # NFR-S08 export + delete
    │   │
    │   └── components/
    │       └── shared/
    │           ├── CurrencyText.tsx             # integer cents → ZAR display
    │           ├── DateText.tsx                 # ISO date → date-fns format
    │           ├── LoadingSkeletonCard.tsx
    │           ├── ErrorSnackbar.tsx
    │           ├── ConfirmDialog.tsx
    │           └── BabyStepProgressBar.tsx      # FR-32
    │
    └── infrastructure/
        ├── di/
        │   └── container.ts                    # wires interfaces → SQLite implementations
        ├── crypto/
        │   └── BiometricAuthService.ts         # expo-local-authentication; NFR-S06
        ├── network/
        │   └── NetworkObserver.ts              # netinfo → SyncOrchestrator + queue drain
        ├── notifications/
        │   ├── LocalNotificationScheduler.ts   # expo-notifications
        │   ├── FCMHandler.ts                   # @react-native-firebase/messaging
        │   └── NotificationPreferencesRepository.ts
        └── storage/
            └── SecureStorageAdapter.ts         # expo-secure-store → Supabase storage interface
```

### Architectural Boundaries

**Layer import rule — strict one-way:**
```
presentation  →  domain       ✅ (reads interfaces and types)
data          →  domain       ✅ (implements interfaces)
infrastructure → data         ✅ (configures implementations)
presentation  →  data         ❌ FORBIDDEN
domain        →  React Native ❌ FORBIDDEN (pure TypeScript only)
```

**External integration entry points:**

| Integration | Entry Point | Direction |
|------------|------------|-----------|
| SQLite reads/writes | `data/local/<feature>/SQLite<Entity>Repository.ts` | App → SQLite |
| Supabase sync | `data/sync/SyncOrchestrator.ts` | App → Supabase (background) |
| Supabase auth | `data/remote/SupabaseAuthService.ts` | App → Supabase Auth |
| OpenAI Vision | `supabase/functions/process-slip/index.ts` | Edge Function → OpenAI only |
| FCM push | `infrastructure/notifications/FCMHandler.ts` | Supabase → FCM → App |
| Biometric auth | `infrastructure/crypto/BiometricAuthService.ts` | App → expo-local-authentication |
| Camera/gallery | `presentation/screens/transactions/SlipCaptureScreen.tsx` | User → expo-camera |

### FR Category → Directory Mapping

| FR Group | Domain | Data (local) | Presentation |
|---------|--------|-------------|-------------|
| FR-1 Budget & Envelope | `domain/budgets/` | `data/local/budgets/` | `screens/budgets/` |
| FR-2 Transactions | `domain/transactions/` | `data/local/transactions/` | `screens/transactions/` |
| FR-3 Utility & Home Metrics | `domain/meterReadings/` | `data/local/meterReadings/` | `screens/meters/` |
| FR-4 Journey & Coaching | `domain/scoring/` | (stored on household record) | `screens/dashboard/` |
| FR-5 Business Expense | *Phase 2 — not scaffolded in MVP* | — | — |
| FR-6 Household & User | `domain/household/` | `data/local/household/`, `data/remote/` | `screens/auth/`, `screens/settings/` |
| FR-7 Insight & Reporting | (existing use cases + calculators) | (existing repos) | `screens/budgets/`, `screens/meters/` |
| FR-8 Data & Sync | — | `data/sync/`, `data/audit/` | `screens/settings/SyncStatusScreen.tsx` |
| FR-9 Budget Mechanics | `domain/shared/BudgetPeriodEngine.ts`, `domain/budgets/` | (existing repos) | `screens/budgets/PeriodCloseScreen.tsx` |
| FR-10 Debt Snowball | `domain/debtSnowball/` | `data/local/debtSnowball/` | `screens/debtSnowball/` |

**Cross-cutting concern locations:**

| Concern | Location |
|---------|---------|
| Budget period scoping | `domain/shared/BudgetPeriodEngine.ts` |
| Audit logging | `data/audit/AuditLogger.ts` |
| Sync queue | `data/sync/PendingSyncTable.ts` + `SyncOrchestrator.ts` |
| Connectivity trigger | `infrastructure/network/NetworkObserver.ts` |
| Auth state + user level | `presentation/stores/appStore.ts` |
| Dependency wiring | `infrastructure/di/container.ts` |
| Currency display | `presentation/components/shared/CurrencyText.tsx` |
| Date display | `presentation/components/shared/DateText.tsx` |

### Data Flow Diagrams

**Transaction entry (online):**
```
AddTransactionScreen
  → CreateTransactionCommand.execute()
    → SQLiteTransactionRepository.insert()   [source of truth]
    → AuditLogger.log()                      [audit_events]
    → PendingSyncTable.enqueue()             [pending_sync]
  → Result<Transaction> → transactionStore updates
  → NetworkObserver (online) → SyncOrchestrator.drain()
    → ConflictResolver → Supabase upsert → PendingSyncTable.clear(id)
```

**Slip scanning (offline → reconnect):**
```
SlipCaptureScreen
  → QueueSlipForScanningUseCase (offline: enqueues image to slipQueue table)
  → [user goes online]
  → NetworkObserver → EdgeFunctionClient.call('process-slip', imageBase64)
    → Supabase Edge Function → OpenAI Vision → SlipExtraction JSON
  → SlipConfirmScreen (user reviews extracted items)
  → ConfirmExtractionUseCase → CreateTransactionCommand per confirmed item
```

### Structure Additions (Applied from Validation)

The following files are added to the structure to close FR gaps identified in validation:

**Baby Steps domain (FR-32 — Must Have):**
```
src/domain/budgets/
  BabyStep.ts                         # entity: stepNumber, name, completionCondition, completedAt
  BabyStepRepository.ts               # interface
  CompleteBabyStepUseCase.ts          # milestone completion + celebration trigger
  (index.ts updated)

src/data/local/schema/
  babySteps.ts                        # Drizzle table

src/data/local/budgets/
  SQLiteBabyStepRepository.ts
  SQLiteBabyStepRepository.test.ts
```

**21-day logging streak (FR-40 — Must Have):**
```
src/domain/scoring/
  LoggingStreakTracker.ts             # consecutive-day counter; streak badge at 21 days
  LoggingStreakTracker.test.ts
  (index.ts updated)
```

**Monthly health summary (FR-37 — Must Have):**
```
src/presentation/screens/dashboard/
  MonthEndSummaryScreen.tsx           # budget performance, variances, utility trends,
                                      # Ramsey Score delta, Baby Step progress
```

**AI conversational advisor (FR-39 — Should Have Phase 1):**
```
src/domain/budgets/
  AskAdvisorUseCase.ts                # validates connectivity, formats context, calls Edge Function

src/presentation/screens/budgets/
  AdvisorScreen.tsx                   # on-demand; connectivity required; strict-mode responses

supabase/functions/
  ask-advisor/
    index.ts                          # Deno Edge Function — OpenAI chat completion
                                      # with household budget context injected as system prompt
```

**Category spend analysis (FR-57 — Should Have Phase 1):**
```
src/presentation/screens/budgets/
  SpendAnalysisScreen.tsx             # pie + bar charts via any date range; FR-57
```

---

## 6. Architecture Validation Results

**Date:** 2026-04-10

### Coherence Validation ✅

**Decision Compatibility:**

| Check | Status | Note |
|-------|--------|------|
| expo-sqlite + Drizzle ORM | ✅ | Compatible; actively maintained together |
| React Native Paper + react-navigation v6 | ✅ | Standard pairing; no conflicts |
| Zustand + React Native | ✅ | Lightweight; no peer conflicts |
| Supabase JS + expo-secure-store adapter | ✅ | Official Supabase pattern |
| expo-crypto randomUUID + strict TS | ✅ | Fully typed; no `any` required |
| date-fns + TypeScript strict | ✅ | Full type coverage available |
| Android 10 FBE + no SQLCipher | ✅ | Intentional deviation documented; risk accepted |
| `@react-native-firebase` + Expo Managed | ⚠️ | Native module — requires `expo-dev-client` and EAS development build from Sprint 0. Also requires `google-services.json` from Firebase Console placed at project root and referenced in `app.config.ts`. Expo Go client cannot be used once this library is installed. |

**Pattern consistency:** All naming conventions internally consistent across domain, data, and presentation layers. `Result<T,E>` contract applied at all use case boundaries. Repository interface / SQLite implementation split enforced everywhere. Command pattern covers all state-mutating operations. ✅

**Structure alignment:** Layer directories map 1:1 to Clean Architecture boundaries. Cross-cutting concerns each have a single canonical file. Data flow diagrams traverse layers correctly (presentation → domain → data, never skipping). ✅

### Requirements Coverage Validation ✅

**Functional Requirements:**

| FR Group | Coverage | Notes |
|---------|---------|-------|
| FR-1 Budget & Envelope | ✅ | FR-07 recurring templates: not scaffolded; Phase 1 Should Have — add use case when implementing |
| FR-2 Transactions | ✅ | All sub-requirements covered |
| FR-3 Utility & Home Metrics | ✅ | FR-27 prepaid token handled in `AddReadingScreen` |
| FR-4 Journey & Coaching | ✅ | Gaps closed by validation additions (FR-32, 37, 39, 40) |
| FR-5 Business Expense | ✅ | Phase 2 — correctly deferred |
| FR-6 Household & User | ✅ | All covered |
| FR-7 Insight & Reporting | ✅ | FR-57 gap closed by `SpendAnalysisScreen.tsx` addition |
| FR-8 Data & Sync | ✅ | All covered |
| FR-9 Budget Mechanics | ✅ | All 5 FRs explicitly scaffolded |
| FR-10 Debt Snowball | ✅ | Both FRs explicitly scaffolded |

**Non-Functional Requirements:**

| NFR Area | Coverage |
|---------|---------|
| Performance (P01–P07) | ✅ SQLite local writes for all core ops; background sync; skeleton loaders |
| Security (S01–S08) | ✅ Android FBE (S01 deviation documented); TLS; RLS; Edge Function key proxy; BiometricAuthService; DataExportScreen |
| Reliability (R01–R06) | ✅ SyncOrchestrator; pending_sync queue; exponential backoff; offline parity |
| Accessibility (A01–A06) | ✅ React Native Paper MD3 baseline; CurrencyText/DateText shared components for consistent rendering |
| Code Quality (Q01–Q09) | ✅ Clean Architecture enforced in directory structure; Result<T,E>; Command; strict TS |
| Testing (T01–T06) | ✅ Co-located `.test.ts(x)`; Jest + RNTL; Maestro in `/e2e/`; 80% domain coverage target |

### Implementation Readiness Validation ✅

**Decision completeness:** All critical decisions documented with technology names and rationale. NFR-S01 deviation explicitly recorded with residual risk and mitigation. Sprint 0 Firebase dev-build requirement noted. ✅

**Structure completeness:** Every directory and file named specifically. No generic placeholders remain. All integration points identified with direction and entry file. ✅

**Pattern completeness:** Naming conventions cover all construct types. Format rules cover currency (integer cents), dates (ISO + date-fns), and UUIDs (expo-crypto). Zustand store template defined. Command contract defined. Error chain defined. Anti-pattern list explicit. ✅

### Architecture Completeness Checklist

**Requirements Analysis**
- [x] Project context thoroughly analysed (74 FRs, 38 NFRs)
- [x] Scale and complexity assessed (Medium-High)
- [x] Technical constraints identified and recorded
- [x] Cross-cutting concerns mapped to specific locations

**Architectural Decisions**
- [x] Critical decisions documented with technology names
- [x] Technology stack fully specified (Expo SDK 55, React Native 0.83)
- [x] Integration patterns defined (Edge Functions, SecureStore, FCM)
- [x] Performance considerations addressed
- [x] NFR-S01 deviation documented with residual risk accepted

**Implementation Patterns**
- [x] Naming conventions established for all construct types
- [x] Structure patterns defined with templates
- [x] Communication patterns specified (Zustand, Command, Result)
- [x] Process patterns documented (error chain, loading, validation layers)
- [x] Anti-patterns explicitly listed

**Project Structure**
- [x] Complete directory tree defined with all files named
- [x] Component boundaries established
- [x] Integration entry points mapped
- [x] FR → directory mapping complete
- [x] Validation gaps resolved and additions applied

### Architecture Readiness Assessment

**Overall Status: READY FOR IMPLEMENTATION**

**Confidence Level: High**

**Key Strengths:**
- Offline-first is structurally enforced — SQLite is the source of truth at every write point; Supabase never receives a direct call from a use case
- Budget period boundary (`BudgetPeriodEngine`) is a first-class architectural citizen — not an afterthought in queries
- Savings-first (FR-69) and no-rollover (FR-70) are discrete use cases, not UI logic — they cannot be bypassed
- Command + AuditLogger + PendingSyncTable are atomically coupled — data integrity is structural
- OpenAI API key isolation is enforced by architecture (Edge Function boundary) — no configuration discipline required

**Areas for Future Enhancement (Post-MVP):**
- WhatsApp/Telegram bot webhook infrastructure (Phase 2) — not scaffolded; will require a separate webhook server layer
- Business expense tracking (Phase 2) — domain not started; will extend `domain/transactions/` with a claim workflow
- Learner levelling system full UI (Phase 3) — `LevelAdvancementEvaluator` is in place; Phase 3 adds the progression UX
- Multiple Firebase environments (dev/staging/prod EAS build profiles) — add to `.github/workflows/release.yml` when needed

### Implementation Handoff

**Sprint 0 — Scaffolding Story (before any feature work):**
```bash
# 1. Initialise project
npx create-expo-app@latest AccountingV2 --template blank-typescript

# 2. Install all libraries (see Section 2 — Starter Template)

# 3. Apply tsconfig.json strict mode

# 4. Set up Drizzle schema + run initial migration

# 5. Create Supabase project + apply migrations in supabase/migrations/

# 6. Create Firebase project + download google-services.json + configure app.config.ts

# 7. Create EAS development build (required for @react-native-firebase)
eas build --profile development --platform android

# 8. Set up GitHub Actions CI workflow

# 9. Verify: app launches, SQLite initialises, Supabase auth connects, dev build installs
```

**Implementation order (after Sprint 0):**
1. `domain/shared/` — `BudgetPeriodEngine`, `Result<T,E>` types, `Command<T>` interface
2. `data/local/db.ts` + all Drizzle schemas + `AuditLogger` + `PendingSyncTable`
3. `data/remote/supabaseClient.ts` + `SupabaseAuthService` + `SecureStorageAdapter`
4. Auth flow: `LoginScreen` → `appStore` session management
5. `SyncOrchestrator` + `NetworkObserver` skeleton
6. Feature epics: Budget & Envelope → Transactions → Meter Readings → Debt Snowball → Scoring & Notifications

**All AI agents implementing this project must:**
- Follow all naming conventions in Section 4 exactly
- Return `Result<T, DomainError>` from every use case — never throw
- Write to `audit_events` and `pending_sync` atomically with every Command
- Store currency as integer cents — never `REAL` or `parseFloat`
- Use `randomUUID()` from `expo-crypto` for all entity IDs
- Keep all business rules in `src/domain/` — screens contain no financial logic
- Refer to this document for all architectural questions before making independent decisions
