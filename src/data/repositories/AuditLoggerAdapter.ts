import { AuditLogger } from '../audit/AuditLogger';
import type { IAuditPort, AuditEntry } from '../../domain/ports/IAuditPort';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../local/schema';

export class AuditLoggerAdapter implements IAuditPort {
  private readonly inner: AuditLogger;

  constructor(db: ExpoSQLiteDatabase<typeof schema>) {
    this.inner = new AuditLogger(db);
  }

  async log(entry: AuditEntry): Promise<void> {
    return this.inner.log(entry);
  }
}
