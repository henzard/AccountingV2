---
name: branch-hygiene
description: Keep a repo free of orphaned work — branch off the default branch, make sure every pushed commit is tracked by an open or merged PR, and never leave un-merged commits stranded. Use as the FIRST action when joining a session (git status + gh pr list), before opening a new branch, or when you spot a pushed branch with no PR. A proportionate, script-free never-lose-work discipline that scales from a single small repo to a multi-repo project.
---

# Branch hygiene

Core principle: **every pushed commit must be reachable from an open or merged PR — no orphans.** Work that is committed-and-pushed but tracked by nothing is the failure mode this skill exists to prevent. It is `git` + `gh` discipline, applied to **every repo you work in** — if a project spans more than one repo (e.g. an app plus a separate service or integration hub), apply the same rules to each independently.

This is the **proportionate, script-free** form of a never-lose-work discipline: no `branch-hygiene.sh`, no PR-count cap, no nightly issue-filing workflow, no enforced multi-tier base. For a small repo the manual `git status` + `gh pr list` check is enough. (Scale up only when it stops fitting — see the last section.)

## Know your defaults first

Two facts drive everything below; confirm them per repo before you start:

```bash
gh repo view --json defaultBranchRef -q .defaultBranchRef.name   # the default branch (main, master, …)
git remote -v                                                    # the remote (owner/repo)
```

Wherever this skill says "the default branch", substitute what that command returns (commonly `main` or `master`). Don't assume.

## First action when joining a session

Before any new work, in whichever repo you're in:

```bash
git status                              # clean tree? what branch am I on?
git fetch origin                        # see what's really on the remote
gh pr list                              # what's open — anything mine to finish first?
gh pr list --state merged --limit 10    # recently merged, for orphan checks
```

If `git status` shows uncommitted work, deal with it before switching context (never-lose-work). If `gh pr list` shows an open PR you own, finish or update it before starting something new. If a branch is pushed but has **no** PR, that's the first thing to fix (see Rescue).

## The four rules (proportionate set)

1. **Branch off the default branch.** `git checkout -b <type>/<topic> origin/<default>`. No feature work on the default branch directly.
2. **Every pushed commit is tracked by a PR.** If you `git push` a branch, open a PR for it the same session — open it as a draft if it's not ready: `gh pr create --draft`.
3. **No orphan branches.** A pushed branch with commits that aren't on the default branch and aren't in any open/merged PR is an orphan. Don't delete it if it carries real un-merged work — rescue it.
4. **Commit + push every step.** Small, frequent commits beat one big drop. Pushing often is the backup; a local-only commit is not safe.

## Spot an orphan (manual check, no script)

```bash
git fetch origin
DEFAULT=$(gh repo view --json defaultBranchRef -q .defaultBranchRef.name)
# branches with commits not on the default branch:
for b in $(git for-each-ref --format='%(refname:short)' refs/remotes/origin | grep -v "/$DEFAULT$"); do
  n=$(git rev-list --count "$b" --not "origin/$DEFAULT")
  [ "$n" -gt 0 ] && echo "$b: $n commit(s) ahead of $DEFAULT"
done
gh pr list --state all --limit 50   # cross-reference: does each ahead branch have a PR?
```

A branch that is ahead of the default branch **and** has no entry in `gh pr list --state all` is an orphan.

## Rescue an orphan

```bash
DEFAULT=$(gh repo view --json defaultBranchRef -q .defaultBranchRef.name)
```

1. See the dangling commits: `git log <branch> --not "origin/$DEFAULT" --oneline`.
2. Open a PR for them directly: `gh pr create --base "$DEFAULT" --head <branch>`.
3. OR, if the branch is messy, cherry-pick the real fixes onto a fresh branch off the default and PR that: `git checkout -b fix/<topic> "origin/$DEFAULT" && git cherry-pick <sha>... && git push -u origin HEAD && gh pr create --base "$DEFAULT"`.
4. **Do not just `git push origin --delete <branch>` if it carries un-merged work** — that is exactly the loss this skill prevents.

## Before opening a NEW branch

Run the First-action checks. If there's a nearby orphan, rescue it before piling on more work. Then:

```bash
DEFAULT=$(gh repo view --json defaultBranchRef -q .defaultBranchRef.name)
git checkout "$DEFAULT" && git pull origin "$DEFAULT"
git checkout -b <type>/<topic>     # feat/, fix/, chore/, docs/
```

## Per-repo notes (fill in for the project)

Keep one line per repo recording its default branch, test command, and where audits/docs live, so the checks above are unambiguous. For example:

- **<repo>** (`<path>`): `<stack>`. Run `<test cmd>` before pushing. Audits live in `docs/` (dated `docs/*-AUDIT-<date>.md`); write any new audit there, never as a stray root-level `.md`.
- Repeat for each additional repo the project spans, with its own default branch and test command.

> _(Example: a multi-repo project — say an app repo defaulting to `master` and a backend/hub repo defaulting to `main` — would list both here, each with its own test command line. Your project's repos and defaults will differ — record the real ones.)_

## When to scale up (and when not to)

For a small repo the manual `git status` + `gh pr list` check is proportionate — there is intentionally **no** `branch-hygiene.sh`, no `MAX_OPEN_PRS_PER_AUTHOR` tuning, no `.github/workflows/branch-hygiene.yml` nightly issue filing, and no enforced `dev`→`qa`→`main` multi-tier base. If branch/PR count ever grows past what a human can eyeball, **then** reintroduce automation — a nightly orphan-detector workflow and/or the multi-tier protected branches from the `deep-review` kit's `setup-branches.sh` — not before.
