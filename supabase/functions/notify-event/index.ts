// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0';

interface NotifyPayload {
  userId: string;
  householdId: string;
  title: string;
  body: string;
}

// The FCM legacy API (fcm.googleapis.com/fcm/send) was shut down by Google in
// mid-2024. This function sends via FCM HTTP v1
// (fcm.googleapis.com/v1/projects/<id>/messages:send), authenticated with an
// OAuth2 access token minted from a Google service-account JWT.
export interface FcmServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

export interface TokenCacheEntry {
  accessToken: string;
  expiresAtMs: number;
}

// Using `any` for the client type so the generic Supabase client works without
// a DB schema definition — matches the extract-slip edge function's style.
export type HandleDeps = {
  createCallerClient: (authHeader: string) => any;
  createAdminClient: () => any;
  fetchImpl: typeof fetch;
  now: () => number;
  // Mutable holder so the access token can be cached across warm invocations
  // of the same edge-function isolate (minting a fresh token costs an extra
  // round trip to Google on every single push otherwise).
  tokenCache: { entry: TokenCacheEntry | null };
  env: {
    SUPABASE_URL: string;
    SUPABASE_ANON_KEY: string;
    SUPABASE_SERVICE_ROLE_KEY: string;
    // The Google service-account JSON, as a raw string (Deno.env.get value).
    // Absent until the owner runs `supabase secrets set FCM_SERVICE_ACCOUNT=...`.
    FCM_SERVICE_ACCOUNT?: string;
  };
};

const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
// Refresh the cached token a minute before it actually expires so a
// request never races an expiry mid-flight.
const TOKEN_SAFETY_MARGIN_MS = 60_000;
const DEFAULT_TOKEN_TTL_SEC = 3600;

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlEncodeString(s: string): string {
  return base64UrlEncodeBytes(new TextEncoder().encode(s));
}

