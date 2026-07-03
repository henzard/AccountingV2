---
name: weighsoft-spec-review
formerly: spec-review
description: Review a specification section-by-section with two parallel swarms — one fact-checks each section against the internet (is the claim accurate, current, standards-aligned?), the other checks each section against the actual codebase (is it implemented, drifted, or missing?) — then a /team-review panel adjudicates, every section gets a verdict (Accurate+Implemented / Inaccurate / Drifted / Not-implemented / Unverifiable) with evidence, and the summary is delivered to WhatsApp. Use when asked to "review this spec", "check the spec is accurate", "verify the spec matches the code", "fact-check the requirements", or "audit a PRD/design doc against reality and the codebase".
version: 1.0.0
category: review
tags:
  - spec
  - requirements
  - verification
  - traceability
  - drift
  - swarm
  - team-review
  - fact-check
  - whatsapp
---

> 🔁 **Renamed:** this skill is now **weighsoft-spec-review** (formerly **spec-review**). Update any references.

# /weighsoft-spec-review — fact-check the spec, and check it against the code

Take a specification (PRD, design doc, RFC, API contract, requirements doc) and decide, for
**every section**, two independent things:

1. **Is it true?** — fact-check the section against the **internet**: current standards,
   library/API behavior, regulations, claimed facts, best practice. (`/swarm` job A)
2. **Is it real?** — check the section against the **codebase**: is what the spec asserts
   actually implemented, has it **drifted**, or is it **missing**? (`/swarm` job B)

Then a **`/team-review`** panel adjudicates the two swarms' findings into one verdict per
section, and the summary is pushed to **WhatsApp**. This is requirements-traceability + spec
↔ code drift detection ([traceability][trc], [drift detection][drift], [spec-driven dev][sdd]),
run as a swarm. Spec-driven development treats the spec as the source of truth and the code as
its build output, so the failure mode this skill hunts is **drift** — code that has silently
diverged from intent as the project evolved (the exact decay SDD tooling like Spec Kit and
Kiro exists to catch). ([spec-driven dev][sdd], [Spec Kit][sk])

> **Posture (Extreme Ownership, as elsewhere in this kit):** every section gets a verdict
> backed by evidence (a URL for accuracy, a `file:line` for code conformance) — never "looks
> fine". A section you genuinely can't verify is marked **Unverifiable** with _why_, not
> waved through.

## What it composes (with graceful fallback)

- **`/team-review`** — the multi-role review panel that adjudicates findings. _Fallback:_
  this kit's **`weighsoft-quality-review`** / **`weighsoft-deep-review`** specialist roster, or a `general-purpose`
  review agent. _(Defined in the target repo's `.claude/skills/team-review/` — confirm the
  exact command name; this skill calls it as `/team-review`.)_
- **`/swarm`** — fan-out execution (ruflo `/swarm_init`, or Superpowers subagents). _Fallback:_
  dispatch **`Agent`** subagents yourself — one section (or section-group) per agent.
- **WhatsApp output** — the **`writing-whatsapp-messages`** skill formats + sends the summary.
  _Fallback:_ if it isn't installed, produce the WhatsApp-formatted text block and tell the
  user it's ready to paste/send. _(Confirm the sender/MCP the skill uses; this skill hands it
  the summary and lets it own delivery.)_
- **Web research** — `WebSearch` / `WebFetch` for the accuracy swarm; **`weighsoft-branch-hygiene`** /
  **`weighsoft-verification-quality`** for evidence discipline.

If a composed command isn't present, use the fallback silently — don't report a missing
capability the fallback already covers.

## Inputs

- **The spec** — a path/URL/PR to the document under review. If none is given, ask which doc.
- **The code** — the target repo (default: cwd), the ref to check against (default branch).
- **Where to send the summary** — the WhatsApp recipient/group (ask if not given).

---

## Phase 0 — Intake & sectioning (one shared map)

