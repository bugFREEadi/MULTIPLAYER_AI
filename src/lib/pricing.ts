/**
 * Anthropic Claude Sonnet 5 list pricing (permanent $2 / $10 as of Aug 2026).
 * Used for both mock fake-token costs and real-provider usage aggregation so
 * the math stays correct regardless of whether token counts are fake or real.
 *
 * @see https://platform.claude.com/docs/en/about-claude/pricing
 */
export const DEFAULT_MODEL_PRICING = {
  model: "claude-sonnet-5",
  /** USD per million input tokens */
  inputUsdPerMTok: 2,
  /** USD per million output tokens */
  outputUsdPerMTok: 10,
} as const;

export type TokenUsageCounts = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export function costUsdFromTokens(
  inputTokens: number,
  outputTokens: number,
  pricing: {
    inputUsdPerMTok: number;
    outputUsdPerMTok: number;
  } = DEFAULT_MODEL_PRICING
): string {
  const usd =
    (Math.max(0, inputTokens) / 1_000_000) * pricing.inputUsdPerMTok +
    (Math.max(0, outputTokens) / 1_000_000) * pricing.outputUsdPerMTok;
  return usd.toFixed(6);
}

export function usageWithCost(
  inputTokens: number,
  outputTokens: number
): { tokenUsage: TokenUsageCounts; costUsd: string } {
  const safeIn = Math.max(0, Math.round(inputTokens));
  const safeOut = Math.max(0, Math.round(outputTokens));
  return {
    tokenUsage: {
      inputTokens: safeIn,
      outputTokens: safeOut,
      totalTokens: safeIn + safeOut,
    },
    costUsd: costUsdFromTokens(safeIn, safeOut),
  };
}
