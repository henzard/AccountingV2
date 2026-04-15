# Swarm Audit — 2026-04-15

Five specialist agents ran in parallel; this is the queen-consensus synthesis.

## Grades (by specialist)

| Lens                  | Grade  | Headline                                                                                            |
| --------------------- | ------ | --------------------------------------------------------------------------------------------------- |
| Architecture          | C+     | Server-side sync is excellent; domain layer leaks Drizzle/Expo — hexagonal structure is nominal.    |
| Security              | B+     | RLS universal, RPCs membership-guarded, but SQLite unencrypted and one TOCTOU on OpenAI spend.      |
| Domain (Ramsey model) | A-     | Baby Steps canonical, snowball genuine, zero-based advisory-not-enforced.                           |
| BMad compliance       | C+     | Planning phase completed in BMad; execution forked to superpowers plans.                            |
| Usability             | 6/10   | Warm onboarding → dashboard cliff where R0.01 envelopes + no "Add transaction" FAB.                 |
| Visual design         | C+     | Token system is rare-quality; screens undermine it — primary KPIs at 14pt, stacked FABs, hex leaks. |
| Visual consistency    | 64/100 | Typography 72 · Spacing 78 · Colour 58 · Component reuse 48.                                        |

**Aggregate: B-.** Production-viable backbone with a painful first-user experience and two high-severity risks.

---

## Where we are

**Working well**

- End-to-end boot path is crash-resilient: `BootErrorBoundary` + `BootRecoveryGate` + persisted `earlyCrashLog` let users screenshot errors that predate Crashlytics init.
- Server-side sync is correct and defence-in-depth: every `slip_queue` / transactions / envelopes upsert hits a `SECURITY DEFINER` RPC with `updated_at`-gated LWW _and_ `user_households` membership re-verification (`supabase/migrations/005_security_and_sync_correctness.sql:263`).
- Pending-sync queue has proper exponential backoff, retry cap, DLQ, and the N+1 fix (`SyncOrchestrator.ts:60-155`).
- Baby Steps domain is a faithful Ramsey canonical implementation (`src/domain/babySteps/BabyStepRules.ts:25-103`); debt snowball is genuine smallest-first (`SnowballPayoffProjector.ts:27`).
- 491 Jest tests green; CI/CD pushing AABs to Play Store internal track every master commit.
- Slip-scanning privacy promise is real: 30-day purge is enforced in two places (server `pg_cron` + client cleanup use case).

**Not working well**

