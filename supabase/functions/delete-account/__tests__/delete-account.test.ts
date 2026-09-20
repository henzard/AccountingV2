import { assertEquals, assert } from 'jsr:@std/assert';
import { handle } from '../index.ts';
import type { HandleDeps } from '../index.ts';

// Mirrors the structure/mocking style of
// supabase/functions/notify-event/__tests__/notify-event.test.ts: hand-rolled
// fake Supabase clients built from plain objects, one `makeBaseDeps` factory
// with per-test overrides, and `handle()` driven directly with a Request.

function makeRequest(authHeader?: string, method = 'POST'): Request {
  return new Request('http://localhost/delete-account', {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(authHeader ? { Authorization: authHeader } : {}),
    },
  });
}

type CallLog = {
  rpcCalls: string[];
  deletedUsers: string[];
  removedPaths: string[][];
  listedPrefixes: string[];
  jobLogInserts: Array<{ job: string; detail: unknown }>;
};

type FakeOverrides = {
  getUserResult?: { data: { user: { id: string } | null }; error: unknown };
  rpcError?: unknown;
  slips?: Array<{ id: string; household_id: string }>;
  slipsError?: unknown;
  authDeleteError?: unknown;
  storageThrows?: boolean;
  storageListError?: unknown;
  storageRemoveError?: unknown;
};

