<!--
PR template for AccountingV2 (React Native / Expo / Supabase).

Branch off `main`, keep PRs small, never commit straight to `main`, no orphan
branches, delete the branch after merge. If this PR contradicts a committed
audit/decision doc (e.g. `docs/*-AUDIT-*.md`, an ADR), update that doc in the
same PR.
-->

## What & why

<!-- One or two sentences. What does this change and why? -->

Linked issue: <!-- #123, or "none" -->

## Test checklist

Tick the layers this PR adds or updates. Mark `n/a` with a one-line reason
(e.g. "docs only", "no UI surface"). Tests live next to source as `*.test.ts(x)`
and run under Jest (`npx jest`).

- [ ] **Unit — happy path** (pure logic, no DB/network)
- [ ] **Unit — edge/error** (boundaries, zero/NaN, malformed input, thrown errors)
- [ ] **UI — happy path** _(if the repo has a UI + component test runner; else `n/a`)_
- [ ] **UI — edge/error** _(component error/empty/loading states; else `n/a`)_
- [ ] **Integration — happy path** (real dependencies where feasible — e.g. an in-memory or test DB — not mocks)
- [ ] **Integration — edge/error** (ownership/permissions, constraint violations, partial-failure / retry paths)

## Anti-pattern guards

Keep the suite authentic. Confirm this PR does not regress it:

- [ ] **No tautological mock-echo** — no "mock returns X, assert X". Hit real dependencies (e.g. a real in-memory/test DB), not a fake that just replays the expected value.
- [ ] **No assertion-free `wasCalled`** — every spy assertion carries behavioral context (which args, which branch), not just "it was called".
- [ ] **No over-mocking** — mock only the true external boundary (a third-party HTTP API, etc.), never the unit under test or its own datastore.
- [ ] **No env-coupled / machine-specific tests** — no absolute paths, no dependency on a sibling repo or a developer's box; skip-guard or fixture anything external. New tests pass on a clean checkout.

## Verification

- [ ] Ran the test suite — **green** (`npx jest --forceExit`).
- [ ] **If user-facing:** ran the app (`npx expo start`) and exercised the change, and it behaves as described.

## Notes for reviewer

<!-- Migrations added? New audit/ADR deltas? Anything that needs a closer look. -->
