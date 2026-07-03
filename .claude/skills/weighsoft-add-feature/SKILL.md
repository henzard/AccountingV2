---
name: weighsoft-add-feature
formerly: add-feature
description: Add a feature the disciplined way — FIRST search the codebase and the docs to understand the request in relation to what already exists, THEN act as a thought partner who pushes back instead of rushing to code (clarify why the feature is needed and what value it adds before any implementation), take Extreme Ownership of the problem, and verify the plan against the project's engineering rules (architecture, coding standards, database design, UI/UX, review/quality, specs/planning, beginner guardrails, context/sessions) in relation to the current code. Only after the problem is understood, the plan is agreed, and the rules are satisfied does it implement. Use when asked to "add a feature", "build X", "implement this request" — especially when the request is vague or jumps straight to a solution.
version: 1.0.0
category: planning
tags:
  - feature
  - planning
  - thought-partner
  - extreme-ownership
  - specs
  - architecture
  - rules-conformance
  - discovery
---

> 🔁 **Renamed:** this skill is now **weighsoft-add-feature** (formerly **add-feature**). Update any references.

# /weighsoft-add-feature — understand first, push back, plan, conform, then build

The order is the point: **understand → challenge → agree the problem → plan → check the
rules → only then code.** A feature request is a _hypothesis about value_, not a coding
ticket. Treat it as one.

> **"Piss Poor Planning Leads to Piss Poor Performance."** Do **not** be eager to code. The
> default failure mode is jumping to an implementation before the problem, value, and fit
> are understood. This skill exists to prevent that.

> **Posture (Extreme Ownership):** you own the _outcome_, not the ticket. That means owning
> the question "should we build this at all, and is this the right shape?" — not just typing
> what was asked. The most valuable thing you can deliver is sometimes a smaller feature, an
> existing-capability answer, or a "here's why this would hurt us."

## The governing rules (read them from the repo if present)

This skill enforces a project rule-set. If the target repo ships these (commonly under
`.cursor/rules/*.mdc` or `docs/`), **read the real files first — they win over this summary**:
`weighsoft-personas-and-modes` · `weighsoft-specs-and-planning` · `weighsoft-architecture-and-design` · `weighsoft-coding-standards`
· `weighsoft-database-design` · `weighsoft-ui-ux-design` · `weighsoft-review-and-quality` · `weighsoft-beginner-guardrails` ·
`weighsoft-context-and-sessions` · `weighsoft-powerhouse`. ([henzard/base rules][rules]) If they're absent, apply
the conformance gate (Phase 4) from this skill's distilled version of them, plus the kit's
own `weighsoft-quality-review` / `weighsoft-verification-quality` standards.

## Composes with the kit

`weighsoft-branch-hygiene` (never lose work) · `weighsoft-spec-review` (fact-check the spec you write) ·
`weighsoft-qa-lead` (the QA gate before "done") · `weighsoft-quality-review` / `weighsoft-deep-review` (the review rubric)
· `weighsoft-verification-quality` (evidence bar). Use `AskUserQuestion` for the discovery dialogue.

---

## Phase 0 — Context first (do NOT write code yet)

Per **context-and-sessions** + **powerhouse**: trust existing artifacts, don't re-plan what's
documented.

1. **Read the project's memory:** `docs/context-handoff.md` (current phase / next steps /
   blockers), `docs/constitution.md` (purpose + principles + out-of-scope), the active task
   file, and any `docs/prd*`, `docs/architecture*`, ADRs. `weighsoft-branch-hygiene`: confirm branch.
2. **Search the codebase and the docs** for the request's domain (`Explore`/`Grep`/`Glob`):
   what already exists that's related? Is there a capability that _already_ does this (or
   80% of it)? What modules/data/owners does the area touch? Write a short **"current state
   vs. the request"** note — the feature only makes sense _in relation to the current code_.

## Phase 1 — Be the thought partner (push back before you build)

Adopt the **Thought Partner** + **Challenger** personas (personas-and-modes): clarify
thinking, surface assumptions, expose second-order consequences. **Ask one question at a
time; do not jump to a solution until discovery is done** (unless the user says skip).
Run the request through these, out loud, with the user (`AskUserQuestion`):

