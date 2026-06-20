# Testing strategy — <project name>

> Purpose: define WHAT to test, HOW, and the bar for "done" so a changed behaviour
> never merges without proof. Copy to `docs/testing-strategy.md`, fill every
> `<!-- fill-in -->`, delete examples. This is the doc the kit's `weighsoft-qa-lead` /
> `weighsoft-quality-review` skills check against.
> Ref: [BMAD QA](https://github.com/bmad-code-org/BMAD-METHOD),
> [non-functional requirements checklist](https://www.door3.com/blog/non-functional-requirements-checklist).

**Status:** living document · **Last updated:** <!-- YYYY-MM-DD --> · **Test runner:** <!-- e.g. Vitest / Jest / pytest -->

---

## 0. The one rule

**Failing tests block merge. A changed behaviour with no test in its applicable
cell of the matrix does not merge.** Everything below is how to satisfy that
efficiently.

## 1. Testing philosophy

<!-- fill-in: 1–2 sentences. Test behaviour, not implementation. Mock only the true
     external boundary; use real DB (in-memory) for integration. -->

_State the team's testing approach._

<!-- Shape, not dogma: weight the layers to the architecture. Domain-heavy code →
     pyramid (most tests are unit). API-/integration-centric code → testing-trophy
     (more integration tests, where behaviour actually lives). Either way keep E2E
     few and reserved for critical journeys, and fill every applicable cell below. -->

_e.g. Trophy-leaning: integration tests over real routes + in-memory DB are the
backbone; unit tests for pure domain logic; E2E for the top 3 journeys only._

## 2. The six-cell matrix (layer × path)

<!-- fill-in: mark each cell ✅ done / ⚠ partial / ❌ gap / n/a-with-reason.
     This is the per-PR proof obligation: tick each cell or mark n/a + why. -->

|                                        | Happy path                                                                | Edge / error path                                                                        |
| -------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **Unit** (pure logic, no DB/network)   | <!-- ✅/⚠/❌ + example test -->                                           | <!-- one test per branch: null/empty/zero/NaN/boundary/malformed/thrown -->              |
| **UI** (component/render tests)        | <!-- renders expected output for typical props/state; WCAG 2.2 AA -->     | <!-- loading/error fallback, empty, no-permission, long strings, locale -->              |
| **Integration** (real DB / API routes) | <!-- persists + re-reads the right rows against a real (in-memory) DB --> | <!-- ownership denial, unique-constraint, concurrency, rollback, post-action re-read --> |

> Add a **7th cross-cutting concern** (its own harness) if you have a
> distributed/property-style invariant a single cell can't express
> (e.g. sync convergence, idempotency, crash-resume). <!-- fill-in or delete -->

## 3. Coverage targets

<!-- fill-in: realistic minimums + a per-file floor on identity/money/data code. -->

- **Lines**: _e.g. ≥ 35% overall, ratcheting up._
- **Per-file floor**: _e.g. ≥ 70% lines on `auth/**` and DB query modules._
- **Integration**: _every endpoint/query has ≥ 1 happy + 1 error test._
- **E2E**: _top 3 user journeys covered._

## 4. What NOT to test (explicitly)

<!-- fill-in: saves debate. -->

- _Third-party library internals._
- _Styling/layout (unless visual-regression is set up)._
- _Generated code (test the generator config instead)._

## 5. Anti-pattern guards (keep the suite authentic)

- [ ] No tautological mock-echo — DB tests hit a real (in-memory) DB, not a fake.
- [ ] No assertion-free `toHaveBeenCalled` — every spy assertion carries arg/branch context.
- [ ] No over-mocking — mock only the true external boundary, never the unit under test.
- [ ] No env-coupled / cross-repo tests — guard with skip-if or a committed fixture.
- [ ] Money asserted in exact integer minor units (never FLOAT tolerance).

## 6. Test data and fixtures

<!-- fill-in -->

- _Seed via factories, not raw SQL; fixtures in `test/fixtures/`._
- _Mock external APIs with MSW / VCR cassettes._

## 7. How to run

```bash
# fill-in real commands
# Unit + integration:  <!-- npm test / pytest / cargo test -->
# E2E:                 <!-- npx playwright test -->
# Full verify:         ./scripts/verify.sh   # lint + typecheck + test + build
```

## 8. When NOT to apply this strategy

- Throwaway spikes: minimal/no tests; note it in the spike doc.
- Config-only changes: no new tests unless behaviour changes.
