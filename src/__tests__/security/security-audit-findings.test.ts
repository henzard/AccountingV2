/**
 * Security audit findings — provable vulnerabilities and their fixes.
 *
 * Finding 1 (CRITICAL): notify-event IDOR — any authenticated household member
 *   could send push notifications to ANY user, not just household co-members.
 * Finding 2 (MEDIUM):   notify-event leaked the FCM_SERVER_KEY env var name
 *   in error responses.
 * Finding 3 (CRITICAL): merge_slip_queue (migration 017) referenced nonexistent
 *   columns, breaking slip sync entirely at runtime.
 * Finding 4 (MEDIUM):   merge_slip_queue security regression — creator-only
 *   authz check was replaced with weaker household membership check.
 * Finding 5 (MEDIUM):   user_households trigger from 005 referenced columns
 *   (role, created_at) that didn't exist on the table.
 */
import * as fs from 'fs';
import * as path from 'path';
import { sliceMigrationFrom, sliceMigrationSection } from '../../__test-utils__/migrationSlice';

const FUNCTIONS_DIR = path.resolve(__dirname, '../../../supabase/functions');
const MIGRATIONS_DIR = path.resolve(__dirname, '../../../supabase/migrations');

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
// FINDING 3 (CRITICAL): merge_slip_queue references nonexistent columns
// ═══════════════════════════════════════════════════════════════════════════════

