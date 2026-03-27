import { describe, it, expect } from 'vitest';
import { calculateCost, formatUsd, formatCostBreakdown } from '../lib/pricing.js';
import type { TokenUsageSummary } from '../lib/metrics.js';

function makeUsage(overrides: Partial<TokenUsageSummary> = {}): TokenUsageSummary {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    ...overrides,
  };
}

describe('calculateCost', () => {
  it('returns zero cost for zero tokens', () => {
    const result = calculateCost(makeUsage(), 'claude-sonnet-4-6');
    expect(result.totalCost).toBe(0);
    expect(result.inputCost).toBe(0);
    expect(result.outputCost).toBe(0);
  });

  it('calculates sonnet pricing correctly', () => {
    const result = calculateCost(
      makeUsage({ inputTokens: 1_000_000, outputTokens: 1_000_000 }),
      'claude-sonnet-4-6',
    );
    // Sonnet: $3/M input, $15/M output
    expect(result.inputCost).toBeCloseTo(3.0);
    expect(result.outputCost).toBeCloseTo(15.0);
    expect(result.totalCost).toBeCloseTo(18.0);
  });

  it('calculates opus pricing correctly', () => {
    const result = calculateCost(
      makeUsage({ inputTokens: 1_000_000, outputTokens: 1_000_000 }),
      'claude-opus-4-6-20250514',
    );
    // Opus: $15/M input, $75/M output
    expect(result.inputCost).toBeCloseTo(15.0);
    expect(result.outputCost).toBeCloseTo(75.0);
    expect(result.totalCost).toBeCloseTo(90.0);
  });

  it('calculates haiku pricing correctly', () => {
    const result = calculateCost(
      makeUsage({ inputTokens: 1_000_000, outputTokens: 1_000_000 }),
      'claude-haiku-4-5-20251001',
    );
    // Haiku: $0.80/M input, $4/M output
    expect(result.inputCost).toBeCloseTo(0.8);
    expect(result.outputCost).toBeCloseTo(4.0);
    expect(result.totalCost).toBeCloseTo(4.8);
  });

  it('includes cache costs', () => {
    const result = calculateCost(
      makeUsage({
        inputTokens: 100_000,
        outputTokens: 50_000,
        cacheCreationInputTokens: 200_000,
        cacheReadInputTokens: 500_000,
      }),
      'claude-sonnet-4-6',
    );
    // Cache write: $3.75/M, Cache read: $0.30/M
    expect(result.cacheWriteCost).toBeCloseTo(0.75);
    expect(result.cacheReadCost).toBeCloseTo(0.15);
    expect(result.totalCost).toBeGreaterThan(0);
  });

  it('falls back to sonnet pricing for unknown model', () => {
    const result = calculateCost(
      makeUsage({ inputTokens: 1_000_000 }),
      'claude-unknown-model' as any,
    );
    // Should use sonnet fallback: $3/M input
    expect(result.inputCost).toBeCloseTo(3.0);
  });

  it('includes model in breakdown', () => {
    const result = calculateCost(makeUsage(), 'claude-sonnet-4-6');
    expect(result.model).toBe('claude-sonnet-4-6');
  });
});

describe('formatUsd', () => {
  it('formats small amounts with 4 decimals', () => {
    expect(formatUsd(0.0012)).toBe('$0.0012');
  });

  it('formats larger amounts with 2 decimals', () => {
    expect(formatUsd(3.5)).toBe('$3.50');
  });

  it('formats zero', () => {
    expect(formatUsd(0)).toBe('$0.0000');
  });

  it('formats exact cents', () => {
    expect(formatUsd(0.01)).toBe('$0.01');
  });
});

describe('formatCostBreakdown', () => {
  it('includes all cost lines', () => {
    const breakdown = calculateCost(
      makeUsage({
        inputTokens: 100_000,
        outputTokens: 50_000,
        cacheCreationInputTokens: 10_000,
        cacheReadInputTokens: 20_000,
      }),
      'claude-sonnet-4-6',
    );
    const text = formatCostBreakdown(breakdown);
    expect(text).toContain('Input:');
    expect(text).toContain('Output:');
    expect(text).toContain('Total:');
  });

  it('omits cache lines when zero', () => {
    const breakdown = calculateCost(makeUsage({ inputTokens: 100 }), 'claude-sonnet-4-6');
    const text = formatCostBreakdown(breakdown);
    expect(text).not.toContain('Cache write:');
    expect(text).not.toContain('Cache read:');
  });
});
