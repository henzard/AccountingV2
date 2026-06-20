/**
 * Security tests: Migration 016 regression documentation.
 *
 * Migration 016 (LWW direction-independent tiebreaker) rewrites all merge RPCs
 * but drops columns/guards that were added in earlier migrations:
 * - 009: target_amount_cents + target_date in merge_envelope
 * - 006: slip_id in merge_transaction, new slip_queue schema
 * - 012: role escalation guard in merge_household_member
 *
 * Migration 017 fixes all 5 regressions.
 */
import * as fs from 'fs';
import * as path from 'path';
import { sliceMigrationFrom, sliceMigrationSection } from '../../__test-utils__/migrationSlice';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../supabase/migrations');

function readMigration(filename: string): string {
  return fs.readFileSync(path.join(MIGRATIONS_DIR, filename), 'utf-8');
}

// ═══════════════════════════════════════════════════════════════════════════════
// MIGRATION 016 REGRESSION TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Migration 016 Regressions', () => {
  let migration016: string;
  let migration017: string;
  let migration009: string;
  let migration006: string;
  let migration012: string;

  beforeAll(() => {
    migration016 = readMigration('016_lww_direction_independent_tiebreaker.sql');
    migration017 = readMigration('017_fix_merge_regressions.sql');
    migration009 = readMigration('009_sinking_funds.sql');
    migration006 = readMigration('006_slip_scanning.sql');
    migration012 = readMigration('012_fix_role_escalation.sql');
  });

  describe('merge_envelope: sinking fund columns (migration 009)', () => {
    it('migration 009 DOES include target_amount_cents in merge_envelope', () => {
      const mergeEnvSection = sliceMigrationFrom(
        migration009,
        'CREATE OR REPLACE FUNCTION public.merge_envelope',
      );
      expect(mergeEnvSection).toContain('target_amount_cents');
      expect(mergeEnvSection).toContain('target_date');
    });

    it('should include target_amount_cents in merge_envelope (fixed in 017)', () => {
      const mergeEnvSection = sliceMigrationSection(
        migration017,
        'CREATE OR REPLACE FUNCTION public.merge_envelope',
        'GRANT EXECUTE ON FUNCTION public.merge_envelope',
      );

      expect(mergeEnvSection).toContain('target_amount_cents');
    });

    it('should include target_date in merge_envelope (fixed in 017)', () => {
      const mergeEnvSection = sliceMigrationSection(
        migration017,
        'CREATE OR REPLACE FUNCTION public.merge_envelope',
        'GRANT EXECUTE ON FUNCTION public.merge_envelope',
      );

      expect(mergeEnvSection).toContain('target_date');
    });
  });

  describe('merge_transaction: slip_id column (migration 006)', () => {
    it('migration 006 DOES include slip_id in merge_transaction', () => {
      const mergeTxSection = sliceMigrationFrom(
        migration006,
        'CREATE OR REPLACE FUNCTION public.merge_transaction',
      );
      expect(mergeTxSection).toContain('slip_id');
    });

    it('should include slip_id in merge_transaction (fixed in 017)', () => {
      const mergeTxSection = sliceMigrationSection(
        migration017,
        'CREATE OR REPLACE FUNCTION public.merge_transaction',
        'GRANT EXECUTE ON FUNCTION public.merge_transaction',
      );

      expect(mergeTxSection).toContain('slip_id');
    });
  });

  describe('merge_household_member: role escalation guard (migration 012)', () => {
    it('migration 012 DOES include role escalation guard', () => {
      expect(migration012).toContain("r.role := 'member'");
    });

    it('should include role escalation guard in merge_household_member (fixed in 017)', () => {
      const mergeHmSection = sliceMigrationSection(
        migration017,
        'CREATE OR REPLACE FUNCTION public.merge_household_member',
        'GRANT EXECUTE ON FUNCTION public.merge_household_member',
      );

      expect(mergeHmSection).toContain("r.role := 'member'");
    });
  });

  describe('merge_slip_queue: column schema (migration 006)', () => {
    it('migration 006 slip_queue has created_by, image_uris, and modern columns', () => {
      expect(migration006).toContain('created_by');
      expect(migration006).toContain('image_uris');
      expect(migration006).toContain('openai_cost_cents');
    });

    it('merge_slip_queue should use current table schema (fixed in 017)', () => {
      const mergeSlipSection = sliceMigrationSection(
        migration017,
        'CREATE OR REPLACE FUNCTION public.merge_slip_queue',
        'GRANT EXECUTE ON FUNCTION public.merge_slip_queue',
      );

      expect(mergeSlipSection).toContain('created_by');
      expect(mergeSlipSection).not.toContain('image_base64');
      expect(mergeSlipSection).not.toContain('extracted_json');
    });
  });

  describe('LWW operator change documentation', () => {
    it('documents the >= to > operator change with direction-independent tiebreaker', () => {
      const mergeEnvSection016 = sliceMigrationSection(
        migration016,
        'CREATE OR REPLACE FUNCTION public.merge_envelope',
        'GRANT EXECUTE ON FUNCTION public.merge_envelope',
      );

      const mergeEnvSection009 = sliceMigrationFrom(
        migration009,
        'CREATE OR REPLACE FUNCTION public.merge_envelope',
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
      const mergeEnvSection009 = sliceMigrationFrom(
        migration009,
        'CREATE OR REPLACE FUNCTION public.merge_envelope',
      );

      expect(mergeEnvSection009).toContain('EXCLUDED.updated_at >= envelopes.updated_at');
      expect(mergeEnvSection009).not.toContain('EXCLUDED.id > envelopes.id');
    });
  });
});
