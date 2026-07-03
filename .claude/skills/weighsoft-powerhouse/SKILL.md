---
name: weighsoft-powerhouse
formerly: powerhouse
description: The umbrella rule — an AI-first engineering system that wires planning, implementation, and verification into one pipeline (Constitution → PRD → Architecture → Tasks → Implementation → Verification/UAT) with no skipped artifacts, rigor scaled to context, atomic traceable commits, regenerate-over-patch on spec drift, and security as non-negotiable. Use when starting or governing any non-trivial engineering effort, when deciding how much process a change warrants, or when specs and code have diverged and you must decide whether to patch or regenerate.
version: 1.0.0
category: workflow
tags:
  - spec-driven
  - pipeline
  - atomic-commits
  - conventional-commits
  - scaled-rigor
  - traceability
  - regenerate-over-patch
  - security-non-negotiable
---

# weighsoft-powerhouse — the umbrella: planning, implementation, and verification as one pipeline

> 🔁 **Renamed:** this skill is now **weighsoft-powerhouse** (formerly **powerhouse**). Update any references; other systems keying off the old name should rename to match.

This is the meta-rule that ties the kit together. It turns "AI writes code" into a disciplined
pipeline where intent flows downstream to commits and nothing important gets skipped. The other
skills are its phases; this one is the spine.

> **"Piss Poor Planning Leads to Piss Poor Performance."** Proper upstream planning prevents
> downstream chaos. Specs are version-controlled "super prompts" that drive the code — not
> ad-hoc vibe-coding that produces plausible-looking first drafts needing endless rework. ([spec-driven development][sdd])

## The rules

### The pipeline (each handoff explicit)

- **Constitution → Product/PRD → Architecture → Tasks → Implementation → Verification/UAT.**
  Separate the _design_ phases from the _implementation_ phase; agree the upstream artifact
  before generating downstream from it. ([Thoughtworks — SDD][sdd], [GitHub Spec Kit][kit])
- **Skipping a stage requires explicit justification** — say which stage and why.

### The five principles

1. **No skipping artifacts** — don't implement from a vague idea; require at least a minimal
   spec or task list. A spec gives the agent contracts, boundaries, and error behavior — the
   difference between production-ready and a plausible draft. ([SDD][sdd])
2. **Scaled rigor by context** — proportional process: quick fix / feature / refactor /
   greenfield / brownfield each get _proportionate_ rigor, not the full ceremony every time.
3. **Atomic, ordered work** — logically discrete changes with traceability **spec →
   architecture → tasks → commits**. One logical change per commit.
4. **Regenerate over patch drift** — when spec and code diverge, **rewrite from intent**
   rather than accumulating local fixes; the spec is the source of truth, so re-derive from it.
5. **Security non-negotiable** — secrets/credentials never enter commits or prompts; enforce
   deny-lists. No exceptions, no "just this once".

### The mottos (each a check)

- **"One logical change per commit"** — atomic commits, **Conventional Commits 1.0.0** messages
  (`type(scope): subject`) so history is traceable and machine-parseable. `feat`/`fix` are the two
  SemVer-correlated types (minor/patch); a `!` or `BREAKING CHANGE:` footer signals a major. Keep the
  subject imperative, ≤50 chars, no trailing period. ([Conventional Commits][cc])
- **Verification before merge** — run the gate in order: **lint → test → typecheck → build**,
  all green, before anything merges.
- **Spec-driven development** — intent drives regeneration; the markdown spec is the artifact
  reviewed and the thing code is generated from. ([SDD complete guide][guide])

### When to break the rules (and only then)

- **Exploratory spikes**, **throwaway prototypes**, **docs-only changes** — go lighter. Say
  you're doing so; don't quietly skip rigor on real, shipping work.

## Anti-patterns to reject

- **Vibe-coding from a one-liner** — WHY: no spec means the agent invents contracts and error
  behavior; you get a plausible draft that needs more rework than the spec would have cost. ([SDD][sdd])
