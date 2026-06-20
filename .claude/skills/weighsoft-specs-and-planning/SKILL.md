---
name: weighsoft-specs-and-planning
formerly: specs-and-planning
description: Enforce the ordered artifact flow — Constitution → PRD → Architecture → Tasks → Implementation — so code is never written from a vague idea without minimal specs or a task list. Every PRD requirement carries a testable acceptance criterion + verification method, every key decision lands as a numbered ADR with at least one alternative considered, and every task ships with a mandatory verification step. Use when asked to "plan this", "write a spec/PRD", "record an ADR", "break this into tasks", or before starting a feature with no specs.
version: 1.0.0
category: planning
tags:
  - spec-driven
  - prd
  - adr
  - architecture
  - task-breakdown
  - acceptance-criteria
  - verification
  - planning
  - artifact-flow
---

# weighsoft-specs-and-planning — minimal specs, ordered, every claim verifiable

> 🔁 **Renamed:** this skill is now **weighsoft-specs-and-planning** (formerly **specs-and-planning**). Update any references; other systems keying off the old name should rename to match.

Code is the last artifact, not the first. The flow exists so that _what_ and _why_ and _how we'll
verify_ are settled — briefly — before _how_. Minimal and reviewable beats exhaustive and ignored.

> **Constitution → PRD → Architecture → Tasks → Implementation. Never code from a vague idea
> without minimal specs or a task list.**

## The rules

### The ordered artifact flow

Each artifact feeds the next; skipping upstream means the downstream work has no anchor. Scale the
depth to the change (a small feature ⇒ a paragraph each; a new subsystem ⇒ the full set) — but never
skip the _order_.

### Constitution

- **One-sentence purpose**, **3–7 guiding principles**, and an **explicit out-of-scope** list.
- This is the tiebreaker when later decisions conflict — keep it short enough that people read it.

### PRD

- **Problem statement + affected users** — who hurts, and how.
- **Bounded scope / MVP** — what's in, what's deferred.
- **Testable outcomes** — measurable, e.g. _"login succeeds with a valid email in < 2s at p95"_, not
  "fast login". Prefer a concrete threshold over an adjective.
- **Acceptance criteria per feature, each with a verification method** — the criterion and _how you'll
  prove it_ live together. Write them **Given / When / Then** (Gherkin/BDD): a binary pass/fail with
  context, action, and observable outcome — _"Given a registered user, When they submit a valid email,
  Then a reset link arrives within 2 min"_ — so the criterion doubles as a test case and covers the
  happy path **and** edge cases (error, timeout, permission). ([spec-driven dev: what + how to verify][sdd], [acceptance criteria: Given-When-Then][ac])

### Architecture

- **One-paragraph overview** of components + data flow.
- **Service / module boundaries** named explicitly.
- **Key decisions linked to ADRs**; a brief **tech-stack summary**.

### ADR (Architecture Decision Record)

- Fields: **title · status · context · decision · ≥1 alternative considered (with reasoning) ·
  consequences + migration notes.**
- **Numbered sequentially** (`0001-...`, `0002-...`), Markdown in-repo so Git tracks the decision
  history. Prefer a lightweight template — **MADR 4.0** (full or minimal): _decision drivers_ +
  _considered options_ + a **Confirmation** sub-element of the outcome (renamed from "Validation" in
  4.0) that states _how compliance with the decision is verified_ — a code review, a test, an arch-fitness
  function — turning the decision into a testable claim. ([MADR][madr], [ADR best practices][adr])
- **One decision per ADR** — explore options in a linked design doc, record the chosen direction here.

### Tasks

- **Small, completable in one session** — if it can't finish in a sitting, split it.
- **Mandatory verification step per task** — how you'll know it's actually done.
- **Dependency tracking** — order so blockers come first; no task starts on an unmet dependency.

## Anti-patterns to reject

- **Over-spec** — lengthy specs nobody reads. WHY: documentation that isn't reviewed is documentation
  that isn't trusted; favor minimal, reviewable docs over exhaustive ones.
