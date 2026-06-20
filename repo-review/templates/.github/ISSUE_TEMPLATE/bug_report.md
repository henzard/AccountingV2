---
name: Bug report
about: Something in the project behaves incorrectly
title: 'bug: '
labels: bug
assignees: ''
---

<!--
TAILOR ME — generic bug template installed by repo-review.
Adjust the platform checkboxes, the run/test commands, and the doc paths below
to THIS repo before relying on it.

Before filing:
- Is this a SECURITY issue (auth, credentials, injection, access bypass)?
  Do NOT use this template — open a private Security Advisory instead.
- If the project replicates / syncs data and this is a data-loss or divergence
  issue, use the dedicated data-loss template (if present) — it asks for the
  failing interleaving.
-->

## What happened

<!-- One or two sentences. What did you observe? -->

## What you expected

<!-- What should have happened instead? -->

## Steps to reproduce

1.
2.
3.

## Where it happens

<!-- TAILOR: replace with the surfaces this repo actually ships. -->

- [ ] Application / main runtime
- [ ] A secondary build or platform target
- [ ] Tests / CI
- [ ] Other:

## Environment

- Version: <!-- release/tag, build number, or commit SHA -->
- Platform / OS:
- Relevant mode/config: <!-- e.g. online vs offline, env, feature flag -->

## Logs / errors

<!--
Paste the error, stack trace, or console output. REDACT any tokens,
Authorization headers, credentials, or secrets before pasting — they must
never appear in a public issue.
-->

```
<paste here>
```

## Suspected area / notes for reviewer

<!--
Optional. If you have a guess (a module, a screen, a service boundary), say so.
If this contradicts a committed audit/decision doc (`docs/*-AUDIT-*.md`, an ADR),
link it — the fix PR should update that doc in the same change.
-->
