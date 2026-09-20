import { assertEquals } from 'jsr:@std/assert';
import { handle } from '../index.ts';
import type { HandleDeps } from '../index.ts';

// Mirrors delete-account's test style: hand-rolled fake Supabase admin
// client, one makeDeps factory with per-test overrides, handle() driven
// directly with a Request.

const SECRET = 'test-cleanup-secret';

function makeRequest(headers: Record<string, string> = {}, method = 'POST'): Request {
  return new Request('http://localhost/cleanup-slip-images', { method, headers });
}

type CallLog = {
  listedPrefixes: string[];
  removedPaths: string[][];
  rpcCalls: Array<{ name: string; args: unknown }>;
  jobLogInserts: Array<{ job: string; detail: unknown }>;
};

type FakeOverrides = {
  slips?: Array<{ id: string; household_id: string }>;
  selectError?: unknown;
  storageListError?: unknown;
  storageRemoveError?: unknown;
  storageThrows?: boolean;
  rpcError?: unknown;
  rpcResult?: { status: string };
};

function makeDeps(overrides: FakeOverrides = {}): { deps: HandleDeps; log: CallLog } {
  const log: CallLog = { listedPrefixes: [], removedPaths: [], rpcCalls: [], jobLogInserts: [] };

  const admin = {
    from: (table: string) => {
      if (table === 'slip_queue') {
        return {
          select: () => ({
            lt: () => ({
              is: () => ({
                limit: () =>
                  Promise.resolve({
                    data: overrides.slips ?? [],
                    error: overrides.selectError ?? null,
                  }),
              }),
            }),
          }),
        };
      }
      if (table === 'job_log') {
        return {
          insert: (row: { job: string; detail: unknown }) => {
            log.jobLogInserts.push(row);
            return Promise.resolve({ data: null, error: null });
          },
        };
      }
      throw new Error(`Unexpected table ${table}`);
    },
    storage: {
      from: (_bucket: string) => ({
        list: (prefix: string) => {
          if (overrides.storageThrows) throw new Error('storage exploded');
          log.listedPrefixes.push(prefix);
          if (overrides.storageListError) {
            return Promise.resolve({ data: null, error: overrides.storageListError });
          }
          return Promise.resolve({ data: [{ name: '0.jpg' }], error: null });
        },
        remove: (paths: string[]) => {
          log.removedPaths.push(paths);
          if (overrides.storageRemoveError) {
            return Promise.resolve({ data: null, error: overrides.storageRemoveError });
          }
          return Promise.resolve({ data: null, error: null });
        },
      }),
    },
    rpc: (name: string, args: unknown) => {
      log.rpcCalls.push({ name, args });
      if (overrides.rpcError) return Promise.resolve({ data: null, error: overrides.rpcError });
      return Promise.resolve({
        data: overrides.rpcResult ?? { status: 'applied' },
        error: null,
      });
    },
  };

  return {
    deps: {
      createAdminClient: () => admin as any,
      env: { CLEANUP_SECRET: SECRET },
    },
    log,
  };
}

Deno.test('GET is rejected with 405', async () => {
  const { deps } = makeDeps();
  const resp = await handle(makeRequest({ 'x-cleanup-secret': SECRET }, 'GET'), deps);
  assertEquals(resp.status, 405);
});

Deno.test('missing header: 401', async () => {
  const { deps } = makeDeps();
  const resp = await handle(makeRequest(), deps);
  assertEquals(resp.status, 401);
});

Deno.test('wrong secret: 401', async () => {
  const { deps } = makeDeps();
  const resp = await handle(makeRequest({ 'x-cleanup-secret': 'nope' }), deps);
  assertEquals(resp.status, 401);
});

Deno.test('secret of a different length than expected: 401, no crash', async () => {
  const { deps } = makeDeps();
  const resp = await handle(makeRequest({ 'x-cleanup-secret': 'short' }), deps);
  assertEquals(resp.status, 401);
});

Deno.test('CLEANUP_SECRET not configured server-side: always 401', async () => {
  const { deps } = makeDeps();
  deps.env.CLEANUP_SECRET = '';
  const resp = await handle(makeRequest({ 'x-cleanup-secret': '' }), deps);
  assertEquals(resp.status, 401);
});

Deno.test('no eligible slips: 200 with all zero counts', async () => {
  const { deps } = makeDeps({ slips: [] });
  const resp = await handle(makeRequest({ 'x-cleanup-secret': SECRET }), deps);
  assertEquals(resp.status, 200);
  assertEquals(await resp.json(), { processed: 0, removed: 0, failed: 0 });
});

Deno.test('select failure: 500, nothing processed', async () => {
  const { deps, log } = makeDeps({ selectError: { message: 'timeout' } });
  const resp = await handle(makeRequest({ 'x-cleanup-secret': SECRET }), deps);
  assertEquals(resp.status, 500);
  assertEquals(log.rpcCalls.length, 0);
});

