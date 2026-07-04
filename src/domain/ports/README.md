# Domain Ports — Injection Pattern

As of slice 5 task 1, **every** use case that writes to persistent storage uses the same DI
pattern: `SyncWriteDeps` (oplog, via `createSyncedRepo`/`runInUnitOfWork`). The older
`ISyncEnqueuer` (`pending_sync` outbox) pattern below is now **dead** — no domain code
constructs a `PendingSyncEnqueuerAdapter` anymore. It's documented here only because
`ISyncEnqueuer`/`PendingSyncEnqueuer`/`PendingSyncTable` themselves aren't deleted yet (that's
slice 5 task 6's job, once `SyncEngine` replaces `SyncOrchestrator`).

## Pattern — SyncWriteDeps (oplog, createSyncedRepo)

Every writing use case (envelopes, transactions, debts, meter readings, households, baby steps,
slip queue, user consent) accepts an optional `deps?: SyncWriteDeps` (see
`src/domain/shared/syncWrite.ts`) as its trailing constructor argument, defaulting to `{}`.

- **`deps.repo`**: a `SyncedRepo` (see `src/data/uow/createSyncedRepo.ts`) — the entity write AND
  its oplog row are appended atomically, in one SQLite transaction. When omitted, the use case
  builds a real one via `createSyncedRepo(db, { tableName })`.
- **`deps.clock` / `deps.genId`**: override the oplog row's `client_created_at` / `op_id` for
  deterministic tests. Passed straight through to `SyncedRepoCtx` — no separate IClock/IIdGenerator
  port was introduced, since that would just re-box these same two functions.
- **`deps.deviceId` / `deps.actorUserId`**: override the oplog row's attribution. **Known gap**:
  no call site currently supplies these (no session/device-id wiring exists yet in presentation),
  so they default to `null` (actor) and `UNASSIGNED_DEVICE_ID` (device) — see the comment on
  `UNASSIGNED_DEVICE_ID` in `syncWrite.ts`. Wiring real values is presentation/composition-root
  work for a later slice.
- **In tests**: inject a fake `SyncedRepo` (`{ insert: jest.fn(), update: jest.fn(), softDelete:
jest.fn(), increment: jest.fn() }`) rather than mocking Drizzle's query builder — much less
  brittle, and matches how these use cases are actually exercised.
- **Repository writes throw on 0 rows matched** (`createSyncedRepo`'s `update`/`softDelete`) — these
  use cases catch that and translate it into a domain `Result` failure (e.g. `ENVELOPE_NOT_FOUND` /
  `TRANSACTION_NOT_FOUND` / `STEP_NOT_FOUND`) rather than letting the exception propagate.

### Example

```ts
const repo: SyncedRepo = {
  insert: jest.fn(),
  update: jest.fn(),
  softDelete: jest.fn(),
  increment: jest.fn(),
};
const uc = new CreateEnvelopeUseCase(db, audit, input, { repo });
await uc.execute();
expect(repo.insert).toHaveBeenCalledTimes(1);
```

## Tables that don't fit createSyncedRepo's (id, household_id) shape

`createSyncedRepo` assumes a table has both an `id` column and a `household_id` column distinct
from it. Two tables don't:

- **`households`** — a household's own `id` IS its scope (no separate `household_id` column).
  `CreateHouseholdUseCase`/`UpdateHouseholdPaydayDayUseCase`/`EnsureHouseholdUseCase`'s legacy
  catch-up path drive `runInUnitOfWork` directly instead, with the row's own `id` used as the
  oplog `household_id`.
- **`user_consent`** — keyed by `user_id`, no household concept at all.
  `DrizzleUserConsentRepository` drives `runInUnitOfWork` directly, appending oplog rows with
  `household_id: null` (a value `AppendOpInput` explicitly supports for exactly this case).

See `.superpowers/sdd/task-1-report.md` for the full rationale.

## Special case — AcceptInviteUseCase's household_members insert

`AcceptInviteUseCase`'s local `household_members` insert is a plain, un-synced local write (no
`SyncWriteDeps`, no oplog op) — the row was already created **server-side** by the
`join_household_via_invite` RPC, so this is this device's local copy catching up, not a new fact
the server needs to learn. Appending an oplog `insert` op here would re-push a row the server
already has. This mirrors `RestoreService`'s own pulled-row inserts, which also never enqueue or
append ops.

## Legacy — ISyncEnqueuer (dead, pending removal in slice 5 task 6)

```ts
interface ISyncEnqueuer {
  enqueue(
    tableName: string,
    recordId: string,
    operation: 'INSERT' | 'UPDATE' | 'DELETE',
  ): Promise<void>;
}
```

No use case builds a `PendingSyncEnqueuerAdapter` anymore. `PendingSyncEnqueuer`,
`PendingSyncEnqueuerAdapter`, `PendingSyncTable`, and `SyncOrchestrator` remain in the tree only
because slice 5 task 6 owns deleting them (`SyncOrchestrator` is replaced by the new `SyncEngine`
in this same slice).
