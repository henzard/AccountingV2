import { assertEquals, assert } from 'jsr:@std/assert';
import { handle, buildV1Message, formatZar, sanitizeFreeText, parseRequest } from '../index.ts';
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
LrGH6dJ7+mHkBHbdUcCZ8sLKZ2q1Gg0HyXV1bNpJ3AAAdUMpVi3LN8sYJcDmupYk
Rz4kXEy1Y3Tl5mhP0LBcV9Q0kBFYFqrHsqNMEpINcxQC4OhNP+pV0DBOAXOhF3nD
6tQEMyB9y6vQmM4SfOdLtjrSmFH4mNbEKIgErmkCgYAXQ7hGJmOyfRuqPBCFtzVR
lRrrRAXwIunvIdEvrMkVBUKnYJXdVsEWKGZSNoTt5OMcDOrn0Wt8SRRJLl4ahIyL
lMVYOLq2VwzZdDVIvrlRhKk5HVpGFvBcLBQYMLU35+n2YRcAbwXTQrPIYZ0YOpVR
9G9OaHWPVBCxD3+rGBTL7Q==
-----END PRIVATE KEY-----`;

const TEST_SERVICE_ACCOUNT = JSON.stringify({
  project_id: 'test-project',
  client_email: 'fcm@test-project.iam.gserviceaccount.com',
  private_key: TEST_PRIVATE_KEY,
});

const CALLER_ID = 'u1';

function makeRequest(body: unknown, authHeader?: string, method = 'POST'): Request {
  return new Request('http://localhost/notify-event', {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(authHeader ? { Authorization: authHeader } : {}),
    },
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
  });
}

type DeletedCall = { userId: string; tokens: string[] };
type RpcCall = { name: string; args: Record<string, unknown> };

type FakeAdminOverrides = {
  /** Active members of the household, as the roster query returns them. */
  members?: string[];
  /** maybeSingle() result for the caller membership probe. */
  callerIsMember?: boolean;
  /** maybeSingle() result for the legacy target membership probe. */
  targetIsMember?: boolean;
  tokens?: Array<{ user_id: string; token: string }>;
  deletedTokens?: DeletedCall[];
  rpcCalls?: RpcCall[];
  rpcResult?: { data: unknown; error: unknown };
  membersError?: unknown;
  tokensError?: unknown;
  isCalls?: Array<[string, unknown]>;
};

function makeAdminSupabase(overrides: FakeAdminOverrides = {}) {
  const members = overrides.members ?? [CALLER_ID, 'u2'];
  const callerIsMember = overrides.callerIsMember ?? true;
  const targetIsMember = overrides.targetIsMember ?? true;
  const tokens = overrides.tokens ?? [{ user_id: 'u2', token: 'tok-1' }];
  const deletedCalls = overrides.deletedTokens ?? [];
  const rpcCalls = overrides.rpcCalls ?? [];
  const isCalls = overrides.isCalls ?? [];

  const from = (table: string) => {
    if (table === 'household_members') {
      return {
        select: () => ({
          eq: (_c1: string, _v1: string) => ({
            // Roster query (typed-event shape): .is('deleted_at', null) with
            // no second .eq, resolving to every active member row.
            is: (c: string, v: unknown) => {
              isCalls.push([c, v]);
              return Promise.resolve({
                data: members.map((id) => ({ user_id: id })),
                error: overrides.membersError ?? null,
              });
            },
            // Single-member probe: caller, or the legacy shape's target.
            eq: (_c2: string, v2: string) => ({
              is: (c: string, v: unknown) => {
                isCalls.push([c, v]);
                const present = v2 === CALLER_ID ? callerIsMember : targetIsMember;
                return {
                  maybeSingle: () =>
                    Promise.resolve({ data: present ? { user_id: v2 } : null, error: null }),
                };
              },
            }),
          }),
        }),
      };
    }
    if (table === 'user_fcm_tokens') {
      return {
        select: () => ({
          in: (_col: string, ids: string[]) =>
            Promise.resolve({
              data: tokens.filter((t) => ids.includes(t.user_id)),
              error: overrides.tokensError ?? null,
            }),
        }),
        delete: () => ({
          eq: (_col: string, userId: string) => ({
            in: (_col2: string, vals: string[]) => {
              deletedCalls.push({ userId, tokens: vals });
              return Promise.resolve({ error: null });
            },
          }),
        }),
      };
    }
    return { select: () => ({ in: () => Promise.resolve({ data: [], error: null }) }) };
  };

  return {
    from,
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return Promise.resolve(overrides.rpcResult ?? { data: true, error: null });
    },
  };
}

function makeBaseDeps(overrides: Partial<HandleDeps> = {}): HandleDeps {
  const callerSupabase = {
    auth: {
      getUser: () => Promise.resolve({ data: { user: { id: CALLER_ID } }, error: null }),
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

const unconfiguredEnv: HandleDeps['env'] = {
  SUPABASE_URL: 'http://localhost',
  SUPABASE_ANON_KEY: 'anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  FCM_SERVICE_ACCOUNT: undefined,
};

/** The new typed-event request shape. */
const transactionRequest = {
  householdId: 'h1',
  event: { kind: 'transaction_created', amountCents: 12_345, envelopeName: 'Groceries' },
};

/** The 1.1.134 shape, kept working for one release. */
const legacyRequest = { userId: 'u2', householdId: 'h1', title: 'Hello', body: 'World' };

/** Mock fetch that records every FCM send and always succeeds. */
function recordingFetch(record: { sends: number; bodies: unknown[]; tokenFetches: number }) {
  return ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('oauth2.googleapis.com/token')) {
      record.tokenFetches++;
      return Promise.resolve(
        new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 }),
      );
    }
    if (url.includes('/messages:send')) {
      record.sends++;
      record.bodies.push(JSON.parse(init!.body as string));
      return Promise.resolve(new Response('{}', { status: 200 }));
    }
    throw new Error(`Unexpected fetch to ${url}`);
  }) as any;
}

// ===========================================================================
// Pure helpers
// ===========================================================================

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

Deno.test('formatZar: ZAR cents rendering matches the client formatCurrency shape', () => {
  assertEquals(formatZar(0), 'R0,00');
  assertEquals(formatZar(5), 'R0,05');
  assertEquals(formatZar(99), 'R0,99');
  assertEquals(formatZar(100), 'R1,00');
  assertEquals(formatZar(123_456), 'R1 234,56');
  assertEquals(formatZar(100_000_000), 'R1 000 000,00');
  assertEquals(formatZar(-123_456), '-R1 234,56');
});

Deno.test('sanitizeFreeText: strips control characters and collapses whitespace', () => {
  assertEquals(sanitizeFreeText('Woolworths\n\nSandton'), 'Woolworths Sandton');
  assertEquals(sanitizeFreeText('  Pick n Pay  ​ '), 'Pick n Pay');
  assertEquals(sanitizeFreeText('order‮gnp.txt'), 'order');
});

Deno.test('sanitizeFreeText: strips anything that looks like a URL', () => {
  assertEquals(sanitizeFreeText('Locked http://evil.example/now'), 'Locked');
  assertEquals(sanitizeFreeText('visit www.evil.test today'), 'visit today');
  assertEquals(sanitizeFreeText('mail me@evil.test please'), 'mail please');
  assertEquals(sanitizeFreeText('go to evil.test'), 'go to');
  assertEquals(sanitizeFreeText('Checkers Hyper'), 'Checkers Hyper');
});

// ===========================================================================
// parseRequest — strict validation + server-side rendering (SEC2-12)
// ===========================================================================

Deno.test('parseRequest: transaction_created renders a server-authored message', () => {
  const parsed = parseRequest({
    householdId: 'h1',
    event: {
      kind: 'transaction_created',
      amountCents: 123_456,
      envelopeName: 'Groceries',
      payee: 'Woolworths',
    },
  });
  assert(parsed.ok);
  assert(parsed.shape === 'event');
  assertEquals(parsed.message, {
    title: 'New spending logged',
    body: 'R1 234,56 from Groceries at Woolworths',
  });
  assertEquals(parsed.bucket, 'default');
  assertEquals(parsed.limit, 20);
});

Deno.test('parseRequest: transaction_created without a payee omits the payee clause', () => {
  const parsed = parseRequest(transactionRequest);
  assert(parsed.ok);
  assertEquals(parsed.message.body, 'R123,45 from Groceries');
});

Deno.test('parseRequest: a URL smuggled into a free-text field never reaches the body', () => {
  const parsed = parseRequest({
    householdId: 'h1',
    event: {
      kind: 'transaction_created',
      amountCents: 100,
      envelopeName: 'Groceries',
      payee: 'Locked http://evil.test',
    },
  });
  assert(parsed.ok);
  assertEquals(parsed.message.body, 'R1,00 from Groceries at Locked');
});

Deno.test('parseRequest: envelope_over_budget gets its own bucket and smaller limit', () => {
  const parsed = parseRequest({
    householdId: 'h1',
    event: { kind: 'envelope_over_budget', envelopeName: 'Groceries', overByCents: 9_900 },
  });
  assert(parsed.ok);
  assert(parsed.shape === 'event');
  assertEquals(parsed.bucket, 'over_budget');
  assertEquals(parsed.limit, 10);
  assertEquals(parsed.message, {
    title: 'Envelope over budget',
    body: 'Groceries is over by R99,00',
  });
});

Deno.test('parseRequest: slip_confirmed pluralises and appends the merchant', () => {
  const one = parseRequest({
    householdId: 'h1',
    event: { kind: 'slip_confirmed', itemCount: 1 },
  });
  assert(one.ok);
  assertEquals(one.message, { title: 'Slip confirmed', body: '1 item added' });

  const many = parseRequest({
    householdId: 'h1',
    event: { kind: 'slip_confirmed', itemCount: 7, merchant: 'Checkers' },
  });
  assert(many.ok);
  assertEquals(many.message.body, '7 items added from Checkers');
});

Deno.test('parseRequest: rejects an unknown kind', () => {
  const parsed = parseRequest({ householdId: 'h1', event: { kind: 'something_else' } });
  assertEquals(parsed.ok, false);
});

Deno.test('parseRequest: rejects an unknown field on a known kind', () => {
  const parsed = parseRequest({
    householdId: 'h1',
    event: {
      kind: 'transaction_created',
      amountCents: 100,
      envelopeName: 'Groceries',
      title: 'Your bank account is locked',
    },
  });
  assertEquals(parsed.ok, false);
});

Deno.test('parseRequest: rejects an unknown top-level field', () => {
  const parsed = parseRequest({ ...transactionRequest, title: 'spoofed' });
  assertEquals(parsed.ok, false);
});

Deno.test('parseRequest: rejects non-integer, zero, negative and oversized amounts', () => {
  for (const amountCents of [
    0,
    -1,
    12.5,
    '100',
    null,
    1_000_000_001,
    Number.MAX_SAFE_INTEGER + 2,
  ]) {
    const parsed = parseRequest({
      householdId: 'h1',
      event: { kind: 'transaction_created', amountCents, envelopeName: 'Groceries' },
    });
    assertEquals(parsed.ok, false, `amountCents ${String(amountCents)} must be rejected`);
  }
});

Deno.test('parseRequest: rejects itemCount outside 1..200', () => {
  for (const itemCount of [0, 201, 1.5, '3']) {
    const parsed = parseRequest({
      householdId: 'h1',
      event: { kind: 'slip_confirmed', itemCount },
    });
    assertEquals(parsed.ok, false, `itemCount ${String(itemCount)} must be rejected`);
  }
  assertEquals(
    parseRequest({ householdId: 'h1', event: { kind: 'slip_confirmed', itemCount: 200 } }).ok,
    true,
  );
});

Deno.test('parseRequest: rejects over-length free text', () => {
  const parsed = parseRequest({
    householdId: 'h1',
    event: {
      kind: 'transaction_created',
      amountCents: 100,
      envelopeName: 'x'.repeat(61),
    },
  });
  assertEquals(parsed.ok, false);
});

Deno.test('parseRequest: rejects a required free-text field that sanitizes away to nothing', () => {
  const parsed = parseRequest({
    householdId: 'h1',
    event: { kind: 'transaction_created', amountCents: 100, envelopeName: 'http://evil.test' },
  });
  assertEquals(parsed.ok, false);
});

Deno.test('parseRequest: rejects a missing or malformed householdId', () => {
  assertEquals(parseRequest({ event: transactionRequest.event }).ok, false);
  assertEquals(parseRequest({ householdId: '', event: transactionRequest.event }).ok, false);
  assertEquals(parseRequest('not an object').ok, false);
});

Deno.test('parseRequest: the legacy shape renders NOTHING the caller wrote', () => {
  const parsed = parseRequest({
    userId: 'u2',
    householdId: 'h1',
    title: 'Your bank account is locked',
    body: 'Tap http://evil.test to unlock',
  });
  assert(parsed.ok);
  assertEquals(parsed.shape, 'legacy');
  assertEquals(parsed.message, {
    title: 'Household activity',
    body: 'Household activity — open the app to see what changed',
  });
});

Deno.test('parseRequest: legacy shape keeps its old validation errors', () => {
  assertEquals(parseRequest({ ...legacyRequest, userId: '' }).ok, false);
  assertEquals(parseRequest({ ...legacyRequest, title: '   ' }).ok, false);
  const tooLarge = parseRequest({ ...legacyRequest, title: 'x'.repeat(121) });
  assertEquals(tooLarge.ok, false);
  assert(!tooLarge.ok && tooLarge.error === 'Payload too large');
});

// ===========================================================================
// handle() — auth, membership, fan-out, throttle, send, prune
// ===========================================================================

Deno.test('returns 405 for a non-POST method', async () => {
  const deps = makeBaseDeps();
  const resp = await handle(makeRequest(undefined, 'Bearer tok', 'GET'), deps);
  assertEquals(resp.status, 405);
});

Deno.test('returns 401 without Authorization header', async () => {
  const deps = makeBaseDeps();
  const resp = await handle(makeRequest(transactionRequest), deps);
  assertEquals(resp.status, 401);
});

Deno.test('returns 400 for an unparseable body', async () => {
  const deps = makeBaseDeps();
  const req = new Request('http://localhost/notify-event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
    body: 'not json',
  });
  const resp = await handle(req, deps);
  assertEquals(resp.status, 400);
});

Deno.test('returns 400 for a rejected event payload', async () => {
  const deps = makeBaseDeps();
  const resp = await handle(
    makeRequest({ householdId: 'h1', event: { kind: 'nope' } }, 'Bearer tok'),
    deps,
  );
  assertEquals(resp.status, 400);
  assertEquals((await resp.json()).error, 'Invalid payload');
});

Deno.test('returns 403 when the caller is not a household member', async () => {
  const deps = makeBaseDeps({
    createAdminClient: () => makeAdminSupabase({ callerIsMember: false }) as any,
  });
  const resp = await handle(makeRequest(transactionRequest, 'Bearer tok'), deps);
  assertEquals(resp.status, 403);
});

Deno.test(
  'legacy shape: returns 403 when the target is not a household member (IDOR)',
  async () => {
    const deps = makeBaseDeps({
      createAdminClient: () => makeAdminSupabase({ targetIsMember: false }) as any,
    });
    const resp = await handle(makeRequest(legacyRequest, 'Bearer tok'), deps);
    assertEquals(resp.status, 403);
  },
);

Deno.test('every membership query filters deleted_at IS NULL', async () => {
  const isCalls: Array<[string, unknown]> = [];
  const deps = makeBaseDeps({
    createAdminClient: () => makeAdminSupabase({ isCalls }) as any,
  });
  await handle(makeRequest(transactionRequest, 'Bearer tok'), deps);
  assert(isCalls.length >= 2);
  for (const [col, val] of isCalls) {
    assertEquals(col, 'deleted_at');
    assertEquals(val, null);
  }
});

Deno.test(
  'REG-15: one request fans out to every other member and costs ONE rate-limit unit',
  async () => {
    const rpcCalls: RpcCall[] = [];
    const record = { sends: 0, bodies: [] as unknown[], tokenFetches: 0 };
    const deps = makeBaseDeps({
      createAdminClient: () =>
        makeAdminSupabase({
          members: [CALLER_ID, 'u2', 'u3'],
          tokens: [
            { user_id: 'u2', token: 'tok-2' },
            { user_id: 'u3', token: 'tok-3a' },
            { user_id: 'u3', token: 'tok-3b' },
          ],
          rpcCalls,
        }) as any,
      fetchImpl: recordingFetch(record),
    });

    const resp = await handle(makeRequest(transactionRequest, 'Bearer tok'), deps);
    assertEquals(resp.status, 200);
    const json = await resp.json();
    assertEquals(json.recipients, 2);
    assertEquals(json.sent, 3);
    assertEquals(record.sends, 3);
    assertEquals(rpcCalls.length, 1);
    assertEquals(rpcCalls[0].name, 'check_and_reserve_notify_send_v2');
    assertEquals(rpcCalls[0].args, {
      p_sender_id: CALLER_ID,
      p_bucket: 'default',
      p_limit: 20,
    });
  },
);

Deno.test('REG-15: an over-budget event reserves from its own, separate bucket', async () => {
  const rpcCalls: RpcCall[] = [];
  const deps = makeBaseDeps({
    createAdminClient: () => makeAdminSupabase({ rpcCalls }) as any,
  });
  await handle(
    makeRequest(
      {
        householdId: 'h1',
        event: { kind: 'envelope_over_budget', envelopeName: 'Groceries', overByCents: 500 },
      },
      'Bearer tok',
    ),
    deps,
  );
  assertEquals(rpcCalls[0].args, {
    p_sender_id: CALLER_ID,
    p_bucket: 'over_budget',
    p_limit: 10,
  });
});

Deno.test(
  'SEC2-12: the FCM body is the server-rendered text, never the caller-supplied text',
  async () => {
    const record = { sends: 0, bodies: [] as unknown[], tokenFetches: 0 };
    const deps = makeBaseDeps({ fetchImpl: recordingFetch(record) });
    await handle(
      makeRequest(
        {
          userId: 'u2',
          householdId: 'h1',
          title: 'Your bank account is locked',
          body: 'Tap http://evil.test to unlock',
        },
        'Bearer tok',
      ),
      deps,
    );
    assertEquals(record.bodies, [
      {
        message: {
          token: 'tok-1',
          notification: {
            title: 'Household activity',
            body: 'Household activity — open the app to see what changed',
          },
          android: { priority: 'high' },
          apns: { headers: { 'apns-priority': '10' } },
        },
      },
    ]);
  },
);

Deno.test('rate limit exceeded: returns 429 and sends nothing', async () => {
  const record = { sends: 0, bodies: [] as unknown[], tokenFetches: 0 };
  const deps = makeBaseDeps({
    createAdminClient: () => makeAdminSupabase({ rpcResult: { data: false, error: null } }) as any,
    fetchImpl: recordingFetch(record),
  });
  const resp = await handle(makeRequest(transactionRequest, 'Bearer tok'), deps);
  assertEquals(resp.status, 429);
  assertEquals(record.sends, 0);
});

Deno.test('throttle RPC failure: returns 500', async () => {
  const deps = makeBaseDeps({
    createAdminClient: () =>
      makeAdminSupabase({ rpcResult: { data: null, error: { message: 'boom' } } }) as any,
  });
  const resp = await handle(makeRequest(transactionRequest, 'Bearer tok'), deps);
  assertEquals(resp.status, 500);
});

Deno.test('roster query failure: returns 500', async () => {
  const deps = makeBaseDeps({
    createAdminClient: () => makeAdminSupabase({ membersError: { message: 'boom' } }) as any,
  });
  const resp = await handle(makeRequest(transactionRequest, 'Bearer tok'), deps);
  assertEquals(resp.status, 500);
});

Deno.test('token query failure: returns 500', async () => {
  const deps = makeBaseDeps({
    createAdminClient: () => makeAdminSupabase({ tokensError: { message: 'boom' } }) as any,
  });
  const resp = await handle(makeRequest(transactionRequest, 'Bearer tok'), deps);
  assertEquals(resp.status, 500);
});

Deno.test('solo household: no recipients, no rate-limit unit spent', async () => {
  const rpcCalls: RpcCall[] = [];
  const deps = makeBaseDeps({
    createAdminClient: () => makeAdminSupabase({ members: [CALLER_ID], rpcCalls }) as any,
  });
  const resp = await handle(makeRequest(transactionRequest, 'Bearer tok'), deps);
  assertEquals(resp.status, 200);
  assertEquals((await resp.json()).recipients, 0);
  assertEquals(rpcCalls.length, 0);
});

Deno.test('no tokens registered: returns sent:0 without spending a rate-limit unit', async () => {
  const rpcCalls: RpcCall[] = [];
  const deps = makeBaseDeps({
    createAdminClient: () => makeAdminSupabase({ tokens: [], rpcCalls }) as any,
    env: unconfiguredEnv,
  });
  const resp = await handle(makeRequest(transactionRequest, 'Bearer tok'), deps);
  assertEquals(resp.status, 200);
  const json = await resp.json();
  assertEquals(json.sent, 0);
  assertEquals(json.recipients, 1);
  assertEquals(rpcCalls.length, 0);
});

Deno.test('missing FCM_SERVICE_ACCOUNT: graceful "not configured" response, no crash', async () => {
  const rpcCalls: RpcCall[] = [];
  const deps = makeBaseDeps({
    createAdminClient: () => makeAdminSupabase({ rpcCalls }) as any,
    env: unconfiguredEnv,
  });
  const resp = await handle(makeRequest(transactionRequest, 'Bearer tok'), deps);
  assertEquals(resp.status, 200);
  const json = await resp.json();
  assertEquals(json.sent, 0);
  assertEquals(json.pushConfigured, false);
  assert(typeof json.error === 'string');
  assertEquals(rpcCalls.length, 0);
});

Deno.test('invalid FCM_SERVICE_ACCOUNT JSON: graceful "not configured", no crash', async () => {
  const deps = makeBaseDeps({
    env: { ...unconfiguredEnv, FCM_SERVICE_ACCOUNT: 'not-json{{{' },
  });
  const resp = await handle(makeRequest(transactionRequest, 'Bearer tok'), deps);
  assertEquals(resp.status, 200);
  const json = await resp.json();
  assertEquals(json.sent, 0);
  assertEquals(json.pushConfigured, false);
});

Deno.test(
  'single token: sends one v1 message to the right endpoint and reports sent:1',
  async () => {
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
          assert(url.includes('/v1/projects/test-project/messages:send'));
          assertEquals(JSON.parse(init!.body as string), {
            message: {
              token: 'tok-1',
              notification: { title: 'New spending logged', body: 'R123,45 from Groceries' },
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
    const resp = await handle(makeRequest(transactionRequest, 'Bearer tok'), deps);
    assertEquals(resp.status, 200);
    assertEquals((await resp.json()).sent, 1);
    assertEquals(sendCalls, 1);
  },
);

/** Builds a fetch that always answers /messages:send with one FCM error body. */
function failingFetch(status: number, errorBody: unknown) {
  return ((input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('oauth2.googleapis.com/token')) {
      return Promise.resolve(
        new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 }),
      );
    }
    if (url.includes('/messages:send')) {
      return Promise.resolve(
        new Response(JSON.stringify(errorBody), {
          status,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }
    throw new Error(`Unexpected fetch to ${url}`);
  }) as any;
}

Deno.test('UNREGISTERED token: pruned per recipient, not counted as sent', async () => {
  const deletedTokens: DeletedCall[] = [];
  const deps = makeBaseDeps({
    createAdminClient: () =>
      makeAdminSupabase({
        tokens: [{ user_id: 'u2', token: 'dead-token' }],
        deletedTokens,
      }) as any,
    fetchImpl: failingFetch(404, {
      error: { code: 404, message: 'Requested entity was not found.', status: 'UNREGISTERED' },
    }),
  });
  const resp = await handle(makeRequest(transactionRequest, 'Bearer tok'), deps);
  const json = await resp.json();
  assertEquals(json.sent, 0);
  assertEquals(json.pruned, 1);
  assertEquals(deletedTokens, [{ userId: 'u2', tokens: ['dead-token'] }]);
});

Deno.test('stale tokens are pruned per user_id, not across users', async () => {
  const deletedTokens: DeletedCall[] = [];
  const deps = makeBaseDeps({
    createAdminClient: () =>
      makeAdminSupabase({
        members: [CALLER_ID, 'u2', 'u3'],
        tokens: [
          { user_id: 'u2', token: 'dead-2' },
          { user_id: 'u3', token: 'dead-3' },
        ],
        deletedTokens,
      }) as any,
    fetchImpl: failingFetch(404, { error: { status: 'UNREGISTERED' } }),
  });
  const resp = await handle(makeRequest(transactionRequest, 'Bearer tok'), deps);
  assertEquals((await resp.json()).pruned, 2);
  assertEquals(deletedTokens, [
    { userId: 'u2', tokens: ['dead-2'] },
    { userId: 'u3', tokens: ['dead-3'] },
  ]);
});

Deno.test('INVALID_ARGUMENT naming the token field: pruned from user_fcm_tokens', async () => {
  const deletedTokens: DeletedCall[] = [];
  const deps = makeBaseDeps({
    createAdminClient: () =>
      makeAdminSupabase({
        tokens: [{ user_id: 'u2', token: 'malformed-token' }],
        deletedTokens,
      }) as any,
    fetchImpl: failingFetch(400, {
      error: {
        code: 400,
        message: 'Invalid registration token',
        status: 'INVALID_ARGUMENT',
        details: [
          {
            '@type': 'type.googleapis.com/google.rpc.BadRequest',
            fieldViolations: [{ field: 'message.token', description: 'Invalid token' }],
          },
        ],
      },
    }),
  });
  const resp = await handle(makeRequest(transactionRequest, 'Bearer tok'), deps);
  const json = await resp.json();
  assertEquals(json.pruned, 1);
  assertEquals(deletedTokens[0], { userId: 'u2', tokens: ['malformed-token'] });
});

Deno.test(
  'INVALID_ARGUMENT NOT naming the token field (e.g. bad message shape): token kept',
  async () => {
    const deletedTokens: DeletedCall[] = [];
    const deps = makeBaseDeps({
      createAdminClient: () =>
        makeAdminSupabase({
          tokens: [{ user_id: 'u2', token: 'healthy-token' }],
          deletedTokens,
        }) as any,
      fetchImpl: failingFetch(400, {
        error: {
          code: 400,
          status: 'INVALID_ARGUMENT',
          details: [
            {
              '@type': 'type.googleapis.com/google.rpc.BadRequest',
              fieldViolations: [{ field: 'message.notification.title', description: 'bad' }],
            },
          ],
        },
      }),
    });
    const resp = await handle(makeRequest(transactionRequest, 'Bearer tok'), deps);
    const json = await resp.json();
    assertEquals(json.sent, 0);
    assertEquals(json.pruned, 0);
    assertEquals(deletedTokens.length, 0);
  },
);

Deno.test(
  'INVALID_ARGUMENT with no details at all: token kept, not pruned (DB-12 regression guard)',
  async () => {
    const deletedTokens: DeletedCall[] = [];
    const deps = makeBaseDeps({
      createAdminClient: () =>
        makeAdminSupabase({
          tokens: [{ user_id: 'u2', token: 'healthy-token-2' }],
          deletedTokens,
        }) as any,
      fetchImpl: failingFetch(400, {
        error: { code: 400, message: 'Bad request', status: 'INVALID_ARGUMENT' },
      }),
    });
    const resp = await handle(makeRequest(transactionRequest, 'Bearer tok'), deps);
    assertEquals((await resp.json()).pruned, 0);
    assertEquals(deletedTokens.length, 0);
  },
);

Deno.test('non-prunable FCM error (e.g. UNAVAILABLE): token kept, not sent', async () => {
  const deletedTokens: DeletedCall[] = [];
  const deps = makeBaseDeps({
    createAdminClient: () =>
      makeAdminSupabase({ tokens: [{ user_id: 'u2', token: 'tok-1' }], deletedTokens }) as any,
    fetchImpl: failingFetch(503, {
      error: { code: 503, message: 'Server unavailable', status: 'UNAVAILABLE' },
    }),
  });
  const resp = await handle(makeRequest(transactionRequest, 'Bearer tok'), deps);
  const json = await resp.json();
  assertEquals(json.sent, 0);
  assertEquals(json.pruned, 0);
  assertEquals(deletedTokens.length, 0);
});

Deno.test('non-JSON FCM error body: token kept, no crash', async () => {
  const deletedTokens: DeletedCall[] = [];
  const deps = makeBaseDeps({
    createAdminClient: () =>
      makeAdminSupabase({ tokens: [{ user_id: 'u2', token: 'tok-1' }], deletedTokens }) as any,
    fetchImpl: ((input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('oauth2.googleapis.com/token')) {
        return Promise.resolve(
          new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 }),
        );
      }
      return Promise.resolve(new Response('<html>gateway</html>', { status: 502 }));
    }) as any,
  });
  const resp = await handle(makeRequest(transactionRequest, 'Bearer tok'), deps);
  assertEquals(resp.status, 200);
  assertEquals((await resp.json()).pruned, 0);
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
  const resp = await handle(makeRequest(transactionRequest, 'Bearer tok'), deps);
  assertEquals(resp.status, 502);
});

Deno.test(
  'cached access token is reused across calls within TTL (no second token-mint fetch)',
  async () => {
    const record = { sends: 0, bodies: [] as unknown[], tokenFetches: 0 };
    const tokenCache: HandleDeps['tokenCache'] = { entry: null };
    const makeDeps = () => makeBaseDeps({ tokenCache, fetchImpl: recordingFetch(record) });

    await handle(makeRequest(transactionRequest, 'Bearer tok'), makeDeps());
    await handle(makeRequest(transactionRequest, 'Bearer tok'), makeDeps());

    assertEquals(record.tokenFetches, 1);
    assertEquals(record.sends, 2);
  },
);
