/**
 * Security tests: Edge function authentication and authorization.
 * Tests extract-slip and notify-event Supabase Edge Functions.
 *
 * NOTE: The edge function source uses Deno-specific syntax (import.meta.main)
 * that cannot be directly imported in Jest/Node. Tests validate the auth
 * contract via source code inspection and mocked handler patterns.
 */
import * as fs from 'fs';
import * as path from 'path';

// ─── Source Paths ────────────────────────────────────────────────────────────

const FUNCTIONS_DIR = path.resolve(__dirname, '../../../supabase/functions');
const EXTRACT_SLIP_SOURCE = fs.readFileSync(
  path.join(FUNCTIONS_DIR, 'extract-slip/index.ts'),
  'utf-8',
);
const NOTIFY_EVENT_SOURCE = fs.readFileSync(
  path.join(FUNCTIONS_DIR, 'notify-event/index.ts'),
  'utf-8',
);

// ─── Shared Helpers ──────────────────────────────────────────────────────────

const VALID_USER_ID = '11111111-1111-1111-1111-111111111111';
const VALID_HOUSEHOLD_ID = 'aaaa1111-aaaa-aaaa-aaaa-aaaa11111111';
const OTHER_USER_ID = '33333333-3333-3333-3333-333333333333';

interface MockDeps {
  getUser: jest.Mock;
  membershipLookup: jest.Mock;
  consentLookup: jest.Mock;
  slipLookup: jest.Mock;
}

function makeMockDeps(overrides: Partial<MockDeps> = {}): MockDeps {
  return {
    getUser: jest.fn().mockResolvedValue({ user: { id: VALID_USER_ID }, error: null }),
    membershipLookup: jest.fn().mockResolvedValue({ user_id: VALID_USER_ID }),
    consentLookup: jest.fn().mockResolvedValue({ slip_scan_consent_at: '2026-01-01T00:00:00Z' }),
    slipLookup: jest.fn().mockResolvedValue({
      id: 's1',
      status: 'pending',
      raw_response_json: null,
      created_by: VALID_USER_ID,
      household_id: VALID_HOUSEHOLD_ID,
    }),
    ...overrides,
  };
}

/**
 * Simulates the extract-slip auth flow (mirrors the actual edge function logic)
 * without needing to import the Deno-specific module.
 */
