#!/usr/bin/env bash
# Create the severity + domain label set used by the deep-review pipeline.
# Usage: scripts/bootstrap-labels.sh [owner/repo]   (defaults to the current repo)
set -euo pipefail
command -v gh >/dev/null 2>&1 || { echo "ERROR: gh (GitHub CLI) not found on PATH"; exit 1; }
REPO="${1:-}"
if [ -z "$REPO" ]; then
  REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || true)"
  [ -n "$REPO" ] || { echo "ERROR: no owner/repo given and 'gh repo view' failed (not in a GitHub repo, or 'gh auth status' is not green)."; exit 1; }
fi

# --force upserts: creates the label or updates colour/description if it exists,
# so re-runs are idempotent. A genuine failure (bad auth, repo not found) is
# reported instead of being silently swallowed as "(exists)".
create() {
  if gh label create "$1" --color "$2" --description "$3" -R "$REPO" --force >/dev/null 2>&1; then
    echo "  + $1"
  else
    echo "  ! $1 (failed — check 'gh auth status' and repo access)"
  fi
}

echo "Labels → $REPO"
# severity
create "sev:critical" "b60205" "Exploitable / data-loss / systemic"
create "sev:high"     "d93f0b" "Serious; fix before release"
create "sev:medium"   "fbca04" "Should fix"
create "sev:low"      "0e8a16" "Minor / hardening"
create "sev:info"     "c5def5" "Informational"
# priority
create "priority:p0"  "b60205" "Drop everything"
create "priority:p1"  "d93f0b" "This cycle"
create "priority:p2"  "fbca04" "Backlog"
# domains
create "security"      "d73a4a" "Security finding"
create "sync"          "b60205" "Replication / eventual-consistency"
create "api"           "1d76db" "API design / contract"
create "database"      "0e8a16" "Schema / indexing / migrations"
create "code-quality"  "5319e7" "SOLID / smells / maintainability"
create "tests"         "1d76db" "Coverage / authenticity"
create "ux"            "c2e0c6" "UX / accessibility"
create "design-system" "fbca04" "UI consistency / tokens"
create "anti-pattern"  "d93f0b" "Named anti-pattern violation"
create "tech-debt"     "ededed" "Tracked debt"
echo "done."

