# Slice 4: Period Rollover Engine + Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Build the real period-rollover the app has only pretended to do — copy-forward envelopes at payday with type-aware rules, deterministic cross-device idempotency, and a 3-step wizard replacing the lying "your envelopes have been reset" modal. Fix the flagged EMF create-time duplicate race along the way.

**Architecture:** `StartNewPeriodUseCase` copies non-archived period-scoped envelopes into the new period as deterministic-id INSERT ops (UUIDv5 over householdId+periodStart+sourceEnvelopeId, per spec §6.6) via the slice-3 `createSyncedRepo`; user allocation adjustments emit as separate UPDATE ops (so two offline devices converge instead of one clobbering the other). Persistent-scoped envelopes (sinking/emergency/savings) are NOT copied — they carry across periods by definition (slice-3 scope). A rollover wizard (review last period → adjust allocations → commit) fires when `isNewPeriodWithin` triggers. Spec: `docs/superpowers/specs/2026-07-03-oplog-sync-correctness-design.md` §3, §6.6.

**Tech Stack:** Drizzle + expo-sqlite, realsql tier, React Native Paper, expo-crypto (uuidv5 — verify it exposes v5; if not, add a minimal deterministic UUIDv5 impl or the `uuid` pkg's v5 behind an adapter, matching slice-3's expo-crypto-first decision).

## Global Constraints

- All gates green at end of EVERY task: realsql, app-coverage (80/60), tsc, eslint, `supabase db reset`+`supabase test db`.
- Deterministic id: UUIDv5(namespace, `${householdId}:${periodStart}:${sourceEnvelopeId}`). Same inputs → same id on every device, so the copy-forward INSERT op is idempotent (server treats an insert whose row exists with the same id as an applied no-op, spec §6.6). Confirm expo-crypto can do v5; if only randomUUID(v4), implement a small RFC-4122 v5 (SHA-1 namespace hash) helper with a test vector — do NOT use a non-deterministic id.
- Rollover writes go through slice-3 `createSyncedRepo` (oplog append; dark until slice 5). Balance is derived — copied envelopes start with spent 0 automatically (no transactions in the new period yet).
- Idempotent per period: running rollover twice for the same period must not duplicate envelopes (deterministic ids guarantee this locally; add an explicit guard/test).
- Money integer cents. Persistent envelopes untouched by rollover.

---

### Task 1: StartNewPeriodUseCase — copy-forward with deterministic ids (realsql, TDD)

**Files:** Create `src/domain/budgets/StartNewPeriodUseCase.ts`; Create `src/infrastructure/crypto/uuidv5.ts` (deterministic UUIDv5 helper — fills the empty crypto/ dir the deep review flagged) + test with an RFC-4122 test vector; Test `tests/realsql/startNewPeriod.test.ts`.

**Interfaces:** `StartNewPeriodUseCase.execute({ householdId, fromPeriodStart, toPeriodStart })` → Result: reads non-archived period-scoped envelopes of `fromPeriodStart`, inserts a copy of each into `toPeriodStart` with id = uuidv5(householdId, toPeriodStart, sourceId), allocatedCents copied, via createSyncedRepo (one oplog op each). Persistent envelopes skipped. Returns the count copied. `uuidv5(namespace, name): string`.

TDD: (1) uuidv5 helper matches a known RFC-4122 v5 test vector (deterministic). (2) rollover copies period-scoped envelopes to the new period with derived spent 0, allocations preserved, persistent envelopes NOT duplicated. (3) **idempotency**: running execute twice produces the SAME envelope ids and does not create duplicates (second run's inserts are no-ops or skipped). (4) each copy appends exactly one oplog insert op.

---

### Task 2: EMF create-time duplicate guard (the flagged race)

**Files:** Modify `src/domain/envelopes/CreateEnvelopeUseCase.ts` (guard against a second active emergency_fund in the same household); Test.

**Interfaces:** CreateEnvelopeUseCase, when creating an `emergency_fund` (or the persistent singletons per product rule — check EMF only unless the codebase treats others as singletons), checks for an existing non-archived, non-deleted emergency_fund in the household and returns a domain failure (or returns the existing one idempotently) instead of creating a duplicate. This is the real fix the slice-3 Task-6 subagent flagged; once it holds, the `emergencyFundReconcileStore` banner becomes a backstop rather than the only guard (do NOT remove the store here — that's a later cleanup; just make duplicates not happen at creation).

TDD: creating a second emergency_fund in a household fails (or returns existing); creating one in a DIFFERENT household still works; a soft-deleted EMF does not block creating a new one.

---

### Task 3: Wizard UI — replace the lying modal with review→adjust→commit

**Files:** Create `src/presentation/screens/budgets/RolloverWizard.tsx` (3 steps); Modify `src/presentation/screens/dashboard/DashboardScreen.tsx` (trigger the wizard instead of PeriodRolloverModal when isNewPeriodWithin fires); Modify/replace `PeriodRolloverModal.tsx` (delete or repurpose — its copy is false); wire the wizard's commit to StartNewPeriodUseCase + emit adjustment UPDATE ops. Tests.

**Interfaces:** Wizard steps: (1) Review last period — overspent envelopes, totals, wins (read-only summary from derived balances); (2) Adjust allocations — editable per-envelope allocation for the copied set, defaulting to last period's; (3) Commit — runs StartNewPeriodUseCase then applies the user's allocation edits as UPDATE ops, marks the period acknowledged (reuse the existing per-period AsyncStorage ack key so it fires once). Accessibility: WCAG AA (labels, focus, 48dp targets) per weighsoft-ui-ux-design.

TDD: wizard renders the 3 steps; commit calls StartNewPeriodUseCase with the right periods; allocation edits produce UPDATE ops; the "envelopes have been reset" false copy is gone; the ack fires once per period.

---

### Task 4: Dashboard/BabySteps integration + final verification

**Files:** Modify DashboardScreen rollover trigger; confirm ReconcileBabyStepsUseCase now sees the persistent EMF correctly post-rollover (the monthly Step 1/3 regression should be structurally fixed by slice-3 persistent scope + this copy-forward — add a regression test proving Baby Step 1 does NOT regress after a period rollover); status doc + spec as-built note.

- [ ] Full gate green (realsql/app-coverage/tsc/eslint/supabase).
- [ ] Regression test: period rolls over → period envelopes copied, persistent EMF intact, Baby Step 1 stays complete (was the deep-review "Steps 1&3 regress every month" bug).
- [ ] Boot-safety reasoning (rollover writes to oplog, dark until slice 5, no throw).
- [ ] Commit; slice PR.

## Done means

- A real rollover: period envelopes copy forward at payday with allocations preserved and derived spend 0; persistent envelopes carry across untouched.
- Deterministic UUIDv5 ids make rollover idempotent and cross-device-convergent (two offline devices don't duplicate or clobber).
- The lying "envelopes have been reset" modal is replaced by a review→adjust→commit wizard.
- EMF create-time duplicate race fixed at the source.
- Baby Step 1/3 no longer regress at period boundaries (regression-tested).
- All gates green; rollover writes dark-until-slice-5 without breaking the app.
