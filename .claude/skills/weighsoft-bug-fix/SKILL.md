---
name: weighsoft-bug-fix
formerly: bug-fix
description: Fix a bug the disciplined way — FIRST get the report crystal clear (how it occurred, what was expected, what happened instead, in which environment), THEN investigate until you are 100% certain of the ROOT CAUSE (not a guess, not the symptom), reproduce it with a FAILING Playwright test you can watch go red, fix it at the root, and prove the fix by turning that same test green plus a regression test and the full suite. Use when asked to "fix a bug", "this is broken", "X doesn't work", "investigate this error/crash", or "reproduce and fix".
version: 1.0.0
category: debugging
tags:
  - bug-fix
  - root-cause
  - reproduction
  - playwright
  - regression
  - extreme-ownership
  - verification
  - debugging
---

> 🔁 **Renamed:** this skill is now **weighsoft-bug-fix** (formerly **bug-fix**). Update any references.

# /weighsoft-bug-fix — reproduce it red, fix the root, prove it green

The order is the point: **understand the report → prove the root cause → reproduce with a
failing Playwright test → fix the root → turn the test green.** A bug you can't reproduce is
a bug you can't prove you fixed. A "fix" without a failing-then-passing test is a guess.

> **Two hard gates, no exceptions:** (1) **You must be 100% certain of the root cause** — able
> to explain the exact causal chain from trigger to wrong behavior — before you touch the fix.
> (2) **You must reproduce the bug in an automated test that you watch FAIL** before you write
> the fix, so the green afterward means something. Guessing is not allowed. ([RCA / 5 Whys][rca])

> **Posture (Extreme Ownership):** "can't reproduce it" is the start of the investigation, not
> an excuse to close it. You own pinning the bug down — gather what's missing, instrument, bisect
> — until it reproduces on demand.

## Composes with the kit

`weighsoft-personas-and-modes` (Interviewer/Thought-Partner for the intake) · `weighsoft-verification-quality`
(the evidence bar + the regression-test rule + anti-patterns) · `weighsoft-qa-lead` (the sign-off gate)
· the rule skills / `CLAUDE.md` (the fix must still satisfy them) · `weighsoft-branch-hygiene` (never
lose work). Use `AskUserQuestion` for an unclear report.

---

## Phase 0 — Capture the report (don't debug a vague complaint)

`weighsoft-branch-hygiene`: branch `fix/<short-bug>` off the default. Then capture, in writing, the
**three things that define a bug** — refuse to proceed on any that are missing (go to Phase 1):

- **How it occurred** — the exact steps / inputs / route that triggered it (a real repro path).
- **Expected** — what _should_ have happened (the correct behavior, per spec/intent).
- **Actual** — what happened instead (error text, wrong value, crash, blank screen — verbatim).
  Plus the **context**: environment (browser/OS/build/branch/commit), the user/role, the data
  involved, frequency (always / intermittent), and when it started (regression? always broken?).

## Phase 1 — Make the report unambiguous (ask; assume a non-technical reporter)

If expected-vs-actual or the repro steps aren't crystal clear, **ask before investigating**
(`weighsoft-personas-and-modes` Interviewer; `AskUserQuestion`). Translate to plain language — "When you
clicked Save, did you see an error message, or did it look like it saved but the value was gone
after refresh?" Pin down: the precise trigger, what "correct" means here, and any
screenshot/console/network log they can share. **A bug you can't state precisely you cannot
fix precisely.**

## Phase 2 — Investigate to the ROOT CAUSE (be 100% sure)

Reproduce it **manually first** (run the real app, follow the steps, see it fail with your own
eyes — `weighsoft-verification-quality`). Then drive to the true cause, with evidence, not a hunch:

- **Read the evidence:** the full stack trace, the failing line, console/network/server logs.
- **Localize:** which component/layer actually misbehaves? Add a temporary log/breakpoint to
  confirm the bad value's origin — don't assume.
- **When did it break:** `git log`/`git blame` the suspect lines; for a regression, **`git
bisect`** to the exact commit.
- **Ask "why" until it bottoms out (5 Whys):** wrong pixel → wrong state → stale cache → missing
  invalidation after the mutation. The _missing invalidation_ is the root; the pixel is the symptom.
- **State the causal chain** in one short paragraph: _trigger → what the code does → why that's
  wrong → the precise root._ **Gate: if you cannot write that chain with certainty, keep
  investigating — do NOT start fixing.** Fixing the symptom (clamping the value, swallowing the
  error, a retry) without the root is forbidden.

## Phase 3 — Reproduce with a FAILING Playwright test (watch it go red)

Lock the bug into an automated, deterministic reproduction **before** fixing:

1. **Ensure Playwright is set up** — `npm i -D @playwright/test && npx playwright install`
   if absent; tests live in the project's e2e dir (e.g. `e2e/` or `tests/`). (`npx playwright
