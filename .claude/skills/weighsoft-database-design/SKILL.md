---
name: weighsoft-database-design
formerly: database-design
description: Enforces disciplined schema design — snake_case singular tables, 3NF by default, DB-level FK constraints with explicit ON DELETE, NOT NULL defaults, DECIMAL/integer-cents for money (never FLOAT), UTC timestamps, indexed FKs/filters, reversible one-change migrations, soft deletes for user data, and the SQLite/Supabase specifics including Row Level Security — and rejects EAV, CSV-in-a-column, missing constraints, and float money. Use when designing tables, writing migrations, choosing keys/types, or reviewing a schema change.
version: 1.0.0
category: database
tags:
  - schema-design
  - normalization
  - foreign-keys
  - money-decimal
  - migrations
  - row-level-security
  - sqlite
  - supabase
  - soft-delete
---

# weighsoft-database-design — the schema enforces the invariants, not the app

> 🔁 **Renamed:** this skill is now **weighsoft-database-design** (formerly **database-design**). Update any references; other systems keying off the old name should rename to match.

The database is the last line of defense for data integrity; constraints in the schema hold
even when application code has a bug, so put them there.

> **Constraints live in the database. NOT NULL, FOREIGN KEY, and money-as-DECIMAL are not
> optional decorations — they are how corruption is prevented at the source.** ([3NF][nf], [PG design][pg])

## The rules

### Naming & structure

- **snake_case throughout** — tables, columns, constraints, indexes.
- **SINGULAR table names** — `user`, not `users`; `order_item`, not `order_items`.
- **FKs follow `<referenced_table>_id`** — `user_id`, `order_id`.
- **Booleans use `is_` / `has_` / `can_`** — `is_active`, `has_paid`, `can_edit`.
- **Normalize to 3NF by default** — eliminate transitive dependencies; denormalize only with a
  measured read-heavy reason (e.g. read:write ratio > ~10:1) recorded as a decision. ([3NF][nf])

### Primary keys & relationships

