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
