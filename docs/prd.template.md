# PRD — <feature name>

> Purpose: define WHAT we're building and HOW we'll know it's done, before code.
> Copy to `docs/prd-<feature>.md`, fill every `<!-- fill-in -->`, delete examples.
> The PRD is the source of truth for "done" — code and tests must align to it.
> Ref: [Spec Kit specify](https://github.com/github/spec-kit),
> [acceptance criteria](https://www.atlassian.com/work-management/project-management/acceptance-criteria),
> [Gherkin AC guide 2026](https://testquality.com/gherkin-user-stories-acceptance-criteria-guide/).

**Status:** Draft · **Last updated:** <!-- YYYY-MM-DD --> · **Owner:** <!-- name -->

---

## Problem

<!-- fill-in: what we are solving and why it matters. Lead with the pain and its
     root cause (5 Whys), not the solution. -->

_Describe the problem and its impact._

## Users

<!-- fill-in: every role that touches this, with their job-to-be-done. -->

| Role                  | Goal / job-to-be-done      | Frequency | Tech level      |
| --------------------- | -------------------------- | --------- | --------------- |
| _e.g. Field operator_ | _Capture a batch in < 30s_ | _Daily_   | _Non-technical_ |

## Scope / MVP

<!-- fill-in: MoSCoW. An explicit out-of-scope list is the scope-creep guard. -->

- **MUST have**: _blocks launch without it._
- **SHOULD have**: _important; can ship shortly without._
- **COULD have**: _nice to have if time allows._
- **Out of scope (WON'T this release)**: _e.g. No mobile app in v1._

## Success criteria

<!-- fill-in: release-level testable outcomes with a number. -->

- _e.g. User completes sign-up in under 2 minutes (measured via funnel)._
- _e.g. API p95 latency < 200 ms under expected load._

## Acceptance criteria (per feature / story)

<!-- fill-in: each criterion is an OUTCOME ("User can…", "When X, then Y") with a
     concrete verification. Include at least one negative/edge case per feature.
     INVEST + Given/When/Then keeps them unambiguous and machine-verifiable. -->

| ID  | Feature   | Criterion (Given / When / Then)                                                                  | How to verify                           |
| --- | --------- | ------------------------------------------------------------------------------------------------ | --------------------------------------- |
| AC1 | _Login_   | _Given a registered user, when they submit valid email+password, then they reach the dashboard._ | _E2E (happy path)_                      |
| AC2 | _Login_   | _Given invalid credentials, when submitted, then return 401 with no stack trace._                | _Unit test on auth service (edge path)_ |
| AC3 | _Pricing_ | _Given a cart total, when computed, then money uses integer minor units (never FLOAT)._          | _Unit test asserting exact cents_       |

> Each AC maps to a cell in the testing matrix (Unit / UI / Integration × happy / edge).
> An AC that can't be verified isn't ready — refine it before building.

## Non-functional requirements

<!-- fill-in: the stuff teams forget. Mark "n/a" deliberately. -->

- **Performance**: _e.g. p95 < 200 ms._
- **Accessibility**: _WCAG 2.2 AA (keyboard, contrast, labels)._
- **Security / privacy**: _auth, roles, encryption, GDPR/HIPAA if applicable._
- **Availability / observability**: _uptime target; logging + alerting._

## Risks and assumptions

<!-- fill-in: Risk | Likelihood | Impact | Mitigation. -->

- _e.g. Assumes auth provider SLA of 99.9% (mitigation: cached offline login)._
