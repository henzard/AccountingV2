# Scaffolding vs full review — checklist

Use this when an agent or human is asked to "apply repo-review." Prevents shipping Phase 7 while skipping Phase 9.

## Mode A — Standards scaffolding only

**User intent:** CI, templates, hooks, branch model, labels, docs _shape_.

| Step                                                             | Phase | Done when                                    |
| ---------------------------------------------------------------- | :---: | -------------------------------------------- |
| `install.sh <target> [protected-branches]`                       |   7   | skills, hooks, templates, CI template copied |
| Tailor `.github/workflows/ci.yml`                                |   7   | real test runner + gitleaks/audit jobs       |
| Author `CLAUDE.md`, testing-strategy, anti-patterns, conventions |   6   | claims true to target repo                   |
| `bootstrap-labels.sh owner/repo`                                 |   0   | `sev:*` + domain labels exist                |
| `setup-branches.sh` + protection/rulesets                        |   8   | `dev`, `qa` exist; protected                 |
| Copy `rubric.md` → `docs/rubric.md`                              |   —   | ruler present                                |

**Explicitly tell the user:** No score yet. No `findings.json`. No `docs/audit-report.html`.

---

## Mode B — Full deep review (includes scorecard)

Everything in **Mode A**, plus:

| Step                                                         | Phase | Done when               |
| ------------------------------------------------------------ | :---: | ----------------------- |
| Structure inventory                                          |   0   | written                 |
| `npm test --coverage` (or stack equivalent)                  |   1   | numbers captured        |
| Security + quality review                                    |  2–3  | findings with file:line |
| GitHub issues filed                                          |   4   | labelled                |
| Rubric sub-scores                                            |   5   | 8 dimensions scored     |
| `findings.json` assembled                                    |   5   | weights sum to 100      |
| `generate-report.mjs findings.json > docs/audit-report.html` | **9** | **scorecard committed** |
| Completeness loop                                            |  10   | two clean critic passes |
| Summary PR                                                   |   6   | links to scorecard      |

**Definition of done:** open `docs/audit-report.html` in a browser and see the 0–100 grade.

Preview shape: `examples/report.sample.html` (NutSync sample — do not copy scores).

---

## One-line status to report

- **Scaffolding only:** "Repo-review **machinery** installed; run `/deep-review` for the **scorecard**."
- **Full review:** "Deep review complete — **grade X (Y/100)** in `docs/audit-report.html`."
