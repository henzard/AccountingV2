import { assertEquals } from 'jsr:@std/assert';
import { handle } from '../index.ts';
import type { HandleDeps } from '../index.ts';

function makeRequest(body: unknown, authHeader?: string): Request {
  return new Request('http://localhost/extract-slip', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authHeader ? { Authorization: authHeader } : {}),
    },
    body: JSON.stringify(body),
  });
}

function makeBaseDeps(overrides: Partial<HandleDeps> = {}): HandleDeps {
  const adminFrom = (table: string) => {
    if (table === 'user_households') {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: { user_id: 'u1' }, error: null }),
            }),
          }),
        }),
      };
    }
    if (table === 'user_consent') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: { slip_scan_consent_at: '2026-04-01T00:00:00Z' },
                error: null,
              }),
          }),
        }),
      };
    }
    if (table === 'slip_queue') {
      const slipRow = {
        id: 'slip1',
        status: 'processing',
        raw_response_json: null,
        created_by: 'u1',
      };
      const chainedEq = {
        eq: () => chainedEq,
        maybeSingle: () => Promise.resolve({ data: slipRow, error: null }),
        gte: () => Promise.resolve({ data: null, count: 0, error: null }),
      };
      return {
        select: () => ({ eq: () => chainedEq }),
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      };
    }
    if (table === 'envelopes') {
      return {
        select: () => ({
          eq: () => ({
            in: () => ({
              eq: () => Promise.resolve({ data: [{ id: 'env1', name: 'Groceries' }], error: null }),
            }),
          }),
        }),
      };
    }
    return {
      select: () => ({
        eq: () => ({ gte: () => Promise.resolve({ data: [], count: 0, error: null }) }),
      }),
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
    };
  };

  const callerSupabase = {
    auth: {
      getUser: () => Promise.resolve({ data: { user: { id: 'u1' } }, error: null }),
    },
  };

  const adminSupabase = { from: adminFrom };

  const openAIFetch = () =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  merchant: 'Pick n Pay',
                  slip_date: '2026-04-13',
                  total_cents: 5000,
                  items: [
                    {
                      description: 'Eggs',
                      amount_cents: 5000,
                      quantity: 1,
                      suggested_envelope_id: 'env1',
                      confidence: 0.95,
                    },
                  ],
                }),
              },
            },
          ],
          usage: { prompt_tokens: 1000, completion_tokens: 200 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

  return {
    createCallerClient: () => callerSupabase as any,
    createAdminClient: () => adminSupabase as any,
    openAIFetch: openAIFetch as any,
    env: {
      OPENAI_API_KEY: 'sk-test',
      SUPABASE_URL: 'http://localhost',
      SUPABASE_SERVICE_ROLE_KEY: 'service-key',
      SUPABASE_ANON_KEY: 'anon-key',
    },
    ...overrides,
  };
}

Deno.test('returns 401 without Authorization header', async () => {
  const req = new Request('http://localhost', {
    method: 'POST',
    body: JSON.stringify({ slip_id: 's1', household_id: 'h1', images_base64: [] }),
    headers: { 'Content-Type': 'application/json' },
  });
  const deps = makeBaseDeps();
  const resp = await handle(req, deps);
  assertEquals(resp.status, 401);
});

Deno.test('returns 403 when not household member', async () => {
  const deps = makeBaseDeps({
    createAdminClient: () =>
      ({
        from: (table: string) => {
          if (table === 'user_households') {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    maybeSingle: () => Promise.resolve({ data: null, error: null }),
                  }),
                }),
              }),
            };
          }
          return { select: () => ({}), update: () => ({ eq: () => Promise.resolve({}) }) };
        },
      }) as any,
  });
  const req = makeRequest(
    { slip_id: 's1', household_id: 'h1', images_base64: ['aaa'] },
    'Bearer tok',
  );
  const resp = await handle(req, deps);
  assertEquals(resp.status, 403);
});

Deno.test('returns 412 when consent missing', async () => {
  const deps = makeBaseDeps({
    createAdminClient: () =>
      ({
        from: (table: string) => {
          if (table === 'user_households') {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    maybeSingle: () => Promise.resolve({ data: { user_id: 'u1' }, error: null }),
                  }),
                }),
              }),
            };
          }
          if (table === 'user_consent') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () => Promise.resolve({ data: null, error: null }),
                }),
              }),
            };
          }
          return { select: () => ({}), update: () => ({ eq: () => Promise.resolve({}) }) };
        },
      }) as any,
  });
  const req = makeRequest(
    { slip_id: 's1', household_id: 'h1', images_base64: ['aaa'] },
    'Bearer tok',
  );
  const resp = await handle(req, deps);
  assertEquals(resp.status, 412);
});

Deno.test('returns 200 on idempotent cache hit', async () => {
  const cachedResponse = JSON.stringify({ merchant: 'Cached', items: [] });
  const deps = makeBaseDeps({
    createAdminClient: () =>
      ({
        from: (table: string) => {
          if (table === 'user_households') {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    maybeSingle: () => Promise.resolve({ data: { user_id: 'u1' }, error: null }),
                  }),
                }),
              }),
            };
          }
          if (table === 'user_consent') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: { slip_scan_consent_at: '2026-04-01' },
                      error: null,
                    }),
                }),
              }),
            };
          }
          if (table === 'slip_queue') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 's1',
                        status: 'completed',
                        raw_response_json: cachedResponse,
                        created_by: 'u1',
                      },
                      error: null,
                    }),
                }),
              }),
            };
          }
          return { select: () => ({}), update: () => ({ eq: () => Promise.resolve({}) }) };
        },
      }) as any,
  });
  const req = makeRequest(
    { slip_id: 's1', household_id: 'h1', images_base64: ['aaa'] },
    'Bearer tok',
  );
  const resp = await handle(req, deps);
  assertEquals(resp.status, 200);
  const body = await resp.text();
  assertEquals(body, cachedResponse);
});

Deno.test('returns 413 when payload too large', async () => {
  const largeb64 = 'A'.repeat(7 * 1024 * 1024); // ~7MB
  const deps = makeBaseDeps();
  const req = makeRequest(
    { slip_id: 's1', household_id: 'h1', images_base64: [largeb64] },
    'Bearer tok',
  );
  const resp = await handle(req, deps);
  assertEquals(resp.status, 413);
});

Deno.test('returns 503 when OpenAI is unreachable', async () => {
  const deps = makeBaseDeps({
    openAIFetch: () => Promise.resolve(new Response('Server error', { status: 503 })) as any,
  });
  // Need slip_queue update to not throw
  const req = makeRequest(
    { slip_id: 'slip1', household_id: 'h1', images_base64: ['aaa'] },
    'Bearer tok',
  );
  const resp = await handle(req, deps);
  assertEquals(resp.status, 503);
});

Deno.test('returns 200 on happy path', async () => {
  const deps = makeBaseDeps();
  const req = makeRequest(
    { slip_id: 'slip1', household_id: 'h1', images_base64: ['aaa'] },
    'Bearer tok',
  );
  const resp = await handle(req, deps);
  assertEquals(resp.status, 200);
  const body = await resp.json();
  assertEquals(body.merchant, 'Pick n Pay');
  assertEquals(body.items.length, 1);
});
