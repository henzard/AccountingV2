---
name: weighsoft-sync-safety
formerly: sync-safety
description: >-
  Use when touching ANY replication / offline-first / multi-writer sync code —
  push/pull, apply-merge, the "what's unsynced" cursor, mark-synced, conflict
  resolution (last-write-wins), soft-delete/tombstones, INSERT OR IGNORE /
  UPSERT, or any code that moves committed writes between replicas (edge↔hub,
  client↔server, peer↔peer). Encodes replication-correctness rules so a change
  cannot silently lose or fail to replicate a committed write. Triggers on edits
  to sync engines, merge logic, dirty-flag cursors, LWW comparisons, tombstone
  handling, or idempotent-apply paths.
---

# weighsoft-sync-safety — replication-correctness guard

> 🔁 **Renamed:** this skill is now **weighsoft-sync-safety** (formerly **sync-safety**). Update any references; other systems keying off the old name should rename to match.

Use this skill whenever your change moves a **committed write between replicas**:
offline-first edge ⇄ hub, client ⇄ server, device ⇄ device, or any system that
lets more than one writer mutate the same logical row and later reconciles them.
The promise of such a system is **convergence**: after any interleaving of writes
and sync rounds, every replica reaches the same state and **no committed write is
ever silently dropped**. That promise is fragile, and most sync bugs are silent —
they don't crash, they just quietly lose or fail to propagate a write. This skill
exists to make a replication change _prove_ it didn't.

Treat every replication change as **never-lose-work**: small, tested, and justified
against the rules below. The rules are stack-agnostic — they hold whether your
store is SQLite, Postgres, a key-value log, or a flow-based hub, and whether
ordering is by timestamp, a version counter, or a vector clock.

## When this skill is active

You are editing any code that does one of:

- **Selects what to push** — the "unsynced" / "dirty" cursor (e.g. `WHERE
synced_at IS NULL`, a dirty flag, an outbox query).
- **Marks rows as synced** — clears the dirty flag after a push.
- **Applies an incoming change** — the merge/apply path on the receiving side
  (UPSERT, `INSERT OR IGNORE`/`OR REPLACE`, id-keyed UPDATE).
- **Resolves conflicts** — last-write-wins, "newest wins", any `isNewer`-style
  comparison.
- **Handles deletes** — soft-delete columns / tombstones and how they merge.
- **Orchestrates a round** — push/pull, snapshot, retry.

If so: **find and read the system's own sync-correctness audit / design doc first**
(if one exists). Don't reason from this summary alone — the real interleavings,
the table list, and the regression targets live in the project's docs. Cite the
concrete location you're changing (file:line, function name, or — for flow/visual
runtimes that have no line numbers — the node name) in your reasoning and commit.

## The seven non-negotiable rules

### R1 — Never drop a write on a constraint hit without journaling it

A blind `INSERT OR IGNORE` / `INSERT ... ON CONFLICT DO NOTHING` on a merge path
silently discards an incoming row whenever a UNIQUE / NOT NULL / FK constraint
fires. If the collision is **persistent** (a real duplicate-key clash, not a
transient ordering issue), that row is dropped **forever** on that replica →
permanent divergence and silent loss of a committed write. A bare "skipped count"
is not a fix — you can't retry or inspect a number.

Rule: if you add, keep, or move any conflict-swallowing insert, you MUST durably
**journal what was dropped** — a dead-letter record (`table, id, reason,
payload, first_seen, attempts`) that is inspectable and retryable, not a counter.
For identity-bearing rows, prefer **merge-to-existing-id** (remap to the row that
already exists) over dropping. The tables most at risk are those reconciled with
no natural-key matcher (no "match by name / external id") — never put a new such
table on the silent-ignore path without a dead-letter.

### R2 — Clearing the dirty flag must be guarded by the value you pushed

The classic lost-update: snapshot dirty row X (=v1) → push of v1 takes time over
the network → user edits X→v2 (still dirty) → the push completes and you mark X
"synced" **unconditionally by id** → the next snapshot excludes X because its
flag is clear → **v2 never pushes.** Permanent divergence of a committed write.

