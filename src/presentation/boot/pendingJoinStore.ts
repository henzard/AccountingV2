/**
 * pendingJoinStore — F1 (round 6) app-start recovery for a half-completed join.
 *
 * Set by App.tsx's LOCAL boot phase when `EnsureHouseholdUseCase` reports
 * `household_not_downloaded` (an active local `household_members` row whose
 * `households` row was never downloaded), and read by RootNavigator to show
 * FinishJoinScreen instead of the create/join choice screen — where "Create
 * Household" would mint a SECOND household for someone who is already a
 * member.
 *
 * Deliberately its own tiny store rather than a field on appStore: this is
 * boot-recovery state with a single writer and a single reader, and it must
 * not participate in appStore's household/session reset semantics.
 */

import { create } from 'zustand';

interface PendingJoinState {
  /** Household the user already belongs to but has no local row for. */
  pendingJoinHouseholdId: string | null;
  setPendingJoinHouseholdId: (householdId: string | null) => void;
}

export const usePendingJoinStore = create<PendingJoinState>()((set) => ({
  pendingJoinHouseholdId: null,
  setPendingJoinHouseholdId: (pendingJoinHouseholdId): void => set({ pendingJoinHouseholdId }),
}));
