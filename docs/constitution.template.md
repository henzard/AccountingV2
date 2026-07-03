# Project Constitution — <project name>

> Purpose: the one source of truth for this project's non-negotiable principles
> and constraints. Copy this file to `docs/constitution.md`, fill every
> `<!-- fill-in -->`, and delete the example bullets. Keep it short — a
> constitution is a list of binding rules, not a design doc. It lives in the repo,
> evolves with the product, and is loaded as persistent context every session.
> Ref: [Spec Kit](https://github.com/github/spec-kit),
> [SDD 2026 guide](https://thebcms.com/blog/spec-driven-development),
> [Constitutional SDD](https://arxiv.org/abs/2602.02584) (constitutional
> constraints reduced security defects ~73% vs. unconstrained AI generation).

**Status:** living document · **Last updated:** <!-- YYYY-MM-DD --> · **Owner:** <!-- name/role -->

---

## Purpose

<!-- fill-in: ONE sentence — what this project exists to do. -->

_e.g. Give field crews an offline-first app to capture, grade, and sync produce batches._

## Principles

<!-- fill-in: 3–7 binding rules. State WHAT + WHY so edge cases resolve correctly.
     Write each as a testable invariant, not an aspiration. -->

- _e.g. **Every behaviour change ships with a test in its applicable layer** — a
  changed behaviour with no test does not merge (catches silent regressions)._
- _e.g. **Money is never stored or computed as FLOAT** — use integer minor units
  (cents) or fixed-precision decimal; floats lose cents at scale._
- _e.g. **Dependencies point inward** — domain/business logic never imports UI,
  framework, or DB adapters; only outer layers depend on inner ones
  ([Clean Architecture dependency rule](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html))._
- _e.g. **The database is snake_case and 3NF by default** — denormalise only with
  an ADR recording the trade-off._
- _e.g. **UI meets WCAG 2.2 AA** — keyboard-operable, labelled, contrast-checked._
- _e.g. **No secrets or PII in code, logs, or prompts** — env vars only._
- _e.g. **One logical change per commit, Conventional Commits** (`feat(scope):`,
  `fix(scope):`); the spec is the source of truth — update it when behaviour changes._

## Out of scope

<!-- fill-in: what we explicitly DO NOT do. Naming exclusions prevents scope creep. -->

- _e.g. We do not support Internet Explorer or pre-WCAG-2.2 browsers._
- _e.g. We do not run untrusted user code on the server._
- _e.g. No multi-tenant billing in v1._

## Quality bar (definition of "done")

<!-- fill-in: the minimum bar a change must clear to merge. -->

- Lint and format pass; typecheck clean.
- Tests pass; new behaviour is covered (see `docs/testing-strategy.md`).
- No hardcoded secrets; no PII in logs.
- No high/critical security findings.

## Collaboration (optional)

<!-- fill-in: who decides what / when a human is in the loop.
     Copy from docs/reference/workflow-sdlc.md "AI/Human collaboration rules". -->

- _e.g. Human owns pain, scope, and success criteria; AI drafts PRD and tasks._
- _e.g. Human approves tech and architecture (via ADR); AI implements after approval._
- _e.g. Verify before commit; AI never commits secrets or deploys to prod._

## Amending this constitution

<!-- fill-in: changes are versioned, not silent. -->

- Change via PR with rationale; bump **Last updated**. A principle that touches a
  LOCKED invariant requires an ADR (`docs/adr/`).
