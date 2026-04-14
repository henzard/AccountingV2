export type ExtractSlipRequest = {
  slip_id: string;
  household_id: string;
  images_base64: string[];
};

export type ExtractSlipResponseItem = {
  description: string;
  amount_cents: number;
  quantity: number;
  suggested_envelope_id: string | null;
  confidence: number;
};

export type ExtractSlipResponse = {
  merchant: string | null;
  slip_date: string | null;
  total_cents: number | null;
  items: ExtractSlipResponseItem[];
  raw_response: string;
  openai_cost_cents: number;
};
