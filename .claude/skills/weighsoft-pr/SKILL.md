---
name: weighsoft-pr
description: Drive a pull request all the way to GREEN and mergeable — actively check it for blocking CI runs and unresolved review comments (CodeRabbit and human), and for EACH one investigate, fix the code, push, then reply to the thread saying exactly what the fix was and resolve it. A PR does not merge until CI is success AND every comment is resolved/fixed, so loop until that terminal state. Use when asked to "get the PR green", "babysit/fix this PR", "resolve the CodeRabbit comments", "make CI pass", or "get this mergeable".
version: 1.0.0
category: orchestration
tags:
  - pull-request
  - ci
  - code-review
  - coderabbit
  - merge
  - github
  - loop
  - automation
---

# weighsoft-pr — get the PR green and keep it green

A PR is blocked by two things: **red CI** and **unresolved review comments** (CodeRabbit,
other bots, and humans). This skill owns both — it does not stop at "here's what's failing";
it drives the PR to the terminal state where **CI is success and every comment is resolved
and fixed**, so the PR can merge.

> **The standing reality:** the PR will **not** merge while any required check is red or any
> review thread is unresolved. So the job isn't to report status — it's to _close every
> blocker_: fix the code, push it, reply with what you changed, resolve the thread. Get the
> PR green. ([CodeRabbit review commands][cr], [resolving review conversations][gh])

> **Posture (Extreme Ownership):** every red check and every open comment is yours to close.
> "CodeRabbit is just nitpicking" / "that test is flaky" is the start of the investigation,
> not an excuse to leave it red. If a comment is genuinely wrong or out of scope, you still
> _act_ — reply with the reason and resolve it; you never leave it dangling.

## Tools & composition

- **GitHub MCP** (`mcp__github__*`): `pull_request_read` (methods `get_check_runs`,
  `get_status`, `get_review_comments`, `get_comments`, `get_reviews`, `get_files`,
  `get_diff`), `get_job_logs` (CI failure logs), `add_comment_to_pending_review` /
  `add_reply_to_pull_request_comment` (reply to a thread), `resolve_review_thread`,
  `update_pull_request_branch` (sync with base), `merge_pull_request` (only if authorized).
- **Subscribe, don't poll:** `subscribe_pr_activity` so new CI failures and review comments
  wake the session. Never `sleep`-loop on CI. Webhooks don't deliver CI _success_, new
  pushes, or merge-conflict transitions — so re-check those yourself each pass (a scheduled
  self-check-in if a timer tool exists).
- **Fix engines:** `weighsoft-bug-fix` (a CI failure that's a real bug → reproduce red → fix →
  green), `weighsoft-qa-lead` (the test/e2e sign-off), `weighsoft-verification-quality` (prove
  it locally before pushing), `weighsoft-branch-hygiene` (commit + push every step).

---

## Phase 0 — Read the board

Identify the PR (number/branch). Pull the full blocking picture in one sweep:

- **CI:** `pull_request_read get_check_runs` (+ `get_status`) — list every check and its state
  (success / failure / pending / required). Note which are **required** for merge.
- **Review threads:** `get_review_comments` — every thread with `isResolved`, file:line, and
  the requested change. Separate **unresolved** from resolved/outdated.
- **Reviews & mergeability:** `get_reviews` (CHANGES_REQUESTED blocks), and the PR's
  mergeable/behind-base state. Write a short **blocker list**: `[CI: jobs red] + [N unresolved
threads] + [requested changes] + [behind base?]`. That list is the definition of "not done".

