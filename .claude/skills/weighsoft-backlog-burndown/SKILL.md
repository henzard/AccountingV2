---
name: weighsoft-backlog-burndown
formerly: backlog-burndown
description: Act as an autonomous Project Manager that drives an open-issue backlog to zero — babysit in-flight PRs to green CI with every review comment resolved, then work the issues in batches (default 5 at a time): deep-research each, brainstorm → write a plan → swarm-execute it → open a PR → code-review → and only count it done once /weighsoft-qa-lead is happy and tests pass. Runs in a babysit loop until every issue is CLOSED or, after deep research and several passes it still can't be resolved, labelled HUMAN with a written hand-off. Use when asked to "burn down the backlog", "close all the issues", "be the PM and resolve the issues", "babysit the PRs and get CI green", or "do as many passes as it takes, mark the stuck ones HUMAN".
version: 1.0.0
category: orchestration
tags:
  - project-management
  - backlog
  - issues
  - swarm
  - ci
  - pull-requests
  - loop
  - autonomous
  - orchestration
---

> 🔁 **Renamed:** this skill is now **weighsoft-backlog-burndown** (formerly **backlog-burndown**). Update any references.

# /weighsoft-backlog-burndown — autonomous PM that closes the backlog

You are the **Project Manager on point**. The deliverable is **an empty actionable
backlog**: every open issue ends in one of exactly two states — **CLOSED** (a merged/ready
PR resolved it and `/weighsoft-qa-lead` signed off) or **HUMAN** (after real effort it's genuinely
blocked, so it's labelled and handed off with notes). Nothing is silently dropped, and you
do not stop at "here's what could be done" — you run the pipeline until the board is clear.

> **Posture (Extreme Ownership, same as `weighsoft-qa-lead`):** the backlog is yours to burn down.
> Red CI is yours to fix; an unresolved review comment is yours to address; a stuck issue
> is yours to _either_ resolve _or_ escalate with a written reason. "We could close these"
> is not the deliverable — a clear board is.
>
> **Honest caveat:** an agent swarm closes well-specified issues reliably but cannot make
> product decisions, grant access, or judge ambiguous intent. Those are exactly what the
> **HUMAN** label is for — escalating early on those is _good_ PM judgment, not failure.

## What it composes (with graceful fallback)

This skill orchestrates tools you may have from other plugins; **each has a native
fallback** so it works in a plain session too:

- **Brainstorm** — `/superpowers:brainstorm` (Obra Superpowers). _Fallback:_ a brainstorming
  pass in the main thread / an `Explore` agent. ([superpowers][sp])
- **Plan** — `/superpowers:write-plan` (TDD-shaped plan doc). _Fallback:_ the **`Plan`**
  agent → a `docs/plans/<issue>.md`. ([superpowers][sp])
- **Swarm-execute** — `/swarm` / ruflo `/swarm_init` (queen-led agent teams). _Fallback:_
  `/superpowers:execute-plan` (subagent-driven), or dispatch **`Agent`** subagents yourself,
  one task per agent, each with a review pass. ([ruflo][rf])
- **QA gate** — **`/weighsoft-qa-lead`** (this kit) — the merge gate. Non-negotiable per the request:
  _"after every run make sure /weighsoft-qa-lead is happy and all tests pass."_
- **Code review** — **`/code-review`** (this kit) on every PR diff.
- **The loop** — **`/loop`**, or `subscribe_pr_activity` + a `send_later` self-check-in
  (preferred over `sleep`-polling). ([ruflo autopilot/loop][rf])
- **Never lose work** — **`weighsoft-branch-hygiene`**; **`weighsoft-verification-quality`** is the evidence bar.

If an orchestrator command isn't installed, **use the fallback silently** — don't tell the
user a capability is missing when the native path covers it.

## Orchestration model

Decompose → dispatch → monitor → verify → escalate-or-close. Keep the main thread
interruptible. Commit + push after every issue (never lose work). Scale agent count to the
batch (5 issues ⇒ a handful of focused subagents; don't spawn 50).

---

## Phase 0 — Take the board (setup)

1. `weighsoft-branch-hygiene`: confirm the default branch + `gh auth status`; work on branches, never
   the protected base.
2. **Inventory the work** — the real counts, not guesses:
   ```bash
   gh pr list  --state open  --json number,title,isDraft,reviewDecision,statusCheckRollup
   gh issue list --state open --json number,title,labels --limit 200    # expect ~65
   ```
3. **Create the tracking labels** (idempotent) so state lives on GitHub, not in chat:
   ```bash
   gh label create "needs:human"  --color B60205 --description "Blocked — needs a human decision/access" --force
   gh label create "pm:in-progress" --color FBCA04 --description "Being worked by backlog-burndown" --force
   gh label create "pm:done"        --color 0E8A16 --description "Resolved by a PR, qa-lead signed off"  --force
   ```
4. **Set the batch size** (default **5**; honor whatever the user said). Record it.

## Phase 1 — Babysit the in-flight PRs FIRST (green the board before adding to it)

Don't pile new work onto a red board. For every open PR:

- **CI:** `gh pr checks <n>` — if red, read the failing job logs, reproduce locally, fix,
  push. Re-kick until green (this loop has a terminal state; drive it there — see the
  CI-babysit discipline in the environment guidance).
- **Review comments:** resolve every unresolved CR thread — apply the change and reply, or
  (if you disagree) reply with the reason. Don't leave threads dangling.
- **Subscribe**, don't poll: `subscribe_pr_activity` for each PR so new CI failures / review
  comments wake the session; never `sleep`-loop waiting on CI.
- A PR you can get green + reviewed → ready to merge (merge only if the user authorized
  merging; otherwise leave it ready and say so). A PR blocked on a human → **HUMAN** (Phase 4).

## Phase 2 — Triage & batch the backlog

Autonomous triage is now a mainstream agent pattern — agents that reproduce, label, and route
issues as a first line of defense (GitHub Agentic Workflows reached technical preview in Feb
2026; Dosu/Repro-Bot do the same). This phase is that pattern, gated by the HUMAN escape
hatch below. ([agentic triage][trg], [Repro-Bot][rb])

- Pull the open issues; **skip any already labelled `needs:human` or `pm:done`**.
- **Order by value × unblock:** security/data/broken-core first, then dependency order (an
  issue whose fix others depend on goes earlier). Group into **batches of <N>** (default 5).
- Within a batch prefer **independent** issues so the swarm doesn't collide on the same files.

## Phase 3 — The per-batch pipeline (repeat per batch)

For each issue in the batch, label it `pm:in-progress`, then run the pipeline. Parallelize
across the batch where the issues don't overlap; serialize where they touch the same code.

1. **Deep-research the issue** ("several passes" starts here, not at the fix). Read the issue
   thread, reproduce the bug / pin down the ask, and read the real code around it (`Explore`
   / `general-purpose` agent for the fan-out). Write a 2–3 line problem statement: _what's
   actually wrong, where, and what "fixed" means._ If the ask is ambiguous and the answer is
   a product decision → **don't guess, go to HUMAN** (or `AskUserQuestion` if the user is
   reachable now).
2. **Brainstorm** the approach — `/superpowers:brainstorm` (fallback: a short
   brainstorming pass) to surface the design + edge cases before any code. ([superpowers][sp])
3. **Write the plan** — `/superpowers:write-plan` into `docs/plans/issue-<n>.md`: TDD-shaped
   (failing test → minimal impl → green → commit), with acceptance criteria tied to the
   issue. _Fallback:_ the `Plan` agent. ([superpowers][sp])
4. **Swarm-execute the plan** — `/swarm` (ruflo) or `/superpowers:execute-plan`; _fallback:_
   dispatch `Agent` subagents (one task per agent, fresh context, each task followed by a
   spec-compliance + code-quality review). Commit + push as tasks land. ([ruflo][rf])
5. **Open a PR** for the issue (or one PR per cohesive batch) — body links `Closes #<n>`,
   summarizes the fix, and references the plan doc.
6. **Code-review** — run **`/code-review`** on the diff and address findings before the QA gate.
7. **QA gate — `/weighsoft-qa-lead` must be happy** (the request's hard rule). Run it; **all tests must
   pass** and the issue's acceptance criteria must hold end-to-end. If `/weighsoft-qa-lead` finds
   regressions, they go back into this same pipeline (they're new work) — the issue is **not**
   done until QA is green.
8. **Close or escalate:** QA green ⇒ relabel `pm:in-progress`→`pm:done`, let the merged PR
   close the issue. Still failing after the pass budget ⇒ **Phase 4 (HUMAN)**.

## Phase 4 — The HUMAN escape hatch (when to stop trying)

Escalate an issue to **HUMAN** — don't burn infinite cycles — when **any** holds:

- **Pass budget exhausted:** you've done deep research + **≥3 genuine fix attempts**
  (default; honor a different number if the user gave one) and it's still red or still
  reproduces.
- **Needs something only a human has:** a product/UX decision, a credential/secret, access
  to an external system, a third-party change, or sign-off on a risky/irreversible action.
- **Genuinely ambiguous** intent and the user isn't reachable to disambiguate.

To escalate (never silently drop):

```bash
gh issue edit <n> --add-label "needs:human" --remove-label "pm:in-progress"
gh issue comment <n> --body "$(cat <<'EOF'
**Escalating to HUMAN** — backlog-burndown could not resolve this autonomously.
- **What I tried:** <attempts / approaches, N passes>
- **Where it's stuck:** <root blocker — failing test, missing decision, needed access>
- **What I need from you:** <the specific decision/credential/answer>
- **Partial work:** <branch / draft PR link, if any>
EOF
)"
```

Then **move on to the next issue** — one stuck issue never stalls the burndown.

## Phase 5 — The PM babysit loop (run it until the board is clear)

Wrap Phases 1–4 in a recurring loop — this is the "/loop to babysit this process" the
request asks for:

```text
each pass:
  1. babysit in-flight PRs  → CI green, review threads resolved   (Phase 1)
  2. pick the next batch of <N> open, non-HUMAN issues            (Phase 2)
  3. run the pipeline for the batch                               (Phase 3)
  4. /weighsoft-qa-lead + full suite must be green before anything is "done"
  5. escalate the truly-stuck to HUMAN                            (Phase 4)
  6. commit + push; refresh the PM status (Phase 6)
until: NO open issue remains that is neither CLOSED nor labelled needs:human
       AND every PR is merged/closed (or ready + review-clean + CI green)
       AND /weighsoft-qa-lead is green on the integrated result
```

Drive the loop with `/loop` **or** `subscribe_pr_activity` + a `send_later` self-check-in
(re-check CI / mergeability / next batch when it fires; re-arm until the board is clear).
**Prefer events + scheduled check-ins over `sleep`-polling.** The loop is _not_ done after
one batch — keep going until the terminal state above.

## Phase 6 — PM status report (every pass)

Keep a live status the user can read at a glance (a checklist comment on a tracking issue,
or `docs/backlog-burndown-status.md`):

- **Burndown:** open at start → closed / HUMAN / in-flight / remaining.
- **This pass:** issues attempted, PRs opened, CI state, `/weighsoft-qa-lead` result.
- **HUMAN queue:** each escalated issue + the one-line reason + what's needed.
- **Residual risk** (per the caveat). Only message the user when something needs them or the
  board is clear — re-arm silently otherwise.

## Definition of done

- [ ] In-flight PRs babysat: CI green, every review thread resolved (or ready + reason)
- [ ] Backlog triaged and worked in batches of <N> (default 5)
- [ ] Each worked issue: deep-researched → brainstormed → planned → swarm-executed → PR →
      code-reviewed → **`/weighsoft-qa-lead` happy + tests pass** before it counts as done
- [ ] Truly-stuck issues labelled **`needs:human`** with a written hand-off (tried / stuck /
      needs / partial work) — none silently dropped
- [ ] Babysit loop ran until every issue is CLOSED or HUMAN and `/weighsoft-qa-lead` is green
- [ ] Live PM status maintained; final report lists closed vs HUMAN vs residual risk

## Quick reference

```text
0. Take the board: list open PRs + issues (~65); create needs:human / pm:* labels; batch size = 5.
1. Babysit PRs FIRST: CI green + review threads resolved (subscribe, don't poll).
2. Triage issues → batches of 5 (value × unblock; independent issues together).
3. Per issue: deep-research → /superpowers:brainstorm → /superpowers:write-plan
   → /swarm execute → PR → /code-review → /weighsoft-qa-lead must pass → close.
4. Stuck after deep research + ≥3 passes, or needs a human decision/access → label needs:human + hand-off note.
5. /loop (or subscribe + send_later) the whole thing until every issue is CLOSED or HUMAN.
6. Keep a live PM status; report closed vs HUMAN vs residual risk.
```

**The gate, one line:** _you are the PM — green the in-flight PRs, then burn the backlog
down 5 at a time through brainstorm→plan→swarm→PR→code-review→`/weighsoft-qa-lead`, loop until every
issue is either CLOSED with tests passing or labelled **HUMAN** with a written reason, and
never silently drop one._

---

Sources / further reading:
[sp]: https://github.com/obra/superpowers "Obra Superpowers — brainstorming → writing-plans → subagent-driven execution"
[rf]: https://github.com/ruvnet/ruflo "ruflo (Claude Flow) — swarm orchestration, queen-led agents, autopilot/loop workers"
[trg]: https://www.infoq.com/news/2026/02/github-agentic-workflows/ "GitHub Agentic Workflows — natural-language CI/CD for autonomous issue triage & labeling (tech preview, Feb 2026)"
[rb]: https://www.metabase.com/blog/reprobot-github-issue-triage-agent "Metabase Repro-Bot — an AI agent that reproduces bug reports for triage"
