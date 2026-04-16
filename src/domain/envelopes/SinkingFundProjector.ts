import { differenceInMonths } from 'date-fns';

export interface SinkingFundProjection {
  percentComplete: number;
  monthsRemaining: number;
  requiredMonthlyCents: number;
  isOnTrack: boolean;
}

export interface SinkingFundProjectInput {
  savedCents: number;
  targetAmountCents: number;
  targetDate: string;
  currentMonthlyCents?: number;
  today?: Date;
}

export class SinkingFundProjector {
  project(input: SinkingFundProjectInput): SinkingFundProjection {
    const today = input.today ?? new Date();
    const target = new Date(input.targetDate);
    const monthsRemaining = Math.max(0, differenceInMonths(target, today));
    const shortfallCents = Math.max(0, input.targetAmountCents - input.savedCents);
    const percentComplete =
      input.targetAmountCents === 0
        ? 100
        : Math.min(100, Math.round((input.savedCents / input.targetAmountCents) * 100));
    const requiredMonthlyCents =
      monthsRemaining === 0 ? 0 : Math.ceil(shortfallCents / monthsRemaining);
    const currentMonthly = input.currentMonthlyCents ?? 0;
    const isOnTrack = shortfallCents === 0 || currentMonthly >= requiredMonthlyCents;

    return { percentComplete, monthsRemaining, requiredMonthlyCents, isOnTrack };
  }
}
