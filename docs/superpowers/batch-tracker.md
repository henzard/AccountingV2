# Issue Remediation Batch Tracker

**Total issues:** 65 (#41–#105)  
**Batch size:** 5  
**QA baseline:** 239 suites · 2023 tests · all green (2026-06-20)

## Issue closure status

| Status     | Count  | Notes                                |
| ---------- | ------ | ------------------------------------ |
| **Closed** | **5**  | Batch 1: #88–#92 (SEC-RT-001–005)    |
| **Open**   | **60** | Batch 2 in PR; #97 HUMAN (SQLCipher) |
| **HUMAN**  | **1**  | #97 SEC-RT-010 — local DB encryption |

## PR / CI / CodeRabbit

| PR             | Status                                    |
| -------------- | ----------------------------------------- |
| #39, #40, #106 | **Merged** — CI green, 0 CR threads       |
| Batch 2        | `fix/batch2-security-hardening` — pending |

## Batches

| Batch | Issues                 | GitHub       | Status                   |
| ----- | ---------------------- | ------------ | ------------------------ |
| 1     | SEC-RT-001–005         | #88–#92      | **Done** (migration 019) |
| 2     | SEC-RT-006–009, 011    | #93–#96, #98 | **In PR** — #97 → HUMAN  |
| 3     | SEC-RT-012–014 + 2 TBD | #99–#101     | queued                   |
| …     | 13 batches total       |              |                          |

## HUMAN escalations

| Issue          | Reason                                                                          |
| -------------- | ------------------------------------------------------------------------------- |
| #97 SEC-RT-010 | SQLCipher + Android Keystore + DB migration path — needs native/security review |

## Process (each batch)

1. Brainstorm → spec in `docs/superpowers/specs/`
2. writing-plans → plan in `docs/superpowers/plans/`
3. Implement on `fix/batchN-*` branch
4. `npm test` green (qa-lead gate)
5. Open PR → CI green → CR threads 0 → merge
6. **Close all 5 GitHub issues** with migration/PR evidence (batch 1 gap fixed retroactively)

## PM loop

Every 15m: open PR CI, CR thread count, batch progress, test suite, next batch readiness.
