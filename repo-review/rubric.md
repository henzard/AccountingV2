# Scoring rubric — comparable across systems

Apply the **same** rubric to every system you review for apples-to-apples comparison.
Each dimension is scored **0–100 as-built** (what the code is when audited — the fair
basis for comparing builds), then weighted to a single 0–100 number. Track a separate
_remediated_ score as fixes land, but **report as-built** as the headline.

## Dimensions & weights (sum = 100)

| Dimension                   | Weight | What it measures                                                                                                                           |
| --------------------------- | :----: | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Security & secrets          | **25** | Auth, injection, secrets handling, transport, access control, supply chain. Weighted highest — it's where vibe-coded systems fail hardest. |
| Data integrity & sync       | **20** | Can a committed write be silently lost/corrupted? Convergence, idempotency, conflict resolution, transactions, deletes/tombstones.         |
| Architecture & code quality | **15** | SOLID, layering, duplication, complexity, deployed==tested.                                                                                |
| Data layer                  | **10** | Schema/types/constraints, indexing, migrations (reversible?), query quality, RLS.                                                          |
| API & contracts             | **10** | REST correctness, status codes, validation, versioning, idempotency, pagination, docs, schema leakage.                                     |
| Testing & verifiability     | **10** | Real coverage **and** test authenticity (not mock-echo theatre); CI gates; the six-layer matrix.                                           |
| UX & accessibility          | **5**  | Nielsen heuristics, WCAG 2.2 AA, error/loading states, flows. (N/A for headless → reweight or score operability.)                          |
| UI / code consistency       | **5**  | Design tokens vs magic values, reuse vs duplication, naming, file org.                                                                     |

## The weakest-link rule

For **Security** and **Data integrity**, score the system as its **weakest component**,
not an average. A two-part system (e.g. client + hub) with a Critical hole in one half is
only as safe as that half — averaging hides the risk that actually gets you breached.

## Grade bands (production-readiness)

| Score  | Grade | Meaning                                                             |
| :----: | :---: | ------------------------------------------------------------------- |
| 85–100 | **A** | Production-grade. No material findings; ship.                       |
| 70–84  | **B** | Solid. Ship after clearing a short, known list.                     |
| 55–69  | **C** | Works, but notable gaps. Not production-safe without targeted work. |
| 40–54  | **D** | Significant defects. Substantial rework before deploy.              |
|  0–39  | **F** | Critical/systemic failures. Do not deploy.                          |

## How to score a dimension (anchors)

- **90+** no material findings; tested; idiomatic.
- **70–84** minor issues only; no High+; good coverage.
- **55–69** notable gaps or a couple of Highs; works but not hardened.
- **40–54** a Critical _or_ several Highs; substantial rework.
- **<40** multiple Criticals / systemic failure (e.g. provable silent data loss, RCE, backdoor).

Each sub-score should trace to a documented finding (the per-domain grade in the audit
docs — e.g. "UX 6.4/10", "maintainability 4.3/10", "convergence fails"). Put the driver in
the report's scorecard so the number is reproducible, not vibes.

## Feed it to the report

`scripts/generate-report.mjs` consumes a `findings.json` (see `examples/findings.example.json`)
and computes the weighted total + grade automatically — keep the rubric and the generator in
lockstep (weights here == weights you put in the JSON).
