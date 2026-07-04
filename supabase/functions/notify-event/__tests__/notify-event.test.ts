import { assertEquals, assert } from 'jsr:@std/assert';
import { handle, buildV1Message } from '../index.ts';
import type { HandleDeps } from '../index.ts';

// Test-only RSA private key (PKCS8 PEM), generated solely to exercise the
// real JWT-signing code path against a mocked Google token endpoint. Not a
// real credential — never used against a live Google service.
const TEST_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQCt3S+kslcApY2U
Thm3jQWnDj8FjpUNPZjVMr09YKe9K0N2xiEx73dybM4Nr0HLnm5RksBL3FlQ45nM
DWt4dsyhjbAV0mII4o3DgV+9HJI66qIiDiuapLrzUyOYnpQyWPnR2x+zZ/SVC3rQ
l5yWZ0roMm0HZ6AKXr478EC9uaxHV8QLZA9KMQtd6h50nCrqgIdiN6npWoQoqN5+
v7tPOJPDXI42JM80aoTTOWk79RDy/m8lkiJsEFyg8kAd6nfpbqTK0C76ZNzSPlPR
KnsX/1WpRGn8mNHKiSaS4aEovDoDf8Dt5Fbag+0ehgIucQifGrgEzPuI2aHrnAsK
oJ+j+O/7AgMBAAECggEAHx+9a6pRUNhSI/5nNCiWnnU6avA/VoN0XJYcsmQfIwof
pZ+KSbook99Oc7yv9peCADBZJDtp8cUMvy6X0pTRxQnsP7vNuPF1l04NqXj35Hwk
UhxfSeu7W9vCP4wD04+CCUNExYUSj6vibHz3lyUej7qXMgAm8jRLsccsj8oxQQP0
/SWuVf0ojcKfVU/Al6A3yY+13qjyEXSCXlU3l+BIrj1cNmwCe+V2b769d5Tg/Mvn
BGih7NUqcNsDCgHbVGxxPGq4hfxeV/Fao+qEgLGH+Oxou3DSVIITjAyuwIlY1Dwc
HgI0OLs5qH5oYR4oQ4PdzjuotbEn62bvX2bwh+TY4QKBgQDvXWxVGgnKOuL4DqL5
UgsSWKSYN31KQc86CM3jTlfbDQZycJBDC9IMlOibg/1MkKfMFreYQpTsh8PnzIyj
pS6eoizLxsUnpUCokpRj+ZRxonnEUvWM1k3Pc9JIA8R0uoPNocDuVeRgNrnyEJ4E
ZtNJhJzuUvzfMg8jgKjYHHtnbwKBgQC58m0iPHiiN/5l2rC1JOEAkEM3yRtxXHNw
NCSDUL5+nT3gr6rfQPLX91REuLPC83hVBUKd8XdwUOxGOmRCR78SRbRMwS1F4jI+
dmwCzJbd3PmRrZ5uH1cuqb8/t/MdZ/Lz3LcKtmLskshKboFgh0RZEheisjMMSrn4
ElcX8SjaNQKBgCs/ZPBnWPd59kI9WsLTSP7Sl0KNXAzLoSZqKtDz+bmxO8X3gokq
nJP7X5+hlGV+CWM9g4R2GzQ1P3clJQ/4K1ksEg3rZvnHyMvsV/VMRb7WTUvkdUsx
+TMPSSIL1DYG8QN5Q0OMr0uW97e9ut8uuOQimrwQsHGfOM8AUwFg/AbvAoGAH5/V
Y785HQ283IHHD+fHxJrEc9ZmLm90yp5zn0m6PDpt7aqyuumG46gS0uU+3WcfDgao
/8ezcoywwnjn2EXvfyIPugYYtwvzU6A8WnWFKxKL93S5vyzhXPRNrH6SgGvPbB4b
m1zNkkKcgdwtcMdQnn1vO6JnAC4tVr13xoCjXAkCgYBg51YkRASNd1EVl/ZpAGBb
KRBgmdYL2W4VBqstzn5GUiaB7evWBAE64DahvNNswPnzV3R6VfczHeWBJRuuxj7C
tQmT9aoShRxdBYgkQHPJ2RUhXztTSvbSTnzg5kro4Rlc3WdWaao8LC+Z8mSNMttg
xFoL08uf5XhxtZEVQOBXeA==
-----END PRIVATE KEY-----`;

const TEST_SERVICE_ACCOUNT = JSON.stringify({
  project_id: 'test-project',
  client_email: 'fcm@test-project.iam.gserviceaccount.com',
  private_key: TEST_PRIVATE_KEY,
});

function makeRequest(body: unknown, authHeader?: string): Request {
  return new Request('http://localhost/notify-event', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authHeader ? { Authorization: authHeader } : {}),
    },
    body: JSON.stringify(body),
  });
}

type FakeAdminOverrides = {
  tokens?: Array<{ token: string }>;
  deletedTokens?: string[][];
};

function makeAdminSupabase(overrides: FakeAdminOverrides = {}) {
  const deletedCalls: string[][] = overrides.deletedTokens ?? [];
  const tokens = overrides.tokens ?? [{ token: 'tok-1' }];

  const from = (table: string) => {
    if (table === 'household_members') {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: { user_id: 'u1' }, error: null }),
            }),
          }),
        }),
      };
    }
    if (table === 'user_fcm_tokens') {
      return {
        select: () => ({
          eq: () => Promise.resolve({ data: tokens, error: null }),
        }),
        delete: () => ({
          eq: () => ({
            in: (_col: string, vals: string[]) => {
              deletedCalls.push(vals);
              return Promise.resolve({ error: null });
            },
          }),
        }),
      };
    }
    return { select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) };
  };

  return {
    from,
    rpc: (_name: string, _args: unknown) => Promise.resolve({ data: true, error: null }),
    __deletedCalls: deletedCalls,
  };
}

function makeBaseDeps(overrides: Partial<HandleDeps> = {}): HandleDeps {
  const callerSupabase = {
    auth: {
      getUser: () => Promise.resolve({ data: { user: { id: 'u1' } }, error: null }),
    },
  };

  const fetchImpl = (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('oauth2.googleapis.com/token')) {
      return Promise.resolve(
        new Response(JSON.stringify({ access_token: 'fake-access-token', expires_in: 3600 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }
    if (url.includes('/messages:send')) {
      return Promise.resolve(
        new Response(JSON.stringify({ name: 'projects/test-project/messages/0' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }
    throw new Error(`Unexpected fetch to ${url}`);
  };

  return {
    createCallerClient: () => callerSupabase as any,
    createAdminClient: () => makeAdminSupabase() as any,
    fetchImpl: fetchImpl as any,
    now: () => 1_700_000_000_000,
    tokenCache: { entry: null },
    env: {
      SUPABASE_URL: 'http://localhost',
      SUPABASE_ANON_KEY: 'anon-key',
      SUPABASE_SERVICE_ROLE_KEY: 'service-key',
      FCM_SERVICE_ACCOUNT: TEST_SERVICE_ACCOUNT,
    },
    ...overrides,
  };
}

const validPayload = { userId: 'u1', householdId: 'h1', title: 'Hello', body: 'World' };

Deno.test('buildV1Message: correct v1 payload shape', () => {
  const msg = buildV1Message('tok-abc', 'Hello', 'World');
  assertEquals(msg, {
    message: {
      token: 'tok-abc',
      notification: { title: 'Hello', body: 'World' },
      android: { priority: 'high' },
      apns: { headers: { 'apns-priority': '10' } },
    },
  });
});

Deno.test('returns 401 without Authorization header', async () => {
  const deps = makeBaseDeps();
  const resp = await handle(makeRequest(validPayload), deps);
  assertEquals(resp.status, 401);
});

Deno.test('missing FCM_SERVICE_ACCOUNT: graceful "not configured" response, no crash', async () => {
  const deps = makeBaseDeps({
    env: {
      SUPABASE_URL: 'http://localhost',
      SUPABASE_ANON_KEY: 'anon-key',
      SUPABASE_SERVICE_ROLE_KEY: 'service-key',
      FCM_SERVICE_ACCOUNT: undefined,
    },
  });
  const resp = await handle(makeRequest(validPayload, 'Bearer tok'), deps);
  assertEquals(resp.status, 200);
  const json = await resp.json();
  assertEquals(json.sent, 0);
  assertEquals(json.pushConfigured, false);
  assert(typeof json.error === 'string');
});

Deno.test('invalid FCM_SERVICE_ACCOUNT JSON: graceful "not configured", no crash', async () => {
  const deps = makeBaseDeps({
    env: {
      SUPABASE_URL: 'http://localhost',
      SUPABASE_ANON_KEY: 'anon-key',
      SUPABASE_SERVICE_ROLE_KEY: 'service-key',
      FCM_SERVICE_ACCOUNT: 'not-json{{{',
    },
  });
  const resp = await handle(makeRequest(validPayload, 'Bearer tok'), deps);
  assertEquals(resp.status, 200);
  const json = await resp.json();
  assertEquals(json.sent, 0);
  assertEquals(json.pushConfigured, false);
});

Deno.test('single token: sends one v1 message and reports sent:1', async () => {
  let sendCalls = 0;
  const deps = makeBaseDeps({
    fetchImpl: ((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('oauth2.googleapis.com/token')) {
        return Promise.resolve(
          new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      if (url.includes('/messages:send')) {
        sendCalls++;
        // Assert the v1 endpoint shape and payload.
        assert(url.includes('/v1/projects/test-project/messages:send'));
        const parsed = JSON.parse(init!.body as string);
        assertEquals(parsed, {
          message: {
            token: 'tok-1',
            notification: { title: 'Hello', body: 'World' },
            android: { priority: 'high' },
            apns: { headers: { 'apns-priority': '10' } },
          },
        });
        assertEquals((init!.headers as Record<string, string>)['Authorization'], 'Bearer tok');
        return Promise.resolve(new Response('{}', { status: 200 }));
      }
      throw new Error(`Unexpected fetch to ${url}`);
    }) as any,
  });
  const resp = await handle(makeRequest(validPayload, 'Bearer tok'), deps);
  assertEquals(resp.status, 200);
  const json = await resp.json();
  assertEquals(json.sent, 1);
  assertEquals(sendCalls, 1);
});

Deno.test('multiple tokens: one send per token', async () => {
  let sendCalls = 0;
  const deps = makeBaseDeps({
    createAdminClient: () =>
      makeAdminSupabase({
        tokens: [{ token: 'tok-1' }, { token: 'tok-2' }, { token: 'tok-3' }],
      }) as any,
    fetchImpl: ((input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('oauth2.googleapis.com/token')) {
        return Promise.resolve(
          new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 }),
        );
      }
      if (url.includes('/messages:send')) {
        sendCalls++;
        return Promise.resolve(new Response('{}', { status: 200 }));
      }
      throw new Error(`Unexpected fetch to ${url}`);
    }) as any,
  });
  const resp = await handle(makeRequest(validPayload, 'Bearer tok'), deps);
  const json = await resp.json();
  assertEquals(sendCalls, 3);
  assertEquals(json.sent, 3);
});

Deno.test('UNREGISTERED token: pruned from user_fcm_tokens, not counted as sent', async () => {
  const deletedTokens: string[][] = [];
  const deps = makeBaseDeps({
    createAdminClient: () =>
      makeAdminSupabase({ tokens: [{ token: 'dead-token' }], deletedTokens }) as any,
    fetchImpl: ((input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('oauth2.googleapis.com/token')) {
        return Promise.resolve(
          new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 }),
        );
      }
      if (url.includes('/messages:send')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              error: {
                code: 404,
                message: 'Requested entity was not found.',
                status: 'UNREGISTERED',
              },
            }),
            { status: 404, headers: { 'Content-Type': 'application/json' } },
          ),
        );
      }
      throw new Error(`Unexpected fetch to ${url}`);
    }) as any,
  });
  const resp = await handle(makeRequest(validPayload, 'Bearer tok'), deps);
  const json = await resp.json();
  assertEquals(json.sent, 0);
  assertEquals(json.pruned, 1);
  assertEquals(deletedTokens.length, 1);
  assertEquals(deletedTokens[0], ['dead-token']);
});

Deno.test('INVALID_ARGUMENT token: pruned from user_fcm_tokens', async () => {
  const deletedTokens: string[][] = [];
  const deps = makeBaseDeps({
    createAdminClient: () =>
      makeAdminSupabase({ tokens: [{ token: 'malformed-token' }], deletedTokens }) as any,
    fetchImpl: ((input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('oauth2.googleapis.com/token')) {
        return Promise.resolve(
          new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 }),
        );
      }
      if (url.includes('/messages:send')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              error: { code: 400, message: 'Bad token', status: 'INVALID_ARGUMENT' },
            }),
            { status: 400, headers: { 'Content-Type': 'application/json' } },
          ),
        );
      }
      throw new Error(`Unexpected fetch to ${url}`);
    }) as any,
  });
  const resp = await handle(makeRequest(validPayload, 'Bearer tok'), deps);
  const json = await resp.json();
  assertEquals(json.sent, 0);
  assertEquals(json.pruned, 1);
  assertEquals(deletedTokens[0], ['malformed-token']);
});

Deno.test('non-prunable FCM error (e.g. UNAVAILABLE): token kept, not sent', async () => {
  const deletedTokens: string[][] = [];
  const deps = makeBaseDeps({
    createAdminClient: () =>
      makeAdminSupabase({ tokens: [{ token: 'tok-1' }], deletedTokens }) as any,
    fetchImpl: ((input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('oauth2.googleapis.com/token')) {
        return Promise.resolve(
          new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 }),
        );
      }
      if (url.includes('/messages:send')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              error: { code: 503, message: 'Server unavailable', status: 'UNAVAILABLE' },
            }),
            { status: 503, headers: { 'Content-Type': 'application/json' } },
          ),
        );
      }
      throw new Error(`Unexpected fetch to ${url}`);
    }) as any,
  });
  const resp = await handle(makeRequest(validPayload, 'Bearer tok'), deps);
  const json = await resp.json();
  assertEquals(json.sent, 0);
  assertEquals(json.pruned, 0);
  assertEquals(deletedTokens.length, 0);
});

Deno.test('token mint failure: graceful 502, no crash', async () => {
  const deps = makeBaseDeps({
    fetchImpl: ((input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('oauth2.googleapis.com/token')) {
        return Promise.resolve(new Response('server error', { status: 500 }));
      }
      throw new Error(`Unexpected fetch to ${url}`);
    }) as any,
  });
  const resp = await handle(makeRequest(validPayload, 'Bearer tok'), deps);
  assertEquals(resp.status, 502);
});

Deno.test(
  'cached access token is reused across calls within TTL (no second token-mint fetch)',
  async () => {
    let tokenFetches = 0;
    let sendCalls = 0;
    const tokenCache: HandleDeps['tokenCache'] = { entry: null };
    const makeDeps = () =>
      makeBaseDeps({
        tokenCache,
        fetchImpl: ((input: string | URL | Request) => {
          const url = typeof input === 'string' ? input : input.toString();
          if (url.includes('oauth2.googleapis.com/token')) {
            tokenFetches++;
            return Promise.resolve(
              new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), {
                status: 200,
              }),
            );
          }
          if (url.includes('/messages:send')) {
            sendCalls++;
            return Promise.resolve(new Response('{}', { status: 200 }));
          }
          throw new Error(`Unexpected fetch to ${url}`);
        }) as any,
      });

    await handle(makeRequest(validPayload, 'Bearer tok'), makeDeps());
    await handle(makeRequest(validPayload, 'Bearer tok'), makeDeps());

    assertEquals(tokenFetches, 1);
    assertEquals(sendCalls, 2);
  },
);

Deno.test('returns 403 when caller is not a household member', async () => {
  const deps = makeBaseDeps({
    createAdminClient: () =>
      ({
        from: (table: string) => {
          if (table === 'household_members') {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({ single: () => Promise.resolve({ data: null, error: null }) }),
                }),
              }),
            };
          }
          return { select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) };
        },
        rpc: () => Promise.resolve({ data: true, error: null }),
      }) as any,
  });
  const resp = await handle(makeRequest(validPayload, 'Bearer tok'), deps);
  assertEquals(resp.status, 403);
});

Deno.test('rejects payload with oversized title', async () => {
  const deps = makeBaseDeps();
  const resp = await handle(
    makeRequest({ ...validPayload, title: 'x'.repeat(121) }, 'Bearer tok'),
    deps,
  );
  assertEquals(resp.status, 400);
});

Deno.test('rejects payload with empty userId', async () => {
  const deps = makeBaseDeps();
  const resp = await handle(makeRequest({ ...validPayload, userId: '' }, 'Bearer tok'), deps);
  assertEquals(resp.status, 400);
});

Deno.test('rate limit exceeded: returns 429', async () => {
  const deps = makeBaseDeps({
    createAdminClient: () => {
      const admin = makeAdminSupabase();
      return { ...admin, rpc: () => Promise.resolve({ data: false, error: null }) } as any;
    },
  });
  const resp = await handle(makeRequest(validPayload, 'Bearer tok'), deps);
  assertEquals(resp.status, 429);
});

Deno.test('no tokens registered: returns sent:0 without attempting push config check', async () => {
  const deps = makeBaseDeps({
    createAdminClient: () => makeAdminSupabase({ tokens: [] }) as any,
    env: {
      SUPABASE_URL: 'http://localhost',
      SUPABASE_ANON_KEY: 'anon-key',
      SUPABASE_SERVICE_ROLE_KEY: 'service-key',
      FCM_SERVICE_ACCOUNT: undefined,
    },
  });
  const resp = await handle(makeRequest(validPayload, 'Bearer tok'), deps);
  assertEquals(resp.status, 200);
  const json = await resp.json();
  assertEquals(json.sent, 0);
});
