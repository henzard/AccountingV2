---
name: weighsoft-quality-review
formerly: quality-review
description: Multi-agent code quality + test audit — an orchestrator dispatches six specialists (test coverage & authenticity, UX, UI components, API, backend SOLID/code-smells, database) over their layers and merges findings into one report with per-domain health scores and a prioritized backlog
version: 1.0.0
category: quality
tags:
  - quality
  - testing
  - coverage
  - solid
  - ux
  - ui
  - api
  - database
  - review
---

> 🔁 **Renamed:** this skill is now **weighsoft-quality-review** (formerly **quality-review**). Update any references.

# /weighsoft-quality-review — Multi-Agent Code Quality & Test Review

An orchestrator maps the repo, runs **real** coverage, dispatches six specialist
agents in parallel (each scoped to its layer so they don't all re-scan the
tree), then merges everything into one consolidated report.

## When to use

- Periodic health check of the codebase, or before a release.
- After a large feature, to catch test-theatre, code smells, and UX/UI drift.

## Step 1 — Orchestrator: inventory + real coverage

1. Map the repo: frontend, backend, API layer, data layer, test suites. Output a
   structure inventory first.
2. Run the actual test suite with coverage and capture the numbers (do NOT let
   agents guess coverage):
   ```bash
   npm test -- --coverage      # Node: Jest
   npx vitest run --coverage   # Node: Vitest
   pytest --cov                # Python (pytest-cov)
   go test -cover ./...        # Go (add -coverprofile for per-pkg)
   cargo llvm-cov              # Rust (or: cargo tarpaulin)
   ```
   Use the target repo's real runner — feed the real per-module numbers to the Test agent.
3. Dispatch the six specialists below **in parallel** (Task tool,
   `run_in_background: true`), each pointed at its directories.

**Severity:** Critical | High | Medium | Low. Every finding MUST carry:
`evidence (file:line + snippet)` · `the standard it violates` · `a concrete fix`.
Reject vague findings.

## Step 2 — Specialist agents

### A. Test Coverage & Authenticity

- **Coverage:** line/branch/function/statement per module (from the real run).
  List lowest- and zero-covered files, weighted to business logic, auth, data.
- **Authenticity (the important part)** — flag tests that don't test real code:
  tautological tests (assert a mock returns what the mock was told to return),
  `toHaveBeenCalled` with no behavioral assertion, over-mocking so no real code
  runs, no-meaningful-assertion / always-pass tests, unreviewed snapshot
  rubber-stamps, missing edge/error/boundary cases, and "integration" tests that
  mock the very integration they claim to cover (e.g. mocking the DB in a DB test).
  For each weak test: `file:line`, why it's weak, what it should assert, fixed version.
  The modern bar (RTL/MSW-era): tests assert **observable behavior/outcomes, not
  implementation details**, and mock only at true boundaries (network/clock/fs) — a
  test that mocks the subject or its core collaborators proves nothing. Coverage % is
  a floor, not the goal: a high number with assertion-free tests is coverage theatre.
- **Gaps:** untested critical paths (auth, payments, mutations, RLS), missing
  negative/error/concurrency tests → prioritized list of tests to add.
- **Layer matrix (if the project defines one):** enumerate every route and every
  data mutation, then fill a matrix of `unit-happy · unit-edge · UI-happy ·
UI-edge · integration-happy · integration-edge` (present / missing / weak per
  cell). **Any data mutation with a missing integration-edge cell is high
  priority** — those are the silent failure paths.
- **E2E authenticity:** do E2E specs assert real outcomes, or just "page
  loaded"? List weak specs and what they should assert.
- **Named anti-patterns:** if the repo documents anti-patterns (e.g. in
  CLAUDE.md — flicker/unmount-on-refetch, post-action gap, fix-without-backfill,
  deploy-time blind spot), find every test/area exhibiting each, `file:line`, fix.

### B. UX Reviewer

Evaluate against **Nielsen's 10 heuristics** and **WCAG 2.2 AA** (keyboard nav,
focus order, contrast, ARIA, alt text, form labels, error identification, target
sizes). Also: core-flow efficiency & error recovery, information architecture,
feedback/system-status (loading/success/error), responsive & touch ergonomics,
form UX (validation timing, inline errors, sane defaults). Per issue:
standard violated, location (route/component), severity, user impact, fix.
End with a prioritized UX backlog + usability score (0–100).

### C. UI / Design-Systems Reviewer

