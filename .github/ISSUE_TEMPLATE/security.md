---
name: Security (already-public hardening note)
about: A low-sensitivity, already-public security hardening note. NOT for live vulnerabilities.
title: 'security: '
labels: security
assignees: ''
---

<!--
Security hardening-note template for AccountingV2.

⚠ STOP if this is a live, exploitable vulnerability.

Do NOT describe an unpatched exploit in a public issue. For anything
exploitable, open a private GitHub Security Advisory instead (linked from the
issue chooser).

Use THIS template only when ALL of these are true:
  - the issue is already public (referenced in a committed audit, a published
    CVE, or otherwise non-sensitive), AND
  - there is no usable exploit detail being newly revealed, AND
  - it is a hardening / follow-up task, not an active incident.
-->

## Confirm this is safe to file publicly

- [ ] This does NOT reveal a new, exploitable, unpatched vulnerability.
- [ ] This is a hardening note / follow-up, or it tracks an issue already
      documented in a committed security audit.
- [ ] I have redacted all tokens, credentials, and secrets.

## Summary

<!-- One or two sentences. -->

## Related audit finding

<!--
If this maps to a known finding, cite its id and the file. If it's new and
you've confirmed it's non-exploitable / already public, say why it's safe to
discuss here.
-->

- Finding id (if any):
- Audit file: <!-- e.g. docs/SECURITY-AUDIT.md -->
- OWASP / CWE (optional):

## Affected surface

- [ ] Supabase Auth / session tokens
- [ ] API keys / service-role secrets
- [ ] Supabase Edge Functions (extract-slip, notify-event)
- [ ] RLS policies / merge RPCs
- [ ] Local SQLite database / AsyncStorage
- [ ] Sync orchestrator (push/pull)
- [ ] Logging / data exposure (POPIA)
- [ ] Other:

## Suggested remediation

<!--
Optional. If the project keeps a remediation log, a fix PR should update it.
Keep it proportionate — prefer the simplest durable fix for the project's size.
-->

## Verification plan

- [ ] Add/extend a test that fails on the insecure behavior and passes after the fix.
- [ ] Test suite green. <!-- TAILOR the command. -->
