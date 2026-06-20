# HOW-TO — run a deep review

The full runbook. The `deep-review` skill is the automation; this is the human guide to
what it does, how to drive it, and how to verify each phase. Designed so you can copy the
`repo-review/` folder into any project and get an enterprise-grade review + scaffolding.

## 0. Prerequisites

- `gh auth status` is green; you have **admin** on the GitHub repo (for branch protection).
- `git`, `node`, and (ideally) the project's test runner are installed.
- A Claude Code session. **Preferred:** the Workflow tool is available and you've opted into
  multi-agent orchestration (say "use a workflow" / "ultracode"). Otherwise the skill falls
  back to background agents.
- The kit is reachable. Either install it (`scripts/install.sh <target>`) or run the skills
  from `~/repo-review`.

## 1. Install the scaffolding

```bash
~/repo-review/scripts/install.sh /path/to/target "main master dev qa prod"
~/repo-review/scripts/bootstrap-labels.sh owner/repo
```

This copies the skills, hooks (+ `.claude/protected-branches`), `.claude/settings.json`,
CI, and PR/issue templates. **Then tailor `.github/workflows/ci.yml`** to the repo's real
test runner (the template has swap-ins per stack). It won't overwrite files you've tailored.

> **Important:** `install.sh` is **Phase 7 only**. It does **not** run the audit, file
> findings, or generate the HTML scorecard. For a 0–100 grade you still need Phases 0–5
> and **Phase 9** (`generate-report.mjs`). See `docs/scaffolding-vs-full-review.md`.

## 2. Drive the review

From the target repo in Claude Code:

```
/deep-review
```

The orchestrator runs these phases (commit + push after each — never lose work):

| Phase | What                                                                                                      | Verify                           |
| ----: | --------------------------------------------------------------------------------------------------------- | -------------------------------- |
|     0 | Preflight: confirm default branch, stack, structure inventory; create `review/deep-review-<date>`         | inventory written                |
|     1 | **Real coverage** — run the suite with `--coverage`; capture per-module numbers                           | numbers captured, not guessed    |
|     2 | **Security review** (`security-review`): red → blue → verify; + scanners (`npm audit`, gitleaks, semgrep) | each finding CLOSED/PARTIAL/OPEN |
|     3 | **Quality review** (`quality-review`): 6 specialists + extended (sync/orchestration/backend) when present | findings carry file:line + fix   |
|     4 | **File issues** — one per finding, severity + domain labels                                               | issues created                   |
|     5 | **Score** — apply `rubric.md` → single 0–100 + grade (weakest-link on security/data)                      | per-dimension drivers recorded   |
|     6 | **Author scaffolding** — CLAUDE.md/AGENTS.md/testing-strategy/anti-patterns/conventions/ADRs, tailored    | claims true to the code          |
|     7 | **Install** — CI + templates + hooks (`install.sh`)                                                       | files present                    |
|     8 | **Branches + policies** — `setup-branches.sh` + `setup-branch-protection.sh`                              | dev/qa/main protected            |
|     9 | **Report** — `generate-report.mjs findings.json > docs/audit-report.html`                                 | scorecard renders                |
|    10 | **Completeness loop** — critic passes until two return nothing                                            | gaps filed                       |

### Three ways to drive it (same phases, pick by what your session has)

The phases above are identical regardless of how you fan the work out — only the
dispatch mechanism changes:

1. **Workflow tool (preferred, most parallel).** Opt into multi-agent ("use a
   workflow" / "ultracode"), then run the script directly:
   ```
   Workflow({ scriptPath: "<kit>/workflows/deep-review.workflow.js",
     args: { target: "/abs/path/to/repo", repo: "owner/repo", coverage: "<paste Phase-1 numbers>" } })
   ```
   It covers Inventory→Review→Verify→File→Author + the completeness loop. You
   still run Phase 1 (coverage), 5 (score), 7–9 (install/branches/report) around it.
2. **Background agents.** No Workflow tool but parallel agents available: `/deep-review`
   spawns each specialist with the Task tool (`run_in_background: true`), following the
   `security-review` and `quality-review` skills' agent lists. Monitor, then synthesize.
3. **Plain sequential (always works — zero extra tooling).** Just a basic Claude
   Code session: run `/deep-review` and let it work the phases **one specialist at a
   time in the main thread** — RT1→RT5 (+ extended), then the 6 quality specialists,
   then verify/file/author. Slower, but produces the same findings, issues, score,
   scaffolding, and report. If `/deep-review` isn't loaded, open
   `skills/deep-review/SKILL.md` and follow Phases 0–10 by hand; the scripts in
   §1/§4/§5 are the same either way.

All three file issues with the **same** label scheme (`sev:<level>` + domain) created
by `bootstrap-labels.sh`, so results are interchangeable.

## 3. The completeness loop ("nothing is missed")

Phase 10 repeatedly asks: _what attack surface, route, mutation, data flow, subsystem,
or test layer did we NOT examine? what claim is unverified?_ Run it until **two consecutive
passes find nothing**. With the Workflow tool, this is a loop-until-dry stage; manually, ask
the critic question per domain (security, sync, data, API, tests, infra, integrations).

## 4. Score & report

Assemble a `findings.json` (shape in `examples/findings.example.json` — weights must match
`rubric.md`) and generate the report:

```bash
node ~/repo-review/scripts/generate-report.mjs findings.json > docs/audit-report.html
python3 -m http.server 8080 --directory docs      # browse at http://<host>:8080/audit-report.html
```

⚠️ **Don't use port 6000** — Chrome/Firefox block it (`ERR_UNSAFE_PORT`). Use 8080/3001/5000.

## 5. Branches & policies

```bash
~/repo-review/scripts/setup-branches.sh                    # creates dev, qa off the default
~/repo-review/scripts/setup-branch-protection.sh owner/repo test   # protect + require the 'test' CI check
```

Result: `feature/* → dev → qa → main`; no direct pushes to protected branches; PR + green
CI required; `dev` set as the default working base. The commit-guard hook enforces this
locally too (reads `.claude/protected-branches`).

## 6. Land it

Open one summary PR (sectioned: Security fixes / Audits / Scaffolding). Large foundational
PRs are fine once; afterward follow the right-size rule in `engineering-conventions`.

**If you only landed scaffolding (Phase 7):** state in the PR body that the **scorecard is
not included** and link to `docs/audit-report.placeholder.md` → next step `/deep-review`.

Field notes from real installs: `docs/adoption-learnings.md`.

## Scaling the agent count

- Small diff / single concern → merge RT1–RT5 into one security pass; a few quality specialists.
- Whole-repo / "be thorough" → all red-team agents in parallel, all 6 quality specialists,
  the extended sync/orchestration agents, plus a completeness critic. Cost scales with scope.

## Adapting to non-Node stacks

The skills are stack-agnostic; only the concrete commands change. Edit the CI template and
the coverage command (Phase 1) to the real runner (pytest/go/cargo/…). The rubric, hooks,
branch model, report generator, and issue/label flow are language-independent.

## Caveat (put it in every report)

LLM + scanners reduce risk substantially but cannot prove a system is unhackable or
bug-free. Keep a human reviewer on Critical findings and anything touching auth, crypto,
money, or multi-tenant isolation.
