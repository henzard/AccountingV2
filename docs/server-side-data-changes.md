# Changing household data from the server side

**Read this before inserting, updating or deleting rows in Supabase by hand, from a script, or through an AI assistant.**

## Why a row you added in Supabase does not show up in the app

Phones do not read the data tables. A phone takes one snapshot when it first joins a household, and from then on it converges **only** by pulling `public.oplog` through `sync_pull`. Every legitimate writer goes through `private.apply_one_op`, which appends the oplog row _and_ applies the change:

| Writer                                            | Entry point                                              |
| ------------------------------------------------- | -------------------------------------------------------- |
| The app                                           | `public.sync_push(ops)`                                  |
| Server code (edge functions, scripts, assistants) | `public.apply_server_op(p_op)` with the service-role key |

A row written straight into `public.transactions` (SQL editor, table editor, a script or assistant using the service key) has **no oplog row**. It exists on the server and is invisible to every phone already in the household.

## The right way to add or change data

Call `apply_server_op` once per change. It takes the household's advisory lock, appends the oplog row and applies it, exactly like a phone's push.

```sql
select public.apply_server_op(jsonb_build_object(
  'v', '1',
  'op_id', gen_random_uuid(),
  'household_id', '<household id>',
  'table', 'transactions',
  'row_id', gen_random_uuid()::text,      -- the new row's id
  'op_type', 'insert',                    -- insert | update | delete | increment
  'device_id', 'server:<who-you-are>',    -- must start with "server:"
  'client_created_at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'payload', jsonb_build_object(
    'envelope_id', '<envelope id in the SAME household and period>',
    'amount_cents', 25000,                -- integer cents; negative = refund
    'payee', 'Woolworths',
    'transaction_date', '2026-09-21',     -- local date, YYYY-MM-DD
    'is_business_expense', false,
    'created_at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'updated_at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  )
));
```

Rules that matter:

- `id` and `household_id` go in the op envelope (`row_id`, `household_id`), **never** in `payload`.
- Money is integer cents. Dates are `YYYY-MM-DD` strings; timestamps are ISO strings ending in `Z`.
- A transaction's `envelope_id` must be an envelope of the same household. Period-scoped envelopes (spending / utility / income) are re-created every period, so use the envelope whose `period_start` matches the period the transaction belongs to.
- `update` payloads carry only the columns being changed. `delete` is a soft delete (the row gets `deleted_at`). Never hard-delete a synced row: phones would keep it forever.
- The response is `{status: 'applied' | 'rejected', code}`. Check it.

## Savings funds: what the rows mean, and merging duplicates

`savings`, `sinking_fund`, `emergency_fund` and `baby_step` envelopes are **persistent**: one envelope row per fund, kept forever (they are not re-created each period). The app shows:

```
saved balance = SUM(envelope_contributions.amount_cents) - SUM(transactions.amount_cents)
```

both for that `envelope_id`, ignoring soft-deleted rows. So:

- A **transaction** on a savings envelope is money taken **out** of the fund. A deposit recorded as a positive transaction makes the balance go _down_.
- Money moved **in** is an `envelope_contributions` row (`envelope_id`, `amount_cents`, `period_start`, `source`, `created_at`, `updated_at`). `source` is one of `opening_balance` (at most one per fund, ever), `initial`, `rollover`, `monthly_confirmed`, `adjustment`. For a deposit you are recording after the fact, use `adjustment`.
- The envelope's `allocated_cents` is the **monthly contribution**, not a balance.

If an import recorded deposits as transactions, fix it through `apply_server_op`: soft-delete each wrong transaction (`op_type: 'delete'`) and insert a contribution row for the same amount and period. Do not edit amounts in place in the table.

If an import created the same fund once per period (many envelopes with the same type and name), the app treats them as one fund at rollover and in pickers, and the row that receives the monthly contribution is the **carrier**: earliest `created_at`, then lowest `id`. To merge for real, keep the carrier and, for every other duplicate, through `apply_server_op`:

1. `update` each of its transactions and contributions to the carrier's `envelope_id`.
2. `update` the duplicate envelope with `is_archived: true` (archive, don't delete — old builds and history still reference it).

**Run the whole merge in ONE SQL transaction** (`begin; … commit;`). `apply_server_op` takes the household lock with `pg_advisory_xact_lock`, which is held until the transaction ends — so inside one transaction the lock is taken once and kept for every call, no phone can push in between, and any failure (or a `rejected` status you `raise exception` on) rolls back the entire merge instead of leaving it half done.

**Opening balances.** A fund may have at most one `opening_balance` contribution. Before merging, write down the fund's total saved balance across all duplicates (the formula above, summed over every duplicate's `envelope_id`). Then decide per row: if several `opening_balance` rows restate the _same_ legacy balance, keep one and soft-delete the rest; if they are _distinct_ money, keep one on the carrier with `amount_cents` set to their sum and soft-delete the rest. After the merge, the carrier's saved balance must equal the figure you wrote down — or the figure you deliberately corrected it to. Check it before `commit`.

Do this before starting a new budget period, so the rollover sees one fund.

## Repairing rows that were already written directly

Migration `0019` added `private.backfill_unlogged_rows(p_household_id text default null)`. It appends a synthetic `insert` op for every row of a synced data table that has no oplog row, so the phones receive it on their next sync. It only appends to the oplog — it never touches a data row — and it is idempotent.

```sql
-- one household
select * from private.backfill_unlogged_rows('<household id>');
-- every household
select * from private.backfill_unlogged_rows();
```

It cannot repair a row that was **updated** or **deleted** directly: there is nothing to compare against. Redo those through `apply_server_op`.
