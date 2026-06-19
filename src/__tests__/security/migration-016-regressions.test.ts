/**
 * Security tests: Migration 016 regression documentation.
 *
 * Migration 016 (LWW direction-independent tiebreaker) rewrites all merge RPCs
 * but drops columns/guards that were added in earlier migrations:
 * - 009: target_amount_cents + target_date in merge_envelope
 * - 006: slip_id in merge_transaction, new slip_queue schema
 * - 012: role escalation guard in merge_household_member
 *
 * These tests DOCUMENT known regressions. They use it.failing() because
 * the assertions correctly identify missing functionality.
 */
import * as fs from 'fs';
import * as path from 'path';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../supabase/migrations');

function readMigration(filename: string): string {
  return fs.readFileSync(path.join(MIGRATIONS_DIR, filename), 'utf-8');
}

// ═══════════════════════════════════════════════════════════════════════════════
// MIGRATION 016 REGRESSION TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Migration 016 Regressions', () => {
  let migration016: string;
  let migration009: string;
  let migration006: string;
  let migration012: string;

  beforeAll(() => {
    migration016 = readMigration('016_lww_direction_independent_tiebreaker.sql');
    migration009 = readMigration('009_sinking_funds.sql');
    migration006 = readMigration('006_slip_scanning.sql');
    migration012 = readMigration('012_fix_role_escalation.sql');
  });

  describe('merge_envelope: sinking fund columns (migration 009)', () => {
    it('migration 009 DOES include target_amount_cents in merge_envelope', () => {
      const mergeEnvSection = migration009.slice(
        migration009.indexOf('CREATE OR REPLACE FUNCTION public.merge_envelope'),
      );
      expect(mergeEnvSection).toContain('target_amount_cents');
      expect(mergeEnvSection).toContain('target_date');
    });

    // REGRESSION: 016 drops target_amount_cents and target_date from merge_envelope
    // TODO: FIX in migration 017
    it.failing(
      'should include target_amount_cents in merge_envelope (REGRESSION: 016 drops this)',
      () => {
        const mergeEnvSection = migration016.slice(
          migration016.indexOf('CREATE OR REPLACE FUNCTION public.merge_envelope'),
          migration016.indexOf('GRANT EXECUTE ON FUNCTION public.merge_envelope'),
        );

        expect(mergeEnvSection).toContain('target_amount_cents');
      },
    );

    // REGRESSION: 016 drops target_date from merge_envelope
    // TODO: FIX in migration 017
    it.failing('should include target_date in merge_envelope (REGRESSION: 016 drops this)', () => {
      const mergeEnvSection = migration016.slice(
        migration016.indexOf('CREATE OR REPLACE FUNCTION public.merge_envelope'),
        migration016.indexOf('GRANT EXECUTE ON FUNCTION public.merge_envelope'),
      );

      expect(mergeEnvSection).toContain('target_date');
    });
  });

  describe('merge_transaction: slip_id column (migration 006)', () => {
    it('migration 006 DOES include slip_id in merge_transaction', () => {
      const mergeTxSection = migration006.slice(
        migration006.indexOf('CREATE OR REPLACE FUNCTION public.merge_transaction'),
      );
      expect(mergeTxSection).toContain('slip_id');
    });

    // REGRESSION: 016 drops slip_id from merge_transaction
    // TODO: FIX in migration 017
    it.failing('should include slip_id in merge_transaction (REGRESSION: 016 drops this)', () => {
      const mergeTxSection = migration016.slice(
        migration016.indexOf('CREATE OR REPLACE FUNCTION public.merge_transaction'),
        migration016.indexOf('GRANT EXECUTE ON FUNCTION public.merge_transaction'),
      );

      expect(mergeTxSection).toContain('slip_id');
    });
  });

  describe('merge_household_member: role escalation guard (migration 012)', () => {
    it('migration 012 DOES include role escalation guard', () => {
      expect(migration012).toContain("r.role := 'member'");
    });

    // REGRESSION: 016 drops the role escalation guard from merge_household_member
    // TODO: FIX in migration 017
    it.failing(
      'should include role escalation guard in merge_household_member (REGRESSION: 016 drops this)',
      () => {
        const mergeHmSection = migration016.slice(
          migration016.indexOf('CREATE OR REPLACE FUNCTION public.merge_household_member'),
          migration016.indexOf('GRANT EXECUTE ON FUNCTION public.merge_household_member'),
        );

        expect(mergeHmSection).toContain("r.role := 'member'");
      },
    );
  });

  describe('merge_slip_queue: column schema (migration 006)', () => {
    it('migration 006 slip_queue has created_by, image_uris, and modern columns', () => {
      expect(migration006).toContain('created_by');
      expect(migration006).toContain('image_uris');
      expect(migration006).toContain('openai_cost_cents');
    });

    // REGRESSION: 016 merge_slip_queue uses pre-006 columns (image_base64, extracted_json)
    // instead of the current schema (image_uris, created_by, merchant, etc.)
    // TODO: FIX in migration 017
    it.failing(
      'merge_slip_queue should use current table schema (REGRESSION: 016 uses pre-006 columns)',
      () => {
        const mergeSlipSection = migration016.slice(
          migration016.indexOf('CREATE OR REPLACE FUNCTION public.merge_slip_queue'),
          migration016.indexOf('GRANT EXECUTE ON FUNCTION public.merge_slip_queue'),
        );

        expect(mergeSlipSection).toContain('created_by');
        expect(mergeSlipSection).not.toContain('image_base64');
        expect(mergeSlipSection).not.toContain('extracted_json');
      },
    );
  });

  describe('LWW operator change documentation', () => {
    it('documents the >= to > operator change with direction-independent tiebreaker', () => {
      const mergeEnvSection016 = migration016.slice(
        migration016.indexOf('CREATE OR REPLACE FUNCTION public.merge_envelope'),
        migration016.indexOf('GRANT EXECUTE ON FUNCTION public.merge_envelope'),
      );

      const mergeEnvSection009 = migration009.slice(
        migration009.indexOf('CREATE OR REPLACE FUNCTION public.merge_envelope'),
      );

      expect(mergeEnvSection009).toContain('>=');
      expect(mergeEnvSection016).toContain('>');
      expect(mergeEnvSection016).toContain('EXCLUDED.id > envelopes.id');

      expect(mergeEnvSection016).not.toContain('WHERE EXCLUDED.updated_at >= envelopes.updated_at');
    });

    it('all merge RPCs in 016 use strict > with id tiebreaker', () => {
      const lwwPatternCount = (
        migration016.match(
          /WHERE EXCLUDED\.updated_at > \w+\.updated_at\s+OR \(EXCLUDED\.updated_at = \w+\.updated_at AND EXCLUDED\.id > \w+\.id\)/g,
        ) ?? []
      ).length;

      expect(lwwPatternCount).toBeGreaterThanOrEqual(7);
    });

    it('migration 009 used >= operator (no tiebreaker)', () => {
      const mergeEnvSection009 = migration009.slice(
        migration009.indexOf('CREATE OR REPLACE FUNCTION public.merge_envelope'),
      );

      expect(mergeEnvSection009).toContain('EXCLUDED.updated_at >= envelopes.updated_at');
      expect(mergeEnvSection009).not.toContain('EXCLUDED.id > envelopes.id');
    });
  });
});
