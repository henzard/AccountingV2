---
name: weighsoft-deep-review
formerly: deep-review
description: One-command enterprise-grade deep review of any repo — inventory + real coverage, multi-agent security (red/blue/verify) and quality (6 specialists) review, files every finding as a GitHub issue, scores the system 0-100 against a fixed rubric, authors the engineering scaffolding (CLAUDE.md/AGENTS.md/testing-strategy/anti-patterns/conventions/ADRs), installs CI + PR/issue templates + protect-branch hooks, creates dev/qa branches with branch-protection policies, and emits a self-contained HTML scorecard report. Use when asked to "deep review", "audit this repo", "score this system", or to onboard a vibe-coded project to enterprise discipline.
version: 1.0.0
category: review
---

> 🔁 **Renamed:** this skill is now **weighsoft-deep-review** (formerly **deep-review**). Update any references.

# /weighsoft-deep-review — portable enterprise deep-review pipeline

Drop the `repo-review/` folder into any project (or run from it) and execute this
end-to-end. It turns a raw / "vibe-coded" repo into a reviewed, scored, scaffolded,
policy-protected one. Every phase is **evidence-based** (file:line) and **filed as
issues** so nothing is lost to chat.

> **Honest caveat (state it in the report):** an LLM + scanners substantially reduce
> risk but cannot prove a system is unhackable or bug-free. Keep a human on Critical
> findings and anything touching auth, crypto, money, or multi-tenant isolation.

## Orchestration model

- **Preferred:** if the **Workflow tool** is available, run `workflows/weighsoft-deep-review.workflow.js`
  (it fans the specialists out in parallel with adversarial review passes and a
  completeness loop). The user must have opted into multi-agent orchestration.
- **Fallback (parallel):** spawn the specialists as background agents (Task tool,
  `run_in_background: true`) per the `weighsoft-security-review` and `weighsoft-quality-review` skills.
- **Fallback (always works):** with no Workflow tool and no background agents, run the
  specialist passes **sequentially in the main thread** — RT1–RT5 (+ extended when the
  subsystem exists), then the six quality specialists, then verify → file → author. Same
  phases, same outputs, just serial. Nothing in this kit requires parallelism.
- **Manager posture:** decompose → dispatch → monitor → report. Keep the main thread
  interruptible. Commit + push after every phase (never lose work).

**What the workflow automates vs. what this skill drives:** the workflow's six stages —
_Inventory → Review → Verify → File → Author → Completeness_ — cover Phases 0, 2, 3 (review +
adversarial verify), 4 (file issues), 6 (author scaffolding), and 10 (completeness loop). It
auto-adds the extended specialists (RT6–8, sync/orchestration/backend) only when its inventory
finds the subsystem. The skill drives the rest around it: Phase 1 (real coverage — you run it
and pass the numbers in as `args.coverage`), Phase 5 (score via `rubric.md`), Phase 7
(`install.sh`), Phase 8 (branch scripts — need `gh` admin), and Phase 9 (`generate-report.mjs`).

## Inputs

- Target repo path (default: cwd). Confirm `git` clean, `gh auth status` OK, the
  **default branch** (`gh repo view --json defaultBranchRef`), and the **stack**
  (languages, test runner, DB, API style, frontend, deploy target).
- Scope: whole repo (default), or a PR/branch diff for a lighter pass.

## Phase 0 — Preflight (use the `weighsoft-branch-hygiene` + `weighsoft-verification-quality` skills)

1. `scripts/bootstrap-labels.sh <owner/repo>` — create severity + domain labels.
2. Create the review branch off the default: `git checkout -b review/deep-review-$(date +%Y%m%d)`.
3. Map the repo: frontend / backend / API / data layer / tests / infra → write a
   **structure inventory** first (so agents don't all re-scan the tree).

## Phase 1 — Real coverage (never let agents guess)

Run the actual suite with coverage and capture per-module numbers:

```bash
npx vitest run --coverage    # Node (Vitest); or: npm test -- --coverage (Jest)
# Python: pytest --cov · Go: go test -cover ./... · Rust: cargo llvm-cov (or cargo tarpaulin)
```

Feed the real numbers to the Test specialist. If the runner needs a native rebuild
or services, note what was excluded.

## Phase 2 — Security review (skill: `weighsoft-security-review`)

Red team (RT1 injection · RT2 authN/authZ · RT3 web/client · RT4 secrets/crypto/supply-chain
· RT5 infra/deploy · + RT6 auth deep-dive · RT7 integrations/multi-tenant · RT8 CI/CD —
only when those subsystems exist) → Blue team (root cause + minimal fix + regression test +
defense-in-depth) → Verify (re-attack, mark CLOSED/PARTIAL/OPEN). Categorise findings against
**OWASP Top 10:2025** (note the new A03 Software Supply Chain Failures and A10 Mishandling of
Exceptional Conditions, and that SSRF folded into A01). Fold in scanners:
the stack's dependency-CVE audit (Node `npm audit` · Python `pip-audit` · Go `govulncheck ./...`
· Rust `cargo audit`), plus `gitleaks`, `semgrep --config auto`, secret-in-history grep.

## Phase 3 — Quality review (skill: `weighsoft-quality-review`)

Six specialists in parallel — **A Test** (coverage + authenticity), **B UX**
(Nielsen + WCAG 2.2 AA), **C UI/design-system**, **D API**, **E Backend**
(SOLID + smells), **F Database**.

The **Test** specialist must cover all of:

- **The six-layer matrix** — enumerate every route and every data mutation, then fill
  a matrix of the six cells: `unit-happy · unit-edge · UI-happy · UI-edge ·
integration-happy · integration-edge` (mark each present / missing / weak). **Any
  data mutation with a missing integration-edge cell is high priority** — those are the
  silent failure paths.
- **E2E authenticity** — do E2E specs assert real outcomes, or just "page loaded"? List
  weak specs and what each should actually assert.
- **The four named anti-patterns** (the product/code anti-patterns Phase 6 catalogues in
  `docs/anti-patterns.md`; adapt each principle to THIS stack, find every area exhibiting
  it with `file:line` + fix): (1) **flicker / unmount-on-refetch** (list blanks on
  re-fetch); (2) **post-action gap** (assert the action dispatched but never re-read the
  resulting state); (3) **fix-without-backfill** (a code fix that protects only future
  rows while the existing data stays broken); (4) **deploy-time blind spot** (a
  health/smoke check that returns OK regardless of real runtime state).

(Distinct from the four _verification_ anti-patterns in `weighsoft-verification-quality` — orphan
test, mocked-away subject, "tests pass ⇒ done" for UI, pre-existing-failure-as-blanket —
which guard the audit's own evidence. Apply both sets.)

**Extended specialists, dispatch ONLY if the subsystem exists** (run order = risk,
G first since data loss is unrecoverable): **G Replication/Sync** correctness
(offline-first / edge↔hub — convergence, conflict resolution, cursor, idempotency,
partial-failure atomicity, deletes/tombstones, skip-log, ordering — flag any
silent-write-loss as Critical), **H Orchestration/integrations** (event outbox,
job state machine, webhooks, rules engine, cross-tenant isolation — Critical if broken),
**I remaining backend** (projections, parsers/ReDoS, key management).

## Phase 4 — File every finding as a GitHub issue

One issue per material finding with severity + domain labels (see `bootstrap-labels.sh`).
Title `[Sev][Domain] …`, body = `location (file:line) · standard violated · evidence ·
fix`. Close + comment any you fix in Phase 2's blue-team pass.

## Phase 5 — Score the system (see `rubric.md`)

Apply the fixed 8-dimension weighted rubric → a **single 0-100 as-built score** + grade
(A–F). **Security and data-integrity inherit the weakest component** (a system is only as
safe as its weakest half), not an average. Multi-repo system → one score. Record the
per-dimension sub-scores (each maps to an audit doc's grade) so it's reproducible and
comparable across systems.

## Phase 6 — Author the engineering scaffolding (tailored to THIS repo)

Author, grounded in the real code (read package.json/source/the audit docs you just wrote):

- `CLAUDE.md` (root pointer-index + scoped sub-dir files), `AGENTS.md`
- `docs/testing-strategy.md` (six-layer matrix adapted to the stack), `docs/anti-patterns.md`,
  `docs/engineering-conventions.md`, `docs/adr/` (template + the real locked decisions),
  `docs/audit/INDEX.md`
  Use `examples/*.example.md` as shape references — **adapt, never copy**; every claim must
  be true to the target repo.

## Phase 7 — Install scaffolding (`scripts/install.sh <target>`)

Copies into the target: `.claude/skills/*` (these skills), `.claude/hooks/*` +
`.claude/settings.json` (protect-branch guards), `.github/workflows/ci.yml` (tailored to
the detected runner — DO NOT ship steps the repo can't run), `.github/pull_request_template.md`,
`.github/ISSUE_TEMPLATE/*`, and `docs/adr/0000-template.md`. (The HTML report is generated
later in Phase 9 by `generate-report.mjs`, which is self-contained — nothing to install.)

## Phase 8 — Branches + policies

- `scripts/setup-branches.sh` — create the 3-tier `dev` → `qa` → `main` (off the default).
- `scripts/setup-branch-protection.sh <owner/repo>` — require PRs + CI green + no direct
  pushes on `main`/`qa`/`dev`; set `dev` as the default working base.

## Phase 9 — HTML scorecard report

`scripts/generate-report.mjs findings.json > docs/audit-report.html` — self-contained,
single-file scorecard (the rubric score + per-dimension bars + Critical findings + fixes +
next steps). Serve with `python3 -m http.server 8080 --directory docs` (avoid port 6000 —
browsers block it as ERR_UNSAFE_PORT).

## Phase 10 — Completeness pass ("nothing is missed")

Run a completeness critic loop (≥ several passes, until two consecutive return nothing):
_"What attack surface, mutation, route, data flow, or subsystem did we NOT examine? What
claim is unverified? What test layer is empty?"_ Each gap becomes a new finding/issue.
Then re-run the suite + scanners and confirm green. End with the report + a summary PR.

## Outputs (definition of done)

- [ ] Inventory + real coverage captured
- [ ] Security review (red/blue/verify) complete; Critical/High fixed or issue-filed
- [ ] Quality review (6 + applicable extended) complete
- [ ] Every finding filed as a labelled issue
- [ ] Single 0-100 system score + grade, per-dimension breakdown
- [ ] CLAUDE.md/AGENTS.md/testing-strategy/anti-patterns/conventions/ADRs authored
- [ ] CI + templates + hooks installed; dev/qa branches + protection set
- [ ] HTML scorecard report generated
- [ ] Completeness loop ran clean; summary PR opened

See `HOW-TO.md` for the step-by-step runbook and `rubric.md` for the scoring rubric.