function makeDeps(overrides: FakeOverrides = {}): { deps: HandleDeps; log: CallLog } {
  const log: CallLog = {
    rpcCalls: [],
    deletedUsers: [],
    removedPaths: [],
    listedPrefixes: [],
    jobLogInserts: [],
  };

  const getUserResult = overrides.getUserResult ?? {
    data: { user: { id: 'user-1' } },
    error: null,
  };

  const callerSupabase = {
    auth: { getUser: () => Promise.resolve(getUserResult) },
    rpc: (name: string) => {
      log.rpcCalls.push(name);
      return Promise.resolve({ data: null, error: overrides.rpcError ?? null });
    },
  };

  const adminSupabase = {
    from: (table: string) => {
      if (table === 'slip_queue') {
        return {
          select: () => ({
            eq: () =>
              Promise.resolve({
                data: overrides.slips ?? [],
                error: overrides.slipsError ?? null,
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
          return Promise.resolve({ data: [{ name: '0.jpg' }, { name: '1.jpg' }], error: null });
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
    auth: {
      admin: {
        deleteUser: (id: string) => {
          log.deletedUsers.push(id);
          return Promise.resolve({ data: null, error: overrides.authDeleteError ?? null });
        },
      },
    },
  };

  return {
    deps: {
      createCallerClient: () => callerSupabase as any,
      createAdminClient: () => adminSupabase as any,
    },
    log,
  };
}

Deno.test('OPTIONS preflight: 204 with CORS headers', async () => {
  const { deps } = makeDeps();
  const resp = await handle(makeRequest(undefined, 'OPTIONS'), deps);
  assertEquals(resp.status, 204);
  assertEquals(resp.headers.get('Access-Control-Allow-Origin'), '*');
  assert(resp.headers.get('Access-Control-Allow-Methods')?.includes('POST'));
  assert(resp.headers.get('Access-Control-Allow-Headers')?.includes('authorization'));
});

Deno.test('GET is rejected with 405', async () => {
  const { deps, log } = makeDeps();
  const resp = await handle(makeRequest('Bearer tok', 'GET'), deps);
  assertEquals(resp.status, 405);
  assertEquals(log.rpcCalls.length, 0);
});

Deno.test('returns 401 without Authorization header', async () => {
  const { deps, log } = makeDeps();
  const resp = await handle(makeRequest(), deps);
  assertEquals(resp.status, 401);
  assertEquals(log.deletedUsers.length, 0);
});

Deno.test('returns 401 when getUser rejects the JWT', async () => {
  const { deps, log } = makeDeps({
    getUserResult: { data: { user: null }, error: { message: 'bad jwt' } },
  });
  const resp = await handle(makeRequest('Bearer bogus'), deps);
  assertEquals(resp.status, 401);
  assertEquals(log.rpcCalls.length, 0);
  assertEquals(log.deletedUsers.length, 0);
});

Deno.test('happy path: runs the RPC as the user, then deletes the auth user', async () => {
  const { deps, log } = makeDeps();
  const resp = await handle(makeRequest('Bearer tok'), deps);
  assertEquals(resp.status, 200);
  assertEquals(await resp.json(), { deleted: true });
  assertEquals(log.rpcCalls, ['delete_my_account_data']);
  assertEquals(log.deletedUsers, ['user-1']);
  assertEquals(resp.headers.get('Access-Control-Allow-Origin'), '*');
});

Deno.test('RPC failure: auth user is NOT deleted and the error is generic', async () => {
  const { deps, log } = makeDeps({ rpcError: { message: 'deadlock detected on hh-42' } });
  const resp = await handle(makeRequest('Bearer tok'), deps);
  assertEquals(resp.status, 500);
  const json = await resp.json();
  assertEquals(json, { error: 'Account deletion failed' });
  assertEquals(log.deletedUsers.length, 0);
});

Deno.test(
  'auth-user delete failure: 200 with deleted:false, data_deleted:true so the client can retry (SEC2-7)',
  async () => {
    const { deps, log } = makeDeps({ authDeleteError: { message: 'service_role key revoked' } });
    const resp = await handle(makeRequest('Bearer tok'), deps);
    assertEquals(resp.status, 200);
    assertEquals(await resp.json(), { deleted: false, data_deleted: true });
    // The RPC (the data-erasing half) still ran — only the auth-user delete
    // failed.
    assertEquals(log.rpcCalls, ['delete_my_account_data']);
  },
);

Deno.test(
  "slip images: the caller's own slip folders are swept before the auth delete",
  async () => {
    const { deps, log } = makeDeps({
      slips: [
        { id: 'slip-1', household_id: 'hh-1' },
        { id: 'slip-2', household_id: 'hh-2' },
      ],
    });
    const resp = await handle(makeRequest('Bearer tok'), deps);
    assertEquals(resp.status, 200);
    assertEquals(log.listedPrefixes, ['hh-1/slip-1', 'hh-2/slip-2']);
    assertEquals(log.removedPaths, [
      ['hh-1/slip-1/0.jpg', 'hh-1/slip-1/1.jpg'],
      ['hh-2/slip-2/0.jpg', 'hh-2/slip-2/1.jpg'],
    ]);
  },
);

Deno.test(
  'storage failure is best effort: the account is still deleted, and the prefix is logged to job_log (SEC2-7)',
  async () => {
    const { deps, log } = makeDeps({
      slips: [{ id: 'slip-1', household_id: 'hh-1' }],
      storageThrows: true,
    });
    const resp = await handle(makeRequest('Bearer tok'), deps);
    assertEquals(resp.status, 200);
    assertEquals(await resp.json(), { deleted: true });
    assertEquals(log.removedPaths.length, 0);
    assertEquals(log.deletedUsers, ['user-1']);
    assertEquals(log.jobLogInserts.length, 1);
    assertEquals(log.jobLogInserts[0].job, 'delete-account');
    assertEquals((log.jobLogInserts[0].detail as { prefix: string }).prefix, 'hh-1/slip-1');
  },
);

Deno.test('storage list error (not a throw) is also logged to job_log', async () => {
  const { deps, log } = makeDeps({
    slips: [{ id: 'slip-1', household_id: 'hh-1' }],
    storageListError: { message: 'list failed' },
  });
  const resp = await handle(makeRequest('Bearer tok'), deps);
  assertEquals(resp.status, 200);
  assertEquals(log.jobLogInserts.length, 1);
});

Deno.test('storage remove error is also logged to job_log', async () => {
  const { deps, log } = makeDeps({
    slips: [{ id: 'slip-1', household_id: 'hh-1' }],
    storageRemoveError: { message: 'remove failed' },
  });
  const resp = await handle(makeRequest('Bearer tok'), deps);
  assertEquals(resp.status, 200);
  assertEquals(log.jobLogInserts.length, 1);
});

Deno.test(
  'slip lookup failure now stops BEFORE the RPC runs: 500, no data erased, retryable (SEC2-7)',
  async () => {
    const { deps, log } = makeDeps({ slipsError: { message: 'timeout' } });
    const resp = await handle(makeRequest('Bearer tok'), deps);
    assertEquals(resp.status, 500);
    assertEquals(await resp.json(), { error: 'Account deletion failed' });
    assertEquals(log.rpcCalls.length, 0);
    assertEquals(log.deletedUsers.length, 0);
  },
);
