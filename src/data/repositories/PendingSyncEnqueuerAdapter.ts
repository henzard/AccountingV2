import { PendingSyncEnqueuer } from '../sync/PendingSyncEnqueuer';
import type { ISyncEnqueuer, SyncOperation } from '../../domain/ports/ISyncEnqueuer';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../local/schema';

export class PendingSyncEnqueuerAdapter implements ISyncEnqueuer {
  private readonly inner: PendingSyncEnqueuer;

  constructor(db: ExpoSQLiteDatabase<typeof schema>) {
    this.inner = new PendingSyncEnqueuer(db);
  }

  async enqueue(tableName: string, recordId: string, operation: SyncOperation): Promise<void> {
    return this.inner.enqueue(tableName, recordId, operation);
  }
}
