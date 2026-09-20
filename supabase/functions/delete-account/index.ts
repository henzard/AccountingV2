// deno-lint-ignore-file no-explicit-any
import { createClient } from 'jsr:@supabase/supabase-js@2.103.0';

// PRIVACY-1: the in-app "delete my account" endpoint. docs/privacy-policy.md
// promises the user can delete their account and all associated data, and
// Google Play requires that path to exist IN the app — it previously only
// existed as an email address.
//
// Order of operations matters and is deliberate:
//
//   1. Collect the caller's slip folders FIRST, while slip_queue.created_by
//      still names them. The RPC in step 3 anonymises that column, after
//      which the caller's own images are no longer identifiable at all.
//   2. Verify the JWT with getUser() exactly as extract-slip does.
//   3. Run public.delete_my_account_data() AS THE USER (the caller-scoped
//      client, carrying their JWT) so auth.uid() inside the SECURITY DEFINER
//      function is the caller. The service-role client must never call it:
//      auth.uid() would be NULL and the function would refuse anyway, but
//      routing it through the user's own token is what makes "you can only
//      delete YOURSELF" structural rather than a check this function could
//      forget.
//   4. Only if (3) succeeded, delete the auth user with the service-role
//      client. If the RPC failed we stop here and leave the auth user intact:
//      an account whose auth row is gone but whose household memberships,
//      tokens and consent rows survive is unrecoverable and unreachable —
//      strictly worse than a failed delete the user can simply retry.
//
// Storage note: the slip-images bucket is laid out PER HOUSEHOLD
// (`<householdId>/<slipId>/<frameIndex>.jpg`, see
// src/infrastructure/slipScanning/SupabaseSlipImageUploader.ts), so there is
// no per-user prefix to sweep. The caller's own images are still identified,
// indirectly, through slip_queue.created_by (step 1) and removed folder by
// folder. That removal is BEST EFFORT: it never fails the request, because
// the images are transient anyway (public.cleanup_old_slip_images() purges
// the bucket on a cron schedule) and a storage hiccup must not leave the
// account half-deleted.

export type HandleDeps = {
  // Using `any` for the client type so the generic Supabase client works
  // without a DB schema definition — matches extract-slip / notify-event.
  createCallerClient: (authHeader: string) => any;
  createAdminClient: () => any;
};

const SLIP_BUCKET = 'slip-images';

// The app has a web target, so the browser preflights this endpoint.
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

interface SlipFolder {
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

/** Best-effort log of a storage prefix this request could not clean up, so
 * the folder is not just silently lost — SEC2-7. Writes go through job_log
 * (0001_baseline.sql: id bigserial, job text, detail jsonb, created_at
 * timestamptz), service-role only, same table cleanup_old_slip_images
 * already logs failures to. This itself is best-effort: if job_log can't be
 * written, the request must still complete — that would only cost
 * observability, never correctness. */
async function logFailedPrefix(admin: any, prefix: string, error: unknown): Promise<void> {
  try {
    await admin.from('job_log').insert({
      job: 'delete-account',
      detail: {
        event: 'STORAGE_REMOVE_FAILED',
        prefix,
        error: errorMessage(error),
      },
    });
  } catch {
    // job_log is diagnostics, not correctness — never let a logging failure
    // affect the account-deletion request itself.
  }
}

/** Best-effort removal of every object under `<household_id>/<slip_id>/`.
 * Returns how many objects were actually removed; never throws. Every
 * prefix it could not clean up is logged to job_log (SEC2-7) so the folder
 * is not just silently lost — the RPC that ran before this already
 * tombstoned slip_queue.created_by, so this is the LAST point at which the
 * prefix is still identifiable at all. */
async function removeSlipImages(admin: any, folders: SlipFolder[]): Promise<number> {
  let removed = 0;
  for (const folder of folders) {
    const prefix = `${folder.household_id}/${folder.id}`;
    try {
      const { data: entries, error } = await admin.storage.from(SLIP_BUCKET).list(prefix);
      if (error) {
        await logFailedPrefix(admin, prefix, error);
        continue;
      }
      if (!entries || entries.length === 0) continue;
      const paths = entries.map((e: { name: string }) => `${prefix}/${e.name}`);
      const { error: removeErr } = await admin.storage.from(SLIP_BUCKET).remove(paths);
      if (removeErr) {
        await logFailedPrefix(admin, prefix, removeErr);
        continue;
      }
      removed += paths.length;
    } catch (err) {
      // Storage is best effort — see the header note. Move on to the next
      // folder, but log it first so the prefix isn't lost completely.
      await logFailedPrefix(admin, prefix, err);
    }
  }
  return removed;
}

export async function handle(req: Request, deps: HandleDeps): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  // 1. Auth — same shape as extract-slip's.
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return jsonResponse(401, { error: 'Unauthorized' });

  const callerSupabase = deps.createCallerClient(authHeader);
  const { data: userData, error: userErr } = await callerSupabase.auth.getUser();
  if (userErr || !userData?.user) return jsonResponse(401, { error: 'Unauthorized' });
  const userId: string = userData.user.id;

  const adminSupabase = deps.createAdminClient();

  // 2. Snapshot the caller's slip folders BEFORE the RPC anonymises
  //    slip_queue.created_by. SEC2-7: this lookup used to be treated as
  //    best-effort and the request proceeded regardless — but once the RPC
  //    below tombstones slip_queue.created_by, this lookup is the ONLY way
  //    to ever find the caller's image folders again. If it errors, the
  //    folders would become unfindable forever, so this now stops BEFORE
  //    calling the RPC rather than after.
  const { data: slips, error: slipsErr } = await adminSupabase
    .from('slip_queue')
    .select('id, household_id')
    .eq('created_by', userId);
  if (slipsErr) {
    return jsonResponse(500, { error: 'Account deletion failed' });
  }
  const slipFolders: SlipFolder[] = Array.isArray(slips) ? (slips as SlipFolder[]) : [];

  // 3. Erase the user's data, as the user. If this fails, STOP — the auth
  //    user must survive so the operation stays retryable.
  const { error: rpcErr } = await callerSupabase.rpc('delete_my_account_data');
  if (rpcErr) {
    return jsonResponse(500, { error: 'Account deletion failed' });
  }

  // 4. Best-effort image sweep. Individual prefix failures are logged to
  //    job_log (SEC2-7) rather than silently dropped.
  await removeSlipImages(adminSupabase, slipFolders);

  // 5. Finally remove the auth user itself. user_preferences cascades off
  //    this (the only FK to auth.users in the schema); everything else was
  //    already handled by the RPC. SEC2-7: the RPC already succeeded at this
  //    point — the user's data IS gone — so a failure here must not be
  //    reported as a flat 500 "Account deletion failed" (that reads as
  //    "nothing happened", which is false: retrying would just fail the RPC
  //    again as a no-op and never actually retry the one thing that failed).
  //    Report 200 with `deleted: false, data_deleted: true` instead, so the
  //    client can tell the user their data is erased but the account itself
  //    needs a retry.
  const { error: authErr } = await adminSupabase.auth.admin.deleteUser(userId);
  if (authErr) {
    return jsonResponse(200, { deleted: false, data_deleted: true });
  }

  return jsonResponse(200, { deleted: true });
}

// Production entry point — only runs when executed directly by Deno.
if (import.meta.main) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

  const prodDeps: HandleDeps = {
    createCallerClient: (authHeader: string) =>
      createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } },
      }),
    createAdminClient: () => createClient(supabaseUrl, supabaseServiceKey),
  };

  Deno.serve((req: Request) => handle(req, prodDeps));
}
