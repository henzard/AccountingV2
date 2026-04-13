import { randomUUID } from 'expo-crypto';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import { meterReadings } from '../../data/local/schema';
import type { AuditLogger } from '../../data/audit/AuditLogger';
import { PendingSyncEnqueuerAdapter } from '../../data/repositories/PendingSyncEnqueuerAdapter';
import type { ISyncEnqueuer } from '../ports/ISyncEnqueuer';
import type { Result } from '../shared/types';
import { createSuccess, createFailure } from '../shared/types';
import type { MeterReadingEntity, MeterType } from './MeterReadingEntity';

export interface LogMeterReadingInput {
  householdId: string;
  meterType: MeterType;
  readingValue: number;
  readingDate: string; // YYYY-MM-DD
  costCents: number | null;
  vehicleId: string | null;
  notes: string | null;
}

export class LogMeterReadingUseCase {
  private readonly enqueuer: ISyncEnqueuer;

  constructor(
    private readonly db: ExpoSQLiteDatabase<typeof schema>,
    private readonly audit: AuditLogger,
    private readonly input: LogMeterReadingInput,
    enqueuer?: ISyncEnqueuer,
  ) {
    this.enqueuer = enqueuer ?? new PendingSyncEnqueuerAdapter(db);
  }

  async execute(): Promise<Result<MeterReadingEntity>> {
    if (this.input.readingValue <= 0) {
      return createFailure({
        code: 'INVALID_READING',
        message: 'Reading value must be greater than zero',
      });
    }

    const now = new Date().toISOString();
    const id = randomUUID();

    const reading: MeterReadingEntity = {
      id,
      householdId: this.input.householdId,
      meterType: this.input.meterType,
      readingValue: this.input.readingValue,
      readingDate: this.input.readingDate,
      costCents: this.input.costCents,
      vehicleId: this.input.vehicleId,
      notes: this.input.notes,
      createdAt: now,
      updatedAt: now,
      isSynced: false,
    };

    await this.db.insert(meterReadings).values(reading);

    await this.audit.log({
      householdId: this.input.householdId,
      entityType: 'meter_reading',
      entityId: id,
      action: 'create',
      previousValue: null,
      newValue: {
        id,
        meterType: this.input.meterType,
        readingValue: this.input.readingValue,
        readingDate: this.input.readingDate,
      },
    });

    await this.enqueuer.enqueue('meter_readings', id, 'INSERT');

    return createSuccess(reading);
  }
}
