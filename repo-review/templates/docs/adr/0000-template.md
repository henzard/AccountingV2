# ADR 0000 — <short, present-tense decision title>

**Date:** YYYY-MM-DD · **Author:** <name/role> · **Status:** Proposed
**Affects:** <repo(s) + paths, e.g. `src/db/sync.ts`, `services/api/`>
**Supersedes / Superseded-by:** <ADR number, or — >

> **One-line summary of the decision and why** (lead with the verdict so a
> reader gets the answer before the prose).

This is the template. Copy it to `docs/adr/NNNN-kebab-title.md` (next free 4-digit
number), fill every section, and delete this paragraph. Keep ADRs short: a decision
record is a paragraph of context and a paragraph of choice, not a design doc.
Right-size the ceremony to the project — a small/solo project may only adopt a
structured ADR log once parallel architecture decisions or a growing team make it
worth it; until then, one terse markdown per real decision (see
[`../engineering-conventions.md`](../engineering-conventions.md)).

---

## Context

What forces the decision? State the problem, the constraints, and the relevant
facts — grounded, not hypothetical. Cite real files/lines and the audit(s) where
the pressure was first recorded. Note any LOCKED invariant (e.g. in `CLAUDE.md`)
this touches. If you considered alternatives, name them in one line each — the
rejected options are part of the context.

## Decision

What we will do, in the active voice ("We _will_ …"). One clear choice. If it
changes a LOCKED invariant, say so explicitly and update the invariant doc
(e.g. `CLAUDE.md`) in the same PR. If it crosses multiple repos/services, spell
out each side.

## Status

One of: **Proposed** · **Accepted** · **Rejected** · **Superseded by ADR-NNNN** ·
**Deprecated**. Keep the header `Status:` field and this section in sync. An
Accepted ADR is binding — the same way an audit finding is binding until
remediated; a Superseded one stays in the tree (never delete decisions — link
forward instead).

## Consequences

What becomes true after this — good and bad, both stated honestly.

- **Positive:** what this unlocks or fixes.
- **Negative / cost:** new constraints, migrations owed, follow-up work, any
  scale-up trigger this might pull forward.
- **Tests / verification:** which test layer proves it (name the runner +
  command for this repo), and the verify-before-done check that confirms it in
  the real app/service.