- **Full ceremony on a one-line fix** — WHY: scaled rigor cuts both ways; ceremony on a typo
  fix is its own waste and trains people to skip process when it _does_ matter.
- **Patching accumulating drift** — WHY: each local fix moves code further from the spec until
  neither is trustworthy; regenerate from intent instead of layering patches.
- **A grab-bag commit** — WHY: mixing changes breaks traceability and makes revert/bisect
  impossible; one logical change per commit keeps history a usable tool.
- **A secret in a commit or prompt** — WHY: non-negotiable; it's leaked the moment it's
  pushed, and prompt logs persist — deny-list and rotate, never "just this once".
- **Merging on red** — WHY: the lint→test→typecheck→build gate exists precisely to stop
  "works on my machine" from becoming everyone's problem.

## How it composes with the kit

This is the umbrella; the others are its phases:

- **personas-and-modes** drives the upstream discovery (Constitution/PRD intent).
- **add-feature** is the pipeline applied to one feature (its Phases 0–7 mirror the stages).
- **context-and-sessions** persists the artifacts and handoffs between sessions.
- **beginner-guardrails** is the "security non-negotiable" + scaled-rigor floor.
- **qa-lead** / **quality-review** / **verification-quality** are the Verification/UAT stage
  and the lint→test→typecheck→build gate. **branch-hygiene** makes commits atomic and durable.

## Conformance checklist

- [ ] Worked the pipeline (Constitution→PRD→Architecture→Tasks→Implementation→Verification);
      any skipped stage justified
- [ ] Rigor scaled to context (quick fix vs greenfield) — not under- or over-processed
- [ ] Traceability holds: spec → architecture → tasks → commits
- [ ] Commits atomic, one logical change each, Conventional Commits format
- [ ] On spec/code drift: regenerated from intent, not patched
- [ ] No secret in any commit or prompt; deny-list enforced
- [ ] Pre-merge gate green in order: lint → test → typecheck → build

## Quick reference

```text
PIPELINE: Constitution → PRD → Architecture → Tasks → Implementation → Verification/UAT.
1 No skipping artifacts (min spec/tasks before code).  2 Scaled rigor by context.
3 Atomic + traceable (spec→arch→tasks→commits).  4 Regenerate over patch drift.
5 Security non-negotiable (no secrets in commits/prompts; deny-lists).
Mottos: 1 logical change/commit (Conventional Commits 1.0.0; feat/fix→SemVer, ! = breaking) · verify b4 merge (lint→test→type→build) · spec drives code.
Break ONLY for: spikes · throwaway prototypes · docs-only.
```

**The gate, one line:** _run engineering as one pipeline — plan upstream so you don't pay
downstream, skip no artifact without saying why, keep commits atomic and traceable to intent,
regenerate rather than patch drift, never commit a secret, and merge only on a green
lint→test→typecheck→build._

---

Sources / further reading:
[sdd]: https://www.thoughtworks.com/en-us/insights/blog/agile-engineering-practices/spec-driven-development-unpacking-2025-new-engineering-practices "Thoughtworks — Spec-Driven Development: specs as version-controlled super-prompts, design/implementation separated, beyond vibe-coding"
[kit]: https://developer.microsoft.com/blog/spec-driven-development-ai-native-engineering "Microsoft — Spec-Driven Development & GitHub Spec Kit (Sept 2025), works with Claude Code/Copilot/Cursor"
[guide]: https://www.softwareseni.com/spec-driven-development-in-2025-the-complete-guide-to-using-ai-to-write-production-code/ "Spec-Driven Development in 2025 — complete guide to using AI for production code"
[cc]: https://www.conventionalcommits.org/en/v1.0.0/ "Conventional Commits 1.0.0 — type(scope): subject; feat/fix correlate to SemVer minor/patch; ! or BREAKING CHANGE = major"
