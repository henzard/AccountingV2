import { format, parseISO } from 'date-fns';

export type MeterType = 'electricity' | 'water' | 'odometer';

export interface MeterReadingEntity {
  id: string;
  householdId: string;
  meterType: MeterType;
  readingValue: number; // kWh, kL, or km
  readingDate: string; // ISO date YYYY-MM-DD
  costCents: number | null; // cost associated with this billing period
  vehicleId: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  isSynced: boolean;
}

export function getMeterTypeLabel(meterType: MeterType): string {
  const labels: Record<MeterType, string> = {
    electricity: 'Electricity',
    water: 'Water',
    odometer: 'Vehicle',
  };
  return labels[meterType];
}

export function getMeterUnitLabel(meterType: MeterType): string {
  const units: Record<MeterType, string> = {
    electricity: 'kWh',
    water: 'kL',
    odometer: 'km',
  };
  return units[meterType];
}

export function getMeterIcon(meterType: MeterType): string {
  const icons: Record<MeterType, string> = {
    electricity: 'lightning-bolt',
    water: 'water',
    odometer: 'car',
  };
  return icons[meterType];
}

export function getReadingDisplayDate(reading: MeterReadingEntity): string {
  return format(parseISO(reading.readingDate), 'd MMM yyyy');
}