- **Internal tables:** auto-increment `BIGINT` primary key.
- **Distributed / API-exposed IDs:** `UUID` (don't leak sequential counts or invite enumeration).
- **Always declare DB-level `FOREIGN KEY` constraints** with an **explicit `ON DELETE`** behavior
  (`CASCADE` / `RESTRICT` / `SET NULL`) — never leave it implicit.
- **Relationship shapes:** one-to-many ⇒ FK on the many side; many-to-many ⇒ a junction table;
  one-to-one ⇒ FK with a `UNIQUE` constraint.

### Data integrity

- **`NOT NULL` by default** — a column is nullable only when "unknown" is a real, intended state.
- **Money is `DECIMAL`/`NUMERIC` (or integer cents) — NEVER `FLOAT`/`DOUBLE`.** Binary floats
  can't represent 0.10 exactly; rounding errors compound across sums. Integer cents are smallest
  and fastest for a single currency; `NUMERIC` wins when you need fractional cents or high
  precision. **Multi-currency: store the currency code alongside the amount** — a number without
  its unit is a bug waiting to happen. ([PG design][pg], [money in Postgres][money])
- **Timestamps are UTC-aware** (`timestamptz` in Postgres); store UTC, convert at the edge.
- **Index FKs and query-critical columns** (filters, joins, sort keys) — but don't blind-index
  every column; each index taxes writes.

### Migrations

- **Every schema change ships as a reversible migration file** — no manual prod DDL.
- **One logical change per migration;** descriptive name (`add_deleted_at_to_order`).
- **Expand → migrate → contract for any breaking change:** (1) **expand** — add the new
  column/table, only ever additive, old and new coexist; (2) **migrate** — backfill in batches
  (~1k–10k rows, sleep between) while new writes dual-write; (3) **contract** — drop the old
  column only after the new code has drained in-flight requests. Each phase deploys and reverses
  independently; a destructive rollback is the last resort, not the plan. ([PG best practices][pgb], [zero-downtime migrations][zdm])
- **Use the lock-light DDL forms on big tables:** add a constraint `NOT VALID` (no scan) then
  `VALIDATE CONSTRAINT` (ShareUpdateExclusiveLock, not ACCESS EXCLUSIVE); `CREATE INDEX
CONCURRENTLY` to avoid blocking writes. ([zero-downtime migrations][zdm])

### Soft deletes

- **Prefer soft deletes for user data** via a `deleted_at timestamptz NULL`; filter it out in
  queries (or a view). Hard-delete only where retention rules or PII law require it.

### SQLite & Supabase specifics

- **SQLite:** use `INTEGER PRIMARY KEY AUTOINCREMENT`; store money as **integer cents**;
  enable `PRAGMA foreign_keys = ON` (off by default — constraints are silently ignored otherwise).
- **Supabase / Postgres:** all the standard rules **plus Row Level Security** — enable RLS and
  write explicit policies; a missing or too-restrictive policy _fails closed_ (safe), whereas a
  forgotten `WHERE` in app-side queries _leaks_ — that fail-safe is the point of RLS. Use
  realtime where it fits. ([RLS guide][rls])
- **Shared schema definition** generates both targets — keep one source of truth, not two
  hand-synced schemas that drift.

## Anti-patterns to reject

- **Money as `FLOAT`/`DOUBLE`** — WHY: floats can't represent decimal fractions exactly; cents
  vanish and totals disagree. Use `DECIMAL` or integer cents. ([PG design][pg])
- **Entity-Attribute-Value tables** — WHY: trades the relational model for a key/value soup; no
  type safety, no FK integrity, unusable query plans.
- **Comma-separated values in one column** (`tags = "a,b,c"`) — WHY: unindexable, unjoinable,
  breaks 1NF; use a junction table.
- **Missing DB-level constraints** ("the app validates it") — WHY: app bugs, concurrent writers,
  and ad-hoc scripts all bypass app validation; only the schema holds universally.
- **Implicit `ON DELETE`** — WHY: leaves orphan rows or surprise cascades; the deletion behavior
  must be a deliberate choice.
- **`FLOAT` timestamps or naive local-time storage** — WHY: DST and timezone ambiguity corrupt
  ordering and arithmetic; store `timestamptz` UTC.
- **Supabase table with RLS disabled** — WHY: every authenticated client can read/write every
  row; RLS-off is a tenant-isolation breach waiting to happen. ([RLS guide][rls])

## How it composes with the kit

- **add-feature** Phase 4's `weighsoft-database-design` row checks the plan against exactly these rules
  (3NF, FK+ON DELETE, NOT NULL default, DECIMAL money, indexed FKs, reversible migration,
  soft-delete, no EAV/CSV).
- **architecture-and-design** keeps the DB schema distinct from domain entities and DTOs — this
  skill governs the storage model that those map _to_, not the domain model itself.
- **qa-lead / security-review** target multi-tenant isolation; RLS policies and FK constraints
  here are what their tests assert against (a row that escapes RLS is a finding).
- **verification-quality** requires the migration to actually run forward _and_ back in a real
  DB before "done" — a migration asserted but never applied is not evidence.

## Conformance checklist

- [ ] snake*case, singular table names; FKs named `<table>_id`; booleans `is*/has*/can*`
- [ ] 3NF (or denormalization recorded with a measured reason)
- [ ] Every FK is a DB-level constraint with an explicit `ON DELETE`
- [ ] `NOT NULL` default; nullable only where "unknown" is intended
- [ ] Money is `DECIMAL`/integer-cents, never `FLOAT`; currency code stored with multi-currency amounts; timestamps UTC-aware
- [ ] FKs and query-critical columns indexed; no blind indexing
- [ ] Change is a single reversible migration with a descriptive name; breaking changes go expand→migrate→contract (NOT VALID/CONCURRENTLY on big tables)
- [ ] User data soft-deletes via `deleted_at`; SQLite `PRAGMA foreign_keys=ON`; Supabase RLS enabled with policies

## Quick reference

```text
snake_case · SINGULAR tables (user) · FK = <table>_id · booleans is_/has_/can_ · 3NF default.
Keys: BIGINT internal, UUID for API/distributed. FK constraints always + explicit ON DELETE.
NOT NULL default. Money = DECIMAL or integer cents, NEVER float (+currency code if multi-currency). Timestamps = UTC (timestamptz).
Index FKs + filter columns; don't blind-index. Soft delete user data via deleted_at.
Migrations: reversible, one logical change, descriptive. Breaking ⇒ expand → migrate (batch backfill) → contract.
Big-table DDL: constraint NOT VALID then VALIDATE; CREATE INDEX CONCURRENTLY. Flag the cutover.
SQLite: INTEGER PK AUTOINCREMENT · cents · PRAGMA foreign_keys=ON. Supabase: RLS ON + policies.
Reject: EAV · CSV-in-column · missing constraints · float money · RLS off.
```

**The gate, one line:** _the schema itself enforces the invariants — singular snake_case, 3NF,
FK constraints with explicit ON DELETE, NOT NULL defaults, DECIMAL money, UTC timestamps,
reversible migrations, soft deletes, and RLS on — so corruption is impossible even when the
app has a bug._

---

Sources / further reading:
[nf]: https://en.wikipedia.org/wiki/Third_normal_form "Third Normal Form — eliminate transitive dependencies; 3NF as the production target"
[pg]: https://www.tigerdata.com/learn/guide-to-postgresql-database-design "Guide to PostgreSQL Database Design — constraints, types, DECIMAL for money, indexing"
[pgb]: https://www.instaclustr.com/education/postgresql/top-10-postgresql-best-practices-for-2025/ "Top 10 PostgreSQL Best Practices 2025 — forward-only/additive migrations, flag the cutover"
[money]: https://www.crunchydata.com/blog/working-with-money-in-postgres "Working with Money in Postgres — NUMERIC vs integer cents trade-off, store currency alongside the amount"
[zdm]: https://www.michal-drozd.com/en/blog/zero-downtime-postgresql-migrations/ "Zero-Downtime PostgreSQL Migrations — expand/migrate/contract, batch backfill, NOT VALID + VALIDATE, CONCURRENTLY"
[rls]: https://www.permit.io/blog/postgres-rls-implementation-guide "Postgres RLS Implementation Guide — fail-closed policies, tenant isolation, common pitfalls"
