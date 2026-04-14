export type UserConsentRow = {
  userId: string;
  slipScanConsentAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export interface IUserConsentRepository {
  get(userId: string): Promise<UserConsentRow | null>;
  setSlipScanConsent(userId: string, atIso: string): Promise<void>;
}
