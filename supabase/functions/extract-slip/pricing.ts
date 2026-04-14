import pricing from './model_pricing.json' with { type: 'json' };

export type OpenAIUsage = { prompt_tokens: number; completion_tokens: number };

export function calculateOpenAIcost(usage: OpenAIUsage): number {
  const inputCentsPer1K = pricing.gpt_4o_mini.input_cents_per_1k;
  const outputCentsPer1K = pricing.gpt_4o_mini.output_cents_per_1k;
  return Math.ceil(
    (usage.prompt_tokens / 1000) * inputCentsPer1K +
      (usage.completion_tokens / 1000) * outputCentsPer1K,
  );
}
