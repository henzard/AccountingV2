# Workflow: SDLC & prompt flow

> Read-only reference. A guided, question-by-question prompt flow so neither you nor
> the AI skip the things that cause rework later. Work the steps in order; the
> answers fill `docs/constitution.md`, `docs/prd-*.md`,
> `docs/architecture.md`, and `planning/tasks-*.md`.
> Ref: [intent-driven SDD](https://intent-driven.dev/knowledge/best-practices/),
> [SDD 2026 guide](https://thebcms.com/blog/spec-driven-development),
> [Toptal — requirements mistakes](https://www.toptal.com/product-managers/digital/requirements-gathering-mistakes).

> **Rule of thumb:** if you catch yourself thinking "the AI probably understands what
> I mean," stop and answer one more question. Ambiguity is where projects fail.

---

## Part 1: Discovery & requirements (prompt flow)

### Step 1 — Problem deep-dive

Move past the symptom to the root cause — most projects fail building for a symptom.
Ref: [5 Whys](https://atlassian.com/team-playbook/plays/5-whys).
**Prompt:**

```
I want to define what we're building and why. Interview me one question at a time.
Cover (don't skip any):
1. THE PAIN — what problem, who feels it, how solved today, what breaks, how often?
2. ROOT CAUSE — ask "why" up to 5 times until something structural.
3. IMPACT — what does it cost (time/money/errors)? What if we do nothing for 6 months?
4. DESIRED OUTCOME — perfect day-to-day; the single sentence for success.
5. WHY NOW — what triggered this? Any deadline?
Then summarise: problem (2–3 sentences), root cause, impact (quantified), success
statement (one sentence), urgency.
```

**Produces:** PRD **Problem** + **Success criteria**.

### Step 2 — Users and context

Missed requirements come from not knowing who uses the thing, and how.
Ref: [Jobs to Be Done](https://strategyn.com/jobs-to-be-done/).
**Prompt:**

```
Interview me one question at a time:
1. WHO — every role; their job-to-be-done; tech level; usage frequency.
2. USER JOURNEY — pain → opens solution → step by step → outcome; the "aha" moment.
3. CONTEXT — devices/browsers/OS; online-only or offline; solo or collaborative.
4. EXISTING WORKFLOWS — adjacent tools; integrations; imports/exports.
5. EDGE CASES — where users get stuck; undo on mistakes; permission levels.
Summarise: roles table (Role|Goal|Frequency|Tech level), happy-path journey,
integrations, top 3 edge cases.
```

**Produces:** PRD **Users**, shapes **Scope/MVP**, surfaces integrations/edge cases.

### Step 3 — Scope and prioritization

Scope creep is the #1 killer — force a boundary now.
Ref: [MoSCoW](https://en.wikipedia.org/wiki/MoSCoW_method),
[INVEST](<https://en.wikipedia.org/wiki/INVEST_(mnemonic)>).
**Prompt:**

```
Interview me one question at a time:
1. MVP BOUNDARY — essential steps for the first usable version; the one feature that,
   if missing, makes it useless.
2. MoSCoW — classify each capability: MUST / SHOULD / COULD / WON'T this release.
3. NOT BUILDING — out-of-scope items; competitor features we intentionally skip + why.
4. CONSTRAINTS — deadline, effort, budget, legal/regulatory.
5. SUCCESS METRICS — how we know v1 succeeded; minimum bar to call it shipped.
Produce: MoSCoW list, explicit out-of-scope, success metrics with targets, rough timeline.
```

**Produces:** PRD **Scope/MVP**, **Out of scope**, **Success criteria**.

### Step 4 — Tech, architecture, and constraints

Choose deliberately now that you have context. Ref:
[NFR checklist](https://www.door3.com/blog/non-functional-requirements-checklist),
[ADR format](https://adr.github.io/), `docs/reference/tech-stack-decision-guide.md`.
**Prompt:**

```
Interview me one question at a time:
1. TECH PREFERENCES — preferred lang/framework; existing codebase + stack; tech to avoid.
2. INFRASTRUCTURE — where it runs; expected scale (launch / 12mo / peak); data shape.
3. NON-FUNCTIONAL (the forgotten stuff) — performance (e.g. p95 < 200ms), availability,
   security/roles/encryption, privacy/compliance (GDPR/HIPAA/SOC2/CCPA),
   ACCESSIBILITY (target WCAG 2.2 AA), scalability (10x without re-architecture),
   observability, backup/recovery (RPO/RTO).
4. INTEGRATIONS — 3rd-party APIs; auth provider; payment/email/SMS/storage.
5. DEPLOYMENT — CI/CD; staging/preview; who deploys.
Produce: proposed stack, NFR summary table, ADR candidates, integration list.
```

**Produces:** `docs/architecture.md`, ADRs, PRD **Risks** + **Tech stack**.
Apply the kit invariants: deps point inward, money never FLOAT, snake_case 3NF DB.

### Step 5 — Acceptance criteria (testable "done")

If you can't say how to verify it, the requirement isn't clear yet.
Ref: [Atlassian AC](https://www.atlassian.com/work-management/project-management/acceptance-criteria),
[Gherkin AC 2026](https://testquality.com/gherkin-user-stories-acceptance-criteria-guide/).
**Prompt:**

```
For each MUST/SHOULD feature write acceptance criteria:
1) Outcome-focused, Given/When/Then: "Given X, when Y, then Z."
2) How to verify (automated test, manual step, or both) — map to a test cell
   (Unit / UI / Integration × happy / edge).
3) At least one negative/edge case per feature.
Format: | ID | Feature | Criterion (G/W/T) | Verify |
Flag any criterion still vague and needs my input.
```

**Produces:** PRD **Acceptance criteria** — the "done" checklist and UAT gate.

### Step 6 — Risk and unknowns

Most rework comes from risks nobody named.
Ref: [requirements elicitation](https://www.apriorit.com/white-papers/699-requirement-elicitation).
**Prompt:**

```
Interview me one question at a time:
1. TECHNICAL RISKS — unfamiliar stack; fragile 3rd-party dependency; perf/data-size.
2. PRODUCT RISKS — wrong workflow; guessing user behaviour; competitor response.
3. RESOURCE RISKS — bus factor; realistic timeline; cost surprises (API/hosting).
4. UNKNOWNS — everything we said "figure out later"; for each propose spike/research/ask.
Produce: Risk table (Risk|Likelihood|Impact|Mitigation) + unknowns with an action each.
```

**Produces:** PRD **Risks and assumptions**; research tasks; spikes (`templates/docs/spike.template.md`).

### Step 7 — Task breakdown and order

Break the spec into small, ordered, verifiable items. Ref:
[GSD atomic plans](https://github.com/gsd-build/get-shit-done),
[Spec Kit tasks](https://github.com/github/spec-kit).
**Prompt:**

```
Using PRD + architecture + AC + risks, break work into ordered tasks:
- one logical thing each (one sitting); a verification step (command/test/manual);
  dependencies (task IDs); group into phases; flag tasks needing a spike first.
Output: | ID | Description | Verification | Deps | Phase |
Then tell me: total tasks, phases, what can run in parallel, highest-risk tasks.
```

**Produces:** `planning/tasks-<feature>.md`. Run `./scripts/verify.sh` after each task.

### Step 8 — Review before building

One gut-check before coding.
**Prompt:**

```
Review constitution, PRD, architecture, tasks. Check for:
1. vague/untestable acceptance criteria; 2. MUST features with no covering task;
3. tasks with no verification; 4. conflicting requirements;
5. missing NFRs (performance, security, accessibility).
List issues + proposed fixes. Don't start coding until resolved or I say proceed.
```

**Produces:** a clean, reviewed spec — issues fixed now, not mid-implementation.

---

## Part 2: AI / Human collaboration rules

### Who does what

| Activity                        | Human                                                 | AI                                                                    |
| ------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------- |
| Define pain/users/scope/success | owns the what & why; answers Part 1                   | asks discovery Qs; drafts PRD/AC; flags gaps                          |
| Decide tech & architecture      | approves stack & key decisions; sets hard constraints | proposes options + trade-offs; drafts ADRs; implements after approval |
| Write specs & tasks             | reviews/edits; signs off AC                           | drafts constitution/PRD/architecture/tasks                            |
| Implement code                  | reviews diffs; runs verify; accepts/requests changes  | implements per tasks & standards; writes tests                        |
| Verify & UAT                    | runs verify; manual checks; signs off "done"          | suggests test cases; runs commands if approved                        |
| Fix drift                       | decides spec-vs-code source of truth                  | prefers regenerating from spec when drift is large                    |

### When the human must be in the loop

- **Scope/goal change** — confirm before the AI rewrites PRD or tasks.
- **New tech/architectural decision** — approve before an ADR or stack change.
- **Secrets & production** — AI never adds secrets or deploys to prod without explicit human action.
- **Definition of Done** — human confirms AC are met (or delegates to approved automated tests).
- **Ambiguous requirements** — if the AI must guess, it asks first ("I assumed X — right?").

### When the AI should ask for clarification

Ambiguous AC ("fast enough" with no number); conflicting constraints (offline-first vs.
real-time with no priority); missing context (API contract, brand, data format);
multiple valid implementations (offer 2–3, ask); unclear scope boundary; unspecified NFRs.

### Shared rules to add to your constitution

- **Single source of truth:** the PRD defines "done"; code and tests align — when they drift, update the spec or regenerate.
- **One logical change per commit:** Conventional Commits (`feat(scope):`, `fix(scope):`).
- **Verify before commit:** run `./scripts/verify.sh` before marking a task done.
- **No secrets in code or prompts:** AI must not read or commit `.env`, keys, credentials.
- **Ask, don't assume:** unclear requirement → one clarifying question, not a guess.

---

## Quick reference: flow → artifacts

| Step       | You / AI                     | Artifact updated                     |
| ---------- | ---------------------------- | ------------------------------------ |
| 1 Pain     | you answer; AI interviews    | PRD Problem, Success                 |
| 2 Users    | you answer; AI maps journey  | PRD Users, integrations, edge cases  |
| 3 Scope    | you answer; AI drafts MoSCoW | PRD Scope/MVP, Out of scope, metrics |
| 4 Tech     | you answer; AI proposes      | Architecture, ADRs, PRD Risks        |
| 5 AC       | you approve; AI drafts       | PRD Acceptance criteria              |
| 6 Risks    | you answer; AI tables        | PRD Risks; research/spikes           |
| 7 Tasks    | AI drafts                    | `planning/tasks-*.md`                |
| 8 Review   | AI audits; you approve       | all artifacts gap-checked            |
| Implement  | AI implements; you review    | code + verify                        |
| Verify/UAT | you run verify; sign off     | done checklist                       |

> **Anti-pattern:** don't paste a vague idea and say "build it" — that's vibe coding.
> Five minutes on Step 1 and Step 5 saves hours of rework.
> Ref: [SDD anti-patterns](https://intent-driven.dev/knowledge/best-practices/).
