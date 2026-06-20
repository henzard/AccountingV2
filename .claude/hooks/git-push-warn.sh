#!/usr/bin/env bash
# PreToolUse(Bash) ADVISORY — WARN (never block) on `git push` of a feature branch
# that has no open PR yet (no-orphan-branches nudge). ALWAYS exits 0.
#
# Warn-only on purpose: PR-bootstrap flows push before the PR exists, promotion
# flows push to protected branches, and `gh pr list` can rate-limit / be slow —
# a blocking network dependency is itself a false-positive source.
set -euo pipefail
payload="$(cat 2>/dev/null || true)"

cmd=""
if command -v jq >/dev/null 2>&1; then
  cmd="$(printf '%s' "$payload" | jq -r '.tool_input.command // .params.command // empty' 2>/dev/null || true)"
fi
# jq-free fallback: extract "command":"..." from the raw JSON so the boundary regex
# sees the real command (where `git` is preceded by a quote in the envelope).
if [ -z "$cmd" ]; then
  cmd="$(printf '%s' "$payload" | sed -n 's/.*"command"[[:space:]]*:[[:space:]]*"\(\([^"\\]\|\\.\)*\)".*/\1/p' | head -n1 || true)"
fi
[ -z "$cmd" ] && cmd="$payload"

printf '%s' "$cmd" | grep -Eq '(^|[;&|"'"'"']|[[:space:]])git[[:space:]]+(-[^ ]+[[:space:]]+|[^ ]+=[^ ]+[[:space:]]+)*push([[:space:]]|$|")' || exit 0
git rev-parse --git-dir >/dev/null 2>&1 || exit 0
branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo HEAD)"

# Exempt protected/default branches (promotion + bootstrap pushes are expected).
protected="${REPO_REVIEW_PROTECTED:-}"
if [ -z "$protected" ]; then
  root="$(git rev-parse --show-toplevel 2>/dev/null || echo .)"
  [ -f "$root/.claude/protected-branches" ] && protected="$(cat "$root/.claude/protected-branches")"
fi
[ -z "$protected" ] && protected="main master dev qa prod"
for p in $(printf '%s' "$protected" | tr '|,' '  '); do [ "$branch" = "$p" ] && exit 0; done
[ "$branch" = "HEAD" ] && exit 0

if command -v gh >/dev/null 2>&1; then
  open="$(gh pr list --head "$branch" --state open --json number -q 'length' 2>/dev/null || echo "")"
  if [ "$open" = "0" ]; then
    echo "NOTE: '$branch' has no open PR yet — open one so the work isn't orphaned (no-orphan-branches rule)." >&2
  fi
fi
exit 0
