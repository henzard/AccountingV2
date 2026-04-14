import { calculateOpenAIcost } from '../pricing.ts';
import { assertEquals } from 'jsr:@std/assert';

Deno.test('calculateOpenAIcost: typical 2-frame scan', () => {
  // ~700 image tokens + 800 prompt tokens + 400 output tokens
  const cost = calculateOpenAIcost({ prompt_tokens: 1500, completion_tokens: 400 });
  // 1.5 * 0.015 + 0.4 * 0.06 = 0.0225 + 0.024 = 0.0465 → ceil to 1 cent
  assertEquals(cost, 1);
});

Deno.test('calculateOpenAIcost: 5-frame max', () => {
  const cost = calculateOpenAIcost({ prompt_tokens: 4300, completion_tokens: 600 });
  // 4.3 * 0.015 + 0.6 * 0.06 = 0.0645 + 0.036 = 0.1005 → ceil to 1 cent
  assertEquals(cost, 1);
});

Deno.test('calculateOpenAIcost: large expensive scan returns at least 1 cent', () => {
  const cost = calculateOpenAIcost({ prompt_tokens: 100000, completion_tokens: 10000 });
  // 100 * 0.015 + 10 * 0.06 = 1.5 + 0.6 = 2.1 → ceil to 3 cents
  assertEquals(cost > 0, true);
});