- **Under-spec** — missing acceptance criteria → vibe coding. WHY: with no testable outcome there's
  no definition of done and no way to prove correctness; the build drifts on guesses.
- **Skipping verification** — a task or criterion with no "how we'll prove it". WHY: "done" becomes
  opinion; regressions ship unnoticed.
- **Spec drift** — behavior changes but the spec doesn't. WHY: the doc becomes a lie the next person
  trusts; update the spec in the same change that changes the behavior.
- **Monolithic tasks** — a multi-day "implement everything" item. WHY: un-reviewable, un-verifiable,
  and impossible to track progress against; split to one-session units.
- **ADR with no alternative** — a decision recorded as a foregone conclusion. WHY: the _reasoning_
  (why not the other option) is the entire value of an ADR; without it, the record can't be revisited.

### Skip the formality for

Quick fixes, throwaway spikes, and pure technical refactors — proportional rigor, not ceremony for
its own sake. Say you're skipping, and why.

## How it composes with the kit

- **add-feature** Phases 2–4 _run_ this flow — the PRD slice, architecture (deps inward), tasks, and
  ADRs it produces are exactly these artifacts; the conformance gate checks them.
- **spec-review** fact-checks the spec this skill writes — acceptance criteria real, no drift, checked
  against the actual code — before any build starts.
- **review-and-quality** grades correctness _against the acceptance criteria_ this skill defines; if
  they're missing or untestable, the review has nothing to grade.
- **qa-lead** turns the testable outcomes + critical journeys into its charter and e2e assertions.

## Conformance checklist

- [ ] Constitution exists: one-sentence purpose, 3–7 principles, explicit out-of-scope
- [ ] PRD: problem + users + bounded MVP; every requirement has a **testable** outcome
- [ ] Each acceptance criterion names its **verification method**
- [ ] Architecture: components/data-flow paragraph, named boundaries, key decisions → ADRs
- [ ] Each ADR: context · decision · **≥1 alternative + reasoning** · consequences; numbered, one decision
- [ ] Tasks: one-session sized, **each with a verification step**, dependencies ordered
- [ ] No over-spec / no under-spec; no spec drift (spec updated with the behavior it describes)
- [ ] Rigor scaled to the change; any skipped formality stated with a reason

## Quick reference

```text
Flow:   Constitution → PRD → Architecture → Tasks → Implementation  (order, always)
Const:  1-sentence purpose · 3-7 principles · explicit out-of-scope
PRD:    problem+users · bounded MVP · TESTABLE outcomes · criteria as Given/When/Then + verify method
Arch:   components/data-flow paragraph · named boundaries · decisions → ADRs
ADR:    context·decision·>=1 alternative+why·consequences·Confirmation — numbered, one decision (MADR 4.0)
Tasks:  one-session units · mandatory verification each · dependency order
Reject: over-spec · under-spec · skip-verify · spec-drift · monolith-task · ADR w/o alternative
Skip:   quick fixes · throwaway spikes · pure refactors (say so)
```

**The gate, one line:** _no code from a vague idea — write the minimal Constitution → PRD →
Architecture → Tasks chain first, give every requirement a testable acceptance criterion with a
verification method, record every key decision as a numbered ADR with at least one real alternative,
and keep the specs in sync with the behavior._

---

Sources / further reading:
[sdd]: https://github.com/github/spec-kit/blob/main/spec-driven.md "GitHub Spec Kit — Spec-Driven Development: explicit acceptance criteria as active quality gates, what before how"
[ac]: https://productschool.com/blog/product-fundamentals/acceptance-criteria "Acceptance Criteria — Given/When/Then, binary pass/fail, criterion doubles as test case"
[madr]: https://adr.github.io/madr/ "MADR 4.0 — Markdown Architectural Decision Records: decision drivers, considered options, Confirmation (formerly Validation)"
[adr]: https://aws.amazon.com/blogs/architecture/master-architecture-decision-records-adrs-best-practices-for-effective-decision-making/ "Master ADRs: Best Practices — one decision per ADR, alternatives, consequences"
