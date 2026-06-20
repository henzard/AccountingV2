import { toSupabaseRow, toLocalRow } from '../../sync/rowConverters';

describe('toSupabaseRow edge cases', () => {
  it('empty object input -> empty output', () => {
    expect(toSupabaseRow({})).toEqual({});
  });

  it('strips isSynced', () => {
    const result = toSupabaseRow({ isSynced: true, id: 'x' });
    expect(result).toEqual({ id: 'x' });
    expect(result).not.toHaveProperty('isSynced');
    expect(result).not.toHaveProperty('is_synced');
  });

  it('undefined values preserved', () => {
    const result = toSupabaseRow({ someField: undefined });
    expect(result).toEqual({ some_field: undefined });
    expect('some_field' in result).toBe(true);
  });

  it('null values preserved', () => {
    const result = toSupabaseRow({ errorMessage: null });
    expect(result).toEqual({ error_message: null });
  });

  it('multi-segment camelCase keys', () => {
    const result = toSupabaseRow({
      rawResponseJson: '{}',
      openaiCostCents: 42,
      imagesDeletedAt: null,
    });
    expect(result).toEqual({
      raw_response_json: '{}',
      openai_cost_cents: 42,
      images_deleted_at: null,
    });
  });

  it('boolean false preservation', () => {
    const result = toSupabaseRow({ isCompleted: false });
    expect(result).toEqual({ is_completed: false });
  });

  it('boolean true preservation', () => {
    const result = toSupabaseRow({ isManual: true });
    expect(result).toEqual({ is_manual: true });
  });

  it('numeric zero preservation', () => {
    const result = toSupabaseRow({ totalCents: 0 });
    expect(result).toEqual({ total_cents: 0 });
  });

  it('empty string preservation', () => {
    const result = toSupabaseRow({ name: '' });
    expect(result).toEqual({ name: '' });
  });
});

describe('toLocalRow edge cases', () => {
  it('empty object input -> adds isSynced only', () => {
    expect(toLocalRow({})).toEqual({ isSynced: true });
  });

  it('undefined values preserved', () => {
    const result = toLocalRow({ some_field: undefined });
    expect(result.someField).toBeUndefined();
    expect('someField' in result).toBe(true);
  });

  it('null values preserved', () => {
    const result = toLocalRow({ error_message: null });
    expect(result.errorMessage).toBeNull();
  });

  it('multi-segment snake_case keys', () => {
    const result = toLocalRow({
      raw_response_json: '{}',
      openai_cost_cents: 42,
      images_deleted_at: null,
    });
    expect(result.rawResponseJson).toBe('{}');
    expect(result.openaiCostCents).toBe(42);
    expect(result.imagesDeletedAt).toBeNull();
  });

  it('boolean false preservation', () => {
    const result = toLocalRow({ is_completed: false });
    expect(result.isCompleted).toBe(false);
  });

  it('always adds isSynced: true', () => {
    const result = toLocalRow({ id: 'x' });
    expect(result.isSynced).toBe(true);
  });
});