> **What the branch rule actually enforces** (so you don't chase the wrong blocker): required
> status checks pass against the **latest commit SHA** — any new push resets them, so re-push
> ⇒ re-wait; a check only counts if it reported within the repo's window (default 7 days) and
> its **job name is unique** across workflows. "Require conversation resolution" is a _separate_
> rule from required checks — green CI alone won't merge if it's on and a thread is unresolved.
> Required approvals are dismissed by new commits if "dismiss stale reviews" is set.
> ([branch protection][bp], [required status checks][rsc])

## Phase 1 — Green the CI

For each failing/required check:

1. **Read the real logs** — `get_job_logs` (`failed_only: true`, `return_content: true`).
   Find the actual failure (failing test, lint/type error, build break), not a guess.
2. **Reproduce locally** and fix at the root (use `weighsoft-bug-fix` for a real defect;
   `weighsoft-verification-quality` to confirm green before pushing). Don't paper over a red
   test by weakening it.
3. **Push** the fix (`weighsoft-branch-hygiene`), which re-triggers CI. **Re-kick until green**
   — re-diagnose each new failure; one round is not the task. If a check is genuinely
   infra/transient, re-run it; if it stays red for an unrelated external reason, say so in
   Phase 4.

## Phase 2 — Resolve every review comment (the core loop)

Work **each unresolved thread** to closed — confident, small fixes directly; otherwise
investigate first. For every thread:

1. **Understand the ask** and **verify it against the current code** (CodeRabbit's line may be
   stale after a push). Decide: valid → fix; partially valid → fix the valid part; invalid or
   out-of-scope → reasoned decline.
2. **Fix the code** for valid comments (root cause, rule-conformant per `CLAUDE.md` — no
   banned patterns, deps inward, etc.), and **push**.
3. **Reply to the thread with exactly what you did** — `add_reply_to_pull_request_comment`
   with a one-to-three-line note: _what changed + the commit/file:line_, e.g. "Fixed in
   `abc1234` — added the missing `ON DELETE` and a NOT NULL default on `order.user_id`." For a
   decline: state the reason briefly (why it's correct as-is / out of scope / tracked
   separately).
4. **Resolve the thread** — `resolve_review_thread` (or, for CodeRabbit, you may reply
   `@coderabbitai resolve` to let it close its own threads). Every thread ends **resolved**,
   none left dangling.

> **CodeRabbit specifics:** its comments carry a _“Prompt for AI Agents”_ block and often a
> one-click **committable suggestion** — apply the still-valid ones, skip the rest with a
> one-line reason (CodeRabbit's own guidance). Its chat commands are deterministic and all
> start `@coderabbitai`: **`review`** (incremental, only new changes) vs **`full review`**
> (re-review everything from scratch — use after a force-push or rebase), **`resolve`**
> (marks all its review comments resolved), **`pause`/`resume`** automatic reviews,
> **`configuration`** to dump the active config. After pushing, a new commit auto-triggers an
> incremental review; if it's idle/rate-limited, `@coderabbitai review` re-runs it. Re-read
> its **next** pass — fixes can surface follow-ups. ([CodeRabbit commands][cr])

## Phase 3 — Sync, re-check, and loop to GREEN

- If the PR is **behind base**, update it (`update_pull_request_branch`) and re-run CI.
- **Re-sweep Phase 0** after each push: new pushes can spawn new CI runs and new review
  comments that webhooks won't announce. Keep looping Phases 1–2 until the terminal state:

```text
until:  every required CI check = success
        AND every review thread = resolved (fixed or reasoned-declined)
        AND no CHANGES_REQUESTED outstanding
        AND the branch is not behind base
=> PR is GREEN and mergeable
```

Merge only if the user authorized it (`merge_pull_request`); otherwise report it's green and
ready. Stay subscribed until the PR is **merged or closed**.

## Phase 4 — When a blocker won't yield (HUMAN)

After deep research + several genuine attempts a blocker can still resist — a check needs a
secret/access you don't have, a reviewer wants a product decision, or a failure is a real
external outage. Don't spin forever or fake-resolve:

- **Reply on the thread / PR** with: what you tried, why it's stuck, and exactly what you need
  from a human; label the PR/issue `needs:human` (consistent with `weighsoft-backlog-burndown`).
- Move on to the other blockers so one stuck item doesn't hold the rest. Never resolve a
  thread you didn't actually address.

## Definition of done

- [ ] Blocker list captured (CI + unresolved threads + requested changes + behind-base)
- [ ] Every required CI check is **success** (real fixes, re-kicked to green — not weakened)
- [ ] Every review thread **resolved**: code fixed + **reply stating what the fix was**, or a
      reasoned decline — none left dangling
- [ ] Branch not behind base; no CHANGES_REQUESTED outstanding → PR **GREEN & mergeable**
- [ ] Genuinely stuck blockers escalated to **HUMAN** with what's needed; subscription kept
      until the PR is merged or closed

## Quick reference

```text
0. Read the board: get_check_runs + get_review_comments + get_reviews → blocker list.
1. CI red → get_job_logs → reproduce → fix root → push → re-kick until green.
2. Each unresolved comment → verify vs current code → fix → push → REPLY with what you fixed → resolve thread.
   (CodeRabbit: apply valid suggestions, decline the rest with a reason; @coderabbitai review re-runs it.)
3. Sync with base, re-sweep (new pushes spawn new checks/comments), loop until CI green + all threads resolved.
4. Stuck after real effort → reply with what's needed + label needs:human; never fake-resolve. Stay subscribed till merged/closed.
```

**The gate, one line:** _the PR isn't done when you've listed the problems — it's done when
every required check is green and every comment is fixed-and-resolved with a reply saying what
you changed; loop until the PR is GREEN and mergeable, and escalate only what truly needs a
human._

---

Sources / further reading:
[cr]: https://docs.coderabbit.ai/guides/commands "CodeRabbit — review/full review/resolve/pause commands & committable suggestions"
[gh]: https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/resolving-a-conversation "GitHub — resolving a review conversation"
[bp]: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches "GitHub — protected branches & merge requirements"
[rsc]: https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/troubleshooting-required-status-checks "GitHub — required status checks (latest-SHA, 7-day window, unique job names)"
