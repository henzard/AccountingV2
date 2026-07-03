# Domain Ports — Injection Pattern

There are now **two** DI patterns in this codebase for use cases that write to persistent
storage, depending on when they were migrated:

1. **`ISyncEnqueuer` (legacy — `pending_sync` queue)**: most use cases (debts, meter readings,
   households, baby steps, slip queue, user consent). Documented below.
2. **`SyncWriteDeps` (current — oplog, `createSyncedRepo`)**: the envelope + transaction use
   cases (`CreateTransactionUseCase`, `DeleteTransactionUseCase`, `CreateEnvelopeUseCase`,
   `UpdateEnvelopeUseCase`, `ArchiveEnvelopeUseCase`), migrated in slice 3 task 3 when balance
   became derived. Documented further down.

Only pattern 2 is used for NEW use cases going forward — pattern 1 stays as-is until those
remaining use cases are migrated in a later slice.

## Pattern 1 — ISyncEnqueuer (legacy)

All use cases that write to persistent storage accept an optional `enqueuer?: ISyncEnqueuer`
parameter as their **last constructor argument**.

- **Position varies** by use case (some use cases have other optional params before it), but it
  is always the trailing parameter.
- **Default**: when omitted, the use case constructs `new PendingSyncEnqueuerAdapter(db)`
  internally, preserving backwards compatibility for call-sites that don't inject one.
- **In tests**: always inject a `jest.fn()` mock to avoid hitting the real DB and to assert that
  `enqueue(tableName, recordId, operation)` is called the expected number of times.

## Example

```ts
const mockEnqueuer: ISyncEnqueuer = { enqueue: jest.fn().mockResolvedValue(undefined) };
const uc = new CreateEnvelopeUseCase(db, audit, input, mockEnqueuer);
await uc.execute();
expect(mockEnqueuer.enqueue).toHaveBeenCalledWith('envelopes', expect.any(String), 'INSERT');
```

## ISyncEnqueuer contract

```ts
interface ISyncEnqueuer {
  enqueue(
    tableName: string,
    recordId: string,
    operation: 'INSERT' | 'UPDATE' | 'DELETE',
  ): Promise<void>;
}
```

## Pattern 2 — SyncWriteDeps (current: oplog / createSyncedRepo)

`CreateTransactionUseCase`, `DeleteTransactionUseCase`, `CreateEnvelopeUseCase`,
`UpdateEnvelopeUseCase`, and `ArchiveEnvelopeUseCase` accept an optional
`deps?: SyncWriteDeps` (see `src/domain/shared/syncWrite.ts`) as their trailing constructor
argument, defaulting to `{}`.

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
  work for a later slice, not part of slice 3 task 3's scope.
- **In tests**: inject a fake `SyncedRepo` (`{ insert: jest.fn(), update: jest.fn(), softDelete:
jest.fn(), increment: jest.fn() }`) rather than mocking Drizzle's query builder — much less
  brittle, and matches how these use cases are actually exercised.
- **Repository writes throw on 0 rows matched** (`createSyncedRepo`'s `update`/`softDelete`) — these
  use cases catch that and translate it into a domain `Result` failure (`ENVELOPE_NOT_FOUND` /
  `TRANSACTION_NOT_FOUND`) rather than letting the exception propagate.

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
