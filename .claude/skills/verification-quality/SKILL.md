---
name: verification-quality
description: "Before claiming any task is done, run the project's REAL tests and — for user-facing changes — run the REAL app and observe the actual behavior. Never report 'done', 'fixed', or 'working' on unverified work. Stack-agnostic: discover the project's own test and run commands, execute them, and report exactly what you ran and what you saw."
version: '1.0.0'
category: 'quality-assurance'
tags: ['verification', 'testing', 'evidence', 'completion-gate', 'quality']
---

# Verification & Quality — ground every completion claim in evidence

## What this skill does

> **The one rule:** never claim a task is "done", "fixed", or "working" until you
> have _run the real check_ and _seen the real result_ with your own eyes.
> Automated tests for every change; the running app for every user-facing change.

This skill is the checklist for **grounding a completion claim in evidence**. It is
stack-agnostic: it tells you _what to verify and to what standard_, not which exact
command to type. Discover the project's real test and run commands first (below),
then hold yourself to the completion gate. Scale the effort to the change — a typo
fix needs one layer; a data-contract change needs all of them.

## Step 0 — Discover the project's truth commands (don't assume)

Before verifying anything, find out how _this_ project tests and runs. Read, in
order, whichever exist:

- `README.md` / `CONTRIBUTING.md` — the documented "how to test / how to run".
- The manifest's script section — `package.json` `scripts`, `Makefile` targets,
  `pyproject.toml` / `tox.ini`, `Cargo.toml`, `go.mod`, `build.gradle`, etc.
- CI config (`.github/workflows/*`, `.gitlab-ci.yml`, …) — the commands CI runs are
  the authoritative "this is how the project is tested" list.

Write down the concrete commands for **(a)** the automated test suite, **(b)** any
type/lint/static gate, **(c)** launching the real app, and **(d)** any integration
or end-to-end probe. Those four are your truth commands for this repo. If the repo
spans **multiple sub-projects** (e.g. an app and a separate service/hub), identify
each one's commands and verify each side you changed.

> Common shapes (illustrative — confirm against the repo, never guess):
> JS/TS → `npm test` / `npm run lint` / `npm start`; Python → `pytest` /
> `ruff`/`mypy` / the app entrypoint; Go → `go test ./...` / `go vet` / `go run`;
> Rust → `cargo test` / `cargo clippy` / `cargo run`. For a **flow-based / visual
> runtime** where the flow file _is_ the app, "run it" means load the flow in its
> editor, deploy, and exercise the affected nodes.

## The completion gate (run this before saying "done")

### Step 1 — Run the automated tests (ALWAYS, every change)

Run the suite for every sub-project you touched. A few cross-cutting cautions:

- **Native / generated dependencies.** If the suite relies on a native binding or a
  build/codegen step, make sure it's current for your toolchain before assuming a
  crash is a _real_ test failure (many projects have a pre-test rebuild hook; run
  the rebuild and retry if the suite dies before any test runs).
- **Real subject, not a stub.** A green run only means something if the thing under
  test actually executed (a real DB/in-memory DB for a query, the real function for
  logic). Mock at boundaries only — see anti-pattern #2.
- Iterate on the **focused** test file, then run the **full** suite before claiming
  done.

### Step 2 — Run the app for user-facing changes (UI, desktop, CLI output, flow behavior)

