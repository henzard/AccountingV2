// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0';

// ---------------------------------------------------------------------------
// Request shapes.
//
// SEC2-12: the function used to render whatever `title`/`body` the caller
// sent. Any household member could therefore put arbitrary text on another
// member's lock screen under the app's name ("Your bank account is locked:
// http://..."). Nothing caller-authored is rendered any more: the caller
// describes WHAT HAPPENED with typed, bounded fields and the SERVER writes
// the words.
//
// REG-15: the caller also used to invoke this function once per RECIPIENT,
// and every invocation cost one unit of the sender's 20/hour budget — ten
// transactions in a 3-member household exhausted it, and the over-budget
// alert (the push that matters most) was the one that came back 429. The
// function now resolves the recipients itself and reserves exactly ONE unit
// per EVENT, with `envelope_over_budget` in its own separate bucket so
// ordinary chatter can never starve a budget alert.
// ---------------------------------------------------------------------------

export type NotifyEventKind =
  | 'transaction_created'
  | 'envelope_over_budget'
  | 'slip_confirmed'
  | 'refund_recorded';

/** The old per-recipient shape. Still accepted for one release because
 * 1.1.134 clients are installed and send it; its caller-authored title/body
 * are validated for shape and then DISCARDED — see parseRequest(). */
interface LegacyNotifyPayload {
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
  // PUSH-2: routing-only metadata for the client's notification-tap handler
  // (RootNavigator.resolveNotificationTarget). FCM v1 requires every `data`
  // value to be a string. Never put amounts, payees, names or any other
  // free-text field in here — the notification text above is already
  // server-rendered; `data` exists purely so a tap can pick a screen.
  // Optional (and omitted from the built message when absent) so this stays
  // backward compatible with callers, and the wire shape, that predate it.
  data?: Record<string, string>,
): {
  message: {
    token: string;
    notification: { title: string; body: string };
    data?: Record<string, string>;
    android: { priority: 'high' };
    apns: { headers: { 'apns-priority': '10' } };
  };
} {
  return {
    message: {
      token,
      notification: { title, body },
      ...(data ? { data } : {}),
      android: { priority: 'high' },
      apns: { headers: { 'apns-priority': '10' } },
    },
  };
}

/** PUSH-2: maps a rendered event to one of a small, fixed set of client
 * routes that actually exist (src/presentation/navigation/types.ts) — a
 * Transactions tab, or the Dashboard as the catch-all for anything that
 * isn't specifically about spending/budget. Exported so every branch is
 * directly testable without a full request round trip. */
