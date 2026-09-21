export type UserConsentRow = {
  userId: string;
  slipScanConsentAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export interface IUserConsentRepository {
  get(userId: string): Promise<UserConsentRow | null>;
  setSlipScanConsent(userId: string, atIso: string): Promise<void>;
  // Clears slip_scan_consent_at back to null — the column's existing
  // "not consented" state (see userConsent.ts schema comment) and exactly
  // what both the local hasConsented check (`!= null`) and the
  // extract-slip edge function's consent gate (`!consent?.slip_scan_consent_at`)
  // already treat as "no consent". No new column/meaning required.
  clearSlipScanConsent(userId: string): Promise<void>;
}
