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
    const shortfallCents = Math.max(0, input.targetAmountCents - input.savedCents);
    const percentComplete =
      input.targetAmountCents === 0
        ? 100
        : Math.min(100, Math.round((input.savedCents / input.targetAmountCents) * 100));

    // If target is still in the future, give at least 1 month (handles sub-month gaps).
    // If overdue and there's still a shortfall, requiredMonthlyCents = full shortfall
    // (signalling the goal is unachievable on schedule) so isOnTrack is false.
    const hasTimeLeft = target.getTime() > today.getTime();
    const monthsRemaining = hasTimeLeft ? Math.max(1, differenceInMonths(target, today)) : 0;
    const requiredMonthlyCents =
      shortfallCents === 0
        ? 0
        : monthsRemaining === 0
          ? shortfallCents
          : Math.ceil(shortfallCents / monthsRemaining);
    const currentMonthly = input.currentMonthlyCents ?? 0;
    const isOnTrack = shortfallCents === 0 || currentMonthly >= requiredMonthlyCents;

    return { percentComplete, monthsRemaining, requiredMonthlyCents, isOnTrack };
  }
}
