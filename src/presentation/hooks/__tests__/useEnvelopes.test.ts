import { renderHook, waitFor, act } from '@testing-library/react-native';

const mockFrom = jest.fn();
const mockWhere = jest.fn();

jest.mock('../../../data/local/db', () => ({
  db: {
    select: () => ({ from: mockFrom }),
  },
}));

mockFrom.mockReturnValue({ where: mockWhere });

import { useEnvelopes } from '../useEnvelopes';
import type { EnvelopeEntity } from '../../../domain/envelopes/EnvelopeEntity';

const HOUSEHOLD = 'hh-1';
const PERIOD = '2026-06-01';

function makeEnvelope(overrides: Partial<EnvelopeEntity> = {}): EnvelopeEntity {
  return {
    id: 'env-1',
    householdId: HOUSEHOLD,
    name: 'Groceries',
    allocatedCents: 200000,
    spentCents: 50000,
    envelopeType: 'spending',
    isSavingsLocked: false,
    isArchived: false,
    periodStart: PERIOD,
    targetAmountCents: null,
    targetDate: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('useEnvelopes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFrom.mockReturnValue({ where: mockWhere });
  });

  it('returns loading=true initially', () => {
    mockWhere.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useEnvelopes(HOUSEHOLD, PERIOD));
    expect(result.current.loading).toBe(true);
    expect(result.current.envelopes).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('fetches envelopes and sets loading=false on success', async () => {
    const rows = [makeEnvelope(), makeEnvelope({ id: 'env-2', name: 'Transport' })];
    mockWhere.mockResolvedValue(rows);

    const { result } = renderHook(() => useEnvelopes(HOUSEHOLD, PERIOD));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.envelopes).toEqual(rows);
    expect(result.current.error).toBeNull();
  });

  it('returns empty array when no envelopes found', async () => {
    mockWhere.mockResolvedValue([]);

    const { result } = renderHook(() => useEnvelopes(HOUSEHOLD, PERIOD));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.envelopes).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('sets error message when fetch throws an Error', async () => {
    mockWhere.mockRejectedValue(new Error('Connection lost'));

    const { result } = renderHook(() => useEnvelopes(HOUSEHOLD, PERIOD));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('Connection lost');
    expect(result.current.envelopes).toEqual([]);
  });

  it('sets fallback error when fetch throws a non-Error', async () => {
    mockWhere.mockRejectedValue('string error');

    const { result } = renderHook(() => useEnvelopes(HOUSEHOLD, PERIOD));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('Failed to load envelopes');
  });

  it('reload re-fetches data', async () => {
    const initial = [makeEnvelope()];
    const updated = [makeEnvelope(), makeEnvelope({ id: 'env-3' })];
    mockWhere.mockResolvedValueOnce(initial).mockResolvedValueOnce(updated);

    const { result } = renderHook(() => useEnvelopes(HOUSEHOLD, PERIOD));

    await waitFor(() => {
      expect(result.current.envelopes).toEqual(initial);
    });

    await act(async () => {
      await result.current.reload();
    });

    expect(result.current.envelopes).toEqual(updated);
    expect(result.current.loading).toBe(false);
  });

  it('reload clears previous error before retrying', async () => {
    mockWhere.mockRejectedValueOnce(new Error('fail'));

    const { result } = renderHook(() => useEnvelopes(HOUSEHOLD, PERIOD));

    await waitFor(() => {
      expect(result.current.error).toBe('fail');
    });

    mockWhere.mockResolvedValueOnce([makeEnvelope()]);
    await act(async () => {
      await result.current.reload();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.envelopes).toHaveLength(1);
  });

  it('re-fetches when householdId changes', async () => {
    mockWhere.mockResolvedValue([]);

    const { result, rerender } = renderHook(
      ({ hh, period }: { hh: string; period: string }) => useEnvelopes(hh, period),
      { initialProps: { hh: HOUSEHOLD, period: PERIOD } },
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    mockWhere.mockResolvedValue([makeEnvelope({ householdId: 'hh-2' })]);
    rerender({ hh: 'hh-2', period: PERIOD });

    await waitFor(() => {
      expect(result.current.envelopes[0]?.householdId).toBe('hh-2');
    });
  });
});