Rule: only clear the dirty flag for the **exact version you actually pushed**.
Guard the update with the value captured **at snapshot time**, not at mark time —
e.g. `... WHERE id = ? AND updated_at = ?` with the per-row `updated_at` you
snapshotted, or `... WHERE row_version = <snapshot_version>` with a monotonic
counter bumped on every write. Never mark synced by `id` alone.

### R3 — Conflict ordering should be monotonic, not wall-clock

Last-write-wins on a wall-clock timestamp has three failure modes: a **fast/skewed
clock** always wins (a stale write beats a fresh one); **coarse resolution**
(second-granularity) makes ties common; and a `>=` comparison favors whatever is
_arriving_, so a tie's winner depends on merge **direction**, not write **order** —
a concurrent edit on the other replica is silently lost.

Rule: don't deepen a wall-clock dependency. Move ordering toward a **monotonic
per-row version** (bumped on every local write; an authoritative side may assign a
global sequence) and resolve by `(version, then a stable tiebreaker like
replica_id)` for a total order — keep the timestamp as a display value only. Where
you genuinely need "newest" to track real time _and_ survive skew, a **Hybrid
Logical Clock (HLC)** — physical time fused with a Lamport counter — gives a
monotonic, causality-respecting timestamp that never goes backwards under skew;
this is what production LWW systems (e.g. CockroachDB) use instead of raw
wall-clock. The minimum acceptable fix for a small change: add a
**direction-independent** tiebreaker and sub-second (or counter-based) precision so
identical inputs always pick the same winner on every replica. (Plain LWW silently
drops a genuinely concurrent edit — if losing the other writer's work is
unacceptable, the correct structure is a CRDT or sibling-keeping merge, not a
cleverer timestamp. [LWW pitfalls][lww], [HLC][hlc])

### R4 — Delete-wins on delete-vs-update; tombstones are monotonic

With soft-deletes pushed as ordinary dirty rows, a concurrent **non-delete update
with a newer timestamp overwrites the delete marker → the row resurrects.** Absent
an explicit rule, full-row LWW will undo deletions.

