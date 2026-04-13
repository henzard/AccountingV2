export type SlipScanErrorCode =
  | 'SLIP_OPENAI_UNREACHABLE'
  | 'SLIP_RATE_LIMITED_HOUSEHOLD'
  | 'SLIP_RATE_LIMITED_USER'
  | 'SLIP_UNREADABLE'
  | 'SLIP_CONSENT_MISSING'
  | 'SLIP_OFFLINE'
  | 'SLIP_PAYLOAD_TOO_LARGE'
  | 'SLIP_FORBIDDEN'
  | 'SLIP_UNREASONABLE_EXTRACTION';

export type SlipScanError = {
  code: SlipScanErrorCode;
  message: string;
};
