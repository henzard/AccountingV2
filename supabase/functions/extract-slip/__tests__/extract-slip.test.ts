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
        status: 'pending',
        raw_response_json: null,
        created_by: 'u1',
        household_id: 'h1',
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chainedEq: any = {
        eq: () => chainedEq,
        maybeSingle: () => Promise.resolve({ data: slipRow, error: null }),
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

  const adminSupabase = {
    from: adminFrom,
    rpc: (_name: string, _args: unknown) =>
      Promise.resolve({ data: { allowed: true }, error: null }),
  };

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
                        household_id: 'h1',
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

// ── Additional test cases from PR #8 review ──────────────────────────────────

Deno.test('returns 429 when household rate limit reached (>= 50)', async () => {
  const baseDeps = makeBaseDeps();
  const deps: HandleDeps = {
    ...baseDeps,
    createAdminClient: () => {
      const base = baseDeps.createAdminClient();
      return {
        ...base,
        rpc: (_name: string, _args: unknown) =>
          Promise.resolve({
            data: { allowed: false, reason: 'household_limit' },
            error: null,
          }),
      };
    },
  };
  const req = makeRequest(
    { slip_id: 'slip1', household_id: 'h1', images_base64: ['aaa'] },
    'Bearer tok',
  );
  const resp = await handle(req, deps);
  assertEquals(resp.status, 429);
});

Deno.test('returns 429 when user rate limit reached (>= 25)', async () => {
  const baseDeps = makeBaseDeps();
  const deps: HandleDeps = {
    ...baseDeps,
    createAdminClient: () => {
      const base = baseDeps.createAdminClient();
      return {
        ...base,
        rpc: (_name: string, _args: unknown) =>
          Promise.resolve({
            data: { allowed: false, reason: 'user_limit' },
            error: null,
          }),
      };
    },
  };
  const req = makeRequest(
    { slip_id: 'slip1', household_id: 'h1', images_base64: ['aaa'] },
    'Bearer tok',
  );
  const resp = await handle(req, deps);
  assertEquals(resp.status, 429);
});

Deno.test(
  'returns 503 when OpenAI returns empty content (null choices[0].message.content)',
  async () => {
    const deps = makeBaseDeps({
      openAIFetch: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              choices: [{ message: { content: null } }],
              usage: { prompt_tokens: 10, completion_tokens: 0 },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        ) as any,
    });
    const req = makeRequest(
      { slip_id: 'slip1', household_id: 'h1', images_base64: ['aaa'] },
      'Bearer tok',
    );
    const resp = await handle(req, deps);
    assertEquals(resp.status, 503);
  },
);

Deno.test('returns 503 when OpenAI returns invalid JSON in content', async () => {
  const deps = makeBaseDeps({
    openAIFetch: () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: 'not-json{{' } }],
            usage: { prompt_tokens: 10, completion_tokens: 0 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ) as any,
  });
  const req = makeRequest(
    { slip_id: 'slip1', household_id: 'h1', images_base64: ['aaa'] },
    'Bearer tok',
  );
  const resp = await handle(req, deps);
  assertEquals(resp.status, 503);
});

Deno.test('returns 422 when items.length > 100', async () => {
  const items = Array.from({ length: 101 }, (_, i) => ({
    description: `Item ${i}`,
    amount_cents: 100,
    quantity: 1,
    suggested_envelope_id: null,
    confidence: 0.8,
  }));
  const deps = makeBaseDeps({
    openAIFetch: () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    merchant: 'X',
                    slip_date: null,
                    total_cents: null,
                    items,
                  }),
                },
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 10 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ) as any,
  });
  const req = makeRequest(
    { slip_id: 'slip1', household_id: 'h1', images_base64: ['aaa'] },
    'Bearer tok',
  );
  const resp = await handle(req, deps);
  assertEquals(resp.status, 422);
});

Deno.test(
  'returns 403 when slip belongs to a different household (cross-household attack)',
  async () => {
    // User u1 is a member of h2 but submits slip_id whose household_id is h1.
    // The slip ownership check must reject this even though created_by matches.
    const deps = makeBaseDeps({
      createAdminClient: () =>
        ({
          from: (table: string) => {
            if (table === 'user_households') {
              // membership check passes for h2
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
              // slip belongs to h1, but the request body claims h2
              return {
                select: () => ({
                  eq: () => ({
                    maybeSingle: () =>
                      Promise.resolve({
                        data: {
                          id: 'slip1',
                          status: 'processing',
                          raw_response_json: null,
                          created_by: 'u1',
                          household_id: 'h1', // slip is in h1
                        },
                        error: null,
                      }),
                  }),
                }),
                update: () => ({ eq: () => Promise.resolve({ error: null }) }),
              };
            }
            return { select: () => ({}), update: () => ({ eq: () => Promise.resolve({}) }) };
          },
        }) as any,
    });
    // Request body claims household h2, but the slip lives in h1
    const req = makeRequest(
      { slip_id: 'slip1', household_id: 'h2', images_base64: ['aaa'] },
      'Bearer tok',
    );
    const resp = await handle(req, deps);
    assertEquals(resp.status, 403);
  },
);

