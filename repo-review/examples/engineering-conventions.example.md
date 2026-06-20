# NutSync — Engineering Conventions

How we work on NutSync, the human-facing companion to the AI-pointer index in
[`../CLAUDE.md`](../CLAUDE.md). `CLAUDE.md` is the terse, machine-oriented map of
the codebase and the LOCKED invariants; this doc explains the _workflow and the
why_ behind the git discipline, the audit paper-trail, PR sizing, and "done"
verification.

> See the full file in the remote repository for the complete conventions document
> covering: persistence rules, never-lose-work git discipline, audits-before-remediation,
> LOCKED invariants enforcement, branch & PR hygiene, repo-local guard hooks,
> testing bar with anti-patterns, verify-before-done discipline, anti-hallucination
> checks, and scale-up triggers.

## Key sections demonstrated:

1. **Persistence:** the only durable record is committed git
2. **Never lose work** — git discipline
3. **Audits → `docs/` before remediation; docs-as-recovery**
4. **LOCKED invariants are enforced by tests, not by discipline**
5. **Branch & PR hygiene**
6. **Repo-local guard hooks**
7. **Testing bar** (with anti-pattern hard rules)
8. **Verify before "done"**
9. **Before writing code (anti-hallucination)**
10. **Scale-up triggers** (what we are deliberately not doing yet)