- **Onboarding → Dashboard collapse.** `ExpenseCategoriesStep` seeds envelopes at `allocatedCents: 100` (R0.01). User lands on Dashboard with every envelope showing R0.01 allocated — looks broken. No "Add transaction" FAB anywhere on Dashboard (`DashboardScreen.tsx:171-183` has + for envelopes and camera for slips only). The Ramsey core loop (daily logging → score) has no entry point.
- **Hexagonal architecture is theatre.** Use cases import `expo-crypto`, `drizzle-orm/expo-sqlite`, and concrete data adapters directly (`CreateTransactionUseCase.ts:1-4`, `AcceptInviteUseCase.ts:9`). Declared ports in `src/domain/ports/` are largely bypassed. No DI root — `src/infrastructure/di/` is empty.
- **Sync concurrency gap.** `SyncOrchestrator.syncPending` has no `isRunning` latch. Network-regain + foreground + manual refresh can all trigger it concurrently, double-incrementing `retryCount`.
- **Hard-delete races LWW.** Deletes bypass the merge RPCs entirely (`SyncOrchestrator.ts:176`); a device offline for a day that deletes a transaction obliterates another member's edit.
- **"Ramsey Score" misnamed.** 20% of the score comes from meter readings (`RamseyScoreCalculator.ts`) — orthogonal to Ramsey's method. It's an engagement/habit score marketed as adherence.
- **SQLite unencrypted at rest.** `accountingv2-v3.db` stores household payees, merchants, amounts, and the full audit log in plaintext. On a rooted device / ADB backup, it's readable.
- **OpenAI rate-limit TOCTOU.** Concurrent requests can bypass the 50/day household cap (`supabase/functions/extract-slip/index.ts:128-146` — the comment acknowledges this).
- **Invitation enumeration.** Any authenticated user can `SELECT` all unused, unexpired invitations from `invitations` table (`supabase/migrations/005:111-117`) — reveals household IDs and invitation volume.
- **Dark theme is broken and not user-controllable.** The theme system reads `useColorScheme()` from the OS (`useAppTheme.ts:177`) _but_ `app.config.ts:36` hard-codes `userInterfaceStyle: 'light'`, forcing the OS to report light to the app regardless of the user's system setting. Even if that were flipped, dark mode is half-baked: `AddTransactionScreen.tsx:14,258-286` imports the raw `colours` token (not `useAppTheme()`), and the entire `slipScanning/` stack uses hardcoded hex (`#000`, `#fff`, `#4CAF50`, `#1565C0`) — both go unreadable on a dark surface. There is **no in-app setting** to switch themes; Settings has no appearance row.
- **Visual design regressions from the token system.** A coherent MD3 palette + 8-step spacing scale + Fraunces/Jakarta pairing (`tokens.ts:1-116`) is undermined at the screen level: Dashboard KPIs render at 14pt while page titles go to 28pt so the hero data is the quietest thing on screen (`DashboardScreen.tsx:212`); two stacked FABs compete for attention in clashing colours (`DashboardScreen.tsx:171-183`); Ramsey Score label rendered at 8pt (`RamseyScoreBadge.tsx:104` — below legibility floor); transaction list rows are elevated cards instead of flat rows, producing a "pile of business cards" effect at scale (`TransactionListScreen.tsx:120`).
- **Five reusable components missing** — `StatCard`/`KPIBlock`, `FormScreen`/`OnboardingStepLayout`, `ListRow`, `PickerField`, `SectionHeader`. The 7 onboarding steps, transaction list vs settings list, and three ad-hoc section headers together represent ~500 LOC of duplicated JSX+styles that would collapse into a shared primitive.
- **BMad fork.** Analysis + Planning completed in BMad (PRD 773 lines, architecture 1212 lines). Implementation tracked in `docs/superpowers/plans/` with no traceability back to BMad epic/story IDs. `_bmad-output/implementation-artifacts/` is empty.

---

## What should be next

Priority-ordered. Each item: **rationale / effort / owner.**

### P0 — Ship what's already built, don't build more

1. **Fix the onboarding → dashboard cliff.**
   - Replace the R0.01 envelope seed with an allocation step that splits income across selected categories (or routes through a per-envelope allocation wizard). Replace the + FAB on Dashboard with an "Add transaction" primary FAB; move "add envelope" into the Budget tab. Guard `useAppStore((s) => s.householdId)!` non-null assertions with a `LoadingSkeleton` fallback.
   - **M / frontend + product**

2. **Land Phase A of `docs/superpowers/plans/2026-04-13-codebase-hardening.md`.**
   - `merge_baby_step` RPC has a runtime crash on conflict; `user_households` vs `household_members` duality silently hides data from invited members. Both are data-loss bugs.
   - **L / backend**

3. **Add a concurrency guard to `SyncOrchestrator.syncPending()`.**
   - Module-level `isRunning` latch, or SQLite advisory lock. Eliminates retry-count double-increment and duplicate audit events.
   - **S / backend**

4. **Fix dark-theme + add in-app theme control.**
   - Remove `userInterfaceStyle: 'light'` from `app.config.ts:36` so `useColorScheme()` actually sees system preference. Swap raw-hex sites (`AddTransactionScreen.tsx:14,258-286`, all of `slipScanning/*`) to `useAppTheme()`. Add an `Appearance` row in Settings with `system / light / dark` options persisted to AsyncStorage, wired into a Zustand slice that `useAppTheme` consumes ahead of the OS scheme. Without this, "dark mode" silently half-works, is invisible to the user, and cannot be diagnosed or turned off.
   - **M / frontend**

