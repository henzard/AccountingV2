# Web support (Expo web / react-native-web)

AccountingV2 is primarily an Android app. This document describes the **web
build** — running the same codebase in a browser via `react-native-web` — what
works today, how it's built and tested, and the one architectural gap that
still blocks full parity.

## How to build & run locally

```bash
# Build the static web bundle
EXPO_PUBLIC_SUPABASE_URL=https://demo-web-e2e.supabase.co \
EXPO_PUBLIC_SUPABASE_ANON_KEY=demo-anon-key \
npx expo export --platform web --output-dir dist-web

# Serve it (COOP/COEP headers are required for wa-sqlite's OPFS backend)
node e2e-web/serve-web.js dist-web 8080
# open http://127.0.0.1:8080

# Run the Playwright end-to-end suite against the served bundle
node e2e-web/web-e2e.js http://127.0.0.1:8080 ./pw-artifacts
```

CI runs the same flow on every push — see `.github/workflows/web-e2e.yml`.

## What works

- **The bundle compiles** for web (`platforms: ['android', 'web']` +
  `web.output: 'single'` in `app.config.ts`).
- **The app boots and renders** in the browser: the login / sign-up / forgot-
  password screens render, fields accept input, and navigation works. Verified
  by the Playwright suite (`e2e-web/web-e2e.js`, 11 checks, green).
- **Auth restore**: a persisted Supabase session in `localStorage` advances the
  app past the login wall (the whole gate is local — `EnsureHouseholdUseCase`
  makes no network call).
- The local SQLite database initializes on web through **wa-sqlite** and its
  **migrations run**.

## Web-specific shims (what it took)

| Concern                              | Native                          | Web                            | Where                               |
| ------------------------------------ | ------------------------------- | ------------------------------ | ----------------------------------- |
| SQLite wasm asset                    | n/a                             | register `wasm` asset          | `metro.config.js`                   |
| SQLite worker cold start             | n/a                             | async warm-up before sync init | `index.ts`                          |
| Migration transaction                | `withExclusiveTransactionAsync` | `withTransactionAsync`         | `src/data/local/db.ts`              |
| Firebase (crashlytics/messaging/app) | native SDK                      | no-op stubs (Metro alias)      | `metro.config.js`, `web-shims/`     |
| Secure session storage               | `expo-secure-store`             | `localStorage`                 | `SecureStorageAdapter.web.ts`       |
| Local notifications                  | `expo-notifications`            | no-op scheduler                | `LocalNotificationScheduler.web.ts` |

## Known gap — synchronous SQLite queries

The data layer uses **drizzle-orm's synchronous** expo-sqlite driver
(`openDatabaseSync` + `prepareSync`). On web, expo-sqlite runs SQLite in a Web
Worker and the synchronous API busy-waits on a `SharedArrayBuffer`:

- **Migrations work** because they were routed through the _async_ API
  (`withTransactionAsync`).
- **Runtime queries do not**: the first synchronous query during the
  authenticated cold start (`initSession` → `EnsureHouseholdUseCase` →
  drizzle `prepareSync` → `invokeWorkerSync`) fails against the OPFS-backed
  connection, so the authenticated tree currently lands on the boot-recovery
  screen instead of the dashboard.

Reaching the full authenticated experience on web (dashboard, budget envelopes,
debts, meters, the monthly-income flow) requires **migrating the data layer to
drizzle's asynchronous driver**. That is a cross-cutting change (every query
site) that also affects the native build, so it is tracked as a separate piece
of work rather than bundled here. The web E2E reports this state as a
diagnostic rather than a hard failure so CI still gates on what genuinely
works.
