export type SlipStatus = 'processing' | 'completed' | 'failed' | 'cancelled';

export type SlipFrame = {
  index: number;
  localUri: string;
  base64?: string;
  remotePath?: string;
};

export type SlipExtractionItem = {
  description: string;
  amountCents: number;
  quantity: number;
  suggestedEnvelopeId: string | null;
  confidence: number;
};

export type SlipExtraction = {
  merchant: string | null;
  slipDate: string | null;
  totalCents: number | null;
  items: SlipExtractionItem[];
  rawResponseJson: string;
  openaiCostCents: number;
};