Check component reuse vs duplication; design tokens vs hardcoded values (colors,
spacing, font sizes, radii — flag magic numbers & inline-style sprawl); scale
adherence (Tailwind config / CSS vars / component lib); responsive/breakpoint
consistency; component-level a11y (semantic HTML, focus states, contrast, aria);
component API quality (prop naming, sane defaults, controlled vs uncontrolled,
no needless prop drilling); anti-patterns (`dangerouslySetInnerHTML`, div soup,
layout-in-markup, dead styles); naming & file organization. Per issue:
component/file:line, standard, severity, fixed snippet. End with a
consolidate-these list + styling-debt summary.

**Route-level pass (SPAs):** for every route/page also check — error boundaries
at the right granularity (no white-screen failure modes); data-fetching patterns
(TanStack/React Query keys, `placeholderData`/no-flicker on refetch, no
waterfalls, invalidation after mutations); per-route code splitting; and bundle
size from the real build output (`vite build` / analyzer). End with a per-route
readiness checklist.

### D. API Reviewer

RESTful design (verbs, resource naming, status codes, idempotency); consistent
request/response & error schemas across endpoints; boundary input validation;
versioning & backward compat; pagination/filtering/sorting on collections;
OpenAPI presence/accuracy; does the API leak DB schema/internal models?;
consistent auth handling (no ad-hoc per-route auth); over/under-fetching & N+1
shapes. Per issue: endpoint, method, file:line, standard, severity, fix.
End with an API consistency scorecard.

### E. Backend Reviewer (SOLID + code smells)

SOLID with concrete citations: SRP (god classes/functions, mixed concerns), OCP,
LSP, ISP, DIP (hardcoded deps vs injection). Code smells: long methods, deep
nesting, duplication, primitive obsession, feature envy, shotgun surgery, dead
code, magic values, large parameter lists, tight coupling. Layering: routes →
services → data access (flag business logic in controllers / queries in route
handlers). Error handling (consistent, no swallowed errors, no leaked internals,
correct async propagation). Cyclomatic-complexity hotspots; concurrency/race &
resource leaks; logging quality. Per issue: file:line, principle/smell,
severity, refactored snippet. End with a maintainability score + top refactor
targets.

### F. Database Reviewer

Schema design (normalization or justified denormalization, correct types,
constraints NOT NULL/FK/UNIQUE/CHECK, no stringly-typed data); indexing (missing
on filtered/joined/FK columns, redundant/unused, indexes that fix N+1/slow
queries); query quality (parameterized only, no N+1, no `SELECT *`, efficient
set-based joins); migrations (present, versioned, reversible, no unguarded
destructive ops); RLS enabled & tested per table, service key never client-side;
integrity (transactions around multi-step writes, FK enforcement); access
patterns (repository/DAO separation vs queries scattered in business logic).
Per issue: object/query, file:line, standard, severity, corrected DDL/query.
End with a schema-health summary + index recommendations.

## Step 2b — Extended specialists (dispatch ONLY when the subsystem exists)

These cover higher-risk subsystems that not every repo has. The orchestrator
dispatches one only after detecting the relevant code. **Run order = risk: G
first (data loss is unrecoverable), then H, then I.** Findings here are
frequently Critical — flag anything that can silently lose a committed write,
leak across tenants, or corrupt persisted state.

### G. Replication / Sync correctness _(if an offline-first / edge↔hub / multi-master sync subsystem exists)_

Audit as a distributed-systems engineer. For EACH property, state holds/fails
and give the concrete breaking interleaving (actors + ops, step by step):

- **Convergence:** do replicas reach the same state after arbitrary interleaving
  of concurrent writes?
- **Conflict resolution:** is "last write" decided by a monotonic version/clock
  or by skew-prone wall-clock? What happens on a tie? Can a stale write win?
- **Cursor (e.g. row_version):** can it skip or re-process rows? Behaviour when a
  write lands equal to the cursor? Off-by-one on crash-resume mid-pull?
- **Idempotency:** if apply runs twice (retry/crash-resume) is the result
  identical? Any non-idempotent mutation (counters, appends)?
- **Partial failure / atomicity:** pull ok, apply fails halfway — transactional,
  or can it leave torn state?
- **Deletes:** tombstoned, or can a delete be lost / resurrected by a concurrent
  update (delete-update conflict)?
- **Skip log:** what skips a row, and is there a path where it's never retried
  (silent permanent loss)?
- **Ordering:** are FK-dependent rows applied parent-before-child, or can a child
  be dropped?
  Per finding: file:line, failing interleaving, data-loss/corruption impact,
  severity, fix. End with the properties that need a deterministic fault-injection
  test harness (simulated concurrent replicas).

