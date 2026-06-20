# NutSync — CLAUDE.md

Pointer-index for AI-assisted work on this repo. Keep it TRUE to the code. If a
claim here drifts from reality, fix the claim in the same PR as the code.

NutSync is an **offline-first pecan weighing / sorting / grading / invoicing
app**: one Expo (React Native + RN-Web) codebase, bundled into an **Electron**
desktop build, syncing through a **Node-RED hub** over LAN. The hub
implementation lives in a separate repo (`NutSyncNodeRed`) — not in this
checkout. Treat the client SDK (`src/services/node-red/node-red-api.ts`) as the
authoritative contract here.

---

## Persistence rule (highest-leverage discipline)

Conversation context is volatile (reboots, summariser truncation). The only
durable record is **files committed to git**.

> **Litmus test:** if the laptop dies right now, can the next session resume
> purely from the repo? If no, the persistence rule is broken.

So: keep a lightweight paper trail in `docs/`. Audit findings go to
`docs/<TOPIC>-AUDIT-2026-06.md` **before** remediation (the written matrix is the
source of truth, not chat). Any non-trivial feature (sync change, schema change,
new screen contract) gets a short spec markdown committed **before** the code.

---

## Stack & architecture

- **UI / routing:** Expo Router (`app/`, file-based). Tab shell `app/(tabs)/`
  (index/batches/sorting/grading/reports + nested `settings/`), auth group
  `app/(auth)/login.tsx`, dynamic flows `app/batch/[id].tsx`,
  `app/sorting/weighing/[batchId].tsx`, `app/grading/[batchId]/…`. Same bundle
  renders on native and in Electron (RN-Web via `react-native-web`).
- **Local data (source of truth):** `expo-sqlite` (`nutsync.db`, WAL, FK
  enforcement ON) opened in `src/db/database.ts`. Repository layer in
  `src/db/queries/*` — **no SQL in components**. Forward-only transactional
  migrations in `src/db/migrations/*` (recorded in `_migrations`). Tests run the
  same migrations against `better-sqlite3` via
  `src/db/test-utils/in-memory-db.ts`.
- **State:** `zustand` stores (`src/features/*/*store.ts`, e.g. `auth/store.ts`,
  `sync-engine/sync-store.ts`, `sync-engine/hub-config-store.ts`).
- **DB write serialization:** `src/db/db-write-queue.ts`
  (`enqueueExclusiveDbWrite`) — FIFO so only one `BEGIN…COMMIT` runs at a time on
  the singleton connection. The sync merge runs inside this mutex.
- **Sync engine:** `src/features/sync-engine/` — `useSyncEngine.ts` (push/pull
  orchestration), `hub-url.ts` (URL normalization + insecure-target flagging),
  `device-id.ts` (persistent UUID for sync attribution). Apply/merge logic is
  `src/db/queries/sync.ts`. Wire types in `src/types/sync.ts`.
- **Electron main:** `electron/main.js` (window, IPC, `print:to-pdf`,
  `weighsoft-proxy/*`), `electron/preload.js` (narrow IPC surface,
  `contextIsolation` on), `electron/updater.js` (auto-updater),
  `electron/scale-engine.js` (serialport), `electron/weighsoft-proxy-url.js`
  (proxy URL validation).
- **WeighSoft integration:** `src/services/weighsoft/weighsoft-api.ts` (client) →
  Electron main proxy (`proxyWeighSoftRequest`) → LAN WeighSoft device. The hub
  also ingests WeighSoft batches.
- **Scale:** `serialport` in the Electron main (`scale-engine.js`); renderer
  reads weight over IPC. Used by bag/crate weighing flows.
- **NFC:** `react-native-nfc-manager` via `src/features/nfc-crates/useNfcScan.ts`
  (native only) for crate tag association.
- **Auto-updater:** `electron/updater.js` fetches a JSON manifest
  (`version.json`) from a Dropbox/CDN host and installs the `.exe`. See LOCKED
  invariants — this path is security-sensitive.
- **Printing/PDF:** native `expo-print` + Electron `print:to-pdf` rendering
  centrally-escaped HTML templates (`src/features/printing/*`,
  `src/features/reports/utils/*-html.ts`).

---

## Key commands

| Command                  | What it does                                                                                                                                                                                                                                                                             |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`               | `vitest run` — unit + integration. `pretest`/`postinstall` rebuild `better-sqlite3` for the active Node ABI (needed for in-memory DB tests).                                                                                                                                             |
| `npx tsc --noEmit`       | Typecheck (strict; extends `expo/tsconfig.base`). Same gate CI runs.                                                                                                                                                                                                                     |
| `npm start`              | Expo dev server (native / web).                                                                                                                                                                                                                                                          |
| `npm run electron:dev`   | `expo export --platform web` then launch Electron against the bundle.                                                                                                                                                                                                                    |
| `npm run electron:build` | Web export + `electron-rebuild` serialport + `electron-builder`.                                                                                                                                                                                                                         |
| `.\deploy.ps1`           | Release build (Windows). Runs tests, builds the Electron installer, copies artifacts to `..\releasebuild\`, and **computes the installer SHA-256 into `version.json`** for the verified auto-update. `-Version` permanently stamps; `-SkipTests`, `-Clean`, `-IncludeAndroid` available. |

There is **no lint script / eslint config** in this repo — CI runs typecheck +
tests only. Don't invent an `npm run lint`.

---

## LOCKED invariants (must never silently drift)

These are NutSync's domain rules. Discipline alone isn't trusted — back each with
a cheap Vitest test (`src/**/*.test.ts`, `electron/**/*.test.ts`) that fails CI if
violated. Several already have tests; gaps are called out.

1. **SQLite is the offline source of truth; the UI never blocks on the hub.**
2. **IDs are client-generated UUIDs** (`Crypto.randomUUID()`).
3. **Deletes are soft-delete tombstones that propagate.**
4. **The push cursor is `WHERE syncedAt IS NULL`; `markSynced` advances it.**
5. **Conflict resolution is last-writer-wins on the `updatedAt` wall-clock string.**
6. **The sync apply is one atomic transaction inside the write-queue mutex.**
7. **Auto-update integrity (NS-SEC-01).** HTTPS-only + SHA-256 pinned.
8. **HTML output is escaped at the boundary.**
9. **Closed business records freeze their inputs.**

---

## Git / branch hygiene & never-lose-work

- **Never commit directly to `master`.**
- **Conventional commits** — `type(scope): summary`.
- **Never lose work.** `git add && commit && push` after every coherent step.
- **Keep PRs small** (~6-20 files; split epics).

---

## Before writing code (anti-hallucination)

Verify package/API names against `package.json` or the Expo/Electron/Node-RED
docs before use. Record new env vars in their config file and new tables in a
migration + the DATABASE audit. **Verify before done:** run `npx tsc --noEmit` and
`npm test`.
