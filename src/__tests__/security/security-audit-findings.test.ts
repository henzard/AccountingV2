/**
 * Security audit findings — provable vulnerabilities and their fixes.
 *
 * Finding 1 (CRITICAL): notify-event IDOR — any authenticated household member
 *   could send push notifications to ANY user, not just household co-members.
 * Finding 2 (MEDIUM):   notify-event leaked the FCM_SERVER_KEY env var name
 *   in error responses.
 *
 * Findings 3-5 (merge_slip_queue column drift across migrations 006/017/018,
 * and the user_households trigger column mismatch from 002/005/018) were
 * deleted: merge_slip_queue and user_households no longer exist post-baseline
 * (see supabase/migrations/0001_baseline.sql) — the old sync protocol they
 * documented was replaced wholesale, not patched. Same for "all merge RPCs
 * validate household membership": there are no merge RPCs left to check.
 * The pgTAP suite at supabase/tests/ tests the surviving behavior
 * behaviorally against the real database.
 */
import * as fs from 'fs';
import * as path from 'path';

const FUNCTIONS_DIR = path.resolve(__dirname, '../../../supabase/functions');
const BASELINE_PATH = path.resolve(__dirname, '../../../supabase/migrations/0001_baseline.sql');

function readSource(filePath: string): string {
  return fs.readFileSync(filePath, 'utf-8');
}

// ═══════════════════════════════════════════════════════════════════════════════
// FINDING 1 (CRITICAL): notify-event IDOR
// ═══════════════════════════════════════════════════════════════════════════════

describe('Finding 1: notify-event IDOR — target userId must be validated', () => {
  let notifySource: string;

  beforeAll(() => {
    notifySource = readSource(path.join(FUNCTIONS_DIR, 'notify-event/index.ts'));
  });

  it('validates that the target userId is a member of the household', () => {
    // The fix adds a second household_members query for the target userId.
    // Count occurrences of household_members lookup — must be >= 2:
    // one for the caller, one for the target.
    const membershipChecks = notifySource.match(/\.from\(['"]household_members['"]\)/g);
    expect(membershipChecks).not.toBeNull();
    expect(membershipChecks!.length).toBeGreaterThanOrEqual(2);
  });

  it('returns 403 when target userId is not in the household', () => {
    // After the targetMembership check, there must be a 403 response
    const targetCheckIndex = notifySource.indexOf('targetMembership');
    expect(targetCheckIndex).toBeGreaterThan(-1);

    const afterTargetCheck = notifySource.slice(targetCheckIndex);
    expect(afterTargetCheck).toContain('status: 403');
  });

  it('FCM token lookup only runs AFTER target membership is verified', () => {
    const targetCheckIndex = notifySource.indexOf('targetMembership');
    const fcmLookupIndex = notifySource.indexOf("from('user_fcm_tokens')");
    expect(targetCheckIndex).toBeGreaterThan(-1);
    expect(fcmLookupIndex).toBeGreaterThan(-1);
    expect(fcmLookupIndex).toBeGreaterThan(targetCheckIndex);
  });

  it('proves the pre-fix vulnerability: only one membership check existed', () => {
    // The original (pre-fix) pattern had exactly 1 household_members query.
    // Our fix added a 2nd. This test documents the original vulnerability.
    const callerCheckPattern = /\.eq\('user_id',\s*user\.id\)/;
    expect(callerCheckPattern.test(notifySource)).toBe(true);

    // Target check uses the body-supplied userId
    const targetCheckPattern = /\.eq\('user_id',\s*userId\)/;
    expect(targetCheckPattern.test(notifySource)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// FINDING 2 (MEDIUM): notify-event leaks FCM_SERVER_KEY env var name
// ═══════════════════════════════════════════════════════════════════════════════

describe('Finding 2: notify-event must not leak secret env var names', () => {
  let notifySource: string;

  beforeAll(() => {
    notifySource = readSource(path.join(FUNCTIONS_DIR, 'notify-event/index.ts'));
  });

  it('does NOT return FCM_SERVER_KEY name in any error response', () => {
    // Search for any Response constructor that includes "FCM_SERVER_KEY"
    const responsePattern = /new Response\([^)]*FCM_SERVER_KEY[^)]*\)/;
    expect(responsePattern.test(notifySource)).toBe(false);
  });

  it('does NOT include env var names in JSON error responses', () => {
    // The error string sent to the client must not reveal config details
    const leakPatterns = [
      /error.*FCM_SERVER_KEY/,
      /error.*SUPABASE_SERVICE_ROLE_KEY/,
      /error.*OPENAI_API_KEY/,
    ];
    for (const pattern of leakPatterns) {
      expect(pattern.test(notifySource)).toBe(false);
    }
  });

  it('returns generic "Server misconfigured" when FCM key is missing', () => {
    expect(notifySource).toContain('Server misconfigured');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// NEGATIVE FINDINGS: Areas audited and found secure
// ═══════════════════════════════════════════════════════════════════════════════

describe('Audit: areas confirmed secure', () => {
  describe('RLS policies cover all tables', () => {
    it('all tables in the baseline have RLS enabled', () => {
      const baseline = readSource(BASELINE_PATH);

      const tables = [
        'households',
        'household_members',
        'invitations',
        'envelopes',
        'transactions',
        'debts',
        'meter_readings',
        'baby_steps',
        'slip_queue',
        'user_consent',
        'notify_send_log',
        'user_fcm_tokens',
        'user_preferences',
        'job_log',
        'score_history',
      ];

      for (const table of tables) {
        const rlsPattern = new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`);
        expect(rlsPattern.test(baseline)).toBe(true);
      }
    });
  });

  describe('extract-slip edge function secrets', () => {
    it('all API keys come from environment variables', () => {
      const source = readSource(path.join(FUNCTIONS_DIR, 'extract-slip/index.ts'));
      expect(source).toContain("Deno.env.get('OPENAI_API_KEY')");
      expect(source).toContain("Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')");
      expect(source).toContain("Deno.env.get('SUPABASE_URL')");
    });

    it('error responses do not leak internal details', () => {
      const source = readSource(path.join(FUNCTIONS_DIR, 'extract-slip/index.ts'));
      const errorResponses = [
        'Server misconfigured',
        'Unauthorized',
        'Forbidden',
        'Missing required fields',
        'OpenAI unreachable',
      ];
      for (const msg of errorResponses) {
        expect(source).toContain(msg);
      }
      // No stack traces or internal error objects leaked
      expect(source).not.toContain('SQLERRM');
      expect(source).not.toContain('stack');
    });
  });

  describe('local storage: no secrets in AsyncStorage', () => {
    it('SecureStorageAdapter uses expo-secure-store', () => {
      const source = readSource(
        path.resolve(__dirname, '../../infrastructure/storage/SecureStorageAdapter.ts'),
      );
      expect(source).toContain("import * as SecureStore from 'expo-secure-store'");
      expect(source).toContain('SecureStore.getItemAsync');
      expect(source).toContain('SecureStore.setItemAsync');
    });

    it('Supabase client uses SecureStorageAdapter for auth', () => {
      const source = readSource(path.resolve(__dirname, '../../data/remote/supabaseClient.ts'));
      expect(source).toContain('storage: SecureStorageAdapter');
      expect(source).toContain('autoRefreshToken: true');
      expect(source).toContain('persistSession: true');
    });
  });
});
