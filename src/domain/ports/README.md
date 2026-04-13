# Domain Ports — Injection Pattern

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