1. `weighsoft-branch-hygiene`: confirm the repo, default branch, `gh auth`.
2. **Load the spec and split it into atomic sections** — by heading, then by individual
   claim/requirement within a heading (so "the API returns 429 on rate-limit AND retries
   with backoff" becomes two checkable items). Number them `S1, S2, …`.
3. Write a **section index** (id · title · the claim in one line · type:
   `factual` / `behavioral` / `architectural` / `data` / `security` / `process`). This index
   is the shared work-list both swarms and the panel read — author it once so agents don't
   re-split the doc.

## Phase 1 — Swarm A: fact-check each section against the internet

`/swarm` over the section index (fallback: `Agent` subagents, a group of sections each). For
**every** section, the agent must:

- Identify the **checkable claim(s)** — standards cited, version/API behavior, regulatory or
  domain facts, performance/limit numbers, "industry best practice" assertions.
- **Search the web** to confirm or refute, preferring primary sources (official docs, the
  standard itself, the vendor) over blogs. Cross-check ≥2 sources for anything load-bearing.
- Return per section: `verdict ∈ {Accurate, Outdated, Inaccurate, Unverifiable}` ·
  **the source URL(s)** · the discrepancy if any (what the spec says vs. what the source says)
  · a suggested correction. **No URL ⇒ not verified** (mark Unverifiable, don't assert).
- Flag **stale** claims explicitly (true once, not now — deprecated API, superseded standard).

## Phase 2 — Swarm B: check each section against the codebase

`/swarm` over the same index (fallback: `Agent` subagents, scoped to subsystems so they don't
all re-scan the tree). For **every** section, the agent must locate the implementing code and
decide conformance:

- **Find the implementation** (`Explore`/`Grep`/`Glob`) — the module/route/schema/test that
  should realize the section.
- Return per section: `verdict ∈ {Implemented, Drifted, Missing, Contradicted, N/A}` ·
  **evidence `file:line`** · the divergence (spec says X, code does Y) · is it covered by a
  test? · suggested reconciliation (fix the code, or fix the spec).
- **Drifted** = implemented but diverges from the spec. **Contradicted** = the code does the
  opposite / something the spec forbids (highest priority). **Missing** = no implementation.
- For behavioral/data/security claims, prefer **running evidence** where cheap (a test, a
  query) over reading alone (`weighsoft-verification-quality`) — a green test beats "it looks like it".

> Run A and B **in parallel** — they're independent. A section can be _internet-accurate but
> not implemented_, or _implemented but factually wrong_ (the dangerous combo: the code
> faithfully implements a wrong spec).

## Phase 3 — `/team-review`: adjudicate into one verdict per section

Hand both swarms' per-section findings to **`/team-review`** (fallback: the
`weighsoft-quality-review`/`weighsoft-deep-review` panel). The panel reconciles A + B into a single **section
verdict** and a severity:

| Accuracy (A) →<br>Code (B) ↓         | Accurate                                             | Inaccurate / Outdated                                                | Unverifiable       |
| ------------------------------------ | ---------------------------------------------------- | -------------------------------------------------------------------- | ------------------ |
| **Implemented**                      | ✅ Aligned                                           | ⚠️ **Code implements a wrong spec** (High — fix spec, re-check code) | ◻️ Verify accuracy |
| **Drifted / Missing / Contradicted** | ⚠️ **Spec right, code wrong** (drift/gap — fix code) | ⛔ **Both wrong** (Critical — rethink the section)                   | ◻️ Investigate     |

Each adjudicated section carries: **verdict · severity · the A-evidence (URL) · the
B-evidence (file:line) · the recommended action (fix spec / fix code / both / accept).**
Reject any verdict without both evidence legs (or an explicit "Unverifiable: <why>").

## Phase 4 — Report (traceability matrix) + file what's actionable

- Write `docs/spec-review-<date>.md`: the **traceability matrix** (section → accuracy verdict
  - URL → code verdict + file:line → adjudicated verdict → action), then the prioritized
    list of discrepancies (Critical → Low). ([traceability matrix][trc])
- **File the actionable ones** as GitHub issues (reuse the kit's labels: `sev:<level>` +
  domain) — one per real spec/code discrepancy, so nothing is lost to chat. Optionally feed
  the _fix_ work to **`/weighsoft-backlog-burndown`** and the _test_ gate to **`/weighsoft-qa-lead`**.

## Phase 5 — WhatsApp the summary

Hand the executive summary to **`writing-whatsapp-messages`** to format + send (fallback:
emit the formatted block for the user to send). Keep it short and skimmable — WhatsApp, not a
report:

- Headline: `Spec review: N sections · ✅ A aligned · ⚠️ B need work · ⛔ C critical`.
- The top discrepancies (1 line each: section — verdict — action).
- The count of **Unverifiable** sections + what's needed to close them.
- A link to the full `docs/spec-review-<date>.md` / the filed issues.
  Ask for the recipient/group if it wasn't supplied; confirm before sending to a group.

## Definition of done

- [ ] Spec split into numbered, atomic sections; shared section index authored
- [ ] **Swarm A** fact-checked every section vs. the internet (verdict + source URL each)
- [ ] **Swarm B** checked every section vs. the code (verdict + file:line each)
- [ ] **`/team-review`** adjudicated one verdict + severity + action per section (both
      evidence legs, or an explicit Unverifiable reason)
- [ ] Traceability matrix written (`docs/spec-review-<date>.md`); discrepancies filed as issues
- [ ] WhatsApp summary delivered (or formatted + handed off) to the named recipient

## Quick reference

```text
0. Load spec → split into atomic sections S1..Sn → write the shared section index.
1. /swarm A: fact-check each section vs the INTERNET → {Accurate/Outdated/Inaccurate/Unverifiable} + URL.
2. /swarm B: check each section vs the CODE → {Implemented/Drifted/Missing/Contradicted/N/A} + file:line.
   (A and B run in parallel — independent.)
3. /team-review: adjudicate A+B → one verdict + severity + action per section (need both evidence legs).
4. Write the traceability matrix (docs/spec-review-<date>.md); file actionable discrepancies as issues.
5. writing-whatsapp-messages: send the skimmable summary to the named recipient/group.
```

**The gate, one line:** _every spec section ends with a verdict backed by a source URL
(accuracy) and a `file:line` (code conformance), adjudicated by `/team-review` into a clear
action, and the summary lands on WhatsApp — fact-checked against the world and checked
against the code, section by section._

---

Sources / further reading:
[trc]: https://www.trace.space/blog/what-is-requirements-traceability "Requirements traceability & traceability matrices"
[drift]: https://mcpmarket.com/tools/skills/drift-detection "Spec ↔ code drift detection (PRD/design vs. actual code & tests)"
[sdd]: https://www.augmentcode.com/guides/what-is-spec-driven-development "Spec-driven development — catching API-contract/architecture drift"
[sk]: https://github.com/github/spec-kit "GitHub Spec Kit — Spec-Driven Development (spec is the source of truth; detect spec↔code drift)"