export function pushTargetForKind(kind: NotifyEventKind): 'Transactions' | 'Dashboard' {
  switch (kind) {
    case 'transaction_created':
    case 'envelope_over_budget':
    case 'refund_recorded':
      return 'Transactions';
    default:
      return 'Dashboard';
  }
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
/** Free-text event fields (envelope name, payee, merchant). */
const MAX_FREE_TEXT = 60;
/** Ordinary household chatter: transactions and confirmed slips. */
const MAX_SENDS_PER_HOUR = 20;
/** REG-15: over-budget alerts get their own, deliberately smaller, budget so
 * they can neither be starved by chatter nor become chatter themselves. */
const MAX_OVER_BUDGET_SENDS_PER_HOUR = 10;

const BUCKET_DEFAULT = 'default';
const BUCKET_OVER_BUDGET = 'over_budget';

/** The one message a 1.1.134 client's caller-authored payload can produce. */
const LEGACY_BODY = 'Household activity — open the app to see what changed';

function isValidId(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= MAX_ID_LENGTH;
}

// ---------------------------------------------------------------------------
// Server-side rendering helpers.
// ---------------------------------------------------------------------------

/**
 * ZAR formatting, mirroring the client's formatCurrency
 * (src/presentation/utils/currency.ts): integer cents in, "R1 234,56" out.
 *
 * Deliberately hand-rolled rather than `toLocaleString('en-ZA')`: the edge
 * runtime's ICU data decides whether the group separator is a plain space, a
 * non-breaking space or a narrow no-break space, which would make the
 * rendered body non-deterministic (and untestable) across Deno versions.
 * A plain space is always used here.
 */
export function formatZar(cents: number): string {
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toString();
  const frac = (abs % 100).toString().padStart(2, '0');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${cents < 0 ? '-' : ''}R${grouped},${frac}`;
}

// Control characters, C1 controls, zero-width and bidirectional-override
// characters. All of them let a sender fake structure in a notification
// (extra lines, right-to-left spoofing, invisible padding).
const CONTROL_CHARS = /[ --​-‏‪-‮⁦-⁩]/g;
// Anything that reads as a link: a scheme, a www. host, a bare user@host, or
// a bare label.tld. Deliberately broad — a merchant name legitimately
// containing "x.yz" with no space after the dot loses that token, which is a
// far better outcome than a tappable-looking phishing string on a lock screen.
const URL_LIKE =
  /\S*(?:[a-z][a-z0-9+.-]*:\/\/|www\.|[^\s@]+@[^\s@]+|[a-z0-9][a-z0-9-]*\.[a-z]{2,24})\S*/gi;

/**
 * Makes one free-text field safe to render: no control/bidi characters, no
 * link-shaped tokens, no multi-line or padded layout. Returns '' when nothing
 * renderable survives.
 */
export function sanitizeFreeText(value: string): string {
  return value.replace(CONTROL_CHARS, ' ').replace(URL_LIKE, ' ').replace(/\s+/g, ' ').trim();
}

export interface RenderedMessage {
  title: string;
  body: string;
}

export type ParsedRequest =
  | {
      ok: true;
      shape: 'event';
      householdId: string;
      kind: NotifyEventKind;
      bucket: string;
      limit: number;
      message: RenderedMessage;
    }
  | { ok: true; shape: 'legacy'; householdId: string; userId: string; message: RenderedMessage }
  | { ok: false; error: 'Invalid payload' | 'Payload too large' };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isIntInRange(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max;
}

/** Positive integer cents, capped well above any realistic household spend
 * (R10 000 000) so a nonsense value cannot produce an absurd body. */
const MAX_CENTS = 1_000_000_000;

function hasOnlyKeys(obj: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(obj).every((k) => allowed.includes(k));
}

/**
 * Reads an optional free-text field. `undefined`/absent is fine; anything
 * present must be a string within MAX_FREE_TEXT. Returns null for "invalid",
 * and '' when the value sanitized away to nothing (treated as absent).
 */
function readOptionalText(v: unknown): string | null {
  if (v === undefined) return '';
  if (typeof v !== 'string' || v.length > MAX_FREE_TEXT) return null;
  return sanitizeFreeText(v);
}

/** Reads a required free-text field. Returns null when invalid or when
 * nothing renderable survives sanitization. */
function readRequiredText(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > MAX_FREE_TEXT) return null;
  const cleaned = sanitizeFreeText(v);
  return cleaned.length > 0 ? cleaned : null;
}

/** The event-shape half of ParsedRequest, minus the householdId that is
 * validated by the caller of this function. */
type RenderedEvent = Omit<Extract<ParsedRequest, { shape: 'event' }>, 'householdId'>;

function renderEvent(event: Record<string, unknown>): RenderedEvent | null {
  const kind = event.kind;

  if (kind === 'transaction_created') {
    if (!hasOnlyKeys(event, ['kind', 'amountCents', 'envelopeName', 'payee'])) return null;
    if (!isIntInRange(event.amountCents, 1, MAX_CENTS)) return null;
    const envelopeName = readRequiredText(event.envelopeName);
    const payee = readOptionalText(event.payee);
    if (envelopeName === null || payee === null) return null;
    return {
      ok: true,
      shape: 'event',
      kind: 'transaction_created',
      bucket: BUCKET_DEFAULT,
      limit: MAX_SENDS_PER_HOUR,
      message: {
        title: 'New spending logged',
        body: `${formatZar(event.amountCents)} from ${envelopeName}${payee ? ` at ${payee}` : ''}`,
      },
    };
  }

  if (kind === 'refund_recorded') {
    if (!hasOnlyKeys(event, ['kind', 'amountCents', 'envelopeName', 'payee'])) return null;
    if (!isIntInRange(event.amountCents, 1, MAX_CENTS)) return null;
    const envelopeName = readRequiredText(event.envelopeName);
    const payee = readOptionalText(event.payee);
    if (envelopeName === null || payee === null) return null;
    return {
      ok: true,
      shape: 'event',
      kind: 'refund_recorded',
      bucket: BUCKET_DEFAULT,
      limit: MAX_SENDS_PER_HOUR,
      message: {
        title: 'Refund recorded',
        body: `Refund: ${formatZar(event.amountCents)} back to ${envelopeName}${payee ? ` at ${payee}` : ''}`,
      },
    };
  }

  if (kind === 'envelope_over_budget') {
    if (!hasOnlyKeys(event, ['kind', 'envelopeName', 'overByCents'])) return null;
    if (!isIntInRange(event.overByCents, 1, MAX_CENTS)) return null;
    const envelopeName = readRequiredText(event.envelopeName);
    if (envelopeName === null) return null;
    return {
      ok: true,
      shape: 'event',
      kind: 'envelope_over_budget',
      bucket: BUCKET_OVER_BUDGET,
      limit: MAX_OVER_BUDGET_SENDS_PER_HOUR,
      message: {
        title: 'Envelope over budget',
        body: `${envelopeName} is over by ${formatZar(event.overByCents)}`,
      },
    };
  }

  if (kind === 'slip_confirmed') {
    if (!hasOnlyKeys(event, ['kind', 'itemCount', 'merchant'])) return null;
    if (!isIntInRange(event.itemCount, 1, 200)) return null;
    const merchant = readOptionalText(event.merchant);
    if (merchant === null) return null;
    const items = `${event.itemCount} item${event.itemCount === 1 ? '' : 's'}`;
    return {
      ok: true,
      shape: 'event',
      kind: 'slip_confirmed',
      bucket: BUCKET_DEFAULT,
      limit: MAX_SENDS_PER_HOUR,
      message: {
        title: 'Slip confirmed',
        body: `${items} added${merchant ? ` from ${merchant}` : ''}`,
      },
    };
  }

  return null; // unknown kind
}

/**
 * Validates the request body and renders the message SERVER-SIDE. Exported so
 * every branch is directly testable without a full request round trip.
 */
export function parseRequest(raw: unknown): ParsedRequest {
  if (!isPlainObject(raw)) return { ok: false, error: 'Invalid payload' };

  if (raw.event !== undefined) {
    if (!isValidId(raw.householdId)) return { ok: false, error: 'Invalid payload' };
    if (!hasOnlyKeys(raw, ['householdId', 'event'])) return { ok: false, error: 'Invalid payload' };
    if (!isPlainObject(raw.event)) return { ok: false, error: 'Invalid payload' };
    const rendered = renderEvent(raw.event);
    if (!rendered) return { ok: false, error: 'Invalid payload' };
    return { ...rendered, householdId: raw.householdId };
  }

  // Legacy 1.1.134 shape. Its title/body are validated (so a malformed old
  // client still gets the same 400 it always did) and then thrown away.
  const { userId, householdId, title, body } = raw as unknown as LegacyNotifyPayload;
  if (
    !isValidId(userId) ||
    !isValidId(householdId) ||
    typeof title !== 'string' ||
    typeof body !== 'string' ||
    !title.trim() ||
    !body.trim()
  ) {
    return { ok: false, error: 'Invalid payload' };
  }
  if (title.length > MAX_TITLE || body.length > MAX_BODY) {
    return { ok: false, error: 'Payload too large' };
  }
  return {
    ok: true,
    shape: 'legacy',
    householdId,
    userId,
    message: { title: 'Household activity', body: LEGACY_BODY },
  };
}

function jsonResponse(payload: unknown, init: { status: number }): Response {
  return new Response(JSON.stringify(payload), {
    status: init.status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function handle(req: Request, deps: HandleDeps): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  // 1. Auth
  const authHeader = req.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Unauthorized' }, { status: 401 });
  }

  const callerSupabase = deps.createCallerClient(authHeader);
  const {
    data: { user },
    error: userErr,
  } = await callerSupabase.auth.getUser();
  if (userErr || !user) {
    return jsonResponse({ error: 'Unauthorized' }, { status: 401 });
  }

  // 2. Parse, validate strictly, and render the message server-side.
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid payload' }, { status: 400 });
  }

  const parsed = parseRequest(rawBody);
  if (!parsed.ok) {
    return jsonResponse({ error: parsed.error }, { status: 400 });
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
    .eq('household_id', parsed.householdId)
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .maybeSingle();

  if (!membership) {
    return jsonResponse({ error: 'Forbidden' }, { status: 403 });
  }

  // 4. Recipients.
  let recipients: string[];
  if (parsed.shape === 'legacy') {
    // The 1.1.134 shape addresses ONE member. Verify the target is also a
    // member of the same household: without this check, an authenticated
    // caller could send push notifications to any user in the system (IDOR).
    // Same deleted_at + maybeSingle() reasoning as the caller check above.
    const { userId } = parsed;
    const { data: targetMembership } = await serviceClient
      .from('household_members')
      .select('user_id')
      .eq('household_id', parsed.householdId)
      .eq('user_id', userId)
      .is('deleted_at', null)
      .maybeSingle();

    if (!targetMembership) {
      return jsonResponse({ error: 'Forbidden' }, { status: 403 });
    }
    recipients = [userId];
  } else {
    // REG-15: for the typed event shape the SERVER decides who hears about
    // it — every active member except the caller — so one client request
    // fans out here instead of costing one rate-limit unit per recipient.
    const { data: memberRows, error: membersErr } = await serviceClient
      .from('household_members')
      .select('user_id')
      .eq('household_id', parsed.householdId)
      .is('deleted_at', null);

    if (membersErr) {
      return jsonResponse({ error: 'Internal server error' }, { status: 500 });
    }

    recipients = [
      ...new Set(
        ((memberRows ?? []) as Array<{ user_id?: unknown }>)
          .map((r) => r.user_id)
          .filter((id): id is string => typeof id === 'string' && id.length > 0),
      ),
    ].filter((id) => id !== user.id);
  }

  if (recipients.length === 0) {
    return jsonResponse({ sent: 0, pruned: 0, recipients: 0 }, { status: 200 });
  }

  // 5. Load the recipients' device token(s).
  const { data: tokenRows, error } = await serviceClient
    .from('user_fcm_tokens')
    .select('user_id, token')
    .in('user_id', recipients);

  if (error) {
    return jsonResponse({ error: 'Internal server error' }, { status: 500 });
  }

  const tokens = ((tokenRows ?? []) as Array<{ user_id?: unknown; token?: unknown }>).filter(
    (r): r is { user_id: string; token: string } =>
      typeof r.user_id === 'string' && typeof r.token === 'string' && r.token.length > 0,
  );

  if (tokens.length === 0) {
    return jsonResponse({ sent: 0, pruned: 0, recipients: recipients.length }, { status: 200 });
  }

  // 6. Push configuration check — before burning rate-limit budget below.
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
    return jsonResponse(
      { sent: 0, pushConfigured: false, error: 'Push notifications are not configured' },
      { status: 200 },
    );
  }

  // 7. Rate limit: exactly ONE reservation per EVENT (not per recipient), in
  // the event's own bucket. check_and_reserve_notify_send_v2 (migration 0017)
  // takes a per-sender advisory lock around its count-then-insert, so
  // parallel invocations cannot overshoot the cap (SEC2-12).
  // The v1 RPC name check_and_reserve_notify_send is intentionally no longer
  // called: it has no bucket dimension and no lock.
  const bucket = parsed.shape === 'event' ? parsed.bucket : BUCKET_DEFAULT;
  const limit = parsed.shape === 'event' ? parsed.limit : MAX_SENDS_PER_HOUR;
  const { data: allowed, error: rateErr } = await serviceClient.rpc(
    'check_and_reserve_notify_send_v2',
    { p_sender_id: user.id, p_bucket: bucket, p_limit: limit },
  );

  if (rateErr) {
    return jsonResponse({ error: 'Internal server error' }, { status: 500 });
  }

  if (!allowed) {
    return jsonResponse({ error: 'Rate limit exceeded' }, { status: 429 });
  }

  // 8. Mint (or reuse cached) OAuth2 access token.
  let accessToken: string;
  try {
    accessToken = await mintAccessToken(sa, deps);
  } catch {
    return jsonResponse({ error: 'Push service unavailable' }, { status: 502 });
  }

  // 9. Send one FCM v1 message per token; prune tokens FCM reports as dead.
  const { title, body } = parsed.message;
  // PUSH-2: routing-only data, no free text. `kind` is only known for the
  // typed event shape; the legacy shape (no NotifyEventKind) omits it and
  // just routes to the Dashboard, which is still a valid message for older
  // clients that ignore unknown `data` entirely (rule 19).
  const pushData: Record<string, string> = {
    type: 'household_activity',
    householdId: parsed.householdId,
    target: parsed.shape === 'event' ? pushTargetForKind(parsed.kind) : 'Dashboard',
  };
  if (parsed.shape === 'event') pushData.kind = parsed.kind;
  let sent = 0;
  const staleByUser = new Map<string, string[]>();
  for (const { user_id: recipientId, token } of tokens) {
    const res = await deps.fetchImpl(
      `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(buildV1Message(token, title, body, pushData)),
      },
    );

    if (res.ok) {
      sent++;
      continue;
    }

    let fcmStatus: string | undefined;
    let invalidArgumentNamesToken = false;
    try {
      const errJson = (await res.json()) as {
        error?: {
          status?: unknown;
          details?: Array<{ fieldViolations?: Array<{ field?: unknown }> }>;
        };
      };
      if (typeof errJson.error?.status === 'string') fcmStatus = errJson.error.status;
      // DB-12 (deep-review finding): INVALID_ARGUMENT is FCM's generic
      // "the request body is malformed" status — it fires for a bad message
      // shape too, not just a dead/malformed registration token. Only prune
      // when the error's field-violation details actually name the token
      // field (FCM v1's google.rpc.BadRequest detail, e.g.
      // "message.token"); otherwise a transient/unrelated bad-request error
      // would wrongly unregister a device that never did anything wrong.
      if (fcmStatus === 'INVALID_ARGUMENT') {
        const details = errJson.error?.details ?? [];
        invalidArgumentNamesToken = details.some((d) =>
          (d.fieldViolations ?? []).some(
            (fv) => typeof fv.field === 'string' && fv.field.toLowerCase().includes('token'),
          ),
        );
      }
    } catch {
      // Non-JSON error body — nothing to prune on, just skip this token.
    }
    if (
      fcmStatus === 'UNREGISTERED' ||
      (fcmStatus === 'INVALID_ARGUMENT' && invalidArgumentNamesToken)
    ) {
      const existing = staleByUser.get(recipientId);
      if (existing) existing.push(token);
      else staleByUser.set(recipientId, [token]);
    }
  }

  // 10. Prune stale tokens (deep-review finding: dead tokens accumulate
  // forever otherwise, silently wasting sends). Per user_id, because
  // user_fcm_tokens is keyed (user_id, token) since 0006.
  let pruned = 0;
  for (const [recipientId, staleTokens] of staleByUser) {
    await serviceClient
      .from('user_fcm_tokens')
      .delete()
      .eq('user_id', recipientId)
      .in('token', staleTokens);
    pruned += staleTokens.length;
  }

  return jsonResponse({ sent, pruned, recipients: recipients.length }, { status: 200 });
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