A passing unit test does **not** prove a screen renders, a button works, a device
reads, or a request routes correctly. For anything a user sees or touches: launch
the real app (Step 0's run command) and **actually observe** the changed behavior —
open the screen, click the control, watch the data persist, trigger the endpoint
and confirm the expected response. Note what you saw.

### Step 3 — State the evidence in your report

When you report completion, say **what you ran and what you saw** — e.g.
"<test cmd> → N passed, M skipped; launched the app, performed <action>, and the
result matched <expectation>." That is a _verified_ claim. "Should work now" is not.

## Four anti-patterns (these turn a green check into a lie)

1. **The orphan test.** A new test file that the runner never picks up (not matched
   by the test glob, or not added to an explicit file list in the test script) never
   runs — a silent false-green. _Always confirm your new test actually executed in
   the run output._
2. **The mocked-away subject.** Mocking the very thing under test (stubbing the query
   you're verifying, the request you're hardening, the node you're fixing) yields a
   green test that proves nothing. Keep mocking at boundaries; exercise the real
   subject.
3. **"Tests pass, therefore done" for UI.** Unit-green ≠ renders/works. If a human
   will see or click it, Step 2 (run the app, observe) is mandatory.
4. **The pre-existing-failure excuse used as a blanket.** It's legitimate to note a
   _known, unrelated, documented_ failure. It is **not** legitimate to wave away a
   _new_ red as "probably unrelated." Confirm a failure is pre-existing by checking
   it red on the base branch **before** you touched anything.

## Verification layers (use as many as the change warrants)

Proportionate, not bureaucratic — a typo fix needs layer 1; a data-contract change
needs all of them.

1. **Static** — type check / lint (`tsc --noEmit`, `mypy`, `go vet`, `cargo
clippy`, …). Catches breaks the test runner's environment might not surface.
2. **Unit (pure logic)** — the test runner on extracted helpers / pure functions.
3. **Data layer (real store)** — tests against a real or in-memory DB for queries
   and migrations, not a stubbed store.
4. **Boundary / contract** — request/response shapes, URL normalization, input
   validation, identifier/SSRF guards.
5. **Integration / end-to-end** — a probe or e2e run that exercises cross-component
   behavior (e.g. a sync/round-trip between two services).
6. **Manual app run** — launch the real app/runtime and observe human-observable
   behavior. **Required for every user-facing change.**

You won't always hit all six. You **must** hit layer 6 for anything visible, and at
least one automated layer for _every_ change. A change with zero automated coverage
and no manual run is **unverified** — say so explicitly rather than claiming success.

## Never-lose-work & branch hygiene (proportionate)

- **Don't work directly on the default/protected branch.** Branch first; one topic
  per branch. (See the `branch-hygiene` skill.)
- **Commit + push at every meaningful step** so work is never stranded on one
  machine. Small, green, described commits beat one giant unverified one.
- **No orphan branches.** Every branch heads toward a PR into the default branch or
  gets cleaned up — never leave half-finished work unpushed.
- **Record findings in docs/.** Findings, assessments, and remediations live as dated
  docs (e.g. `docs/SECURITY-REMEDIATION-<date>.md`), not buried in a commit message.
- **Commit guard:** before you commit, the tests for the touched component are green
  (or any red is documented as pre-existing). Never commit a _new_ red without
  saying so.

## How a verified remediation reads (pattern to imitate)

A well-grounded fix has these three traits — aim for all of them:

- **Every code fix ships with a regression test that exercises the real vector** —
  e.g. a security fix lands with a test asserting the attack is now refused (HTTPS
  enforced, redirect-downgrade rejected, SSRF allowlist applied, the injection
  blocked), not merely that the function returns.
- **The real check was run and the real numbers reported** — "<test cmd> → N new
  assertions green, full suite P passed / Q skipped" — and any single pre-existing
  unrelated failure is **named**, not hidden.
- **Residual risk is stated per finding** — "Fixed (code)" vs "Partially fixed" —
  so a green test is never mistaken for "the whole problem is gone."

> _(That bar was met, for example, in a security remediation that paired each
> NS-SEC fix with a real-vector regression test and reported the exact suite counts.
> Hold your own work to the same standard, whatever the stack.)_

## Quick reference

```text
1. Discover this repo's truth commands (README / scripts / CI).
2. Run the automated suite for every sub-project you touched  → green (or red documented).
3. Static/type/lint gate if the change warrants it.
4. For ANY user-facing change: launch the real app and OBSERVE the behavior.
5. Report exactly what you ran and what you saw — not "should work".
```

**The gate, one line:** _tests green for the component you changed, the app run and
observed if a user can see it, and a report that states what you ran and what you
saw — otherwise it is not done._