Deno.test(
  'happy path: derives the prefix from household_id/id (never image_uris), removes storage, and replicates via apply_server_op',
  async () => {
    const { deps, log } = makeDeps({
      slips: [{ id: 'slip-1', household_id: 'hh-1' }],
    });
    const resp = await handle(makeRequest({ 'x-cleanup-secret': SECRET }), deps);
    assertEquals(resp.status, 200);
    assertEquals(await resp.json(), { processed: 1, removed: 1, failed: 0 });
    assertEquals(log.listedPrefixes, ['hh-1/slip-1']);
    assertEquals(log.removedPaths, [['hh-1/slip-1/0.jpg']]);
    assertEquals(log.rpcCalls.length, 1);
    const call = log.rpcCalls[0];
    assertEquals(call.name, 'apply_server_op');
    const op = (call.args as { p_op: Record<string, unknown> }).p_op;
    assertEquals(op.table, 'slip_queue');
    assertEquals(op.row_id, 'slip-1');
    assertEquals(op.household_id, 'hh-1');
    assertEquals(op.op_type, 'update');
    assertEquals(op.device_id, 'server:cleanup-slip-images');
    const payload = op.payload as Record<string, unknown>;
    assertEquals(payload.raw_response_json, null);
    assertEquals(typeof payload.images_deleted_at, 'string');
    assertEquals(typeof payload.updated_at, 'string');
  },
);

Deno.test('storage list failure: logged to job_log, slip left for a later retry', async () => {
  const { deps, log } = makeDeps({
    slips: [{ id: 'slip-1', household_id: 'hh-1' }],
    storageListError: { message: 'list failed' },
  });
  const resp = await handle(makeRequest({ 'x-cleanup-secret': SECRET }), deps);
  assertEquals(resp.status, 200);
  assertEquals(await resp.json(), { processed: 1, removed: 0, failed: 1 });
  assertEquals(log.rpcCalls.length, 0);
  assertEquals(log.jobLogInserts.length, 1);
  assertEquals(log.jobLogInserts[0].job, 'cleanup-slip-images');
});

Deno.test('storage remove failure: logged, no DB write attempted', async () => {
  const { deps, log } = makeDeps({
    slips: [{ id: 'slip-1', household_id: 'hh-1' }],
    storageRemoveError: { message: 'remove failed' },
  });
  const resp = await handle(makeRequest({ 'x-cleanup-secret': SECRET }), deps);
  assertEquals(resp.status, 200);
  assertEquals(await resp.json(), { processed: 1, removed: 0, failed: 1 });
  assertEquals(log.rpcCalls.length, 0);
  assertEquals(log.jobLogInserts.length, 1);
});

Deno.test('storage throws: caught, logged, does not crash the batch', async () => {
  const { deps, log } = makeDeps({
    slips: [{ id: 'slip-1', household_id: 'hh-1' }],
    storageThrows: true,
  });
  const resp = await handle(makeRequest({ 'x-cleanup-secret': SECRET }), deps);
  assertEquals(resp.status, 200);
  assertEquals(await resp.json(), { processed: 1, removed: 0, failed: 1 });
  assertEquals(log.jobLogInserts.length, 1);
});

Deno.test('apply_server_op error: logged, images_deleted_at not considered set', async () => {
  const { deps, log } = makeDeps({
    slips: [{ id: 'slip-1', household_id: 'hh-1' }],
    rpcError: { message: 'deadlock' },
  });
  const resp = await handle(makeRequest({ 'x-cleanup-secret': SECRET }), deps);
  assertEquals(resp.status, 200);
  assertEquals(await resp.json(), { processed: 1, removed: 0, failed: 1 });
  assertEquals(log.jobLogInserts.length, 1);
  assertEquals(log.jobLogInserts[0].detail, {
    event: 'OP_APPLY_FAILED',
    household_id: 'hh-1',
    slip_id: 'slip-1',
    error: 'deadlock',
  });
});

Deno.test('apply_server_op rejects the op (non-applied status): treated as a failure', async () => {
  const { deps, log } = makeDeps({
    slips: [{ id: 'slip-1', household_id: 'hh-1' }],
    rpcResult: { status: 'rejected' },
  });
  const resp = await handle(makeRequest({ 'x-cleanup-secret': SECRET }), deps);
  assertEquals(resp.status, 200);
  assertEquals(await resp.json(), { processed: 1, removed: 0, failed: 1 });
  assertEquals(log.jobLogInserts.length, 1);
});

Deno.test('multiple slips: independent success/failure per slip', async () => {
  const { deps } = makeDeps({
    slips: [
      { id: 'slip-1', household_id: 'hh-1' },
      { id: 'slip-2', household_id: 'hh-2' },
    ],
  });
  const resp = await handle(makeRequest({ 'x-cleanup-secret': SECRET }), deps);
  assertEquals(resp.status, 200);
  assertEquals(await resp.json(), { processed: 2, removed: 2, failed: 0 });
});
