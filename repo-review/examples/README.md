# examples/ — reference outputs, NOT templates

Everything in this folder is a **reference output from a real deep review** (of
[NutSync](https://github.com/henzardkruger/NutSync) — an offline-first weighing app:
an Expo / React Native + Electron client plus a Node-RED hub). They are here to show
you the **shape, depth, and tone** a finished review should produce — concrete file:line
evidence, real findings, true claims, a scored rubric.

> **Imitate them, do not copy them.** These files are saturated with NutSync specifics
> (paths, subsystems, finding IDs like `NS-SEC-01` / `HUB-SEC-02`, the two-repo
> client+hub framing). None of it is portable. When you run `/deep-review` on your own
> repo, the orchestrator must **author fresh files grounded in your actual code** — same
> structure, your facts. Pasting these in and find-replacing the project name would make
> every claim a lie.

## What each file demonstrates

| File                                 | Reference output for                                                                                                                                                                              | Phase |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---: |
| `CLAUDE.example.md`                  | Root AI pointer-index tailored to a real repo                                                                                                                                                     |   6   |
| `anti-patterns.example.md`           | The anti-patterns catalogue a review uncovers                                                                                                                                                     |   6   |
| `engineering-conventions.example.md` | Human-facing "how we work here" conventions                                                                                                                                                       |   6   |
| `testing-strategy.example.md`        | The six-layer test matrix adapted to a stack                                                                                                                                                      |   6   |
| `findings.example.json`              | The scored input to `generate-report.mjs` — the **shape is the template**, the contents are NutSync's                                                                                             |   9   |
| `report.sample.html`                 | A **static**, filled-in sample of the HTML scorecard `generate-report.mjs` produces — shows the intended look/depth; not hand-edited per repo (regenerate the real one from your `findings.json`) |   9   |
| `skills/release/`                    | A **stack-specific** skill a review can author (Electron / NSIS auto-update)                                                                                                                      |   6   |
| `skills/flow-edit/`                  | A **stack-specific** skill a review can author (Node-RED flow editing)                                                                                                                            |   6   |

## Two kinds of example, two rules

- **The `.example.md` docs and `findings.example.json`** — copy the _structure_, replace
  _all_ content with your repo's truths. For the JSON specifically: the **8 dimensions and
  their weights must match `rubric.md` and sum to 100**; everything else (scores, findings,
  metrics) is yours to fill in.
- **The `skills/` examples** — these are _stack-specific_ (each carries an "adaptable
  EXAMPLE" note at the top). They are **not** part of the portable kit and are **not**
  installed by `scripts/install.sh`. They illustrate that a deep review, having understood
  a stack's fragile spots (releasing an Electron app, editing a Node-RED flow), can author
  a guarding skill for them. Build the equivalent for _your_ stack; don't ship these.

The portable, drop-into-any-repo machinery lives in `../skills/`, `../hooks/`,
`../templates/`, and `../scripts/` — nothing there is hardcoded to NutSync. This folder is
the worked example that proves what "good" looks like.
