#!/usr/bin/env bash
# PreToolUse(Bash) guard — HARD-BLOCK `git commit` when the CURRENT branch is a
# protected tier branch. Portable: the protected set is read from (in order)
#   1) env REPO_REVIEW_PROTECTED   (space/pipe separated)
#   2) <repo>/.claude/protected-branches  (one line, space/pipe separated)
#   3) default: "main master dev qa prod"
#
# False-positive-free by design:
#   - Fires ONLY for a `git commit` command (string match on the tool input).
#   - Blocks ONLY when `git rev-parse --abbrev-ref HEAD` is EXACTLY a protected name.
#   - Feature branches (feature/*, fix/*, review/*, chore/*, …) → never blocked.
#   - Detached HEAD ("HEAD") → never blocked. Merge commits via `gh pr merge` are
#     not local `git commit` → never blocked. Outside a git repo → exit 0.
#   - `git config commit.*`, `git commit-tree`, `git log --grep=commit` → never
#     blocked (`commit` must be a standalone command word, not `commit.`/`commit-`).
# Known fail-SAFE limit: a literal `echo "git commit"` (the words inside another
# command's string) over-blocks — string match, no shell parser. It errs toward
# blocking, never toward letting a real commit through; rephrase the echo if hit.
#
# Contract: print a reason to stderr + exit 2 to BLOCK; exit 0 to ALLOW.
set -euo pipefail
payload="$(cat 2>/dev/null || true)"

cmd=""
if command -v jq >/dev/null 2>&1; then
  cmd="$(printf '%s' "$payload" | jq -r '.tool_input.command // .params.command // empty' 2>/dev/null || true)"
fi
# jq-free fallback: pull "command":"..." out of the raw JSON so the boundary regex
# below sees the real command, not the JSON envelope (where `git` is preceded by a
# quote, not whitespace — which would make this guard fail OPEN without jq).
if [ -z "$cmd" ]; then
  cmd="$(printf '%s' "$payload" | sed -n 's/.*"command"[[:space:]]*:[[:space:]]*"\(\([^"\\]\|\\.\)*\)".*/\1/p' | head -n1 || true)"
fi
# Last-resort fallback: match against the raw payload as-is.
[ -z "$cmd" ] && cmd="$payload"

# Only care about `git commit` (not log/diff/status/config/commit-tree internals).
# Match `git [global-opts] commit`. Global opts allowed between git and commit:
#   -x / --long  options, AND  key=value  option-values (e.g. `git -c user.name=x commit`),
# which the old `(-[^ ]+\s+)*` form missed → it fail-OPENED on that very common invocation.
# Boundary class includes `"` so the raw-JSON last-resort fallback (where `git` is
# preceded by a quote) still matches and the guard cannot fail open without jq.
printf '%s' "$cmd" | grep -Eq '(^|[;&|"'"'"']|[[:space:]])git[[:space:]]+(-[^[:space:]]+[[:space:]]+|[^[:space:]]+=[^[:space:]]+[[:space:]]+)*commit([[:space:]]|$|")' || exit 0

git rev-parse --git-dir >/dev/null 2>&1 || exit 0
branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo HEAD)"
[ "$branch" = "HEAD" ] && exit 0

# Resolve protected set.
protected="${REPO_REVIEW_PROTECTED:-}"
if [ -z "$protected" ]; then
  root="$(git rev-parse --show-toplevel 2>/dev/null || echo .)"
  [ -f "$root/.claude/protected-branches" ] && protected="$(cat "$root/.claude/protected-branches")"
fi
[ -z "$protected" ] && protected="main master dev qa prod"

for p in $(printf '%s' "$protected" | tr '|,' '  '); do
  if [ "$branch" = "$p" ]; then
    echo "BLOCKED: refusing to commit directly to protected branch '$branch'." >&2
    echo "Branch off it and open a PR:  git switch -c <type>/<topic>" >&2
    exit 2
  fi
done
exit 0