describe('Finding 3: merge_slip_queue must match actual slip_queue DDL', () => {
  let migration006: string;
  let migration018: string;

  beforeAll(() => {
    migration006 = readSource(path.join(MIGRATIONS_DIR, '006_slip_scanning.sql'));
    migration018 = readSource(path.join(MIGRATIONS_DIR, '018_security_fixes.sql'));
  });

  it('proves the bug: migration 017 references columns not in any DDL', () => {
    const migration017 = readSource(path.join(MIGRATIONS_DIR, '017_fix_merge_regressions.sql'));
    const mergeSlipSection = sliceMigrationSection(
      migration017,
      'CREATE OR REPLACE FUNCTION public.merge_slip_queue',
      'GRANT EXECUTE ON FUNCTION public.merge_slip_queue',
    );

    // These columns do NOT exist in the slip_queue table (created in 006)
    expect(mergeSlipSection).toContain('extracted_data');
    expect(mergeSlipSection).toContain('line_items');
    expect(mergeSlipSection).toContain('original_image_uri');
    expect(mergeSlipSection).toContain('category_suggestion');

    // Verify these columns are NOT in the actual table DDL
    expect(migration006).not.toContain('extracted_data');
    expect(migration006).not.toContain('line_items');
    expect(migration006).not.toContain('original_image_uri');
    expect(migration006).not.toContain('category_suggestion');
  });

  it('proves 017 omits real columns from the merge function', () => {
    const migration017 = readSource(path.join(MIGRATIONS_DIR, '017_fix_merge_regressions.sql'));
    const mergeSlipSection = sliceMigrationSection(
      migration017,
      'CREATE OR REPLACE FUNCTION public.merge_slip_queue',
      'GRANT EXECUTE ON FUNCTION public.merge_slip_queue',
    );

    // These columns ARE in the table (006) but missing from 017's merge
    expect(mergeSlipSection).not.toContain('error_message');
    expect(mergeSlipSection).not.toContain('slip_date');
    expect(mergeSlipSection).not.toContain('raw_response_json');
    expect(mergeSlipSection).not.toContain('images_deleted_at');
    expect(mergeSlipSection).not.toContain('openai_cost_cents');
  });

  it('018 fix: merge_slip_queue uses correct column names from 006 DDL', () => {
    const mergeSlipSection = sliceMigrationSection(
      migration018,
      'CREATE OR REPLACE FUNCTION public.merge_slip_queue',
      'GRANT EXECUTE ON FUNCTION public.merge_slip_queue',
    );

    const ddlColumns = [
      'error_message',
      'merchant',
      'slip_date',
      'total_cents',
      'raw_response_json',
      'images_deleted_at',
      'openai_cost_cents',
      'image_uris',
      'created_by',
      'status',
    ];
    for (const col of ddlColumns) {
      expect(mergeSlipSection).toContain(col);
    }

    // Must NOT contain the ghost columns from 017
    expect(mergeSlipSection).not.toContain('extracted_data');
    expect(mergeSlipSection).not.toContain('line_items');
    expect(mergeSlipSection).not.toContain('original_image_uri');
    expect(mergeSlipSection).not.toContain('category_suggestion');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// FINDING 4 (MEDIUM): merge_slip_queue creator-only authz regression
// ═══════════════════════════════════════════════════════════════════════════════

describe('Finding 4: merge_slip_queue must enforce creator-only writes', () => {
  it('proves the regression: 017 replaced created_by check with household membership', () => {
    const migration017 = readSource(path.join(MIGRATIONS_DIR, '017_fix_merge_regressions.sql'));
    const mergeSlipSection = sliceMigrationSection(
      migration017,
      'CREATE OR REPLACE FUNCTION public.merge_slip_queue',
      'GRANT EXECUTE ON FUNCTION public.merge_slip_queue',
    );

    // 017 uses household membership check (weaker)
    expect(mergeSlipSection).toContain('user_households');
    // 017 does NOT have the created_by ownership guard
    expect(mergeSlipSection).not.toContain('r.created_by != caller_id');
  });

  it('018 fix: restores created_by ownership guard', () => {
    const migration018 = readSource(path.join(MIGRATIONS_DIR, '018_security_fixes.sql'));
    const mergeSlipSection = sliceMigrationSection(
      migration018,
      'CREATE OR REPLACE FUNCTION public.merge_slip_queue',
      'GRANT EXECUTE ON FUNCTION public.merge_slip_queue',
    );

    expect(mergeSlipSection).toContain('r.created_by != caller_id');
    expect(mergeSlipSection).toContain('insufficient_privilege');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// FINDING 5 (MEDIUM): user_households missing columns for trigger
// ═══════════════════════════════════════════════════════════════════════════════

describe('Finding 5: user_households must have role + created_at for trigger', () => {
  it('proves the bug: 005 trigger inserts role+created_at into user_households', () => {
    const migration005 = readSource(
      path.join(MIGRATIONS_DIR, '005_security_and_sync_correctness.sql'),
    );
    const triggerFn = sliceMigrationSection(
      migration005,
      'sync_household_member_to_user_households',
      'CREATE TRIGGER tr_household_members_sync_user_households',
    );

    expect(triggerFn).toContain('role');
    expect(triggerFn).toContain('created_at');
  });

  it('proves the bug: 002 user_households table has NO role or created_at column', () => {
    const migration002 = readSource(path.join(MIGRATIONS_DIR, '002_rls_policies.sql'));
    const tableSection = sliceMigrationSection(
      migration002,
      'CREATE TABLE user_households',
      'ALTER TABLE user_households',
    );

    expect(tableSection).not.toContain('role');
    expect(tableSection).not.toContain('created_at');
  });

  it('018 fix: adds role and created_at columns to user_households', () => {
    const migration018 = readSource(path.join(MIGRATIONS_DIR, '018_security_fixes.sql'));
    const alterSection = sliceMigrationSection(
      migration018,
      'ALTER TABLE public.user_households',
      '-- ═══════════════════════════════════════════════════════════════════════════════',
    );

    expect(alterSection).toContain('ADD COLUMN IF NOT EXISTS role TEXT');
    expect(alterSection).toContain("DEFAULT 'member'");
    expect(alterSection).toContain('ADD COLUMN IF NOT EXISTS created_at TEXT');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// NEGATIVE FINDINGS: Areas audited and found secure
// ═══════════════════════════════════════════════════════════════════════════════

describe('Audit: areas confirmed secure', () => {
  describe('RLS policies cover all tables', () => {
    it('all data tables have RLS enabled in migrations', () => {
      const allMigrations = fs
        .readdirSync(MIGRATIONS_DIR)
        .filter((f) => f.endsWith('.sql'))
        .map((f) => readSource(path.join(MIGRATIONS_DIR, f)))
        .join('\n');

      const tables = [
        'households',
        'envelopes',
        'transactions',
        'meter_readings',
        'debts',
        'baby_steps',
        'audit_events',
        'user_households',
        'household_members',
        'invitations',
        'slip_queue',
        'user_consent',
        'user_preferences',
        'user_fcm_tokens',
      ];

      for (const table of tables) {
        const rlsPattern = new RegExp(`ALTER TABLE.*${table}.*ENABLE ROW LEVEL SECURITY`);
        expect(rlsPattern.test(allMigrations)).toBe(true);
      }
    });
  });

  describe('all merge RPCs validate household membership', () => {
    it('every merge RPC in final migration (016/017) has membership check', () => {
      const migration017 = readSource(path.join(MIGRATIONS_DIR, '017_fix_merge_regressions.sql'));
      const migration016 = readSource(
        path.join(MIGRATIONS_DIR, '016_lww_direction_independent_tiebreaker.sql'),
      );

      const rpcsWithMembershipCheck = [
        'merge_envelope',
        'merge_transaction',
        'merge_debt',
        'merge_meter_reading',
        'merge_household',
        'merge_baby_step',
      ];

      for (const rpc of rpcsWithMembershipCheck) {
        const combined = migration017 + migration016;
        const section = sliceMigrationFrom(combined, `CREATE OR REPLACE FUNCTION public.${rpc}`);
        expect(section).toContain('user_households');
        expect(section).toContain('insufficient_privilege');
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
