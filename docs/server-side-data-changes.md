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
  'client_created_at', now(),
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

## Repairing rows that were already written directly

Migration `0019` added `private.backfill_unlogged_rows(p_household_id text default null)`. It appends a synthetic `insert` op for every row of a synced data table that has no oplog row, so the phones receive it on their next sync. It only appends to the oplog — it never touches a data row — and it is idempotent.

```sql
-- one household
select * from private.backfill_unlogged_rows('<household id>');
-- every household
select * from private.backfill_unlogged_rows();
```

It cannot repair a row that was **updated** or **deleted** directly: there is nothing to compare against. Redo those through `apply_server_op`.
