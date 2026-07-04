# Slice 6: One-Off Fixes Batch + Tier-4 E2E + Consolidation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** The final slice — land the surviving game-plan Phase-0 one-off fixes (all money/UX-critical), fix the carried ConfirmSlip atomicity Critical, re-point the extract-slip edge function (broken by the 2026-07-04 remote baseline deploy which dropped `user_households`), rebuild push on FCM v1, add the authenticated tier-4 e2e + CD gating, and consolidate. After this, the rebuild is complete.

**Architecture:** Independent targeted fixes, each with a test, run through the review loop. The remote now runs the oplog baseline (deployed 2026-07-04); edge functions still need redeploying. Spec: `docs/superpowers/specs/2026-07-03-oplog-sync-correctness-design.md` §4, §4.5; game plan `docs/200x-game-plan.md` Phase 0.

## Global Constraints

- All gates green every task: realsql, twodevice (stack up), app-coverage (80/60), tsc, eslint, `supabase db reset` + `supabase test db`.
- Money integer cents. The money-input parser is money-critical — locale-safe, reject-ambiguous, never coerce-to-wrong.
- Edge-function changes: fix code + `supabase functions deploy <name>` to the linked remote (CLI is authenticated/linked to qmfsobqpnogefvzltwyj). Verify post-deploy.
- FCM v1 needs a Google service-account credential (a secret only the owner has) — write the code + wire it to read a `FCM_SERVICE_ACCOUNT` secret, but flag that deployment/testing of live push needs the owner to set that secret. Do NOT block the slice on it.

---

### Task 1: Fix extract-slip edge function (broken by remote reset) + redeploy

**Files:** Modify `supabase/functions/extract-slip/index.ts` — its membership check reads the dropped `user_households` table; re-point to `private.is_household_member(household_id)` (the baseline helper) or a `household_members` query. Redeploy.

**Interfaces:** extract-slip's household-membership authorization uses the new baseline (private.is_household_member). Its direct `.update()` calls on slip_queue should route through `apply_server_op` per spec §6.2 IF clean; if that's a large change, at minimum fix the membership read so the function WORKS against the new remote, and note the apply_server_op migration as a follow-up.

TDD: update the extract-slip Deno tests (supabase/functions/extract-slip/**tests**) for the new membership path; `deno test` green. Then `supabase functions deploy extract-slip` to the remote; verify it deploys.

---

### Task 2: ConfirmSlipUseCase atomicity (carried Critical, spec §4.5)

**Files:** Modify `src/domain/slipScanning/ConfirmSlipUseCase.ts` — replace the `await this.db.transaction(async (tx) => {...})` (which commits at the first await in expo-sqlite sync mode, so a failed item leaves earlier items committed) with: do all validation/reads FIRST (async, outside any transaction), then perform every item insert in ONE synchronous `runInUnitOfWork` transaction (each appends its oplog op). Add the op_id-level idempotency + status guard (double-confirm doesn't duplicate).

TDD: a realsql test exercising the REAL driver (not a mocked db.transaction) proving a 2-item slip where item 2 fails rolls back item 1 (all-or-nothing); double-confirm is idempotent.

---

### Task 3: Money-input parser — shared, locale-safe (money-critical)

**Files:** Create `src/presentation/utils/parseMoneyInput.ts`; modify `AddTransactionScreen.tsx` (the `toCents` bug: `parseFloat(replace(',','.'))` turns "1,234.56"→R1.23), `AddReadingScreen.tsx`, `AddDebtScreen.tsx`, `AddEditEnvelopeScreen.tsx` to use it.

**Interfaces:** `parseMoneyInput(raw): { cents: number } | { error: string }` — accepts digits with at most one decimal separator (both `.` and `,` as decimal per en-ZA/af-ZA), strips one optional leading currency symbol + whitespace, max 2 decimals; REJECTS ambiguous (thousands separators, spaces between digits, multiple separators, non-numeric) with an inline error rather than coercing. Per spec §7.8.

TDD: unit tests for "1,50"→150, "1.50"→150, "1,234.56"→reject, "1 000"→reject, "12.345"→reject, "abc"→reject, "-5"→reject, "" → reject. Each screen shows an inline error on reject, never writes a wrong amount.

---

### Task 4: Slip camera FAB + password reset (UX unreachables)

**Files:** Modify `SlipQueueScreen.tsx` (add a camera FAB that navigates to SlipConsent-or-SlipCapture — the empty state references a button that doesn't exist; slip scanning's START is currently unreachable); Modify `LoginScreen.tsx` (add "Forgot password?" → `supabase.auth.resetPasswordForEmail` + a ResetPassword screen handling the deep-link token).

TDD: SlipQueue renders a camera FAB that navigates to capture; LoginScreen has a forgot-password link that calls resetPasswordForEmail; the reset screen handles the recovery token. WCAG AA on both.

---

### Task 5: notify-event FCM HTTP v1 (push is 100% dead)

**Files:** Modify `supabase/functions/notify-event/index.ts` — replace the legacy `fcm.googleapis.com/fcm/send` (shut down 2024) with FCM HTTP v1 (`/v1/projects/<id>/messages:send`, OAuth2 service-account JWT via google-auth in Deno); prune UNREGISTERED tokens; input validation + rate limit. Reads a `FCM_SERVICE_ACCOUNT` secret.

TDD: Deno tests for the v1 payload shape + token pruning (mock the FCM endpoint). Deployment/live-push testing needs the owner to set the `FCM_SERVICE_ACCOUNT` secret — flag it, don't block. Deploy the function; note push won't fire until the secret is set.

---

### Task 6: Tier-4 authenticated e2e + CD gating + final consolidation

**Files:** Add an authenticated Detox journey (sign up → onboard → create envelope → add transaction → verify) against local Supabase in the e2e job; make cd.yml's Play publish hard-depend on the e2e + the full test train (fix the CD-races-CI gap). Update `docs/plan-execution-status.md` (all 6 slices delivered), the ADR, and write a final rebuild summary.

- [ ] Full gate green incl. the new e2e.
- [ ] cd.yml publish gated on check + db + e2e (no more racing).
- [ ] Final status doc + ADR complete.
- [ ] Commit; slice PR → merge → Play.

## Done means

- extract-slip works against the new remote (redeployed); ConfirmSlip is atomic + idempotent; money input is locale-safe and can't misparse; slip scanning is reachable; password reset exists; push is on FCM v1 (pending the owner's service-account secret); tier-4 authenticated e2e gates CD.
- All 6 slices delivered. The oplog rebuild is complete.