Deno.test('returns 403 when slip created_by differs from caller', async () => {
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
                      data: { slip_scan_consent_at: '2026-04-01T00:00:00Z' },
                      error: null,
                    }),
                }),
              }),
            };
          }
          if (table === 'slip_queue') {
            // created_by is a different user
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'slip1',
                        status: 'processing',
                        raw_response_json: null,
                        created_by: 'other-user',
                        household_id: 'h1',
                      },
                      error: null,
                    }),
                }),
              }),
              update: () => ({ eq: () => Promise.resolve({ error: null }) }),
            };
          }
          return { select: () => ({}), update: () => ({ eq: () => Promise.resolve({}) }) };
        },
      }) as any,
  });
  const req = makeRequest(
    { slip_id: 'slip1', household_id: 'h1', images_base64: ['aaa'] },
    'Bearer tok',
  );
  const resp = await handle(req, deps);
  assertEquals(resp.status, 403);
});

Deno.test('returns 200 with items: [] when slip is unreadable', async () => {
  const deps = makeBaseDeps({
    openAIFetch: () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    merchant: null,
                    slip_date: null,
                    total_cents: null,
                    items: [],
                  }),
                },
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ) as any,
  });
  const req = makeRequest(
    { slip_id: 'slip1', household_id: 'h1', images_base64: ['aaa'] },
    'Bearer tok',
  );
  const resp = await handle(req, deps);
  assertEquals(resp.status, 200);
  const body = await resp.json();
  assertEquals(body.items.length, 0);
  assertEquals(body.merchant, null);
});

Deno.test(
  'prompt-injection: unknown suggested_envelope_id is nulled and confidence clamped to 0.3',
  async () => {
    const deps = makeBaseDeps({
      openAIFetch: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      merchant: 'Test',
                      slip_date: null,
                      total_cents: 1000,
                      items: [
                        {
                          description: 'Item',
                          amount_cents: 1000,
                          quantity: 1,
                          suggested_envelope_id: 'injected-unknown-id',
                          confidence: 0.9,
                        },
                      ],
                    }),
                  },
                },
              ],
              usage: { prompt_tokens: 10, completion_tokens: 10 },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        ) as any,
    });
    const req = makeRequest(
      { slip_id: 'slip1', household_id: 'h1', images_base64: ['aaa'] },
      'Bearer tok',
    );
    const resp = await handle(req, deps);
    assertEquals(resp.status, 200);
    const body = await resp.json();
    assertEquals(body.items[0].suggested_envelope_id, null);
    assertEquals(body.items[0].confidence <= 0.3, true);
  },
);

Deno.test('returns 429 household_limit when check_and_reserve_slip_slot disallows', async () => {
  const baseDeps = makeBaseDeps();

  const deps: HandleDeps = {
    ...baseDeps,
    createAdminClient: () => {
      const base = baseDeps.createAdminClient();
      return {
        ...base,
        from: (table: string) => {
          if (table === 'slip_queue') {
            // Override to return a pending slip (not completed/processing)
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    maybeSingle: () =>
                      Promise.resolve({
                        data: {
                          id: 'slip1',
                          status: 'pending',
                          raw_response_json: null,
                          created_by: 'u1',
                          household_id: 'h1',
                        },
                        error: null,
                      }),
                  }),
                }),
              }),
              update: () => ({ eq: () => Promise.resolve({ error: null }) }),
            };
          }
          return base.from(table);
        },
        rpc: (_name: string, _args: unknown) =>
          Promise.resolve({
            data: { allowed: false, reason: 'household_limit' },
            error: null,
          }),
      };
    },
  };

  const req = makeRequest(
    { slip_id: 'slip1', household_id: 'h1', images_base64: ['abc'] },
    'Bearer tok',
  );
  const resp = await handle(req, deps);
  assertEquals(resp.status, 429);
  assertEquals(await resp.text(), 'Household rate limit');
});

Deno.test('returns 409 when slip is already processing', async () => {
  const baseDeps = makeBaseDeps();

  const deps: HandleDeps = {
    ...baseDeps,
    createAdminClient: () => {
      const base = baseDeps.createAdminClient();
      return {
        ...base,
        from: (table: string) => {
          if (table === 'slip_queue') {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    maybeSingle: () =>
                      Promise.resolve({
                        data: {
                          id: 'slip1',
                          status: 'processing', // ← already in-flight
                          raw_response_json: null,
                          created_by: 'u1',
                          household_id: 'h1',
                        },
                        error: null,
                      }),
                  }),
                }),
              }),
              update: () => ({ eq: () => Promise.resolve({ error: null }) }),
            };
          }
          return base.from(table);
        },
      };
    },
  };

  const req = makeRequest(
    { slip_id: 'slip1', household_id: 'h1', images_base64: ['abc'] },
    'Bearer tok',
  );
  const resp = await handle(req, deps);
  assertEquals(resp.status, 409);
  assertEquals(await resp.text(), 'Slip already processing');
});
