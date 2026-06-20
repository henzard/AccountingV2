---
name: weighsoft-review-and-quality
formerly: review-and-quality
description: Enforce the six-dimension code-review rubric — Correctness, Tests, DX, Architecture, Performance, Security — before any code is called complete, with correctness and security as hard merge-blockers, backed by automated quality gates (pre-commit lint/format/test/type, and a CI pipeline of Dependencies→Lint→Test→Type→Build) that must pass to merge. Use when asked to "review this PR", "is this ready to merge", "set up quality gates / CI checks", or before declaring any change done.
version: 1.0.0
category: quality
tags:
  - code-review
  - quality-gates
  - ci-pipeline
  - correctness
  - security
  - testing
  - architecture
  - merge-blocking
  - review-rubric
---

# weighsoft-review-and-quality — six dimensions, two of them non-negotiable

> 🔁 **Renamed:** this skill is now **weighsoft-review-and-quality** (formerly **review-and-quality**). Update any references; other systems keying off the old name should rename to match.

Every change is graded on the same rubric before it is "done". Automation catches the trivial so
humans review the load-bearing — logic, design, security — not indentation.

> **A change is complete only when all six dimensions pass — and correctness or security failing
> is a hard stop, no exceptions.**

## The rules

### The six-dimension rubric (grade every change)

1. **Correctness** — behavior matches the acceptance criteria; edge/error/boundary paths handled;
   no obvious bug. **BLOCKING.**
2. **Tests** — new logic carries tests; existing tests still pass; no silent regressions; tests
   assert real behavior, not just that code ran.
3. **DX** — names reveal intent, structure matches the coding standards, no dead code, no surprises
   for the next reader.
4. **Architecture** — dependencies flow inward (domain ← app ← adapters); no new god-class, shotgun
   coupling, or layering violation; SOLID respected.
5. **Performance** — no **N+1 queries**, unbounded loops, oversized payloads, or obvious hot-path
   waste; pagination/limits where data grows.
6. **Security** — no new vulnerability; inputs sanitized **at the boundary**; authZ checked on every
   protected path; secrets never hardcoded or logged. **BLOCKING.**

> **Merge cannot proceed if Correctness or Security fails** — the other four are strong-but-fixable,
> these two are gates. ([code review best practices][cr], [secure review][sec])

### Quality gates (automate the trivial)

- **Pre-commit:** format → lint → **test suite** → type-check, all green locally before a commit
  lands.
- **CI pipeline, ordered:** **Dependencies → Lint → Test → Type-check → Build**, plus an optional
  **security/secret scan** (OWASP-style SAST, secret detection). Fail fast — cheapest stage first.
- **Passing CI is a merge requirement** — branch protection enforces it; trivial feedback (style,
  format) never reaches a human reviewer. ([CI quality gates][cr])

### Keep PRs small, reviews fast

- **Small PRs review better** — keep diffs reviewable (aim well under ~200 lines of real change;
  smaller is faster to review, merge, and diagnose). Large batches hide defects and stall flow. ([slow reviews data][prs])
- **Set a first-response SLA** — same business day at minimum; elite teams land first review
  comments within hours, not days. A standing SLA plus auto-assigned reviewers keeps cycle time
  from bleeding into review latency. ([slow reviews data][prs])
- **Measure flow with DORA, not vibes** — the four keys are deployment frequency, lead time for
  changes, **failed deployment recovery time** (since 2024 this replaced MTTR and sits with
  throughput), and change failure rate; the 2024 report adds **rework rate**. AI lifts throughput
  but tends to raise instability — watch CFR/rework, don't just count merged PRs. ([DORA metrics][dora])

### Principles

- **Acceptance criteria demonstrably satisfied** — show the run/output, don't assert "works".
- **Automate testing** for business logic and API contracts; manual review covers context and
  judgment, automation covers scale. ([balanced review][wiz])
- **Sanitize inputs at boundaries**; treat every request as untrusted until validated/authorized.
- **Never hardcode secrets or log credentials** — fail the review on sight.
- **Document intentional testing gaps** (why, and what would close them) rather than hiding them.
- **Track architectural improvements as follow-up issues** — note the smell, don't silently let it
  rot or scope-creep the PR.

### Exception — emergency hotfix

A production-down hotfix **may defer the non-critical dimensions** (DX, perf, deeper tests) — but
**Correctness and Security still hold**, and the deferred dimensions are filed as immediate
follow-up. "Emergency" is never a license to ship an exploit or a wrong answer.

