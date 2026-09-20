import {
  validateTransactionAmountCents,
  validateTransactionDate,
  validateTargetEnvelope,
} from '../transactionValidation';

describe('validateTransactionAmountCents', () => {
  it('rejects zero', () => {
    const result = validateTransactionAmountCents(0);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_AMOUNT');
  });

  it('rejects negative amounts', () => {
    const result = validateTransactionAmountCents(-100);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_AMOUNT');
  });

  it('rejects non-safe-integer amounts', () => {
    const result = validateTransactionAmountCents(Number.MAX_SAFE_INTEGER + 10);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_AMOUNT');
  });

  it('accepts a positive integer amount', () => {
    expect(validateTransactionAmountCents(5000).success).toBe(true);
  });
});

describe('validateTransactionDate', () => {
  it('rejects a malformed date string', () => {
    const result = validateTransactionDate('12/25/2026');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_DATE');
  });

  it('rejects an impossible calendar date', () => {
    const result = validateTransactionDate('2026-13-40');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_DATE');
  });

  it('rejects a date more than 1 day in the future', () => {
    const farFuture = new Date();
    farFuture.setDate(farFuture.getDate() + 5);
    const dateStr = farFuture.toISOString().slice(0, 10);
    const result = validateTransactionDate(dateStr);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('FUTURE_DATE');
  });

  it('accepts today', () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(validateTransactionDate(today).success).toBe(true);
  });

  it('accepts a past date', () => {
    expect(validateTransactionDate('2020-01-01').success).toBe(true);
  });
});

describe('validateTargetEnvelope', () => {
  it('rejects an undefined envelope (not found)', () => {
    const result = validateTargetEnvelope(undefined);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('ENVELOPE_NOT_FOUND');
  });

  it('rejects an income envelope', () => {
    const result = validateTargetEnvelope({
      envelopeType: 'income',
      isArchived: false,
      deletedAt: null,
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_ENVELOPE_TYPE');
  });

  it('rejects an archived envelope', () => {
    const result = validateTargetEnvelope({
      envelopeType: 'spending',
      isArchived: true,
      deletedAt: null,
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('ENVELOPE_ARCHIVED');
  });

  it('rejects a deleted envelope', () => {
    const result = validateTargetEnvelope({
      envelopeType: 'spending',
      isArchived: false,
      deletedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('ENVELOPE_ARCHIVED');
  });

  it('accepts a live, non-income envelope', () => {
    const result = validateTargetEnvelope({
      envelopeType: 'spending',
      isArchived: false,
      deletedAt: null,
    });
    expect(result.success).toBe(true);
  });
});