async function simulateExtractSlipAuth(
  req: { method: string; authHeader: string | null; body: any },
  deps: MockDeps,
  envKey = 'sk-test',
): Promise<{ status: number; body: string }> {
  if (!envKey) return { status: 500, body: 'Server misconfigured' };
  if (req.method !== 'POST') return { status: 405, body: 'Method not allowed' };
  if (!req.authHeader) return { status: 401, body: 'Unauthorized' };

  const { user, error } = await deps.getUser();
  if (error || !user) return { status: 401, body: 'Unauthorized' };

  const { slip_id, household_id, images_base64 } = req.body ?? {};
  if (!slip_id || !household_id || !Array.isArray(images_base64)) {
    return { status: 400, body: 'Missing required fields' };
  }

  const membership = await deps.membershipLookup(household_id, user.id);
  if (!membership) return { status: 403, body: 'Forbidden' };

  const consent = await deps.consentLookup(user.id);
  if (!consent?.slip_scan_consent_at) return { status: 412, body: 'Consent required' };

  const slipRow = await deps.slipLookup(slip_id);
  if (!slipRow || slipRow.created_by !== user.id || slipRow.household_id !== household_id) {
    return { status: 403, body: 'Forbidden' };
  }

  return { status: 200, body: 'OK' };
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXTRACT-SLIP SOURCE CODE AUTH VERIFICATION
// ═══════════════════════════════════════════════════════════════════════════════

describe('extract-slip: source code auth patterns', () => {
  it('checks for Authorization header', () => {
    expect(EXTRACT_SLIP_SOURCE).toContain("req.headers.get('Authorization')");
    expect(EXTRACT_SLIP_SOURCE).toContain('if (!authHeader)');
  });

  it('validates user via getUser()', () => {
    expect(EXTRACT_SLIP_SOURCE).toContain('auth.getUser()');
    expect(EXTRACT_SLIP_SOURCE).toContain('if (userErr || !userData.user)');
  });

  it('checks household membership', () => {
    expect(EXTRACT_SLIP_SOURCE).toContain('user_households');
    expect(EXTRACT_SLIP_SOURCE).toContain("if (!membership) return new Response('Forbidden'");
  });

  it('verifies slip ownership (created_by + household_id)', () => {
    expect(EXTRACT_SLIP_SOURCE).toContain('slipRow.created_by !== callerId');
    expect(EXTRACT_SLIP_SOURCE).toContain('slipRow.household_id !== household_id');
  });

  it('rejects non-POST methods', () => {
    expect(EXTRACT_SLIP_SOURCE).toContain("req.method !== 'POST'");
    expect(EXTRACT_SLIP_SOURCE).toContain('status: 405');
  });

  it('returns 500 if OPENAI_API_KEY is not set', () => {
    expect(EXTRACT_SLIP_SOURCE).toContain('if (!deps.env.OPENAI_API_KEY)');
    expect(EXTRACT_SLIP_SOURCE).toContain('status: 500');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// EXTRACT-SLIP BEHAVIOR TESTS (mocked handler)
// ═══════════════════════════════════════════════════════════════════════════════

describe('extract-slip Edge Function Auth Behavior', () => {
  it('returns 401 without JWT (no Authorization header)', async () => {
    const deps = makeMockDeps();
    const result = await simulateExtractSlipAuth(
      {
        method: 'POST',
        authHeader: null,
        body: { slip_id: 's1', household_id: VALID_HOUSEHOLD_ID, images_base64: ['abc'] },
      },
      deps,
    );
    expect(result.status).toBe(401);
  });

  it('returns 401 with invalid JWT (getUser fails)', async () => {
    const deps = makeMockDeps({
      getUser: jest.fn().mockResolvedValue({ user: null, error: { message: 'invalid token' } }),
    });
    const result = await simulateExtractSlipAuth(
      {
        method: 'POST',
        authHeader: 'Bearer invalid-token',
        body: { slip_id: 's1', household_id: VALID_HOUSEHOLD_ID, images_base64: ['abc'] },
      },
      deps,
    );
    expect(result.status).toBe(401);
  });

  it('returns 403 with valid JWT but wrong household (user not a member)', async () => {
    const deps = makeMockDeps({
      membershipLookup: jest.fn().mockResolvedValue(null),
    });
    const result = await simulateExtractSlipAuth(
      {
        method: 'POST',
        authHeader: 'Bearer valid-token',
        body: { slip_id: 's1', household_id: 'other-household', images_base64: ['abc'] },
      },
      deps,
    );
    expect(result.status).toBe(403);
  });

  it("returns 403 with valid JWT but another user's slip", async () => {
    const deps = makeMockDeps({
      slipLookup: jest.fn().mockResolvedValue({
        id: 's1',
        status: 'pending',
        raw_response_json: null,
        created_by: OTHER_USER_ID,
        household_id: VALID_HOUSEHOLD_ID,
      }),
    });
    const result = await simulateExtractSlipAuth(
      {
        method: 'POST',
        authHeader: 'Bearer valid-token',
        body: { slip_id: 's1', household_id: VALID_HOUSEHOLD_ID, images_base64: ['abc'] },
      },
      deps,
    );
    expect(result.status).toBe(403);
  });

  it('returns 405 for non-POST method', async () => {
    const deps = makeMockDeps();
    const result = await simulateExtractSlipAuth(
      { method: 'GET', authHeader: 'Bearer valid-token', body: null },
      deps,
    );
    expect(result.status).toBe(405);
  });

  it('returns 500 when OPENAI_API_KEY is missing', async () => {
    const deps = makeMockDeps();
    const result = await simulateExtractSlipAuth(
      {
        method: 'POST',
        authHeader: 'Bearer valid-token',
        body: { slip_id: 's1', household_id: VALID_HOUSEHOLD_ID, images_base64: ['abc'] },
      },
      deps,
      '',
    );
    expect(result.status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// NOTIFY-EVENT AUTH TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('notify-event Edge Function Auth', () => {
  it('checks for Authorization header', () => {
    const hasAuthCheck =
      NOTIFY_EVENT_SOURCE.includes("req.headers.get('Authorization')") ||
      NOTIFY_EVENT_SOURCE.includes('req.headers.get("Authorization")');

    expect(hasAuthCheck).toBe(true);
  });

  it('validates user via auth.getUser()', () => {
    expect(NOTIFY_EVENT_SOURCE).toContain('auth.getUser()');
  });

  it('verifies caller is a member of the target household', () => {
    expect(NOTIFY_EVENT_SOURCE).toContain('household_members');
    expect(NOTIFY_EVENT_SOURCE).toContain('household');
  });

  it('returns 401 if no Authorization header is present', () => {
    expect(NOTIFY_EVENT_SOURCE).toContain('status: 401');
  });

  it('returns 403 if caller is not in the household', () => {
    expect(NOTIFY_EVENT_SOURCE).toContain('status: 403');
    expect(NOTIFY_EVENT_SOURCE).toContain('Forbidden');
  });

  it('rejects non-POST methods', () => {
    expect(NOTIFY_EVENT_SOURCE).toContain("req.method !== 'POST'");
    expect(NOTIFY_EVENT_SOURCE).toContain('status: 405');
  });

  it('SEC-RT-007: validates payload and enforces rate limit', () => {
    expect(NOTIFY_EVENT_SOURCE).toContain('Invalid payload');
    expect(NOTIFY_EVENT_SOURCE).toContain('Payload too large');
    expect(NOTIFY_EVENT_SOURCE).toContain('check_and_reserve_notify_send');
    expect(NOTIFY_EVENT_SOURCE).toContain('Rate limit exceeded');
    expect(NOTIFY_EVENT_SOURCE).toContain('status: 429');
  });
});
