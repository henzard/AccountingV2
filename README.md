# AccountingV2

A personal finance and household budgeting app for Android, built on Dave Ramsey's envelope budgeting and debt snowball methodologies. Offline-first with Supabase cloud sync.

---

## Features

- **Envelope budgeting** — Allocate monthly income across spending categories; track spend vs. budget in real time
- **Transactions** — Log spending against envelopes, grouped by budget period
- **Debt snowball** — Add debts, log payments, simulate payoff timeline with minimum payment rollover
- **Meter readings** — Track electricity, water, and vehicle odometer consumption; anomaly detection flags readings >20% outside the 3-month rolling average
- **Ramsey Score** — 0–100 gamification score across logging consistency, envelope discipline, meter tracking, and Baby Steps progress
- **Multi-household** — Create multiple households, invite members via 6-character codes, switch between households
- **Notifications** — Daily logging reminders, monthly meter prompts, payday pre-flight envelope reminder
- **Offline-first** — All writes go to local SQLite immediately; synced to Supabase when online

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Expo SDK 55 (Android only) |
| Language | TypeScript 5.9 (strict mode) |
| UI | React Native 0.83 + React Native Paper 5 + React Navigation 7 |
| Local DB | Expo SQLite + Drizzle ORM 0.45 |
| Cloud | Supabase (auth + PostgreSQL sync) |
| State | Zustand 5 |
| Notifications | expo-notifications + Firebase Cloud Messaging |
| Testing | Jest 30 + jest-expo + @testing-library/react-native |

---

## Getting Started

### Prerequisites

- Node.js 20+
- Android SDK with an AVD (Pixel 9 recommended) or a connected Android device
- A [Supabase](https://supabase.com) project

### Environment

Copy `.env.example` to `.env` and fill in your Supabase credentials:

```bash
cp .env.example .env
```

```env
EXPO_PUBLIC_SUPABASE_URL=https://<your-project>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<your-anon-key>
```

### Install and run

```bash
npm install
npx expo run:android
```

---

## Project Structure

```
src/
├── domain/          # Pure business logic — no framework imports
│   ├── budgets/
│   ├── debtSnowball/
│   ├── envelopes/
│   ├── households/
│   ├── meterReadings/
│   ├── scoring/
│   ├── transactions/
│   └── shared/      # Result<T>, DomainError, BudgetPeriodEngine, Command interface
│
├── data/            # Data access
│   ├── local/       # SQLite via Drizzle (schema/, migrations/)
│   ├── remote/      # Supabase client + auth service
│   ├── sync/        # SyncOrchestrator, RestoreService, PendingSyncEnqueuer
│   └── audit/       # Immutable audit log for every domain write
│
├── infrastructure/  # Platform services
│   ├── notifications/
│   ├── network/     # NetworkObserver — triggers sync on reconnect
│   └── storage/     # expo-secure-store
│
└── presentation/    # React Native UI
    ├── screens/     # auth/, budgets/, envelopes/, transactions/,
    │                # debtSnowball/, meters/, household/, settings/
    ├── components/
    ├── navigation/  # RootNavigator (tab-based)
    ├── stores/      # Zustand (session, household, sync status, budget period)
    └── theme/       # React Native Paper theme (Teal #00695C), tokens, fonts
```

### Architecture

Strict Clean Architecture dependency direction:

```
Domain → Data → Infrastructure → Presentation
```

- **Domain** — Pure TypeScript use cases and entities. Each use case implements `Command<T, E>` and returns `Result<T, E>` (never throws). Zero React, Expo, or I/O dependencies.
- **Data** — Drizzle ORM for local SQLite. `PendingSyncEnqueuer` queues every write. `SyncOrchestrator` pushes the queue to Supabase when online. `RestoreService` pulls remote state on login.
- **Infrastructure** — Network state, local notifications, secure storage, crypto.
- **Presentation** — Screens consume use cases directly. Zustand tracks global session state.

---

## Database

### Local: SQLite via Drizzle ORM

Database file: `accountingv2.db` (created in the app's document directory on first launch)

| Table | Purpose |
|-------|---------|
| `households` | Household entity; multi-user scope |
| `household_members` | Household membership (userId, role) |
| `envelopes` | Budget categories with `allocatedCents` / `spentCents` |
| `transactions` | Spending log tied to envelopes |
| `debts` | Debt entries for snowball tracking |
| `meter_readings` | Utility and vehicle readings |
| `audit_events` | Immutable write log (entityType, action, before/after JSON) |
| `baby_steps` | Dave Ramsey Baby Steps progress |
| `pending_sync` | Queue of rows waiting to sync to Supabase |
| `slip_queue` | Receipt/slip OCR queue |

Migrations live in `src/data/local/migrations/` and run automatically on app startup via `useDatabaseMigrations()`.

To generate a migration after a schema change:

```bash
npx drizzle-kit generate
```

### Cloud: Supabase

Mirrors the SQLite schema in PostgreSQL. Sync flow:

1. **On login** — `RestoreService` fetches remote state and merges into local SQLite
2. **On any write** — domain use case calls `PendingSyncEnqueuer.enqueue()`
3. **On reconnect** — `NetworkObserver` triggers `SyncOrchestrator` to push the pending queue

---

## Testing

```bash
npx jest                  # Run all tests
npx jest --coverage       # With coverage report
npx tsc --noEmit          # Type check
npx eslint src/ --ext .ts,.tsx --max-warnings 0  # Lint
```

127 tests across domain and data layers. Coverage threshold: **80% lines** (enforced in CI).

Domain logic is the most heavily tested — use cases, entities, and algorithms (snowball projector, anomaly detector, score calculator). Tests live in `__tests__/` subdirectories alongside the code they test.

---

## CI / CD

### CI (`.github/workflows/ci.yml`)

Runs on every push and pull request:

1. TypeScript check (`tsc --noEmit`)
2. ESLint (zero warnings)
3. Jest with 80% line coverage threshold

### CD (`.github/workflows/cd.yml`)

Runs on every push to `master`:

1. Full CI gate
2. Decode release keystore from `KEYSTORE_BASE64` secret
3. Build signed release AAB: `./gradlew bundleRelease -PversionCode=${{ github.run_number }}`
4. Upload to **Google Play Internal Testing** via `r0adkll/upload-google-play@v1`

#### Required GitHub Secrets

| Secret | Description |
|--------|-------------|
| `KEYSTORE_BASE64` | Release keystore, base64-encoded |
| `KEYSTORE_STORE_PASSWORD` | Keystore store password |
| `KEYSTORE_KEY_ALIAS` | Key alias |
| `KEYSTORE_KEY_PASSWORD` | Key password |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` | Google Play API service account JSON |

---

## Development Notes

- All monetary values are stored as **cents** (integers) — no floating point
- UUIDs generated with `expo-crypto` (`Crypto.randomUUID()`)
- Budget periods are driven by each household's `paydayDay` (1–28, default 25); envelope `spentCents` resets each period
- The debt snowball projector simulates up to 600 months (50-year cap); debts are processed in `sortOrder` ascending (smallest balance first)
- Anomaly detection requires at least 4 prior readings to compute 3 consumption deltas for a rolling average
- Path aliases: `@domain/`, `@data/`, `@presentation/`, `@infrastructure/` (configured in `tsconfig.json`)
- The `android/` directory is committed to the repo (bare workflow) — do not re-add it to `.gitignore`
