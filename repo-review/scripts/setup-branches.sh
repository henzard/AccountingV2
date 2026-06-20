#!/usr/bin/env bash
# Create the 3-tier dev -> qa -> main branch model off the default branch.
# Idempotent: skips branches that already exist. Run from inside the target repo.
# Usage: scripts/setup-branches.sh
set -euo pipefail
git rev-parse --git-dir >/dev/null 2>&1 || { echo "ERROR: not a git repo"; exit 1; }

DEFAULT=""
if command -v gh >/dev/null 2>&1; then
  DEFAULT="$(gh repo view --json defaultBranchRef -q .defaultBranchRef.name 2>/dev/null || true)"
fi
if [ -z "$DEFAULT" ]; then
  # No gh (or it failed): try the remote HEAD symbolic-ref, then the current
  # local branch, then main. Never assume a branch name that doesn't exist.
  DEFAULT="$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##' || true)"
fi
if [ -z "$DEFAULT" ]; then
  DEFAULT="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
  [ "$DEFAULT" = "HEAD" ] && DEFAULT=""   # detached HEAD is not a usable base
fi
DEFAULT="${DEFAULT:-main}"
echo "Default branch: $DEFAULT"
HAS_ORIGIN=0; git remote get-url origin >/dev/null 2>&1 && HAS_ORIGIN=1
[ "$HAS_ORIGIN" = 1 ] && git fetch origin --quiet || true

# Resolve a concrete starting point for new branches: prefer the remote ref,
# fall back to a local ref of the same name. Empty if neither exists.
base_ref() {
  if [ "$HAS_ORIGIN" = 1 ] && git show-ref --verify --quiet "refs/remotes/origin/$DEFAULT"; then
    echo "origin/$DEFAULT"
  elif git show-ref --verify --quiet "refs/heads/$DEFAULT"; then
    echo "$DEFAULT"
  fi
}

make_branch() {
  local b="$1" base
  if { [ "$HAS_ORIGIN" = 1 ] && git show-ref --verify --quiet "refs/remotes/origin/$b"; } \
       || git show-ref --verify --quiet "refs/heads/$b"; then
    echo "  = $b (exists)"; return
  fi
  base="$(base_ref)"
  if [ -z "$base" ]; then
    echo "  ! $b skipped — base branch '$DEFAULT' not found locally or on origin"; return
  fi
  if ! git branch "$b" "$base" 2>/dev/null; then
    echo "  ! $b could not be created from '$base'"; return
  fi
  if [ "$HAS_ORIGIN" = 1 ] && git push -u origin "$b" >/dev/null 2>&1; then
    echo "  + $b (off $DEFAULT, pushed)"
  else
    echo "  + $b created locally (no 'origin' remote or no write access — push it yourself)"
  fi
}

# dev is the working base; qa is the integration tier; main is release.
make_branch dev
make_branch qa
echo
echo "Tier model: feature -> dev -> qa -> main."
echo "Set dev as the default PR base in setup-branch-protection.sh (or repo settings)."

