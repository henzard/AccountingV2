import { openMigratedDb, applyMigrationsAfter } from './harness/openMigratedDb';

describe('local migration chain (real SQLite)', () => {
  it('applies every migration in journal order to an empty database', () => {
    const db = openMigratedDb();
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
    ).map((r) => r.name);
    for (const expected of [
      'households',
      'household_members',
      'envelopes',
      'transactions',
      'baby_steps',
      'audit_events',
      'slip_queue',
    ]) {
      expect(tables).toContain(expected);
    }
    // pending_sync was dropped by migration 0014 (slice 5 task 6) — assert
    // its absence here rather than its presence.
    expect(tables).not.toContain('pending_sync');
    db.close();
  });

  it('applies the chain to a database with seeded rows at 0006', () => {
    const db = openMigratedDb('0006_round_betty_brant');
    db.prepare(
      `INSERT INTO households (id, name, payday_day, created_at, updated_at)
       VALUES ('hh-1', 'Test Household', 25, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO household_members (id, household_id, user_id, role, joined_at)
       VALUES ('hm-1', 'hh-1', 'user-1', 'owner', '2026-01-01T00:00:00.000Z')`,
    ).run();
    // Apply the remaining migrations (0007+) on top of the seeded DB.
    expect(() => applyMigrationsAfter(db, '0006_round_betty_brant')).not.toThrow();
    const cols = (
      db.prepare('PRAGMA table_info(household_members)').all() as { name: string }[]
    ).map((c) => c.name);
    expect(cols).toContain('updated_at'); // 0007 applied
    db.close();
  });

  it('0012 drops envelopes.spent_cents and is_synced from every table that had it', () => {
    const db = openMigratedDb('0011_oplog_foundations');

    // Seed rows in the OLD (pre-0012) shape across every affected table.
    db.prepare(
      `INSERT INTO households (id, name, payday_day, created_at, updated_at, is_synced)
       VALUES ('hh-1', 'Test Household', 25, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 0)`,
    ).run();
    db.prepare(
      `INSERT INTO envelopes
         (id, household_id, name, allocated_cents, spent_cents, envelope_type,
          is_savings_locked, is_archived, period_start, created_at, updated_at, is_synced)
       VALUES ('env-1', 'hh-1', 'Groceries', 50000, 12000, 'spending', 0, 0,
               '2026-01-01', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 0)`,
    ).run();
    db.prepare(
      `INSERT INTO transactions
         (id, household_id, envelope_id, amount_cents, transaction_date,
          is_business_expense, created_at, updated_at, is_synced)
       VALUES ('tx-1', 'hh-1', 'env-1', 1000, '2026-01-05', 0,
               '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 0)`,
    ).run();
    db.prepare(
      `INSERT INTO debts
         (id, household_id, creditor_name, debt_type, outstanding_balance_cents,
          minimum_payment_cents, interest_rate_percent, created_at, updated_at, is_synced)
       VALUES ('debt-1', 'hh-1', 'Bank', 'credit_card', 100000, 5000, 20,
               '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 0)`,
    ).run();
    db.prepare(
      `INSERT INTO meter_readings
         (id, household_id, meter_type, reading_value, reading_date, created_at, updated_at, is_synced)
       VALUES ('mr-1', 'hh-1', 'electricity', 100, '2026-01-01',
               '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 0)`,
    ).run();
    db.prepare(
      `INSERT INTO baby_steps (id, household_id, step_number, created_at, updated_at, is_synced)
       VALUES ('bs-1', 'hh-1', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 0)`,
    ).run();
    db.prepare(
      `INSERT INTO slip_queue
         (id, household_id, created_by, image_uris, created_at, updated_at, is_synced)
       VALUES ('sq-1', 'hh-1', 'user-1', '[]', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 0)`,
    ).run();
    db.prepare(
      `INSERT INTO audit_events
         (id, household_id, entity_type, entity_id, action, created_at, is_synced)
       VALUES ('ae-1', 'hh-1', 'envelope', 'env-1', 'create', '2026-01-01T00:00:00.000Z', 0)`,
    ).run();
    db.prepare(
      `INSERT INTO user_consent (user_id, created_at, updated_at, is_synced)
       VALUES ('user-1', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 0)`,
    ).run();

    // Apply 0012 on top of the seeded pre-0012 rows.
    expect(() => applyMigrationsAfter(db, '0011_oplog_foundations')).not.toThrow();

    const tableCols = (table: string): string[] =>
      (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);

    expect(tableCols('envelopes')).not.toContain('spent_cents');
    for (const table of [
      'envelopes',
      'households',
      'transactions',
      'meter_readings',
      'debts',
      'baby_steps',
      'slip_queue',
      'audit_events',
      'user_consent',
    ]) {
      expect(tableCols(table)).not.toContain('is_synced');
    }

    // Data survives the rebuild — this isn't just a schema check.
    const envelope = db.prepare('SELECT * FROM envelopes WHERE id = ?').get('env-1') as {
      allocated_cents: number;
    };
    expect(envelope.allocated_cents).toBe(50000);

    db.close();
  });

  it('0014 drops pending_sync (dead outbox — SyncOrchestrator/PendingSyncEnqueuer deleted, slice 5 task 6)', () => {
    const db = openMigratedDb('0013_emf_unique');

    const tableExists = (): unknown =>
      db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='pending_sync'").get();

    expect(tableExists()).toBeDefined();

    expect(() => applyMigrationsAfter(db, '0013_emf_unique')).not.toThrow();

    expect(tableExists()).toBeUndefined();

    db.close();
  });
});
