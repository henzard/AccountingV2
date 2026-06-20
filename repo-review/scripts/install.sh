#!/usr/bin/env bash
# Install the deep-review scaffolding INTO a target repo (idempotent).
# Copies the portable skills, hooks, settings, and .github/docs templates.
# Re-running is safe: tailored files (settings.json, .github/*, docs, and a
# protected-branches list you've edited) are kept. Kit-authored skills and hooks
# are refreshed to the kit's current version. CLAUDE.md / per-project docs are
# authored by the deep-review skill, not this installer, so are never touched.
#
# Usage: scripts/install.sh /path/to/target-repo [protected-branches]
#   protected-branches: space/pipe list for the commit guard (default "main master dev qa prod")
set -euo pipefail
KIT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${1:?usage: install.sh <target-repo> [protected-branches]}"
# Track whether the caller explicitly passed a branch list ($2). If they didn't,
# we must NOT clobber a protected-branches file they've already tailored.
if [ "$#" -ge 2 ]; then PROTECTED="$2"; PROTECTED_EXPLICIT=1; else PROTECTED="main master dev qa prod"; PROTECTED_EXPLICIT=0; fi
[ -d "$TARGET/.git" ] || { echo "ERROR: $TARGET is not a git repo"; exit 1; }

copy() { mkdir -p "$(dirname "$2")"; if [ -e "$2" ]; then echo "  = ${2#$TARGET/} (kept existing)"; else cp "$1" "$2"; echo "  + ${2#$TARGET/}"; fi; }

echo "Installing deep-review kit → $TARGET"

# skills (generic only — release/flow-edit live in examples/skills and are NOT
# auto-installed). Copy the whole skill dir so any supporting files come along.
for d in "$KIT"/skills/*/; do [ -d "$d" ] || continue; s="$(basename "$d")"; \
  if [ -d "$TARGET/.claude/skills/$s" ]; then verb="↻ refreshed"; else verb="+ added"; fi; \
  mkdir -p "$TARGET/.claude/skills/$s"; \
  cp -R "$d." "$TARGET/.claude/skills/$s/"; echo "  $verb .claude/skills/$s (kit-authored)"; done

# hooks (parameterised) + settings
mkdir -p "$TARGET/.claude/hooks"
cp "$KIT/hooks/git-commit-guard.sh" "$TARGET/.claude/hooks/"
cp "$KIT/hooks/git-push-warn.sh"    "$TARGET/.claude/hooks/"
chmod +x "$TARGET/.claude/hooks/"*.sh
# protected-branches is user-tailorable: write it on first install, or whenever
# the caller explicitly passed a branch list ($2). If it already exists and no
# list was given, keep the tailored file so re-runs don't clobber it.
if [ -f "$TARGET/.claude/protected-branches" ] && [ "$PROTECTED_EXPLICIT" = 0 ]; then
  echo "  + .claude/hooks/* (= .claude/protected-branches kept: $(cat "$TARGET/.claude/protected-branches"))"
else
  echo "$PROTECTED" > "$TARGET/.claude/protected-branches"
  echo "  + .claude/hooks/* + .claude/protected-branches ($PROTECTED)"
fi

if [ ! -f "$TARGET/.claude/settings.json" ]; then
cat > "$TARGET/.claude/settings.json" <<'JSON'
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash", "hooks": [
        { "type": "command", "command": "\"$CLAUDE_PROJECT_DIR/.claude/hooks/git-commit-guard.sh\"" },
        { "type": "command", "command": "\"$CLAUDE_PROJECT_DIR/.claude/hooks/git-push-warn.sh\"" }
      ] }
    ]
  }
}
JSON
echo "  + .claude/settings.json"
else echo "  = .claude/settings.json (kept existing — add the two hooks manually if needed)"; fi

# github templates
copy "$KIT/templates/.github/pull_request_template.md" "$TARGET/.github/pull_request_template.md"
for f in "$KIT"/templates/.github/ISSUE_TEMPLATE/*; do
  [ -e "$f" ] || continue   # empty/missing dir: skip rather than copy the literal glob
  copy "$f" "$TARGET/.github/ISSUE_TEMPLATE/$(basename "$f")"
done
copy "$KIT/templates/.github/workflows/ci.yml.tmpl" "$TARGET/.github/workflows/ci.yml"
copy "$KIT/templates/docs/adr/0000-template.md" "$TARGET/docs/adr/0000-template.md"

echo
echo "Installed (Phase 7 scaffolding ONLY — not a scored audit)."
echo "  ✓ skills, hooks, templates, CI template, ADR template"
echo "  ✗ NO findings.json, NO docs/audit-report.html, NO 0–100 score yet"
echo
echo "Next:"
echo "  1) Review .github/workflows/ci.yml — tailor steps to THIS repo's test runner."
echo "  2) Run /deep-review (Phases 0–5, 9–10) OR manually:"
echo "       - capture coverage + file findings as GitHub issues"
echo "       - score with rubric.md → findings.json"
echo "       - node scripts/generate-report.mjs findings.json > docs/audit-report.html"
echo "     See docs/scaffolding-vs-full-review.md and examples/report.sample.html"
echo "  3) scripts/setup-branches.sh && setup-branch-protection.sh (or rulesets) <owner/repo>"
