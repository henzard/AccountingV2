# Context handoff / session state — <project name>

> Purpose: persistent memory between sessions. AI assistants (and humans) lose
> context when a session ends — update this at every pause so the next session
> resumes without re-discovery. Copy to `docs/context-handoff.md`, keep it CURRENT
> (overwrite, don't append history), fill every `<!-- fill-in -->`.

---

## Current state

- **Date**: <!-- fill-in: YYYY-MM-DD -->
- **Phase / milestone**: <!-- fill-in: e.g. Phase 1 — API layer -->
- **Status**: <!-- fill-in: e.g. T1–T3 done; T4 in progress; blocked on T5 (needs API key) -->

## Completed this session

<!-- fill-in: what actually landed (merged/verified), with task IDs. -->

- _e.g. Implemented auth endpoints (T1, T2); fixed failing user-service test (T3)._

## Next steps

<!-- fill-in: the immediate next tasks/decisions, in order. -->

- _e.g. Complete T4 (JWT middleware), then T5 (integration test)._
- _e.g. Decision needed: Redis vs. in-memory sessions (draft ADR 0003)._

## Blockers and open questions

<!-- fill-in: anything preventing progress. -->

- _e.g. Waiting on API key from provider._
- _e.g. Unclear if RBAC is needed in v1 — check PRD AC3._

## Key decisions made (persist these)

<!-- fill-in: decisions from this session that future sessions must honour. -->

- _e.g. Chose JWT over session cookies (see ADR 0002)._
- _e.g. Deferred email notifications to Phase 2._

## Files changed

<!-- fill-in: key files touched — loads context fast next session. -->

- _e.g. `src/auth/login.ts`, `src/auth/middleware.ts`, `test/auth.test.ts`._

---

**How to use:** End of session — update this file and verify (`./scripts/verify.sh`).
Start of next session — tell the AI: "Read `docs/context-handoff.md` and resume."
