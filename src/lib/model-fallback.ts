/**
 * Model fallback strategy for graceful degradation.
 *
 * When the primary model is unavailable (429 rate limit, 503 service unavailable),
 * automatically falls back to the next model in the chain:
 *   opus → sonnet → haiku
 *
 * Configurable via STATESET_MODEL_FALLBACK env var (comma-separated model aliases).
 */

import { resolveModel, type ModelId } from '../config.js';
import { logger } from './logger.js';

function getDefaultFallbackChain(): ModelId[] {
  // Lazy to avoid import-time dependency on MODEL_ALIASES
  // (which can be mocked in tests)
  return [
    'claude-opus-4-7' as ModelId,
    'claude-sonnet-4-6' as ModelId,
    'claude-haiku-4-5-20251001' as ModelId,
  ];
}

let customChain: ModelId[] | null = null;

/**
 * Get the configured fallback chain.
 */
export function getFallbackChain(): ModelId[] {
  if (customChain) return customChain;

  const envChain = process.env.STATESET_MODEL_FALLBACK?.trim();
  if (envChain) {
    const resolved = envChain
      .split(',')
      .map((s) => resolveModel(s.trim()))
      .filter((m): m is ModelId => m !== null);
    if (resolved.length > 0) {
      customChain = resolved;
      return customChain;
    }
  }

  return getDefaultFallbackChain();
}

/**
 * Set a custom fallback chain (for testing or runtime config).
 */
export function setFallbackChain(chain: ModelId[]): void {
  customChain = [...chain];
}

/**
 * Reset to the default fallback chain.
 */
export function resetFallbackChain(): void {
  customChain = null;
}

/**
 * Check if an error is a model availability issue that should trigger fallback.
 */
export function shouldFallback(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const err = error as Error & {
    status?: number;
    statusCode?: number;
    code?: string;
    error?: { type?: string };
    type?: string;
  };

  // Rate limited
  if (err.status === 429 || err.statusCode === 429) return true;

  // Service unavailable / overloaded
  if (err.status === 503 || err.statusCode === 503) return true;
  if (err.status === 529 || err.statusCode === 529) return true; // Anthropic overloaded

  // Anthropic SDK error types
  if (err.error?.type === 'overloaded_error' || err.type === 'overloaded_error') return true;

  // Check error message patterns
  const msg = err.message?.toLowerCase() ?? '';
  if (msg.includes('overloaded') || msg.includes('capacity')) return true;

  return false;
}

/**
 * Get the next fallback model after the given model.
 * Returns null if no fallback is available.
 */
export function getNextFallback(currentModel: ModelId): ModelId | null {
  const chain = getFallbackChain();
  const idx = chain.indexOf(currentModel);

  // If current model isn't in the chain, try to find a model after where it would be
  if (idx === -1) {
    // Current model not in chain — return the first available model that isn't the current
    return chain.find((m) => m !== currentModel) ?? null;
  }

  // Return the next model in the chain
  if (idx + 1 < chain.length) {
    return chain[idx + 1];
  }

  return null;
}

/**
 * Resolve a model with fallback support. Attempts the primary model first,
 * then falls through the chain on availability errors.
 *
 * Returns the model that should be used.
 */
export function resolveFallbackModel(primaryModel: ModelId, error: unknown): ModelId | null {
  if (!shouldFallback(error)) return null;

  const fallback = getNextFallback(primaryModel);
  if (fallback) {
    logger.warn(`Model ${primaryModel} unavailable, falling back to ${fallback}`, {
      primaryModel,
      fallbackModel: fallback,
    });
  }
  return fallback;
}
