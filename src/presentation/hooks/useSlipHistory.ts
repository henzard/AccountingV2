import { useEffect, useState } from 'react';
import type { SlipQueueRow, ISlipQueueRepository } from '../../domain/ports/ISlipQueueRepository';

export function useSlipHistory(
  repo: ISlipQueueRepository,
  householdId: string,
  page = 0,
  pageSize = 20,
): SlipQueueRow[] {
  const [rows, setRows] = useState<SlipQueueRow[]>([]);
  useEffect(() => {
    let cancelled = false;
    repo.listByHousehold(householdId, pageSize, page * pageSize).then((r) => {
      if (!cancelled) setRows(r);
    });
    return () => {
      cancelled = true;
    };
  }, [repo, householdId, page, pageSize]);
  return rows;
}
