import { createSuccess, createFailure, isSuccess } from './types';

describe('Result type helpers', () => {
  it('createSuccess wraps a value', () => {
    const result = createSuccess(42);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe(42);
  });

  it('createFailure wraps an error', () => {
    const result = createFailure({ code: 'NOT_FOUND', message: 'Missing' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('NOT_FOUND');
  });

  it('isSuccess returns true for success result', () => {
    expect(isSuccess(createSuccess('hello'))).toBe(true);
    expect(isSuccess(createFailure({ code: 'ERR', message: '' }))).toBe(false);
  });
});