function pemToDer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function importPrivateKey(pem: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'pkcs8',
    pemToDer(pem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

// Hand-rolled RS256 service-account JWT (Deno's Web Crypto API), rather than
// `npm:google-auth-library` — no extra dependency, and it keeps signing
// synchronous-in-spirit and easy to exercise in Deno tests.
async function signServiceAccountJwt(sa: FcmServiceAccount, nowSec: number): Promise<string> {
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: sa.client_email,
    scope: FCM_SCOPE,
    aud: GOOGLE_TOKEN_URL,
    iat: nowSec,
    exp: nowSec + DEFAULT_TOKEN_TTL_SEC,
  };
  const signingInput = `${base64UrlEncodeString(JSON.stringify(header))}.${base64UrlEncodeString(JSON.stringify(claims))}`;
  const key = await importPrivateKey(sa.private_key);
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64UrlEncodeBytes(new Uint8Array(signature))}`;
}

async function mintAccessToken(sa: FcmServiceAccount, deps: HandleDeps): Promise<string> {
  const nowMs = deps.now();
  const cached = deps.tokenCache.entry;
  if (cached && cached.expiresAtMs - TOKEN_SAFETY_MARGIN_MS > nowMs) {
    return cached.accessToken;
  }

  const assertion = await signServiceAccountJwt(sa, Math.floor(nowMs / 1000));
  const res = await deps.fetchImpl(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString(),
  });
  if (!res.ok) {
    throw new Error(`FCM token mint failed with status ${res.status}`);
  }
  const json = (await res.json()) as { access_token?: unknown; expires_in?: unknown };
  if (typeof json.access_token !== 'string' || !json.access_token) {
    throw new Error('FCM token mint response missing access_token');
  }
  const expiresInSec =
    typeof json.expires_in === 'number' ? json.expires_in : DEFAULT_TOKEN_TTL_SEC;
  deps.tokenCache.entry = {
    accessToken: json.access_token,
    expiresAtMs: nowMs + expiresInSec * 1000,
  };
  return json.access_token;
}

// The FCM HTTP v1 message shape. v1 has no multicast-to-token-list — callers
// send one message per token.
//
// `android.priority: 'high'` and `apns.headers['apns-priority'] = '10'` are
// delivery-priority hints carried over from the legacy implementation. FCM
// defaults new v1 messages to normal/5 priority, which providers may queue or
// delay (especially on Doze/App Standby and iOS background delivery) —
// without these hints, budget-alert and slip-processing pushes can arrive
// minutes late or be silently coalesced away by the OS.
export function buildV1Message(
  token: string,
  title: string,
  body: string,
): {
  message: {
    token: string;
    notification: { title: string; body: string };
    android: { priority: 'high' };
    apns: { headers: { 'apns-priority': '10' } };
  };
} {
  return {
    message: {
      token,
      notification: { title, body },
      android: { priority: 'high' },
      apns: { headers: { 'apns-priority': '10' } },
    },
  };
}

function parseServiceAccount(raw: string): FcmServiceAccount | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const { project_id, client_email, private_key } = parsed;
    if (
      typeof project_id === 'string' &&
      project_id &&
      typeof client_email === 'string' &&
      client_email &&
      typeof private_key === 'string' &&
      private_key
    ) {
      return { project_id, client_email, private_key };
    }
    return null;
  } catch {
    return null;
  }
}

const MAX_TITLE = 120;
const MAX_BODY = 500;
const MAX_ID_LENGTH = 200;
const MAX_SENDS_PER_HOUR = 20;

function isValidId(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= MAX_ID_LENGTH;
}

export async function handle(req: Request, deps: HandleDeps): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  // 1. Auth
  const authHeader = req.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const callerSupabase = deps.createCallerClient(authHeader);
  const {
    data: { user },
    error: userErr,
  } = await callerSupabase.auth.getUser();
  if (userErr || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 2. Parse + validate payload shape
  let payload: NotifyPayload;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid payload' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const { userId, householdId, title, body } = payload;

  if (
    !isValidId(userId) ||
    !isValidId(householdId) ||
    typeof title !== 'string' ||
    typeof body !== 'string' ||
    !title.trim() ||
    !body.trim()
  ) {
    return new Response(JSON.stringify({ error: 'Invalid payload' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (title.length > MAX_TITLE || body.length > MAX_BODY) {
    return new Response(JSON.stringify({ error: 'Payload too large' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const serviceClient = deps.createAdminClient();

  // 3. Caller must be a member of the household.
  // deleted_at IS NULL matches extract-slip's membership predicate — a
  // soft-deleted/removed member must not retain push-send access, and
  // without it a member who left-and-rejoined has 2 rows (one soft-deleted,
  // one active) which makes .single() throw a spurious 403 forever.
  // maybeSingle() tolerates a null result without throwing.
  const { data: membership } = await serviceClient
    .from('household_members')
    .select('user_id')
    .eq('household_id', householdId)
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .maybeSingle();

  if (!membership) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Verify the target userId is also a member of the same household.
  // Without this check, an authenticated caller could send push
  // notifications to any user in the system (IDOR). Same deleted_at +
  // maybeSingle() reasoning as the caller check above.
  const { data: targetMembership } = await serviceClient
    .from('household_members')
    .select('user_id')
    .eq('household_id', householdId)
    .eq('user_id', userId)
    .is('deleted_at', null)
    .maybeSingle();

  if (!targetMembership) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 4. Load the target's device token(s).
  const { data: tokens, error } = await serviceClient
    .from('user_fcm_tokens')
    .select('token')
    .eq('user_id', userId);

  if (error) {
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!tokens || tokens.length === 0) {
    return new Response(JSON.stringify({ sent: 0 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 5. Push configuration check — before burning rate-limit budget below.
  // Live push requires the owner to run:
  //   supabase secrets set FCM_SERVICE_ACCOUNT='<service-account-json>'
  // Until that's done, respond gracefully rather than crash or 500 — the
  // function must still deploy and run so the rest of the app is unaffected.
  const saRaw = deps.env.FCM_SERVICE_ACCOUNT;
  const sa = saRaw ? parseServiceAccount(saRaw) : null;
  if (!sa) {
    // Deliberately does not name the missing/invalid secret in the response —
    // error responses must never reveal env var names (see Finding 2 in
    // src/__tests__/security/security-audit-findings.test.ts).
    return new Response(
      JSON.stringify({
        sent: 0,
        pushConfigured: false,
        error: 'Push notifications are not configured',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // 6. Rate limit (unchanged from the legacy implementation).
  const { data: allowed, error: rateErr } = await serviceClient.rpc(
    'check_and_reserve_notify_send',
    { p_sender_id: user.id, p_max_per_hour: MAX_SENDS_PER_HOUR },
  );

  if (rateErr) {
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!allowed) {
    return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 7. Mint (or reuse cached) OAuth2 access token.
  let accessToken: string;
  try {
    accessToken = await mintAccessToken(sa, deps);
  } catch {
    return new Response(JSON.stringify({ error: 'Push service unavailable' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 8. Send one FCM v1 message per token; prune tokens FCM reports as dead.
  let sent = 0;
  const staleTokens: string[] = [];
  for (const { token } of tokens) {
    const res = await deps.fetchImpl(
      `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(buildV1Message(token, title, body)),
      },
    );

    if (res.ok) {
      sent++;
      continue;
    }

    let fcmStatus: string | undefined;
    try {
      const errJson = (await res.json()) as { error?: { status?: unknown } };
      if (typeof errJson.error?.status === 'string') fcmStatus = errJson.error.status;
    } catch {
      // Non-JSON error body — nothing to prune on, just skip this token.
    }
    if (fcmStatus === 'UNREGISTERED' || fcmStatus === 'INVALID_ARGUMENT') {
      staleTokens.push(token);
    }
  }

  // 9. Prune stale tokens (deep-review finding: dead tokens accumulate forever
  // otherwise, silently wasting sends).
  if (staleTokens.length > 0) {
    await serviceClient
      .from('user_fcm_tokens')
      .delete()
      .eq('user_id', userId)
      .in('token', staleTokens);
  }

  return new Response(JSON.stringify({ sent, pruned: staleTokens.length }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Production entry point — only runs when executed directly by Deno.
if (import.meta.main) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const prodDeps: HandleDeps = {
    createCallerClient: (authHeader: string) =>
      createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } },
      }),
    createAdminClient: () => createClient(supabaseUrl, supabaseServiceKey),
    fetchImpl: fetch,
    now: () => Date.now(),
    tokenCache: { entry: null },
    env: {
      SUPABASE_URL: supabaseUrl,
      SUPABASE_ANON_KEY: supabaseAnonKey,
      SUPABASE_SERVICE_ROLE_KEY: supabaseServiceKey,
      FCM_SERVICE_ACCOUNT: Deno.env.get('FCM_SERVICE_ACCOUNT'),
    },
  };

  Deno.serve((req: Request) => handle(req, prodDeps));
}
