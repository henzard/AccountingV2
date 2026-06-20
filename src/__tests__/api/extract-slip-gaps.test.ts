/**
 * extract-slip-gaps.test.ts — WS4
 *
 * Supplements existing Deno tests by covering missing edge paths of the
 * extract-slip handler. Since the production handler uses Deno imports,
 * we replicate its contract-critical logic here for Jest compatibility.
 *
 * Tests:
 *   - Method not POST → 405
 *   - Missing OPENAI_API_KEY env → 500
 *   - Consent timestamp invalid/future → 412
 *   - Rate check RPC returns error → 500
 */

// ─── Minimal handler replica (matches supabase/functions/extract-slip/index.ts) ──

interface HandleDeps {
  createCallerClient: (authHeader: string) => any;
  createAdminClient: () => any;
  openAIFetch: typeof fetch;
  env: {
    OPENAI_API_KEY: string;
    SUPABASE_URL: string;
    SUPABASE_SERVICE_ROLE_KEY: string;
    SUPABASE_ANON_KEY: string;
  };
}

async function handle(req: Request, deps: HandleDeps): Promise<Response> {
  if (!deps.env.OPENAI_API_KEY) {
    return new Response('Server misconfigured', { status: 500 });
  }

  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return new Response('Unauthorized', { status: 401 });

  const callerSupabase = deps.createCallerClient(authHeader);
  const { data: userData, error: userErr } = await callerSupabase.auth.getUser();
  if (userErr || !userData.user) return new Response('Unauthorized', { status: 401 });
  const callerId = userData.user.id;

  let body: { slip_id?: string; household_id?: string; images_base64?: string[] };
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }
  const { slip_id, household_id, images_base64 } = body;
  if (!slip_id || !household_id || !Array.isArray(images_base64)) {
    return new Response('Missing required fields', { status: 400 });
  }
  if (images_base64.length < 1 || images_base64.length > 5) {
    return new Response('Invalid image count', { status: 400 });
  }

  const adminSupabase = deps.createAdminClient();

  // Household membership check
  const { data: membership } = await adminSupabase
    .from('user_households')
    .select('user_id')
    .eq('household_id', household_id)
    .eq('user_id', callerId)
    .maybeSingle();
  if (!membership) return new Response('Forbidden', { status: 403 });

  // Consent check
  const { data: consent } = await adminSupabase
    .from('user_consent')
    .select('slip_scan_consent_at')
    .eq('user_id', callerId)
    .maybeSingle();
  if (!consent?.slip_scan_consent_at) return new Response('Consent required', { status: 412 });
  const consentDate = Date.parse(consent.slip_scan_consent_at);
  if (isNaN(consentDate) || consentDate > Date.now()) {
    return new Response('Consent invalid', { status: 412 });
  }

  // Slip ownership check
  const { data: slipRow } = await adminSupabase
    .from('slip_queue')
    .select('id, status, raw_response_json, created_by, household_id')
    .eq('id', slip_id)
    .maybeSingle();
  if (!slipRow || slipRow.created_by !== callerId || slipRow.household_id !== household_id)
    return new Response('Forbidden', { status: 403 });

  // Idempotency + status guard
  if (slipRow.status === 'completed' && slipRow.raw_response_json) {
    return new Response(slipRow.raw_response_json, {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (slipRow.status === 'processing') {
    return new Response('Slip already processing', { status: 409 });
  }

  // Payload size cap
  const totalBytes = images_base64.reduce(
    (acc: number, b64: string) => acc + (b64.length * 3) / 4,
    0,
  );
  if (totalBytes > 5 * 1024 * 1024) return new Response('Payload too large', { status: 413 });

  // Rate-limit check
  const { data: rateCheck, error: rateError } = await adminSupabase.rpc(
    'check_and_reserve_slip_slot',
    { p_household_id: household_id, p_user_id: callerId, p_slip_id: slip_id },
  );
  if (rateError) return new Response('Rate limit check failed', { status: 500 });

  if (!rateCheck || typeof (rateCheck as { allowed?: unknown }).allowed !== 'boolean') {
    return new Response('Rate limit check failed', { status: 500 });
  }
  const check = rateCheck as { allowed: boolean; reason?: string };
  if (!check.allowed) {
    const msg = check.reason === 'user_limit' ? 'User rate limit' : 'Household rate limit';
    return new Response(msg, { status: 429 });
  }

  return new Response(JSON.stringify({ status: 'would_proceed' }), { status: 200 });
}

// ─── Test helpers ────────────────────────────────────────────────────────────

function makeRequest(method: string, body: unknown, authHeader?: string): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authHeader) headers['Authorization'] = authHeader;
  return new Request('http://localhost/extract-slip', {
    method,
    headers,
    ...(method !== 'GET' ? { body: JSON.stringify(body) } : {}),
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
      const chainedEq: any = {
        eq: () => chainedEq,
        maybeSingle: () => Promise.resolve({ data: slipRow, error: null }),
      };
      return {
        select: () => ({ eq: () => chainedEq }),
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
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

  return {
    createCallerClient: () => callerSupabase as any,
    createAdminClient: () => adminSupabase as any,
    openAIFetch: jest.fn().mockResolvedValue(new Response('{}', { status: 200 })),
    env: {
      OPENAI_API_KEY: 'sk-test',
      SUPABASE_URL: 'http://localhost',
      SUPABASE_SERVICE_ROLE_KEY: 'service-key',
      SUPABASE_ANON_KEY: 'anon-key',
    },
    ...overrides,
  };
}

// ═════════════════════════════════════════════════════════════════════════════════
// GAP TESTS — edge paths not covered by existing Deno test suite
// ═════════════════════════════════════════════════════════════════════════════════

describe('extract-slip edge-case gaps', () => {
  describe('Method not POST → 405', () => {
    it('GET request returns 405', async () => {
      const deps = makeBaseDeps();
      const req = new Request('http://localhost/extract-slip', { method: 'GET' });
      const resp = await handle(req, deps);
      expect(resp.status).toBe(405);
      expect(await resp.text()).toBe('Method not allowed');
    });

    it('PUT request returns 405', async () => {
      const deps = makeBaseDeps();
      const req = new Request('http://localhost/extract-slip', {
        method: 'PUT',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });
      const resp = await handle(req, deps);
      expect(resp.status).toBe(405);
    });

    it('DELETE request returns 405', async () => {
      const deps = makeBaseDeps();
      const req = new Request('http://localhost/extract-slip', { method: 'DELETE' });
      const resp = await handle(req, deps);
      expect(resp.status).toBe(405);
    });
  });

  describe('SEC-RT-011: invalid image count → 400', () => {
    it('empty images_base64 array returns 400', async () => {
      const deps = makeBaseDeps();
      const req = makeRequest(
        'POST',
        { slip_id: 's1', household_id: 'h1', images_base64: [] },
        'Bearer tok',
      );
      const resp = await handle(req, deps);
      expect(resp.status).toBe(400);
      expect(await resp.text()).toBe('Invalid image count');
    });

    it('more than 5 images returns 400', async () => {
      const deps = makeBaseDeps();
      const req = makeRequest(
        'POST',
        {
          slip_id: 's1',
          household_id: 'h1',
          images_base64: ['a', 'b', 'c', 'd', 'e', 'f'],
        },
        'Bearer tok',
      );
      const resp = await handle(req, deps);
      expect(resp.status).toBe(400);
      expect(await resp.text()).toBe('Invalid image count');
    });

    it('exactly 1 image passes count guard', async () => {
      const deps = makeBaseDeps();
      const req = makeRequest(
        'POST',
        { slip_id: 's1', household_id: 'h1', images_base64: ['a'] },
        'Bearer tok',
      );
      const resp = await handle(req, deps);
      expect(resp.status).toBe(200);
    });

    it('exactly 5 images passes count guard', async () => {
      const deps = makeBaseDeps();
      const req = makeRequest(
        'POST',
        {
          slip_id: 's1',
          household_id: 'h1',
          images_base64: ['a', 'b', 'c', 'd', 'e'],
        },
        'Bearer tok',
      );
      const resp = await handle(req, deps);
      expect(resp.status).toBe(200);
    });
  });

  describe('Missing OPENAI_API_KEY → 500', () => {
    it('empty OPENAI_API_KEY returns 500', async () => {
      const deps = makeBaseDeps({
        env: {
          OPENAI_API_KEY: '',
          SUPABASE_URL: 'http://localhost',
          SUPABASE_SERVICE_ROLE_KEY: 'key',
          SUPABASE_ANON_KEY: 'anon',
        },
      });
      const req = makeRequest(
        'POST',
        { slip_id: 's1', household_id: 'h1', images_base64: ['aaa'] },
        'Bearer tok',
      );
      const resp = await handle(req, deps);
      expect(resp.status).toBe(500);
      expect(await resp.text()).toBe('Server misconfigured');
    });
  });

  describe('Consent timestamp invalid/future → 412', () => {
    it('invalid consent timestamp (not a date) returns 412', async () => {
      const deps = makeBaseDeps({
        createAdminClient: () => ({
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
                        data: { slip_scan_consent_at: 'not-a-valid-date' },
                        error: null,
                      }),
                  }),
                }),
              };
            }
            return { select: () => ({}), update: () => ({ eq: () => Promise.resolve({}) }) };
          },
          rpc: () => Promise.resolve({ data: { allowed: true }, error: null }),
        }),
      });
      const req = makeRequest(
        'POST',
        { slip_id: 's1', household_id: 'h1', images_base64: ['aaa'] },
        'Bearer tok',
      );
      const resp = await handle(req, deps);
      expect(resp.status).toBe(412);
      expect(await resp.text()).toBe('Consent invalid');
    });

    it('future consent timestamp returns 412', async () => {
      const futureDate = new Date(Date.now() + 86_400_000 * 30).toISOString(); // 30 days ahead
      const deps = makeBaseDeps({
        createAdminClient: () => ({
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
                        data: { slip_scan_consent_at: futureDate },
                        error: null,
                      }),
                  }),
                }),
              };
            }
            return { select: () => ({}), update: () => ({ eq: () => Promise.resolve({}) }) };
          },
          rpc: () => Promise.resolve({ data: { allowed: true }, error: null }),
        }),
      });
      const req = makeRequest(
        'POST',
        { slip_id: 's1', household_id: 'h1', images_base64: ['aaa'] },
        'Bearer tok',
      );
      const resp = await handle(req, deps);
      expect(resp.status).toBe(412);
      expect(await resp.text()).toBe('Consent invalid');
    });
  });

  describe('Rate check RPC returns error → 500', () => {
    it('rpc error object returns 500', async () => {
      const deps = makeBaseDeps({
        createAdminClient: () => {
          const base = makeBaseDeps().createAdminClient();
          return {
            ...base,
            rpc: () => Promise.resolve({ data: null, error: { message: 'DB connection lost' } }),
          };
        },
      });
      const req = makeRequest(
        'POST',
        { slip_id: 'slip1', household_id: 'h1', images_base64: ['aaa'] },
        'Bearer tok',
      );
      const resp = await handle(req, deps);
      expect(resp.status).toBe(500);
      expect(await resp.text()).toBe('Rate limit check failed');
    });

    it('rpc returns malformed data (no allowed field) returns 500', async () => {
      const deps = makeBaseDeps({
        createAdminClient: () => {
          const base = makeBaseDeps().createAdminClient();
          return {
            ...base,
            rpc: () => Promise.resolve({ data: { unexpected: 'shape' }, error: null }),
          };
        },
      });
      const req = makeRequest(
        'POST',
        { slip_id: 'slip1', household_id: 'h1', images_base64: ['aaa'] },
        'Bearer tok',
      );
      const resp = await handle(req, deps);
      expect(resp.status).toBe(500);
      expect(await resp.text()).toBe('Rate limit check failed');
    });

    it('rpc returns null data returns 500', async () => {
      const deps = makeBaseDeps({
        createAdminClient: () => {
          const base = makeBaseDeps().createAdminClient();
          return {
            ...base,
            rpc: () => Promise.resolve({ data: null, error: null }),
          };
        },
      });
      const req = makeRequest(
        'POST',
        { slip_id: 'slip1', household_id: 'h1', images_base64: ['aaa'] },
        'Bearer tok',
      );
      const resp = await handle(req, deps);
      expect(resp.status).toBe(500);
      expect(await resp.text()).toBe('Rate limit check failed');
    });
  });
});
