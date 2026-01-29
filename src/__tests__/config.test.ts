import { describe, it, expect } from 'vitest';
import { resolveModel, DEFAULT_MODEL, MODEL_ALIASES } from '../config.js';

describe('resolveModel', () => {
  it('resolves alias "sonnet"', () => {
    expect(resolveModel('sonnet')).toBe('claude-sonnet-4-20250514');
  });

  it('resolves alias "haiku"', () => {
    expect(resolveModel('haiku')).toBe('claude-haiku-35-20241022');
  });

  it('resolves alias "opus"', () => {
    expect(resolveModel('opus')).toBe('claude-opus-4-20250514');
  });

  it('is case-insensitive', () => {
    expect(resolveModel('SONNET')).toBe('claude-sonnet-4-20250514');
    expect(resolveModel('Haiku')).toBe('claude-haiku-35-20241022');
  });

  it('accepts full model ID', () => {
    expect(resolveModel('claude-sonnet-4-20250514')).toBe('claude-sonnet-4-20250514');
  });

  it('returns null for unknown model', () => {
    expect(resolveModel('gpt-4')).toBeNull();
    expect(resolveModel('')).toBeNull();
    expect(resolveModel('nonexistent')).toBeNull();
  });

  it('trims whitespace', () => {
    expect(resolveModel('  sonnet  ')).toBe('claude-sonnet-4-20250514');
  });
});

describe('constants', () => {
  it('DEFAULT_MODEL is a valid model', () => {
    expect(resolveModel(DEFAULT_MODEL)).toBe(DEFAULT_MODEL);
  });

  it('MODEL_ALIASES has all three aliases', () => {
    expect(Object.keys(MODEL_ALIASES)).toEqual(['sonnet', 'haiku', 'opus']);
  });
});