Rule: treat a tombstone (`deleted_at` / `is_deleted`) as **monotonic**: once set,
an incoming non-deleted row must NOT clear it merely because it has a newer
timestamp — only an explicit un-delete carrying a **higher version** may revive
the row. **Default to delete-wins.** Any change to merge logic must preserve this
(and add it if it's still missing). Decide and document a tombstone retention /
GC policy so tombstones don't accumulate unbounded.

### R5 — Apply must be idempotent on every side

A push/pull **retry** is normal on a flaky link. If applying the same change twice
isn't a no-op, retries cause damage. The common bug: the receiver **re-stamps**
the row's `updated_at` to _its own_ clock on every apply, so a retry makes the row
look newer and re-broadcasts unchanged data to every other replica (**sync
amplification** — a feedback loop of pointless traffic and spurious "newest wins"
flips).

Rule: applying the same incoming change twice must yield **identical state and no
timestamp/version churn**. Drive the stored timestamp from the incoming row's own
value (don't re-stamp to "now"), and make apply a no-op when
`incoming.version <= stored.version`. Never bump a version/timestamp on an apply
that didn't change content. This is the **idempotent-consumer** pattern: real links
deliver **at-least-once**, so "exactly-once effect" is only ever achieved by a
receiver that dedupes — key apply by `(row_id, version)` (or an event/idempotency
key) and treat a re-delivery as a no-op. ([idempotent consumer][idem])

### R6 — Preserve atomicity; never silently swallow non-constraint errors

A merge should apply as **one transaction** (BEGIN → ordered per-table apply →
COMMIT, with ROLLBACK on any throw) under whatever write-serialization the store
has (a mutex/lock if needed). Apply parents before children so a child row is
never dropped for arriving before its parent. Atomicity is often the _one_ property
a shaky sync system still gets right — don't break it.

Rule: keep every merge inside one transaction. **Re-throw any non-constraint
error** so the whole batch rolls back — never widen a swallow-and-skip path beyond
the explicitly journaled R1 case. If you only _count_ a problem (e.g. orphaned
children whose parent never arrived), that's a latent loss: repair it, re-request
the missing parent, or dead-letter it — don't just increment a number.

### R7 — Every replication change needs a property test — the real deliverable

A replication change is **not done** until the relevant property is asserted by an
automated test that simulates two (or more) replicas, a virtual clock, and fault
injection. Build a small model (two in-memory replicas + a clock you control + a
"deliver / drop / duplicate / reorder" message bus) and assert:

1. **Convergence** — any random interleaving of writes + sync rounds → byte-identical
   replicas after quiescence. (If the system is known to fail this today, encode the
   specific case you're fixing as the regression target.)
2. **No lost write (R2)** — inject a local write _between_ snapshot and mark-synced;
   assert it still replicates.
3. **Drop journaling (R1)** — force a UNIQUE/NOT NULL collision on every reconciled
   table; assert no row vanishes silently (dead-letter populated + reconciled).
4. **Idempotent apply (R5)** — apply the same push/pull twice; assert identical state
   and zero timestamp/version churn.
5. **Crash-resume** — kill mid-merge and mid-mark-synced; assert atomic recovery, no
   double-apply.
6. **Delete safety (R4)** — concurrent delete vs update; assert the row stays deleted
   (or follows your defined, tested un-delete rule).
7. **Clock-skew (R3)** — replicas at ±N min skew; assert the later _real_ write wins.
8. **Ordering** — deliver children before parents; assert no orphan survives a full
   round.
9. **Tie-breaking** — identical timestamps on two replicas; assert one deterministic,
   **direction-independent** winner.

Match the property to your change: touching the conflict comparison → at least 7+9;
touching mark-synced/the cursor → 2+5; touching the merge/insert path → 1+3+8;
touching delete columns → 6. For a flow-based / visual-runtime hub (no line numbers),
add the idempotency/tie assertion to that runtime's own test harness.

## Workflow (proportionate never-lose-work)

1. **Read** the system's sync-correctness audit / design doc before opening the file.
2. **Locate** which rule(s) your diff touches; re-read the exact code (file:line, or
   the node name for a flow runtime).
3. **Implement** obeying R1–R6; cite the audit finding you're guarding in a code
   comment where you change the landmine.
4. **Test** per R7 — add/extend the property test; run the real suite to green.
5. **Branch + commit + push every step** — branch off the default branch, never
   commit straight to a protected tier, never leave an orphan branch. End commit
   messages with the project's required trailer (if any).
6. **Record findings in docs/** — if you discover a _new_ replication defect, append
   it to the project's sync-correctness audit (or a dated sibling), ranked by the
   audit's convention: **silent committed-write loss = Critical.**

## Four anti-patterns to reject on sight

- **Conflict-swallowing insert without a dead-letter** — silent permanent loss (R1).
- **Unconditional mark-synced by id** — the lost-update window (R2).
- **A new wall-clock comparison, or a tiebreaker that depends on merge direction** —
  stale-write-wins / lost concurrent edit (R3).
- **Re-stamping `updated_at = now` on apply, or a non-delete clearing a tombstone** —
  sync amplification (R5) / resurrection (R4).

---

> **Worked example (adapt, don't copy).** In one offline-first system (a local-DB
> client syncing to a central hub), a real audit found every one of the above. Names
> below are placeholders for whatever the target repo calls its merge/cursor helpers:
> the apply-merge routine did `INSERT OR IGNORE` and dropped rows to a bare counter
> (R1); a mark-synced step ran `UPDATE ... SET synced_at = ? WHERE id IN (...)`
> unconditionally and lost a write edited mid-push (R2); the "is-newer" comparison
> compared a wall-clock string with `>=`, so the winner depended on merge direction
> (R3); soft-deletes were resurrected by a later non-delete update (R4); and the hub
> re-stamped `updated_at` to its own clock on every apply, amplifying retries across
> all devices (R5). The fix in each case was exactly the corresponding rule above,
> with a two-replica property test as the deliverable. **Your system's specifics will
> differ — find its audit, map its code to R1–R7, and prove the fix with the matching
> property test.**

---

Sources / further reading:
[lww]: https://oneuptime.com/blog/post/2026-01-30-last-write-wins/view "Last-Write-Wins — why raw wall-clock LWW loses concurrent writes"
[hlc]: https://www.cockroachlabs.com/blog/living-without-atomic-clocks/ "Hybrid Logical Clocks — monotonic, skew-tolerant ordering (CockroachDB)"
[idem]: https://microservices.io/patterns/communication-style/idempotent-consumer.html "Idempotent Consumer — dedupe under at-least-once delivery"
