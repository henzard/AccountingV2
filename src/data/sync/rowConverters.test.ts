import { toSupabaseRow, toLocalRow } from './rowConverters';

describe('toSupabaseRow', () => {
  it('converts camelCase keys to snake_case and strips isSynced', () => {
    const result = toSupabaseRow({
      id: '1',
      householdId: 'hh-1',
      allocatedCents: 5000,
      isSynced: false,
      periodStart: '2026-01-01',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });
    expect(result).toEqual({
      id: '1',
      household_id: 'hh-1',
      allocated_cents: 5000,
      period_start: '2026-01-01',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    });
    expect('isSynced' in result).toBe(false);
    expect('is_synced' in result).toBe(false);
  });
});

describe('toLocalRow', () => {
  it('converts snake_case keys to camelCase and adds isSynced: true', () => {
    const result = toLocalRow({
      id: '1',
      household_id: 'hh-1',
      allocated_cents: 5000,
      period_start: '2026-01-01',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    });
    expect(result).toMatchObject({
      id: '1',
      householdId: 'hh-1',
      allocatedCents: 5000,
      periodStart: '2026-01-01',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      isSynced: true,
    });
  });
});

describe('baby_steps round-trip via toSupabaseRow + toLocalRow', () => {
  it('converts a full baby_steps camelCase row to snake_case (Supabase-bound)', () => {
    const camelRow = {
      id: 'bs-1',
      householdId: 'hh-1',
      stepNumber: 1,
      isCompleted: true,
      completedAt: '2026-04-12T10:00:00Z',
      isManual: false,
      celebratedAt: '2026-04-12T10:05:00Z',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-04-12T10:00:00Z',
      isSynced: false,
    };

    const result = toSupabaseRow(camelRow);

    expect(result).toEqual({
      id: 'bs-1',
      household_id: 'hh-1',
      step_number: 1,
      is_completed: true,
      completed_at: '2026-04-12T10:00:00Z',
      is_manual: false,
      celebrated_at: '2026-04-12T10:05:00Z',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-04-12T10:00:00Z',
    });
    // isSynced must be stripped — never sent to Supabase
    expect('isSynced' in result).toBe(false);
    expect('is_synced' in result).toBe(false);
  });

  it('converts a baby_steps snake_case row to camelCase (local-bound) and sets isSynced: true', () => {
    const snakeRow = {
      id: 'bs-1',
      household_id: 'hh-1',
      step_number: 2,
      is_completed: false,
      completed_at: null,
      is_manual: true,
      celebrated_at: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };

    const result = toLocalRow(snakeRow);

    expect(result).toEqual({
      id: 'bs-1',
      householdId: 'hh-1',
      stepNumber: 2,
      isCompleted: false,
      completedAt: null,
      isManual: true,
      celebratedAt: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      isSynced: true,
    });
  });

  it('preserves boolean false values correctly through the round-trip', () => {
    // Drizzle returns booleans from SQLite integer columns (mode: 'boolean').
    // Verify false is not dropped or coerced to falsy-but-wrong type.
    const camelRow = {
      id: 'bs-2',
      householdId: 'hh-1',
      stepNumber: 4,
      isCompleted: false,
      completedAt: null,
      isManual: true,
      celebratedAt: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      isSynced: false,
    };

    const snake = toSupabaseRow(camelRow);
    expect(snake.is_completed).toBe(false);
    expect(snake.is_manual).toBe(true);
    expect(snake.celebrated_at).toBeNull();

    const local = toLocalRow(snake);
    expect(local.isCompleted).toBe(false);
    expect(local.isManual).toBe(true);
    expect(local.celebratedAt).toBeNull();
    expect(local.isSynced).toBe(true);
  });
});
