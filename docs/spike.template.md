# Spike / research — <title>

> Purpose: timeboxed investigation to resolve an unknown that blocks planning or
> implementation. Copy per spike, fill `<!-- fill-in -->`, delete examples. A spike
> produces a decision and a recommendation — NOT production code. Keep its code in
> `spike/` and throw it away.
> Ref: [GSD research phase](https://github.com/gsd-build/get-shit-done).

---

## Spike info

- **ID**: <!-- fill-in: e.g. SPIKE-001 -->
- **Title**: <!-- fill-in: e.g. Evaluate auth providers for SSO -->
- **Timebox**: <!-- fill-in: e.g. 1 day — stop and report even if unfinished -->
- **Owner**: <!-- fill-in -->
- **Status**: In progress | Done | Abandoned

## Question to answer

<!-- fill-in: the single, specific, falsifiable question. -->

_e.g. Which auth provider supports SAML SSO, costs < $100/mo, and has a Node SDK?_

## Context

<!-- fill-in: why we need to know; what it blocks. -->

- Blocking: _e.g. Task T5 in `planning/tasks-auth.md`._
- Related: _e.g. ADR 0002 (auth strategy)._

## Research done

<!-- fill-in: what you actually investigated — docs, prototypes, benchmarks. -->

- _e.g. Evaluated Auth0, Clerk, Supabase Auth; built a PoC with Clerk in `spike/auth-poc/`._

## Findings

<!-- fill-in: be specific — versions, costs, limits, benchmark numbers. -->

| Option  | Pros                          | Cons                   | Cost          |
| ------- | ----------------------------- | ---------------------- | ------------- |
| _Auth0_ | _Mature, SAML, good docs_     | _Expensive at scale_   | _$23/mo+_     |
| _Clerk_ | _Simple DX, React components_ | _No SAML on free tier_ | _Free–$25/mo_ |

## Recommendation

<!-- fill-in: a clear decision, with the condition that would change it. -->

_e.g. Use Clerk for v1 (no SAML needed yet); revisit if enterprise SSO becomes a MUST._

## Follow-up actions

<!-- fill-in: what this spike produces. -->

- [ ] Record the decision as an ADR (`docs/adr/NNNN-...md`).
- [ ] Update the blocking task with concrete implementation steps.
- [ ] Delete throwaway spike code, or graduate it intentionally with tests.
