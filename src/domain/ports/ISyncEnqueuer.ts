export type SyncOperation = 'INSERT' | 'UPDATE' | 'DELETE';

export interface ISyncEnqueuer {
  enqueue(tableName: string, recordId: string, operation: SyncOperation): Promise<void>;
}
