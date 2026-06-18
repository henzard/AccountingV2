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

Fill in the project's sync model here so reporters share your mental model, e.g.:
  N replicas ⇄ one hub. Pull = full snapshot (or delta). Conflict resolution =
  <last-write-wins on a wall-clock timestamp | version vector | CRDT | …>.
  State which ordering primitive exists (row_version / vector clock / Lamport /
  none) and whether convergence is claimed.

The whole point of this template is the INTERLEAVING. An "it didn't sync"
report with no ordering of operations is usually not actionable — most
replication defects are interleaving-specific. Fill in the "Failing
interleaving" section even if you have to estimate the order.
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
Order the operations across the participants. Generic example of a lost-update
window (replace with YOUR sequence):

  Participants: Replica A, Replica B, Hub.
    t0  Replica A: snapshot row X = v1 for push (sync cursor marks it pending)
    t1  Replica A: send v1   (network in flight, seconds)
    t2  Replica A: USER EDITS X -> v2 (still pending, newer timestamp)  <-- committed local write
    t3  Replica A: mark-pushed-synced clears the pending flag UNCONDITIONALLY
    t4  Replica A: next push excludes X  -> v2 never sent
    Result: hub + every other replica keep v1; v2 lives only on Replica A. Divergence.
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
- Soft-deleted? <!-- if the schema uses tombstones / deletedAt / isDeleted flags -->

## State on each replica after a quiescent sync round

<!-- After everyone has synced and gone idle — what does each hold? They should be identical (convergence); if not, that's the bug. -->

- Replica A holds:
- Replica B holds:
- Hub holds:

## Closest known issue (if you can tell)

<!-- If the project has a sync-correctness audit, cite its finding id and file
here. Otherwise leave blank. -->

- Related finding id (if any):
- Audit file: <!-- e.g. docs/SYNC-CORRECTNESS-AUDIT.md -->

## Environment

- Version: <!-- release/tag or commit SHA -->
- Number of replicas involved:
- Clock skew between participants, if known: <!-- relevant if conflict resolution is wall-clock LWW -->
- Were pushes chunked/batched across tables when it happened?

## Logs

<!-- Redact tokens / credentials before pasting. -->

```
<paste sync logs / skip counts / skew warnings here>
```

## Regression test it should pin (notes for reviewer)

<!--
The real deliverable is usually a deterministic multi-replica harness with a
virtual clock and fault injection. Which convergence property does your
interleaving become a test for? e.g. "no lost committed write", "delete safety",
"idempotent re-apply", "eventual convergence".
-->
