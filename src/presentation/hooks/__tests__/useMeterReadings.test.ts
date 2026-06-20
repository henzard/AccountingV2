import { renderHook, act } from '@testing-library/react-native';

const mockFrom = jest.fn();
const mockWhere = jest.fn();
const mockOrderBy = jest.fn();
const mockLimit = jest.fn();

jest.mock('../../../data/local/db', () => ({
  db: {
    select: () => ({ from: mockFrom }),
  },
}));

mockFrom.mockReturnValue({ where: mockWhere });
mockWhere.mockReturnValue({ orderBy: mockOrderBy });
mockOrderBy.mockReturnValue({ limit: mockLimit });

import { useMeterReadings } from '../useMeterReadings';
import type { MeterReadingEntity } from '../../../domain/meterReadings/MeterReadingEntity';

const HOUSEHOLD = 'hh-1';
const METER_TYPE = 'electricity' as const;

function makeReading(overrides: Partial<MeterReadingEntity> = {}): MeterReadingEntity {
  return {
    id: 'mr-1',
    householdId: HOUSEHOLD,
    meterType: METER_TYPE,
    readingValue: 12345,
    readingDate: '2026-06-01',
    rateCentsPerUnit: null,
    costCents: null,
    createdBy: 'user-1',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  } as MeterReadingEntity;
}

describe('useMeterReadings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFrom.mockReturnValue({ where: mockWhere });
    mockWhere.mockReturnValue({ orderBy: mockOrderBy });
    mockOrderBy.mockReturnValue({ limit: mockLimit });
  });

  it('starts with loading=true and empty readings before reload', () => {
    const { result } = renderHook(() => useMeterReadings(HOUSEHOLD, METER_TYPE));
    expect(result.current.loading).toBe(true);
    expect(result.current.readings).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('fetches readings on reload and sets loading=false', async () => {
    const rows = [makeReading(), makeReading({ id: 'mr-2', readingValue: 12400 })];
    mockLimit.mockResolvedValue(rows);

    const { result } = renderHook(() => useMeterReadings(HOUSEHOLD, METER_TYPE));

    await act(async () => {
      await result.current.reload();
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.readings).toEqual(rows);
    expect(result.current.error).toBeNull();
  });

  it('returns empty array when no readings found', async () => {
    mockLimit.mockResolvedValue([]);

    const { result } = renderHook(() => useMeterReadings(HOUSEHOLD, METER_TYPE));

    await act(async () => {
      await result.current.reload();
    });

    expect(result.current.readings).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it('sets error when fetch throws Error', async () => {
    mockLimit.mockRejectedValue(new Error('Disk full'));

    const { result } = renderHook(() => useMeterReadings(HOUSEHOLD, METER_TYPE));

    await act(async () => {
      await result.current.reload();
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe('Disk full');
    expect(result.current.readings).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it('wraps non-Error values into Error', async () => {
    mockLimit.mockRejectedValue('crash');

    const { result } = renderHook(() => useMeterReadings(HOUSEHOLD, METER_TYPE));

    await act(async () => {
      await result.current.reload();
    });

    expect(result.current.error?.message).toBe('crash');
  });

  it('uses custom limit parameter', async () => {
    mockLimit.mockResolvedValue([]);

    const { result } = renderHook(() => useMeterReadings(HOUSEHOLD, METER_TYPE, 10));

    await act(async () => {
      await result.current.reload();
    });

    expect(mockLimit).toHaveBeenCalledWith(10);
  });

  it('uses default limit of 24', async () => {
    mockLimit.mockResolvedValue([]);

    const { result } = renderHook(() => useMeterReadings(HOUSEHOLD, METER_TYPE));

    await act(async () => {
      await result.current.reload();
    });

    expect(mockLimit).toHaveBeenCalledWith(24);
  });

  it('reload refreshes data on subsequent calls', async () => {
    const first = [makeReading()];
    const second = [makeReading(), makeReading({ id: 'mr-3' })];
    mockLimit.mockResolvedValueOnce(first).mockResolvedValueOnce(second);

    const { result } = renderHook(() => useMeterReadings(HOUSEHOLD, METER_TYPE));

    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.readings).toEqual(first);

    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.readings).toEqual(second);
    expect(result.current.loading).toBe(false);
  });

  it('reload clears previous error', async () => {
    mockLimit.mockRejectedValueOnce(new Error('oops'));

    const { result } = renderHook(() => useMeterReadings(HOUSEHOLD, METER_TYPE));

    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.error).not.toBeNull();

    mockLimit.mockResolvedValueOnce([makeReading()]);
    await act(async () => {
      await result.current.reload();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.readings).toHaveLength(1);
  });

  it('reload sets loading=true during fetch', async () => {
    let resolvePromise: (v: unknown[]) => void;
    mockLimit.mockReturnValue(
      new Promise((r) => {
        resolvePromise = r;
      }),
    );

    const { result } = renderHook(() => useMeterReadings(HOUSEHOLD, METER_TYPE));

    let reloadPromise: Promise<void>;
    act(() => {
      reloadPromise = result.current.reload();
    });

    expect(result.current.loading).toBe(true);

    await act(async () => {
      resolvePromise!([]);
      await reloadPromise!;
    });

    expect(result.current.loading).toBe(false);
  });
});
