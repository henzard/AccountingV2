import { renderHook, waitFor } from '@testing-library/react-native';
import type {
  ISlipQueueRepository,
  SlipQueueRow,
} from '../../../domain/ports/ISlipQueueRepository';
import { useSlipHistory } from '../useSlipHistory';

function makeRow(overrides: Partial<SlipQueueRow> = {}): SlipQueueRow {
  return {
    id: 'slip-1',
    householdId: 'hh-1',
    createdBy: 'user-1',
    imageUris: ['file:///img1.jpg'],
    status: 'completed',
    errorMessage: null,
    merchant: 'Shop',
    slipDate: '2026-06-15',
    totalCents: 15000,
    rawResponseJson: '{}',
    imagesDeletedAt: null,
    openaiCostCents: 2,
    createdAt: '2026-06-15T10:00:00.000Z',
    updatedAt: '2026-06-15T10:00:00.000Z',
    ...overrides,
  };
}

function createMockRepo(rows: SlipQueueRow[] = []): ISlipQueueRepository {
  return {
    create: jest.fn(),
    get: jest.fn(),
    update: jest.fn(),
    listByHousehold: jest.fn().mockResolvedValue(rows),
    listExpired: jest.fn(),
    listProcessingOlderThan: jest.fn(),
  };
}

describe('useSlipHistory', () => {
  it('returns empty array initially', () => {
    const repo = createMockRepo();
    (repo.listByHousehold as jest.Mock).mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useSlipHistory(repo, 'hh-1'));
    expect(result.current).toEqual([]);
  });

  it('fetches rows from repository', async () => {
    const rows = [makeRow(), makeRow({ id: 'slip-2', merchant: 'Cafe' })];
    const repo = createMockRepo(rows);

    const { result } = renderHook(() => useSlipHistory(repo, 'hh-1'));

    await waitFor(() => {
      expect(result.current).toEqual(rows);
    });

    expect(repo.listByHousehold).toHaveBeenCalledWith('hh-1', 20, 0);
  });

  it('passes correct limit and offset for page 0', async () => {
    const repo = createMockRepo([]);
    renderHook(() => useSlipHistory(repo, 'hh-1', 0, 10));

    await waitFor(() => {
      expect(repo.listByHousehold).toHaveBeenCalledWith('hh-1', 10, 0);
    });
  });

  it('passes correct offset for page 2 with pageSize 10', async () => {
    const repo = createMockRepo([]);
    renderHook(() => useSlipHistory(repo, 'hh-1', 2, 10));

    await waitFor(() => {
      expect(repo.listByHousehold).toHaveBeenCalledWith('hh-1', 10, 20);
    });
  });

  it('uses default page=0 and pageSize=20', async () => {
    const repo = createMockRepo([]);
    renderHook(() => useSlipHistory(repo, 'hh-1'));

    await waitFor(() => {
      expect(repo.listByHousehold).toHaveBeenCalledWith('hh-1', 20, 0);
    });
  });

  it('refetches when householdId changes', async () => {
    const repo = createMockRepo([makeRow()]);

    const { rerender } = renderHook(({ hh }: { hh: string }) => useSlipHistory(repo, hh), {
      initialProps: { hh: 'hh-1' },
    });

    await waitFor(() => {
      expect(repo.listByHousehold).toHaveBeenCalledWith('hh-1', 20, 0);
    });

    (repo.listByHousehold as jest.Mock).mockResolvedValue([makeRow({ householdId: 'hh-2' })]);
    rerender({ hh: 'hh-2' });

    await waitFor(() => {
      expect(repo.listByHousehold).toHaveBeenCalledWith('hh-2', 20, 0);
    });
  });

  it('refetches when page changes', async () => {
    const repo = createMockRepo([makeRow()]);

    const { rerender } = renderHook(
      ({ page }: { page: number }) => useSlipHistory(repo, 'hh-1', page, 5),
      { initialProps: { page: 0 } },
    );

    await waitFor(() => {
      expect(repo.listByHousehold).toHaveBeenCalledWith('hh-1', 5, 0);
    });

    (repo.listByHousehold as jest.Mock).mockResolvedValue([makeRow({ id: 'slip-page2' })]);
    rerender({ page: 1 });

    await waitFor(() => {
      expect(repo.listByHousehold).toHaveBeenCalledWith('hh-1', 5, 5);
    });
  });

  it('ignores stale response when householdId changes (stale-race)', async () => {
    let resolveStale: (rows: SlipQueueRow[]) => void;
    const repo = createMockRepo();
    const freshRow = makeRow({ id: 'slip-fresh', householdId: 'hh-2' });

    (repo.listByHousehold as jest.Mock).mockImplementation((hhId: string) => {
      if (hhId === 'hh-1') {
        return new Promise<SlipQueueRow[]>((r) => {
          resolveStale = r;
        });
      }
      return Promise.resolve([freshRow]);
    });

    const { result, rerender } = renderHook(({ hh }: { hh: string }) => useSlipHistory(repo, hh), {
      initialProps: { hh: 'hh-1' },
    });

    rerender({ hh: 'hh-2' });

    await waitFor(() => {
      expect(result.current).toEqual([freshRow]);
    });

    resolveStale!([makeRow()]);
    await Promise.resolve();

    expect(result.current).toEqual([freshRow]);
  });

  it('returns empty when repository returns empty list', async () => {
    const repo = createMockRepo([]);

    const { result } = renderHook(() => useSlipHistory(repo, 'hh-1'));

    await waitFor(() => {
      expect(repo.listByHousehold).toHaveBeenCalled();
    });

    expect(result.current).toEqual([]);
  });
});
