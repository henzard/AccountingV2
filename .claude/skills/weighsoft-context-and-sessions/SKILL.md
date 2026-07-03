---
name: weighsoft-context-and-sessions
formerly: context-and-sessions
description: Treat the handoff doc as the single source of truth across sessions — read it FIRST at session start, update it after every task, refresh it at session end, and commit it so work persists instead of being re-discovered or re-planned. Enforces trusting existing artifacts over re-litigating decisions, and capturing significant decisions as ADRs. Use at the start or end of any work session, when handing off to another agent or developer, or whenever you're tempted to re-plan something the docs already settled.
version: 1.0.0
category: workflow
tags:
  - context-handoff
  - session-memory
  - source-of-truth
  - adr
  - continuity
  - context-engineering
  - persistence
  - no-rediscovery
---

# weighsoft-context-and-sessions — the handoff doc is the single source of truth

> 🔁 **Renamed:** this skill is now **weighsoft-context-and-sessions** (formerly **context-and-sessions**). Update any references; other systems keying off the old name should rename to match.

Memory between sessions doesn't survive on its own — it survives because you wrote it down
and committed it. This skill makes the handoff doc authoritative: read it first, keep it
current, trust it over re-deriving. Lost context is re-planned work, and re-planned work is
wasted work.

> **Trust the artifacts.** Do NOT re-discover or re-plan what's already documented. The
> handoff doc wins unless the user says it's changed. Treat the context window as a finite
> resource and the handoff as durable memory _outside_ it — persist structured state to a file
> so a fresh session (or a post-compaction agent) reloads it instead of re-deriving. Without it
> the next session re-proposes approaches already tried and discarded. ([Anthropic — context engineering][ctx], [agent memory][mem])

## The rules

### Session start (before any work)

- **Read `docs/context-handoff.md` FIRST** — current phase, completed work, next steps,
  blockers. This is the working memory of the project; load it before forming a plan.
- If new to the repo, also read the **active task file** and `docs/constitution.md` (purpose
  - principles + out-of-scope).
- **Trust what's there.** Don't re-plan settled decisions or re-explore mapped ground — that's
  the most common way an agent burns a session re-deriving what the last one already knew. ([three-layer persistence][mem])

### During work (after each task)

- **Update the handoff doc** the moment a task closes: what you accomplished, what's next.
  Treat it as short-term memory you're persisting, not a journal you write at the end.
- **Document significant decisions** there — and as an **ADR** (context · decision · ≥1
  alternative · consequences) when the decision is architectural or hard to reverse.
- Keep it compressed: preserve meaning, discard noise — write the **smallest set of high-signal
  tokens** that carries the state forward, not a transcript. The doc is a constrained resource a
  future session reads in full; bloat crowds out the actual work. ([Anthropic — context engineering][ctx])

### Session end (before you stop)

- **Refresh `docs/context-handoff.md`:** completion status, upcoming work, obstacles, **files
  changed**. Make it readable cold by an agent or human with zero prior context.
- **Commit it.** Uncommitted handoff notes don't persist — a swept context loses them. The
  commit is what makes the memory durable. (See **branch-hygiene**.)

### Handing off (to another agent or developer)

- Ensure the handoff doc is current and self-contained.
- **Flag uncommitted work and temporary local state** explicitly — e.g. test credentials with
  an expiry, seed data, a half-applied migration. State what's transient and when it dies.

## Anti-patterns to reject

- **Starting work without reading the handoff** — WHY: you re-discover the codebase and
  re-litigate decisions the last session already made; pure wasted tokens and time.
- **Re-planning documented work** — WHY: the artifact is the source of truth; second-guessing
  it without evidence it's stale just churns and risks diverging from agreed direction.
- **Updating the doc only at session end** — WHY: a mid-session context sweep loses everything
  you didn't persist; update per-task so each task is durably recorded.
- **Leaving the handoff uncommitted** — WHY: "it's in the doc" is false if the doc isn't
  committed — the next session checks out the repo, not your scratchpad.
- **A handoff that's a raw log, not a state** — WHY: the next reader needs _current phase /
  next / blockers_, not a replay; un-compressed context buries the signal.

## How it composes with the kit

- **add-feature Phase 0** opens by reading exactly this handoff doc + constitution; this skill
  is what keeps that doc worth reading. Phase 7 closes the loop back into it.
- **branch-hygiene** is the other half of "never lose work" — it commits/pushes so the handoff
  (and the code) survive a context reset; this skill makes sure the _context_ is in there too.
- **beginner-guardrails** requires `docs/constitution.md`; this skill maintains that artifact
  set alongside the handoff.
- **powerhouse** names "no skipping artifacts" — the handoff and ADRs are non-skippable here.

## Conformance checklist

- [ ] `docs/context-handoff.md` read FIRST this session, before planning
- [ ] Active task file + `docs/constitution.md` read if new to the repo
- [ ] Handoff updated after **each** task (accomplished + next), not just at the end
- [ ] Significant/architectural decisions captured as ADRs
- [ ] Session-end refresh done: status · upcoming · obstacles · files changed
- [ ] Handoff (and ADRs) **committed** so they persist
- [ ] On handoff: uncommitted work and temporary local state flagged with expiry

## Quick reference

```text
START: read docs/context-handoff.md FIRST (phase/done/next/blockers) → +task file+constitution if new.
TRUST the artifacts — don't re-discover or re-plan what's documented.
DURING: after each task, update handoff (done + next); log big decisions → ADR.
END: refresh handoff (status/upcoming/obstacles/files-changed) → COMMIT it.
HANDOFF: doc current + self-contained; flag uncommitted work & temp state (e.g. creds w/ expiry).
```

**The gate, one line:** _read the handoff doc first and trust it, update it after every task,
refresh and commit it at session end — so the next session continues the work instead of
re-discovering and re-planning it._

---

Sources / further reading:
[ctx]: https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents "Anthropic — Effective context engineering for AI agents: smallest high-signal token set, context as a finite resource, memory outside the window"
[mem]: https://www.augmentcode.com/guides/agent-memory-vs-context-engineering "Agent Memory vs Context Engineering — three-layer persistence; without it the replacement agent re-proposes discarded approaches"
