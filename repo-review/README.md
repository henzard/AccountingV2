# repo-review — portable enterprise deep-review kit

Drop this folder next to (or into) any repo and run a **deep review**: multi-agent
security + quality audit, every finding filed as a GitHub issue, a single **0–100
system score**, the engineering scaffolding authored (CLAUDE.md, testing strategy,
anti-patterns, ADRs), CI + PR/issue templates + protect-branch hooks installed,
`dev`/`qa`/`main` branches with protection policies, and a self-contained HTML
scorecard report.

Distilled from real enterprise-codebase reviews + the
`quality-review`/`security-review` skills. Everything you've learned, portable.

## Quick start

```bash
# 1. Get the kit next to your project (copy the folder, or git clone it).
cp -r ~/repo-review /path/to/project/.repo-review     # or keep it anywhere

# 2. Install scaffolding into the target repo (idempotent) — **Phase 7 only**.
#    Does NOT produce findings.json or the HTML scorecard. For that, run /deep-review
#    (Phases 0–5, 9–10) or see docs/scaffolding-vs-full-review.md.
/path/to/repo-review/scripts/install.sh /path/to/project

# 3. In Claude Code, from the target repo, run the orchestrator skill:
#    /deep-review      (Phases 0–10 — includes score + HTML report; see HOW-TO.md)

# 4. Branches + policies (needs admin on the GitHub repo):
scripts/bootstrap-labels.sh owner/repo
scripts/setup-branches.sh
scripts/setup-branch-protection.sh owner/repo

# 5. Report (after the review produces findings.json):
node scripts/generate-report.mjs findings.json > docs/audit-report.html
python3 -m http.server 8080 --directory docs      # NOT 6000 (browsers block it)
```

## What's inside

```
skills/          deep-review (orchestrator) · qa-lead (Extreme-Ownership QA swarm) ·
                 quality-review · security-review · sync-safety ·
                 verification-quality · branch-hygiene   [portable, installed]
hooks/           git-commit-guard.sh (protect tier branches) · git-push-warn.sh   [config-driven]
templates/       CI · PR template · issue templates · ADR template
scripts/         install.sh · bootstrap-labels.sh · setup-branches.sh ·
                 setup-branch-protection.sh · generate-report.mjs
examples/        tailored CLAUDE.md / testing-strategy / anti-patterns + findings.example.json +
                 report.sample.html (a filled-in sample of generate-report.mjs output)
examples/skills/ release · flow-edit  — stack-specific SAMPLE skills; adapt, don't copy verbatim
rubric.md        the 8-dimension weighted scoring rubric + grade bands
docs/            scaffolding-vs-full-review.md · adoption-learnings.md (field notes)
HOW-TO.md        the full step-by-step runbook
```

## Requirements

`git`, `gh` (authenticated), `node` (for the report generator), and any Claude Code
session. The **Workflow tool** (preferred) or background agents add parallelism, but
`/deep-review` also runs fully sequentially in a plain session — see HOW-TO §2 "Three
ways to drive it". Branch protection needs **admin** on the GitHub repo.

See **HOW-TO.md** for the full playbook and **rubric.md** for scoring.
