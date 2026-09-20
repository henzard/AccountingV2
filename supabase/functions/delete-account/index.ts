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

/** Best-effort removal of every object under `<household_id>/<slip_id>/`.
 * Returns how many objects were actually removed; never throws. */
async function removeSlipImages(admin: any, folders: SlipFolder[]): Promise<number> {
  let removed = 0;
  for (const folder of folders) {
    const prefix = `${folder.household_id}/${folder.id}`;
    try {
      const { data: entries, error } = await admin.storage.from(SLIP_BUCKET).list(prefix);
      if (error || !entries || entries.length === 0) continue;
      const paths = entries.map((e: { name: string }) => `${prefix}/${e.name}`);
      const { error: removeErr } = await admin.storage.from(SLIP_BUCKET).remove(paths);
      if (!removeErr) removed += paths.length;
    } catch {
      // Storage is best effort — see the header note. Move on to the next folder.
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
  //    slip_queue.created_by. A failure here is not fatal: it only costs the
  //    (cron-purged) images, never the deletion itself.
  let slipFolders: SlipFolder[] = [];
  const { data: slips, error: slipsErr } = await adminSupabase
    .from('slip_queue')
    .select('id, household_id')
    .eq('created_by', userId);
  if (!slipsErr && Array.isArray(slips)) slipFolders = slips as SlipFolder[];

  // 3. Erase the user's data, as the user. If this fails, STOP — the auth
  //    user must survive so the operation stays retryable.
  const { error: rpcErr } = await callerSupabase.rpc('delete_my_account_data');
  if (rpcErr) {
    return jsonResponse(500, { error: 'Account deletion failed' });
  }

  // 4. Best-effort image sweep.
  await removeSlipImages(adminSupabase, slipFolders);

  // 5. Finally remove the auth user itself. user_preferences cascades off
  //    this (the only FK to auth.users in the schema); everything else was
  //    already handled by the RPC.
  const { error: authErr } = await adminSupabase.auth.admin.deleteUser(userId);
  if (authErr) {
    return jsonResponse(500, { error: 'Account deletion failed' });
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