- **Why / value (Extreme Ownership of the problem):** _Why is this needed? What problem does
  it solve, for whom? What value does it add, and how will we know it worked?_ (PRD-grade
  "testable outcome", per specs-and-planning.) If this can't be answered crisply, **stop here**
  — that's the finding.
- **Does it already exist?** From Phase 0 — can current code/config/an existing feature meet
  the need without new surface?
- **YAGNI / the 3-question test** (beginner-guardrails): (1) Does it solve a _current_ problem,
  not a theoretical one? (2) Could a junior understand it in 5 minutes? (3) Would removing it
  lose real capability? Fail any ⇒ push back / shrink the scope.
- **Challenge the shape:** simplest version that delivers the value? What does it make harder
  later? What's explicitly **out of scope**? Modular-monolith over premature microservices;
  proven libs over custom auth (beginner-guardrails).

End Phase 1 with an explicit, written **agreement on the problem** — not a solution. If the
user insists "just build it" and it's a quick/throwaway change, the scaled-rigor rule
(powerhouse) lets you proceed lighter — but say so, and still apply the Phase 4 gate.

## Phase 2 — Problem & value statement (the thing we agreed)

Write it down (short, reviewable — avoid over-spec): **problem · affected users · the value /
testable outcome · success & failure criteria · explicit out-of-scope.** This is the anchor
the rest of the work traces back to. Confirm it with the user before planning the _how_.

## Phase 3 — Plan: spec → architecture → tasks (specs-and-planning / powerhouse)

Follow the artifact flow, **proportional to size** (a small feature ⇒ minimal docs; a new
subsystem ⇒ the full set). Never code from a vague idea. This is the spec-driven-development
spine the whole industry converged on by 2026 — _constitution → specify → plan → tasks →
implement_, spec as the source of truth, code as its build output — which exists precisely to
stop agents producing plausible code that drifts from intent. ([Spec Kit][sk], [spec-driven dev][sdd])

- **PRD slice:** bounded scope/MVP, acceptance criteria _with verification methods_ per
  requirement (testable, e.g. "user can X in < Ns").
- **Architecture:** components + data flow in a paragraph; module/service boundaries;
  dependencies point **inward** (domain ← app ← adapters); request/response ≠ domain ≠ DB
  models. Record key decisions as **ADRs** (context · decision · ≥1 alternative · consequences).
- **Tasks:** small, one-session units, each with a **mandatory verification step** and
  dependency order. (Optionally write the spec, then run **`/weighsoft-spec-review`** on it to fact-check
  - check it against the code before building.)

## Phase 4 — Rule-conformance gate (check the PLAN against the rules, in relation to the code)

Before implementing, walk the plan against each rule area — citing the _current codebase_,
not in the abstract. Any ❌ goes back to Phase 3.

| Rule area                   | Check the plan/feature for…                                                                                                                                                                                                  |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **architecture-and-design** | SOLID; clean-architecture layers; deps inward; no new god-class/bloater/coupling smell; DRY/YAGNI/KISS                                                                                                                       |
| **coding-standards**        | functions ≤ ~30 lines & 1 thing; ≤ 3 params; intent-revealing names; structured logging, no swallowed errors; no dead code                                                                                                   |
| **database-design**         | snake_case, 3NF (or justified denorm); FKs + ON DELETE; NOT NULL default; **DECIMAL/integer-cents for money, never FLOAT**; indexes on FKs/filters; reversible migration; soft-delete via `deleted_at`; no EAV/CSV-in-column |
| **ui-ux-design**            | WCAG 2.2 AA (contrast, keyboard, focus, 44px targets, semantic HTML, real labels); mobile-first 320px; design tokens not hardcoded hex; no div-onClick / placeholder-as-label                                                |
| **specs-and-planning**      | acceptance criteria + verification exist; not over-/under-spec; no spec drift                                                                                                                                                |
| **review-and-quality**      | passes the 6-dim rubric (correctness · tests · DX · architecture · perf incl. N+1 · security); correctness & security are **blocking**                                                                                       |
| **beginner-guardrails**     | none of: TS `any`, empty catch, fn > 40 lines, hardcoded secrets, `SELECT *`, FLOAT money, non-semantic HTML; modular monolith; proven auth lib; object storage for files                                                    |
| **context-and-sessions**    | will update `docs/context-handoff.md` + ADRs as work lands                                                                                                                                                                   |
| **powerhouse**              | upstream artifacts not skipped; atomic commits; regenerate-over-patch on drift; secrets never committed                                                                                                                      |

