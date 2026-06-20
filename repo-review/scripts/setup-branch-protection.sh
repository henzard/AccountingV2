#!/usr/bin/env bash
# Apply branch-protection policies to main / qa / dev via the GitHub API.
# Requires admin on the repo. Idempotent (PUT replaces the rule).
# Usage: scripts/setup-branch-protection.sh [owner/repo] [ci-check-name]
#   ci-check-name: the required status check job (default "test")
set -euo pipefail
command -v gh >/dev/null 2>&1 || { echo "ERROR: gh (GitHub CLI) not found on PATH"; exit 1; }
REPO="${1:-}"
if [ -z "$REPO" ]; then
  REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || true)"
  [ -n "$REPO" ] || { echo "ERROR: no owner/repo given and 'gh repo view' failed (not in a GitHub repo, or 'gh auth status' is not green)."; exit 1; }
fi
CHECK="${2:-test}"
echo "Branch protection -> $REPO (required check: $CHECK)"

# The PUT .../branches/<b>/protection endpoint requires ALL of
# required_status_checks, enforce_admins, required_pull_request_reviews and
# restrictions to be PRESENT in the body, each either a proper object or null.
# restrictions must be null (not "") on non-org / when unrestricted. We build a
# valid JSON body and pipe it via `gh api --input -` so booleans/null/arrays
# keep their real JSON types (mixing -f/-F bracket syntax stringifies booleans).
protect() {
  local branch="$1" reviews="$2" pr_reviews err
  if [ "$reviews" -gt 0 ]; then
    pr_reviews="{\"required_approving_review_count\":$reviews,\"dismiss_stale_reviews\":true}"
  else
    # Still require a PR (no direct pushes) but no mandatory approvals (e.g. dev).
    pr_reviews="{\"required_approving_review_count\":0,\"dismiss_stale_reviews\":false}"
  fi
  if err="$(gh api -X PUT "repos/$REPO/branches/$branch/protection" \
       -H "Accept: application/vnd.github+json" \
       --input - 2>&1 >/dev/null <<JSON
{
  "required_status_checks": { "strict": true, "contexts": ["$CHECK"] },
  "enforce_admins": false,
  "required_pull_request_reviews": $pr_reviews,
  "restrictions": null,
  "required_linear_history": false,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_conversation_resolution": true
}
JSON
  )"; then
    echo "  + protected $branch (reviews=$reviews, CI=$CHECK)"
  else
    echo "  ! could not protect $branch (branch missing, not admin, or repo is private/free without protection)"
    [ -n "$err" ] && echo "$err" | head -3 | sed 's/^/      gh: /'
  fi
}

# Protect the repo's ACTUAL default branch (main OR master OR …), not a hardcoded name.
DEFAULT="$(gh api "repos/$REPO" --jq .default_branch 2>/dev/null || echo main)"
protect "$DEFAULT" 1
protect qa   1
protect dev  0

# Make dev the default working base (optional; comment out to keep the current default).
if gh api -X PATCH "repos/$REPO" -f default_branch=dev >/dev/null 2>&1; then
  echo "  + default branch set to dev"
else
  echo "  = default branch unchanged (dev may not exist yet, or insufficient perms)"
fi

echo "done. Policy: no direct pushes to protected branches; PR + green '$CHECK' required."
