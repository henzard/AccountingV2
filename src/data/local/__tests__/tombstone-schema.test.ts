/**
 * Ensures Drizzle schema stays aligned with 0009_soft_delete_tombstones.sql.
 * Migration adds deleted_at to every domain table listed below; schema must expose deletedAt.
 */
import * as fs from 'fs';
import * as path from 'path';
import { babySteps } from '../schema/babySteps';
import { debts } from '../schema/debts';
import { envelopes } from '../schema/envelopes';
import { householdMembers } from '../schema/householdMembers';
import { households } from '../schema/households';
import { meterReadings } from '../schema/meterReadings';
import { transactions } from '../schema/transactions';

const MIGRATION_TABLES = [
  'envelopes',
  'transactions',
  'debts',
  'meter_readings',
  'baby_steps',
  'households',
  'household_members',
] as const;

const SCHEMA_TABLES = {
  envelopes,
  transactions,
  debts,
  meter_readings: meterReadings,
  baby_steps: babySteps,
  households,
  household_members: householdMembers,
} as const;

describe('0009 tombstone schema alignment', () => {
  it('migration SQL adds deleted_at to all domain tables', () => {
    const sql = fs.readFileSync(
      path.resolve(__dirname, '../migrations/0009_soft_delete_tombstones.sql'),
      'utf8',
    );
    for (const table of MIGRATION_TABLES) {
      expect(sql).toContain(`\`${table}\` ADD \`deleted_at\``);
    }
  });

  it('Drizzle schema exposes deletedAt on every table from migration 0009', () => {
    for (const table of MIGRATION_TABLES) {
      const schema = SCHEMA_TABLES[table];
      expect(schema.deletedAt).toBeDefined();
      expect(schema.deletedAt.name).toBe('deleted_at');
    }
  });
});