## Anti-patterns to reject

- **"Tests pass" with no new tests for new logic** — WHY: coverage didn't move; the behavior is
  unverified and the next change can silently break it.
- **Approving on style/diff size alone** — WHY: indentation nits crowd out the correctness and
  security review that actually matters; let the linter own style.
- **Correctness/security flagged but merged "to unblock"** — WHY: these are the two blocking
  dimensions by definition; merging past them ships a known defect or hole.
- **Secrets in code or logs** — WHY: a committed/logged credential is leaked the moment it's pushed;
  rotation + history rewrite is far costlier than catching it in review.
- **Unsanitized boundary input / missing authZ check** — WHY: injection and broken-access-control are
  top real-world breach causes; trust must be established at the edge.
- **N+1 / unbounded query merged untracked** — WHY: it works on dev's 10 rows and melts on prod's
  10M; perf debt invisible at review surfaces as an outage.
- **Green-CI-equals-good** — WHY: passing pipelines prove the gates ran, not that the logic is
  correct; the human rubric still applies.
- **Giant PR / review sat for days** — WHY: oversized diffs and high review latency hide defects
  and tank delivery flow; small PRs with a first-response SLA review better and merge faster. ([slow reviews data][prs])

## How it composes with the kit

- **add-feature** Phase 6 _is_ this rubric — it gates the feature before `/weighsoft-qa-lead`; correctness &
  security blocking comes straight from here.
- **qa-lead** runs the six dimensions across its specialist swarm and owns the e2e sign-off this
  rubric demands as proof.
- **verification-quality** supplies the evidence bar — "passes" means the run was shown, the gate was
  green, the regression test exists.
- **spec-review** ensures the acceptance criteria this rubric checks correctness _against_ are real
  and unambiguous before review even starts.
- **branch-hygiene** keeps the pre-commit/CI gates running on a protected branch so nothing merges
  around them.

## Conformance checklist

- [ ] All six dimensions graded; findings recorded
- [ ] Correctness verified against acceptance criteria with shown output — **blocking if failed**
- [ ] Security: boundary input sanitized, authZ checked, no secrets in code/logs — **blocking if failed**
- [ ] New logic has tests; full suite green; no unexplained coverage drop
- [ ] Architecture: deps inward, no new god-class/coupling smell, SOLID held
- [ ] Performance: no N+1, no unbounded loop/payload; limits where data grows
- [ ] PR is small/reviewable; first-response SLA met (same business day or better)
- [ ] Pre-commit (format→lint→test→type) and CI (deps→lint→test→type→build) green; CI required to merge
- [ ] Deferred items (gaps, smells, hotfix debt) filed as follow-up issues with reasons

## Quick reference

```text
6 dims (grade all):  Correctness* · Tests · DX · Architecture · Perf · Security*
                     (* = BLOCKING — no merge if these fail)
Pre-commit gate:     format → lint → test → type-check
CI pipeline:         Dependencies → Lint → Test → Type → Build  (+ optional security scan)
Flow:                small PRs (<~200 lines) · first-response SLA same-day · measure with DORA 4 keys
Hard rules:          inputs sanitized at boundary · authZ everywhere · no secrets in code/logs
Hotfix:              may defer DX/perf/deep-tests — NEVER correctness or security; file the rest
Done:                criteria shown to pass · CI required-green · gaps & smells filed
```

**The gate, one line:** _code isn't done until it passes the six-dimension rubric — and if
correctness or security fails, it does not merge, hotfix or not; let CI's deps→lint→test→type→build
own the trivial so the human review owns the logic, security, and design._

---

Sources / further reading:
[cr]: https://www.codeant.ai/blogs/good-code-review-practices-guide "The Complete Code Review Process — best practices, CI quality gates, block merge on fail"
[sec]: https://devcom.com/tech-blog/secure-code-review-best-practices-to-protect-your-applications/ "Secure Code Review Best Practices (boundary input, authZ, secrets)"
[wiz]: https://www.wiz.io/academy/application-security/code-review-best-practices "Essential Code Review Best Practices — automation + manual oversight"
[prs]: https://dev.to/vitalii_petrenko_dev/the-hidden-cost-of-slow-code-reviews-data-from-8-million-prs-5fei "The Hidden Cost of Slow Code Reviews (8M PRs) — small PRs, first-response SLA, review latency"
[dora]: https://octopus.com/devops/metrics/dora-metrics/ "The 4 DORA Metrics + 2024/25 findings — failed deployment recovery time replaces MTTR, rework rate added"
