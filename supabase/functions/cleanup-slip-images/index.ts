// deno-lint-ignore-file no-explicit-any
import { createClient } from 'jsr:@supabase/supabase-js@2.103.0';

// SEC2-9 (retention, known-open): 0001_baseline.sql's
// public.cleanup_old_slip_images() calls storage.delete_object, a function
// that does not exist on Supabase storage — every nightly run silently
// deletes NOTHING from the bucket, still NULLs raw_response_json (with no
// oplog row, so it never replicates to other devices), and logs one
// STORAGE_DELETE_FAILED row per image forever. This edge function replaces
// it:
//
//   - service-role only, authorized by a constant-time comparison of the
//     `x-cleanup-secret` request header against the CLEANUP_SECRET env var
//     (there is no caller JWT at all here — this is invoked by a scheduled
//     GitHub Actions workflow, not the app — so `verify_jwt = false` is set
//     for this function in supabase/config.toml and this header IS the
//     authorization).
//   - selects up to 200 slips at least 30 days old with images_deleted_at
//     still NULL,
//   - derives the storage prefix as `${household_id}/${id}` — NEVER from
//     slip_queue.image_uris, which is client-writable and must never be
//     trusted to name a storage path to delete,
//   - lists + removes every object under that prefix from the `slip-images`
//     bucket (mirrors delete-account/index.ts's removeSlipImages),
//   - on success, writes `{images_deleted_at, raw_response_json: null,
//     updated_at}` through `rpc('apply_server_op')` so the change replicates
//     via the oplog like any other server write (0010 DB-6(b)'s pattern),
//     instead of writing slip_queue directly the way the broken SQL version
//     did,
//   - any failure (storage or the RPC) is logged to job_log and that slip is
//     left with images_deleted_at IS NULL so a later run retries it.
//
// It is NOT scheduled from SQL: pg_cron would need a vault-stored secret to
// call an authenticated edge function, which this migration does not set
// up. Scheduling instead lives in .github/workflows/slip-retention.yml.

export type HandleDeps = {
  createAdminClient: () => any;
  env: {
    CLEANUP_SECRET: string;
  };
};

const SLIP_BUCKET = 'slip-images';
const BATCH_LIMIT = 200;
const RETENTION_DAYS = 30;
const JOB_NAME = 'cleanup-slip-images';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Constant-time string comparison for the shared-secret header check.
 * Equal-length inputs are compared in time independent of WHERE they first
 * differ (no early return on mismatch). A length mismatch is reported as an
 * immediate false — the length of a secret is not itself sensitive here (an
 * attacker can already guess it is "some long random string"), only which
 * BYTES it contains, which this never short-circuits on. */
function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) {
    diff |= aBytes[i] ^ bBytes[i];
  }
  return diff === 0;
}

interface SlipRow {
  id: string;
  household_id: string;
}

/** Supabase client errors are plain `{ message, ... }` objects, not `Error`
 * instances — `String()` on one of those yields the useless "[object
 * Object]", so this checks for a string `.message` first. */
function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof (error as { message: unknown }).message === 'string'
  ) {
    return (error as { message: string }).message;
  }
  return String(error ?? 'unknown');
}

/** Best-effort failure log — never allowed to throw or block the batch. */
async function logFailure(admin: any, slip: SlipRow, event: string, error: unknown): Promise<void> {
  try {
    await admin.from('job_log').insert({
      job: JOB_NAME,
      detail: {
        event,
        household_id: slip.household_id,
        slip_id: slip.id,
        error: errorMessage(error),
      },
    });
  } catch {
    // job_log is diagnostics, not correctness.
  }
}

/** Lists then removes every object under `<household_id>/<slip_id>/` —
 * mirrors delete-account/index.ts's removeSlipImages, but for one prefix at
 * a time so the caller can decide, per slip, whether to also write the DB
 * update (only on a fully successful removal). */
async function removeSlipImages(
  admin: any,
  prefix: string,
): Promise<{ ok: true } | { ok: false; error: unknown }> {
  try {
    const { data: entries, error } = await admin.storage.from(SLIP_BUCKET).list(prefix);
    if (error) return { ok: false, error };
    if (!entries || entries.length === 0) return { ok: true };
    const paths = entries.map((e: { name: string }) => `${prefix}/${e.name}`);
    const { error: removeErr } = await admin.storage.from(SLIP_BUCKET).remove(paths);
    if (removeErr) return { ok: false, error: removeErr };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err };
  }
}

export async function handle(req: Request, deps: HandleDeps): Promise<Response> {
  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  const secret = deps.env.CLEANUP_SECRET;
  const provided = req.headers.get('x-cleanup-secret');
  if (!secret || !provided || !timingSafeEqual(provided, secret)) {
    return jsonResponse(401, { error: 'Unauthorized' });
  }

  const admin = deps.createAdminClient();

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: slips, error: selectErr } = await admin
    .from('slip_queue')
    .select('id, household_id')
    .lt('created_at', cutoff)
    .is('images_deleted_at', null)
    .limit(BATCH_LIMIT);

  if (selectErr) {
    return jsonResponse(500, { error: 'Failed to select slips' });
  }

  let processed = 0;
  let removed = 0;
  let failed = 0;

  for (const slip of (slips ?? []) as SlipRow[]) {
    processed += 1;

    // SEC2-9: derived from household_id/id — columns the client cannot
    // write (private.apply_one_op's payload allowlist strips id/
    // household_id from every op) — NEVER from slip_queue.image_uris, which
    // IS client-writable and must never be trusted to name a storage path.
    const prefix = `${slip.household_id}/${slip.id}`;

    const removal = await removeSlipImages(admin, prefix);
    if (!removal.ok) {
      failed += 1;
      await logFailure(admin, slip, 'STORAGE_REMOVE_FAILED', removal.error);
      continue;
    }

    const nowIso = new Date().toISOString();
    const { data: opResult, error: opErr } = await admin.rpc('apply_server_op', {
      p_op: {
        v: '1',
        op_id: crypto.randomUUID(),
        household_id: slip.household_id,
        table: 'slip_queue',
        row_id: slip.id,
        op_type: 'update',
        payload: {
          images_deleted_at: nowIso,
          raw_response_json: null,
          updated_at: nowIso,
        },
        device_id: 'server:cleanup-slip-images',
      },
    });

    const status = (opResult as { status?: string } | null)?.status;
    if (opErr || status !== 'applied') {
      failed += 1;
      await logFailure(admin, slip, 'OP_APPLY_FAILED', opErr ?? opResult);
      continue;
    }

    removed += 1;
  }

  return jsonResponse(200, { processed, removed, failed });
}

// Production entry point — only runs when executed directly by Deno.
if (import.meta.main) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const cleanupSecret = Deno.env.get('CLEANUP_SECRET') ?? '';

  const prodDeps: HandleDeps = {
    createAdminClient: () => createClient(supabaseUrl, supabaseServiceKey),
    env: { CLEANUP_SECRET: cleanupSecret },
  };

  Deno.serve((req: Request) => handle(req, prodDeps));
}