## Phase 5 — Implement (now, and only now) — TDD, inward deps, small commits

Work the tasks. Per **coding-standards** + **powerhouse**: write the failing test → minimal
implementation → green → **one logical change per commit** (Conventional Commits), commit +
push each step (`weighsoft-branch-hygiene`). Keep business logic isolated from frameworks/DB/UI. Never
introduce a beginner-guardrails banned pattern.

## Phase 6 — Verify & quality gate (review-and-quality + the kit)

- **Pre-commit gate:** format → lint → **tests** → type-check → build, all green
  (review-and-quality / verification-quality). No new red without naming it as pre-existing.
- **Review rubric:** the 6 dimensions; correctness & security are merge-blocking.
- **`/weighsoft-qa-lead`** for anything user-facing or multi-path — it owns the e2e/test sign-off; the
  feature is **not done** until it's happy and the acceptance criteria hold end-to-end.

## Phase 7 — Close the loop (context-and-sessions)

Update `docs/context-handoff.md` (what landed, what's next, blockers, files changed), finalize
the ADR(s), update the PRD/spec if behavior changed (no spec drift), and open the PR — body
ties the change to the Phase 2 problem statement + acceptance criteria.

## Definition of done

- [ ] Codebase + docs searched; "current state vs. request" written (Phase 0)
- [ ] Thought-partner pass done: **why/value answered**, YAGNI/3-question test applied, scope
      challenged — pushed back rather than rushing to code (Phase 1)
- [ ] Agreed problem & value statement written and confirmed (Phase 2)
- [ ] Proportional spec → architecture (deps inward) → tasks with verification + ADRs (Phase 3)
- [ ] **Rule-conformance gate** passed against the current codebase (Phase 4)
- [ ] Implemented TDD-first, atomic commits, no banned patterns (Phase 5)
- [ ] Format/lint/test/type/build green; 6-dim review; **`/weighsoft-qa-lead` happy** (Phase 6)
- [ ] Handoff + ADR + spec updated; PR ties back to the problem statement (Phase 7)

## Quick reference

```text
0. Context first — read docs/handoff+constitution+ADRs, SEARCH the code & docs. Don't code yet.
1. Thought partner — ask WHY/value first, one question at a time; YAGNI + 3-question test; PUSH BACK.
2. Write the agreed problem & value statement (not a solution). Confirm it.
3. Plan proportionally: PRD slice → architecture (deps inward) → tasks + ADRs. (Optional: /weighsoft-spec-review)
4. Rule-conformance gate: plan vs architecture/coding/db/ui-ux/specs/review/guardrails/context/weighsoft-powerhouse — vs the real code.
5. Implement now: TDD, inward deps, atomic commits, no banned patterns.
6. Gate: format→lint→test→type→build green; 6-dim review; /weighsoft-qa-lead happy.
7. Update handoff + ADR + spec; open PR tied to the problem statement.
```

**The gate, one line:** _no code until you've understood the request against the existing
code, pushed back as a thought partner to nail down why it's needed and what value it adds,
agreed the problem, planned it proportionally, and confirmed it satisfies the project's
rules — then build it TDD-first and don't call it done until `/weighsoft-qa-lead` is happy._

---

Sources / further reading:
[rules]: https://github.com/henzard/base/tree/main/.cursor/rules "henzard/base — personas-and-modes, specs-and-planning, architecture-and-design, coding-standards, database-design, ui-ux-design, review-and-quality, beginner-guardrails, context-and-sessions, powerhouse"
[sk]: https://github.com/github/spec-kit "GitHub Spec Kit — Spec-Driven Development: constitution → specify → plan → tasks → implement"
[sdd]: https://www.augmentcode.com/guides/what-is-spec-driven-development "Spec-driven development — spec as source of truth; prevents code drifting from intent"
