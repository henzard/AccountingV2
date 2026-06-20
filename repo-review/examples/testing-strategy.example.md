# NutSync — Testing Strategy

**Status:** living document · **Last updated:** 2026-06-15

> See the full file in the remote repository for the complete testing strategy
> covering: the honest coverage baseline (~19% lines), the six-cell test matrix
> (Unit/UI/Integration × happy/edge), the sync property harness (7th concern),
> test tiers, per-feature PR checklist, why CI can be green while a build breaks,
> and requirements-to-tests traceability.

## Key sections demonstrated:

1. **The one rule:** Failing tests block merge.
2. **Where we actually are** — authentic but thin coverage baseline.
3. **The test matrix** — six cells plus a seventh concern (sync correctness).
4. **Test tiers** — when each runs (Unit=every PR, Integration=every PR, System=release).
5. **Per-feature PR checklist** — layer-by-layer with anti-pattern guards.
6. **Why CI can be green while a real build breaks** — pure resolver pattern.
7. **Requirements ↔ tests traceability** — living matrix of critical paths.
8. **Running the suite** — `npm test`, coverage, typecheck commands.