codegen <url>` can scaffold the steps; keep only what's needed.)
2. **Write a spec that drives the real repro path** and asserts the **expected** outcome — so it
   currently **fails on the actual (buggy) behavior.** Use **user-facing, role-based locators**
   (`getByRole`, `getByLabel`, `getByText`) over CSS/XPath — switching to role locators
   eliminates more flaky tests than any other single change — and **auto-retrying web-first
   assertions** (`await expect(locator).toHaveText(...)`, which retry until the condition holds
   or the timeout elapses). Never `page.waitForTimeout(...)`; arbitrary sleeps are exactly how
   repros go flaky. ([Playwright best practices][pw], [2026 cheat sheet][pwcs])
3. **Run it and SEE it red** for the right reason — the failure message must match the reported
   _actual_ behavior. A repro that fails for an unrelated reason doesn't count. Run with
   `--trace on` and open the **Trace Viewer** (`npx playwright show-trace`) — its DOM snapshots
   - network + console timeline pin the exact failure moment and double as the bug evidence.
     ([Trace Viewer][pwtrace])

> **If the bug isn't reachable through the browser** (pure API/CLI/backend/data bug): reproduce
> at the lowest layer that exhibits it — Playwright's **API request testing** (`request.post(...)`),
> or an integration/unit test. The rule is unchanged: **a failing automated repro first.** Default
> to Playwright for anything a user can see or click.

## Phase 4 — Fix at the root (minimal, rule-conformant)

Fix the **root cause** from Phase 2 — the smallest change that addresses it, not the symptom.
The fix must still satisfy the standing rules (`CLAUDE.md`): no swallowed errors, deps inward,
no banned patterns, money-DECIMAL, etc. Add **defense-in-depth** only if the bug's _class_
warrants it (e.g. validate at the boundary so the whole family can't recur). Commit + push.

## Phase 5 — Prove it (red → green) and guard it forever

- **The Phase 3 Playwright repro now PASSES** — same test, no edits to weaken the assertion.
  Run it green and say so.
- **Add a focused regression test** at the right layer (unit/integration for the logic, the
  Playwright spec for the journey) that exercises the **real failing vector** — so this exact
  bug can never silently return (`weighsoft-verification-quality`).
- **Full gate:** the whole suite + static/type/lint green (any unrelated red named as
  pre-existing — `weighsoft-verification-quality` anti-pattern #4); for a user-facing fix, **`/weighsoft-qa-lead`**
  signs off end-to-end.

## Phase 6 — Backfill, document, close

- **Backfill bad data the bug already produced.** A code fix that only protects _future_ rows
  while existing corrupted rows stay broken is the kit's **fix-without-backfill** anti-pattern —
  find and repair (or migrate) the rows the bug already damaged.
- **Re-read, don't assume.** Confirm the corrected state by reading it back (the **post-action
  gap** anti-pattern: asserting the action fired but never the resulting state).
- Update `docs/context-handoff.md`; PR body states **how it occurred · root cause · the fix ·
  the failing→passing repro test** as evidence, and links the original report.

## Definition of done

- [ ] Report captured: how-it-occurred + expected + actual + environment (Phase 0); clarified if vague (Phase 1)
- [ ] **Root cause proven** — the causal chain written with certainty; symptom-only fixes rejected (Phase 2)
- [ ] **Failing Playwright (or lowest-layer) repro** written and watched go **red** for the right reason (Phase 3)
- [ ] Root-cause fix applied, rule-conformant, minimal (Phase 4)
- [ ] Same repro now **green** (unweakened) + regression test added + full suite/static green + `/weighsoft-qa-lead` happy (Phase 5)
- [ ] Existing bad data backfilled; result re-read; handoff + PR document cause→fix→proof (Phase 6)

## Quick reference

```text
0. Branch. Capture: HOW it occurred + EXPECTED + ACTUAL + environment. Missing any → Phase 1.
1. Unclear? Ask (Interviewer persona) — state expected vs actual precisely before debugging.
2. Reproduce manually, then drive to ROOT CAUSE with evidence (logs/blame/bisect/5-Whys).
   Write the causal chain. GATE: 100% sure, or keep digging. No symptom fixes.
3. Write a FAILING Playwright test on the real repro path (getByRole + web-first asserts).
   Run it → see it RED for the right reason. (Non-web bug → lowest-layer failing test.)
4. Fix the ROOT, minimal + rule-conformant. Commit/push.
5. Same repro → GREEN (unweakened) + regression test + full suite/static green + /weighsoft-qa-lead happy.
6. Backfill bad data the bug made; re-read state; PR documents cause→fix→proof.
```

**The gate, one line:** _no fix until you can state how it occurred, what was expected vs.
what happened, and the proven root cause — then reproduce it as a Playwright test you watch
fail, fix the root, and turn that test green with a regression guard and `/weighsoft-qa-lead`'s sign-off._

---

Sources / further reading:
[rca]: https://en.wikipedia.org/wiki/Five_whys "Root-cause analysis — the 5 Whys"
[pw]: https://playwright.dev/docs/best-practices "Playwright — best practices (user-facing role locators, web-first assertions, no fixed waits)"
[pwtrace]: https://playwright.dev/docs/trace-viewer "Playwright Trace Viewer — DOM snapshots, network, console timeline per run"
[pwcs]: https://www.webfuse.com/playwright-cheat-sheet "Playwright Cheat Sheet — End-to-End Testing Reference (2026)"
