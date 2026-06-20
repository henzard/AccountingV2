# Adoption learnings — from real installs

Field notes from applying this kit to production repos. Use these to avoid the gap between **"install the standards"** and **"deliver the scorecard."**

## The #1 confusion: scaffolding ≠ scored review

**What happened (xero-gateway, 2026-06):** A request to _"review against repo-review standards and set up GitHub Actions and repo rules"_ was correctly interpreted as Phases 6–8 (docs, CI, templates, branches, rulesets) but **Phases 0–5 and 9–10 were skipped** — so the repo got rubric + placeholder but **no `findings.json` and no `docs/audit-report.html`.**

**Why it felt unclear:** The kit _does_ document the scorecard (README, HOW-TO Phase 9, `deep-review` "Outputs" checklist). But:

| Signal                                  | What it implies (wrongly) | What it actually means                          |
| --------------------------------------- | ------------------------- | ----------------------------------------------- |
| `install.sh` completes successfully     | "Review done"             | Only Phase **7** machinery copied; **no score** |
| `docs/rubric.md` present                | "We're scored"            | Rubric is the **ruler**, not the measurement    |
| `audit-report.placeholder.md`           | "Report exists"           | Placeholder until Phase **9**                   |
| PR titled "Adopt repo-review standards" | Full audit landed         | Often scaffolding-only                          |

**Fix for adopters:** Treat these as **two deliverables**:

1. **Standards scaffolding** — skills, hooks, CI, templates, branches, labels (Phases 6–8).
2. **Scored audit** — coverage, findings, issues, `findings.json`, HTML scorecard (Phases 0–5, 9–10).

If the user only asked for (1), say explicitly: _"Scaffolding is done; scorecard requires `/deep-review` or Phase 9."_

See **`docs/scaffolding-vs-full-review.md`** for a checklist agents can follow.

---

## install.sh on Windows

**Symptom:** `set: pipefail: invalid option name` — scripts have CRLF line endings or Git Bash `set -o pipefail` issues.

**Workaround:** Run from WSL/Linux, or `dos2unix scripts/*.sh hooks/*.sh`, or copy files manually and run `bootstrap-labels.sh` via `gh label create` loops.

**Kit improvement:** Document in HOW-TO §0; consider `.gitattributes` `*.sh text eol=lf` in this repo.

---

## Default branch ≠ always `dev`

**Symptom:** `setup-branch-protection.sh` sets `default_branch=dev`. Repos that **deploy from `master`** (e.g. self-hosted runner on push to default) must **keep production default** and use `dev` only as integration base.

**Pattern:** `feature → dev → qa → master (deploy)` with **`master` still the GitHub default** when deploy hooks listen to it.

**Kit improvement:** Make default-branch override a flag; document in branch scripts.

---

## Rulesets vs legacy branch protection

Modern GitHub repos often use **repository rulesets** (`gh api .../rulesets`) instead of `PUT .../branches/{branch}/protection`.

**Symptom:** `setup-branch-protection.sh` succeeds on some repos, fails or duplicates on others.

**Pattern:** Create `protect-dev`, `protect-qa`; keep `~DEFAULT_BRANCH` ruleset for production. Sync tier branches via **PR** (`master → dev`) — direct push is rejected once rules apply.

---

## Required conversation resolution + CodeRabbit

**Symptom:** PR merge `BLOCKED` despite green `test` + CodeRabbit — unresolved review threads on kit hook files.

**Fix:** Resolve threads via GraphQL `resolveReviewThread`, or fix upstream hook regex in the kit (see open nit: `-C` / `--git-dir` two-token git globals).

---

## Stack-specific templates to skip

- `ISSUE_TEMPLATE/sync-data-loss.md` — NutSync/offline-sync specific; omit for API gateways and headless services.
- `examples/anti-patterns.example.md` — NutSync paths; author fresh `docs/anti-patterns.md` per repo.

---

## Agent request phrasing → expected scope

| User says                                     | Minimum scope                                                |
| --------------------------------------------- | ------------------------------------------------------------ |
| "Set up repo-review / standards / CI / rules" | Phases 6–8 + confirm scorecard **not** included unless asked |
| "Deep review / audit / score this repo"       | Phases 0–10 + **`docs/audit-report.html`**                   |
| "Review against repo-review" (ambiguous)      | **Ask:** scaffolding only, or full scored audit?             |

---

## Reference install

- **Repo:** [Kruger-Web-Solutions/xero-gateway](https://github.com/Kruger-Web-Solutions/xero-gateway)
- **Scaffolding PR:** [#24](https://github.com/Kruger-Web-Solutions/xero-gateway/pull/24)
- **Still pending at time of writing:** Phase 9 scorecard (`findings.json` → `generate-report.mjs`)
