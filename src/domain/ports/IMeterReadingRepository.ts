import type { MeterReadingEntity, MeterType } from '../meterReadings/MeterReadingEntity';

export interface IMeterReadingRepository {
  findById(id: string, householdId: string): Promise<MeterReadingEntity | null>;
  findByHousehold(householdId: string, meterType?: MeterType): Promise<MeterReadingEntity[]>;
  findByDate(
    householdId: string,
    meterType: MeterType,
    readingDate: string,
  ): Promise<MeterReadingEntity | null>;
  insert(reading: MeterReadingEntity): Promise<void>;
}
