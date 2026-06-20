---
name: Sync data-loss / divergence
about: A committed write was lost, replicas diverged, a delete resurrected, or sync churned. Describe the interleaving.
title: 'sync: '
labels: sync, data-loss
assignees: ''
---

<!--
TAILOR ME — generic replication-correctness template installed by repo-review.
Ship this ONLY if the project actually replicates / syncs data (offline-first
client ⇄ hub, multi-master, edge⇄cloud, CRDT, etc.); otherwise delete it and
remove its entry from config.yml.
-->

## What went wrong

- [ ] A committed write never replicated (lives on one replica only)
- [ ] Two replicas hold different values for the same row — divergence
- [ ] A deleted row came back (delete-update conflict / resurrection)
- [ ] Sync keeps re-broadcasting unchanged rows (churn / write amplification)
- [ ] A row is silently skipped/dropped on apply (constraint collision)
- [ ] Other:

## Failing interleaving (required)

<!--
Order the operations across the participants.
-->

```
t0  <participant>: <operation>  (row id / table / value)
t1  ...
t2  ...
t3  ...
Result: <what ended up where>
```

## Affected table(s) / row(s)

- Table(s) / collection(s):
- Row id(s) / business key:
- Soft-deleted?

## State on each replica after a quiescent sync round

- Replica A holds:
- Replica B holds:
- Hub holds:

## Closest known issue (if you can tell)

- Related finding id (if any):
- Audit file: <!-- e.g. docs/SYNC-CORRECTNESS-AUDIT.md -->

## Environment

- Version: <!-- release/tag or commit SHA -->
- Number of replicas involved:
- Clock skew between participants, if known:
- Were pushes chunked/batched across tables when it happened?

## Logs

<!-- Redact tokens / credentials before pasting. -->

```
<paste sync logs / skip counts / skew warnings here>
```

## Regression test it should pin (notes for reviewer)

<!--
Which convergence property does your interleaving become a test for?
e.g. "no lost committed write", "delete safety", "idempotent re-apply",
"eventual convergence".
-->
