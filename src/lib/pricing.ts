/**
 * Token pricing for Claude models.
 *
 * Prices are per-million tokens (as of 2026-04).
 * Cache pricing uses reduced rates for cache reads.
 */

import type { ModelId } from '../config.js';
import type { TokenUsageSummary } from './metrics.js';

interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
  cacheWritePerMillion: number;
  cacheReadPerMillion: number;
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  'claude-opus-4-7': {
    inputPerMillion: 5.0,
    outputPerMillion: 25.0,
    cacheWritePerMillion: 6.25,
    cacheReadPerMillion: 0.5,
  },
  'claude-sonnet-4-6': {
    inputPerMillion: 3.0,
    outputPerMillion: 15.0,
    cacheWritePerMillion: 3.75,
    cacheReadPerMillion: 0.3,
  },
  'claude-haiku-4-5-20251001': {
    inputPerMillion: 1.0,
    outputPerMillion: 5.0,
    cacheWritePerMillion: 1.25,
    cacheReadPerMillion: 0.1,
  },
};

// Fallback pricing (use sonnet rates if model unknown)
const DEFAULT_PRICING = MODEL_PRICING['claude-sonnet-4-6'];

export interface CostBreakdown {
  inputCost: number;
  outputCost: number;
  cacheWriteCost: number;
  cacheReadCost: number;
  totalCost: number;
  model: string;
}

/**
 * Calculate cost from token usage and model.
 */
export function calculateCost(usage: TokenUsageSummary, model: ModelId | string): CostBreakdown {
  const pricing = MODEL_PRICING[model] ?? DEFAULT_PRICING;

  const inputCost = (usage.inputTokens / 1_000_000) * pricing.inputPerMillion;
  const outputCost = (usage.outputTokens / 1_000_000) * pricing.outputPerMillion;
  const cacheWriteCost =
    (usage.cacheCreationInputTokens / 1_000_000) * pricing.cacheWritePerMillion;
  const cacheReadCost = (usage.cacheReadInputTokens / 1_000_000) * pricing.cacheReadPerMillion;

  return {
    inputCost,
    outputCost,
    cacheWriteCost,
    cacheReadCost,
    totalCost: inputCost + outputCost + cacheWriteCost + cacheReadCost,
    model,
  };
}

/**
 * Format a cost value as USD.
 */
export function formatUsd(amount: number): string {
  if (amount < 0.01) {
    return `$${amount.toFixed(4)}`;
  }
  return `$${amount.toFixed(2)}`;
}

/**
 * Format a full cost breakdown as a display string.
 */
export function formatCostBreakdown(breakdown: CostBreakdown): string {
  const lines: string[] = [];
  lines.push(`Input:       ${formatUsd(breakdown.inputCost)}`);
  lines.push(`Output:      ${formatUsd(breakdown.outputCost)}`);
  if (breakdown.cacheWriteCost > 0) {
    lines.push(`Cache write: ${formatUsd(breakdown.cacheWriteCost)}`);
  }
  if (breakdown.cacheReadCost > 0) {
    lines.push(`Cache read:  ${formatUsd(breakdown.cacheReadCost)}`);
  }
  lines.push(`Total:       ${formatUsd(breakdown.totalCost)}`);
  return lines.join('\n');
}