5. **Land the three critical visual fixes.**
   - Promote Dashboard KPIs to `headlineSmall` with tabular-nums (`DashboardScreen.tsx:212-215`); collapse stacked FABs into one primary + header camera icon (`DashboardScreen.tsx:171-183`); enlarge Ramsey Score badge — score → 24pt bold, label → 10pt (`RamseyScoreBadge.tsx:104`).
   - **S / frontend**

### P1 — Reduce risk before wider rollout

4. **Harden the manual migration runner.**
   - Wrap each migration in `BEGIN/COMMIT`, store per-migration checksum, refuse boot on checksum mismatch. Current idempotency is count-based and a partially-applied migration leaves the DB unrecoverable.
   - **M / backend**

5. **Fix the `invitations` RLS leak.**
   - Change `inv_select` policy to require `code = current_setting('request.header.x-invite-code', true)`, or remove the SELECT policy entirely and only allow `claim_invite` RPC access.
   - **S / backend**

6. **Close the OpenAI cost TOCTOU.**
   - Move the rate-limit check into a `pg_advisory_xact_lock(household_id_hash)` transaction or atomic `UPDATE ... RETURNING count` on a rate-counter row.
   - **S / backend**

7. **Rename "Ramsey Score" to "Habit Score" — or re-weight it.**
   - The current formula measures engagement, not Ramsey adherence. Shipping it as "Ramsey Score" is a truth-in-advertising problem with a real creator's trademark. Pick one: rename, or re-weight toward EF-funded %, debts cleared, 15%-retirement flag, bond progress.
   - **S (rename) or L (re-weight) / product**

### P2 — Later, when users exist

8. **Un-skip one Detox E2E journey in CI** (login-then-envelope is the smoke). Current specs are all `describe.skip` and the job is `continue-on-error: true`. **M / devops.**
9. **Move to encrypted SQLite** (op-sqlite + SQLCipher) _or_ explicitly document residual risk in the privacy policy. **M / backend.**
10. **Consolidate `networkStore` + `appStore.pendingSyncCount` into one sync slice** — they encode overlapping state and can disagree. **S / frontend.**
11. **Promote Play Store track from draft to internal with real testers.** Currently no external signal because the listing is incomplete. **S / product + devops.**
12. **Run `bmad-create-epics-and-stories` to back-fill traceability** between the PRD and the superpowers plans. Cheap, recovers a long-term navigability problem. **S / product.**

13. **Extract the five missing UI primitives** — `StatCard`, `OnboardingStepLayout`, `ListRow`, `PickerField`, `SectionHeader`. Unifies visual language, drops ~500 duplicated LOC, and makes the next design pass cheap. **M / frontend.**

14. **Flatten the transaction list** — replace `Surface elevation={1}` per-row with flat rows + 1px `outlineVariant` divider (`TransactionListScreen.tsx:120`). Reserve elevation for summary cards only. **S / frontend.**

### Things to NOT do

- **Don't rewrite the migration runner to use `drizzle-orm/expo-sqlite/migrator`.** It crashes the JS thread on current expo-sqlite — the manual runner is load-bearing. Harden in place.
- **Don't chase 80% coverage** (the README claim) by adding trivial file-level tests. The real gap is presentation-layer coverage for auth/onboarding/household-switch flows.
- **Don't start new features.** Slip scanning and debt snowball are already shipped; spend the next two weeks landing hardening + dashboard-cliff fixes.

---

## Usability rating: 6/10

Would be **8/10** if P0-#1 + P0-#4 + P0-#5 ship. The bones are genuinely good — typography system, Paper components, onboarding copy ("One question at a time. Takes about 12 minutes."), baby-steps tri-tier layout with `accessibilityElementsHidden` on future steps. The cliff is entirely at the transition from `FinishStep` ("Your budget is ready.") to the first Dashboard render, plus a broken theme story that users cannot control.

**Estimated first-run drop-off risk: ~40% within 60s of landing on Dashboard**, based on:

- Envelopes reading R0.01 allocated (looks like onboarding didn't save)
- Ramsey Score near 0 with no "do this next" CTA
- - FAB creates another envelope (not what the user wants)
- Camera FAB gates behind a privacy consent wall
