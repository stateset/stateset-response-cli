import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

vi.mock('../config.js', () => ({
  resolveModel: (input: string) => {
    const map: Record<string, string> = {
      opus: 'claude-opus-4-7',
      sonnet: 'claude-sonnet-4-6',
      haiku: 'claude-haiku-4-5-20251001',
    };
    return map[input.toLowerCase().trim()] ?? null;
  },
}));

vi.mock('../lib/logger.js', () => ({
  logger: { warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import {
  getFallbackChain,
  getNextFallback,
  shouldFallback,
  resolveFallbackModel,
  setFallbackChain,
  resetFallbackChain,
} from '../lib/model-fallback.js';

describe('model-fallback', () => {
  const savedEnv = process.env.STATESET_MODEL_FALLBACK;

  beforeEach(() => {
    resetFallbackChain();
    delete process.env.STATESET_MODEL_FALLBACK;
  });

  afterEach(() => {
    resetFallbackChain();
    if (savedEnv !== undefined) {
      process.env.STATESET_MODEL_FALLBACK = savedEnv;
    } else {
      delete process.env.STATESET_MODEL_FALLBACK;
    }
  });

  describe('getFallbackChain', () => {
    it('returns the default chain (opus → sonnet → haiku)', () => {
      const chain = getFallbackChain();
      expect(chain).toEqual(['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001']);
    });

    it('respects STATESET_MODEL_FALLBACK env var', () => {
      process.env.STATESET_MODEL_FALLBACK = 'sonnet,haiku';
      const chain = getFallbackChain();
      expect(chain).toEqual(['claude-sonnet-4-6', 'claude-haiku-4-5-20251001']);
    });

    it('ignores unrecognized model names in env var', () => {
      process.env.STATESET_MODEL_FALLBACK = 'sonnet,unknown-model,haiku';
      const chain = getFallbackChain();
      expect(chain).toEqual(['claude-sonnet-4-6', 'claude-haiku-4-5-20251001']);
    });

    it('falls back to default chain if env var contains only invalid models', () => {
      process.env.STATESET_MODEL_FALLBACK = 'bogus,invalid';
      const chain = getFallbackChain();
      expect(chain).toEqual(['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001']);
    });
  });

  describe('setFallbackChain / resetFallbackChain', () => {
    it('overrides the fallback chain', () => {
      setFallbackChain(['model-a' as any, 'model-b' as any]);
      expect(getFallbackChain()).toEqual(['model-a', 'model-b']);
    });

    it('makes a defensive copy', () => {
      const arr = ['model-a' as any];
      setFallbackChain(arr);
      arr.push('model-b' as any);
      expect(getFallbackChain()).toEqual(['model-a']);
    });

    it('resetFallbackChain reverts to default', () => {
      setFallbackChain(['custom' as any]);
      resetFallbackChain();
      const chain = getFallbackChain();
      expect(chain).toEqual(['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001']);
    });
  });

  describe('getNextFallback', () => {
    it('returns the next model in the chain', () => {
      const next = getNextFallback('claude-opus-4-7' as any);
      expect(next).toBe('claude-sonnet-4-6');
    });

    it('returns the third model when given the second', () => {
      const next = getNextFallback('claude-sonnet-4-6' as any);
      expect(next).toBe('claude-haiku-4-5-20251001');
    });

    it('returns null at the end of the chain', () => {
      const next = getNextFallback('claude-haiku-4-5-20251001' as any);
      expect(next).toBeNull();
    });

    it('returns the first different model if current is not in chain', () => {
      const next = getNextFallback('some-unknown-model' as any);
      expect(next).toBe('claude-opus-4-7');
    });

    it('returns null if chain has only the current model', () => {
      setFallbackChain(['only-model' as any]);
      const next = getNextFallback('only-model' as any);
      expect(next).toBeNull();
    });
  });

  describe('shouldFallback', () => {
    it('returns true for 429 rate limit (status)', () => {
      const err = Object.assign(new Error('rate limited'), { status: 429 });
      expect(shouldFallback(err)).toBe(true);
    });

    it('returns true for 429 rate limit (statusCode)', () => {
      const err = Object.assign(new Error('rate limited'), { statusCode: 429 });
      expect(shouldFallback(err)).toBe(true);
    });

    it('returns true for 503 service unavailable', () => {
      const err = Object.assign(new Error('unavailable'), { status: 503 });
      expect(shouldFallback(err)).toBe(true);
    });

    it('returns true for 529 overloaded (Anthropic)', () => {
      const err = Object.assign(new Error('overloaded'), { status: 529 });
      expect(shouldFallback(err)).toBe(true);
    });

    it('returns true for error message containing "overloaded"', () => {
      const err = new Error('The model is currently overloaded');
      expect(shouldFallback(err)).toBe(true);
    });

    it('returns true for error message containing "capacity"', () => {
      const err = new Error('Server at capacity');
      expect(shouldFallback(err)).toBe(true);
    });

    it('returns false for 400 bad request', () => {
      const err = Object.assign(new Error('bad request'), { status: 400 });
      expect(shouldFallback(err)).toBe(false);
    });

    it('returns false for 404 not found', () => {
      const err = Object.assign(new Error('not found'), { status: 404 });
      expect(shouldFallback(err)).toBe(false);
    });

    it('returns false for 401 unauthorized', () => {
      const err = Object.assign(new Error('unauthorized'), { status: 401 });
      expect(shouldFallback(err)).toBe(false);
    });

    it('returns true for Anthropic overloaded_error type', () => {
      const err = Object.assign(new Error('overloaded'), {
        error: { type: 'overloaded_error' },
      });
      expect(shouldFallback(err)).toBe(true);
    });

    it('returns true for overloaded_error on error.type directly', () => {
      const err = Object.assign(new Error('overloaded'), {
        type: 'overloaded_error',
      });
      expect(shouldFallback(err)).toBe(true);
    });

    it('returns false for non-Error values', () => {
      expect(shouldFallback('string error')).toBe(false);
      expect(shouldFallback(null)).toBe(false);
      expect(shouldFallback(undefined)).toBe(false);
      expect(shouldFallback(42)).toBe(false);
    });

    it('returns false for generic errors without status codes', () => {
      const err = new Error('something went wrong');
      expect(shouldFallback(err)).toBe(false);
    });
  });

  describe('resolveFallbackModel', () => {
    it('returns fallback model on availability error (429)', () => {
      const err = Object.assign(new Error('rate limited'), { status: 429 });
      const result = resolveFallbackModel('claude-opus-4-7' as any, err);
      expect(result).toBe('claude-sonnet-4-6');
    });

    it('returns fallback model on 503 error', () => {
      const err = Object.assign(new Error('unavailable'), { status: 503 });
      const result = resolveFallbackModel('claude-sonnet-4-6' as any, err);
      expect(result).toBe('claude-haiku-4-5-20251001');
    });

    it('returns null on non-availability error', () => {
      const err = Object.assign(new Error('bad request'), { status: 400 });
      const result = resolveFallbackModel('claude-opus-4-7' as any, err);
      expect(result).toBeNull();
    });

    it('returns null when at end of chain with availability error', () => {
      const err = Object.assign(new Error('rate limited'), { status: 429 });
      const result = resolveFallbackModel('claude-haiku-4-5-20251001' as any, err);
      expect(result).toBeNull();
    });

    it('returns null for non-Error values', () => {
      const result = resolveFallbackModel('claude-opus-4-7' as any, 'string');
      expect(result).toBeNull();
    });
  });
});