### H. Orchestration & integrations correctness _(if an event/outbox/rules/job-state engine or 3rd-party integrations exist)_

- **Event outbox:** at-least-once with idempotent consumers? Drained
  transactionally with the state change, or can events be lost/double-processed?
- **Job state machine:** transitions valid & exhaustive? Any stuck state?
  Retry/backoff/dead-letter present?
- **Cross-tenant isolation (Critical if broken):** can an event/job/route leak
  across tenants?
- **Webhooks:** signature verification, replay protection, idempotency on
  redelivery.
- **Integration failure handling:** retries, partial-failure reconciliation, no
  silent drops; quota/cost accounting correctness.
- **Rules engine:** can a malformed/malicious rule cause infinite loops, resource
  exhaustion, or unintended cross-tenant actions?
  Per finding: file:line, failure scenario, severity, fix. Top priority: every
  cross-tenant gap and every silent-drop path.

### I. Remaining backend subsystems _(projections, reporting/parsers, blob/image storage, restore, key management)_

- Core-algorithm correctness: projection-rebuild idempotency; boot/heal routines
  don't corrupt valid state; restore is atomic & verified; signed-URL expiry &
  scope; blob integrity verification.
- **Parsers / expression evaluators:** untrusted input? injection / unbounded
  recursion / ReDoS?
- **Key management:** secure generation/storage/rotation; no private keys in logs
  or repo.
- SOLID, code smells, layering, error handling, resource leaks (per agent E).
  Per finding: file:line, issue, severity, fix. Flag any integrity or
  key-management issue as high priority.

## Step 3 — Orchestrator: consolidate

```text
QUALITY REVIEW — {repo @ commit}
═══════════════════════════════════════
Health scores (0–100):
  Tests {n} · UX {n} · UI {n} · API {n} · Backend {n} · Database {n}

Top 10 issues by risk:
  1. [SEV] domain — title — file:line — fix — effort
  ...

Cross-cutting issues (raised independently by ≥2 agents):
  - ...

Coverage: lines {x}% · branches {x}% · functions {x}%   (real numbers)
Fake/weak tests: {n}   |   Critical untested paths: {n}

Prioritized remediation backlog (Critical → Low, with effort estimates)
```

Flag any issue multiple agents raised — those are the highest-signal.

## Filing findings as GitHub issues (optional)

When asked, file each finding as an issue. Use the kit's canonical label scheme —
`sev:<level>` + the finding's domain label (`tests`/`ux`/`design-system`/`api`/
`code-quality`/`database`) — so issues match `bootstrap-labels.sh` and the
`weighsoft-deep-review` pipeline. (After `bootstrap-labels.sh` the labels exist; the
`--force` upserts keep this snippet self-contained.)

```bash
for s in critical high medium low info; do gh label create "sev:$s" --force >/dev/null 2>&1; done
for d in tests ux design-system api code-quality database; do gh label create "$d" --force >/dev/null 2>&1; done
gh issue create --title "[high][code-quality] <title>" --label "code-quality,sev:high" \
  --body "**Location:** file:line · **Standard:** … · **Fix:** …"
```

## Notes

- **Wire in real coverage** before dispatching the Test agent — an LLM can't
  reliably execute the suite; it must reason over actual numbers.
- **Dispatch extended specialists (Step 2b) only when their subsystem exists** —
  detect first in Step 1's inventory; don't run a sync audit on a repo with no
  replication layer.
- **Pair with deterministic tooling** so agents focus on design judgment. Use the
  stack's linters/analyzers — Node: ESLint, `ts-prune` (dead code), `npm audit`;
  Python: `ruff`/`pylint`, `mypy`, `pip-audit`; Go: `go vet`, `staticcheck`,
  `govulncheck`; Rust: `cargo clippy`, `cargo audit` — plus cross-stack
  SonarQube/SonarCloud and Semgrep.
- Scope each agent to its directories (frontend vs backend vs db vs tests) to
  avoid redundant full-tree scans and keep findings sharp.
- Portable — copy `.claude/skills/weighsoft-quality-review/` into any repo; it adapts to
  the detected stack and test runner.

---

Sources / further reading:
[rtl]: https://testing-library.com/docs/guiding-principles/ "Testing Library — test behavior, not implementation details"
[wcag]: https://www.w3.org/TR/WCAG22/ "WCAG 2.2 (W3C Recommendation) — AA success criteria"
[solid]: https://www.digitalocean.com/community/conceptual-articles/s-o-l-i-d-the-first-five-principles-of-object-oriented-design "SOLID — the five OO design principles"
