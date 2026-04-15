# Phased Roadmap — post-swarm-audit

_2026-04-15 • based on `docs/swarm-audit-2026-04-15.md`_

Four phases, ~6 weeks total with one full-time engineer plus part-time product and design. Phases are ordered by **blast radius**, not effort — Phase 1 unlocks every subsequent phase; Phase 2 is the gate to promoting past Play Store internal track; Phases 3 + 4 can partially parallelise.

## Phase 1 — "Users can actually use it" (~1.5 weeks)

**Goal:** a brand-new user can sign up and log their first transaction in under 90 seconds, on a device in either light or dark theme.

**Scope**

- Onboarding allocation wizard (replace R0.01 envelope seed with a real split-your-income step)
- Dashboard **Add Transaction** primary FAB (replace the envelope-creation + FAB)
- Dashboard KPI typography promotion (Remaining/Spent/Allocated → `headlineSmall` + tabular-nums)
- Collapse the two stacked FABs — move camera to header or secondary action
- Ramsey Score badge legibility (score 24pt bold, label 10pt tracked)
- Theme fix: remove `userInterfaceStyle: 'light'` from `app.config.ts`; move `AddTransactionScreen` and `slipScanning/*` onto `useAppTheme()`
- Add an **Appearance** row in Settings (system / light / dark), persisted in AsyncStorage and consumed by `useAppTheme`
- `SyncOrchestrator.syncPending()` concurrency latch
- Guard non-null `householdId!` assertions in Dashboard, Baby Steps, Income, Payday with a `LoadingSkeleton` fallback

**Mix:** frontend + product + one small backend change
**Exit criteria**

- Internal-tester journey: fresh install → signed in → allocated envelopes totalling their income → logged one transaction, all in <90s.
- Dark-mode toggle works on every screen a user can reach without a special build.
- No concurrent-run duplicate entries in `pendingSync` under network-regain + foreground races.

## Phase 2 — "Data + spend can't go wrong" (~2 weeks)

**Goal:** no known data-loss, cost-abuse, or enumeration paths.

**Scope**

- Land Phase A of `docs/superpowers/plans/2026-04-13-codebase-hardening.md`
  - `merge_baby_step` RPC crash on conflict
  - `user_households` ↔ `household_members` duality (invited members silently lose access to data)
- Migration runner per-file `BEGIN/COMMIT`, checksum per migration stored in `__app_migrations`, refuse boot on checksum mismatch
- `invitations` RLS fix — require invite code header or remove the `SELECT` policy entirely
- OpenAI rate-limit TOCTOU — `pg_advisory_xact_lock(household_id_hash)` or atomic `UPDATE ... RETURNING count` before calling OpenAI
- Rename `Ramsey Score` → `Habit Score` (or re-weight toward EF funded %, debts cleared, 15% retirement flag, bond progress — pick one)

**Mix:** backend + product
**Exit criteria**

- Two-device household test: member A deletes a transaction offline while member B edits it; no silent data loss, conflict surfaces clearly.
- `pg_cron` cost-audit shows no household exceeding the 50/day cap even under simulated parallel burst.
- `SELECT * FROM invitations` as a non-creator returns 0 rows.

## Phase 3 — "Looks consistent + scales" (~1.5 weeks, partial parallel with Phase 2)

**Goal:** visual consistency score ≥ 85/100; ~500 LOC of duplicated JSX removed.

**Scope**

- Extract five missing UI primitives:
  - `StatCard` / `KPIBlock` — Dashboard summary row, Budget banner, Debt payoff card
  - `OnboardingStepLayout` — the 7 onboarding steps' shared chrome (`KeyboardAvoidingView → ScrollView → Title → Subtitle → children → primary CTA`)
  - `ListRow` — transactions and settings list-item convergence
  - `PickerField` — envelope picker + date picker in `AddTransactionScreen`
  - `SectionHeader` — unify the three ad-hoc implementations
- Flatten transaction list rows — remove per-row `Surface elevation={1}`, add 1px `outlineVariant` divider
- Consolidate `networkStore` + `appStore.pendingSyncCount` into one sync slice
- Populate or delete the empty `src/infrastructure/di/` directory

**Mix:** frontend
**Exit criteria**

- Design audit re-run scores ≥ 85/100 on visual consistency.
- Each of the five primitives has at least two call sites; no duplicate `StyleSheet` declarations for their patterns survive.

## Phase 4 — "Ready for public beta" (~1 week)

**Goal:** external users can find the app, install it, and report back with real signal.

**Scope**

- Un-skip one Detox E2E journey (login → add envelope → log transaction) with a working `.detoxrc.js` build script; remove `continue-on-error: true` from the `e2e-android` job
- Encrypted SQLite via `op-sqlite` + SQLCipher (or document residual risk + set `android:allowBackup="false"`)
- Play Store track: draft → internal with real testers (listing copy, screenshots, tester group)
- Firebase Test Lab smoke run on each CD build
- `bmad-create-epics-and-stories` back-fill mapping superpowers plans to PRD sections
- `.github/workflows/cd.yml` Crashlytics mapping upload: remove `continue-on-error: true`

**Mix:** devops + backend + product
**Exit criteria**

- Green E2E gate in CI on every master commit.
- ≥ 5 real testers on the internal track with at least one crash-free 7-day session each.
- Privacy-policy wording matches shipped behaviour (SQLite encryption, slip retention, OpenAI DPA).

---

## Skip-rule

Phase 1 + 2 alone produces an _honest and safe_ app. That's a legitimate closed-beta ship point. Phase 3 should land before opening the testing track wider.

## Out of scope for this roadmap

Slip-scanning enhancements, iOS build, CSV export, family-chat transaction notes, full hexagonal refactor (domain layer still imports Expo/Drizzle — noted in audit, not addressed here because no user is blocked on it).
