import { describe, it, expect } from 'vitest';
import {
  parseToggleValue,
  extractInlineFlags,
  normalizeTag,
  formatTimestamp,
  readBooleanEnv,
  hasCommand,
} from '../cli/utils.js';

describe('parseToggleValue', () => {
  it('returns true for positive values', () => {
    expect(parseToggleValue('on')).toBe(true);
    expect(parseToggleValue('true')).toBe(true);
    expect(parseToggleValue('1')).toBe(true);
    expect(parseToggleValue('yes')).toBe(true);
    expect(parseToggleValue('y')).toBe(true);
    expect(parseToggleValue('ON')).toBe(true);
    expect(parseToggleValue('True')).toBe(true);
  });

  it('returns false for negative values', () => {
    expect(parseToggleValue('off')).toBe(false);
    expect(parseToggleValue('false')).toBe(false);
    expect(parseToggleValue('0')).toBe(false);
    expect(parseToggleValue('no')).toBe(false);
    expect(parseToggleValue('n')).toBe(false);
  });

  it('returns undefined for null/empty/unknown', () => {
    expect(parseToggleValue(null)).toBeUndefined();
    expect(parseToggleValue(undefined)).toBeUndefined();
    expect(parseToggleValue('')).toBeUndefined();
    expect(parseToggleValue('maybe')).toBeUndefined();
  });

  it('trims whitespace', () => {
    expect(parseToggleValue('  on  ')).toBe(true);
    expect(parseToggleValue('  off  ')).toBe(false);
  });
});

describe('extractInlineFlags', () => {
  it('extracts --apply flag', () => {
    const result = extractInlineFlags('hello world --apply');
    expect(result.text).toBe('hello world');
    expect(result.flags.apply).toBe(true);
    expect(result.flags.redact).toBeUndefined();
  });

  it('extracts --redact flag', () => {
    const result = extractInlineFlags('hello world --redact');
    expect(result.text).toBe('hello world');
    expect(result.flags.redact).toBe(true);
  });

  it('extracts both flags', () => {
    const result = extractInlineFlags('hello --apply --redact');
    expect(result.text).toBe('hello');
    expect(result.flags.apply).toBe(true);
    expect(result.flags.redact).toBe(true);
  });

  it('returns original text when no flags', () => {
    const result = extractInlineFlags('hello world');
    expect(result.text).toBe('hello world');
    expect(result.flags).toEqual({});
  });

  it('handles empty input', () => {
    const result = extractInlineFlags('');
    expect(result.text).toBe('');
    expect(result.flags).toEqual({});
  });
});

describe('normalizeTag', () => {
  it('lowercases and trims', () => {
    expect(normalizeTag('  MyTag  ')).toBe('mytag');
  });

  it('returns null for empty string', () => {
    expect(normalizeTag('')).toBeNull();
    expect(normalizeTag('   ')).toBeNull();
  });
});

describe('formatTimestamp', () => {
  it('returns a formatted date string for valid ms', () => {
    const result = formatTimestamp(1700000000000);
    expect(typeof result).toBe('string');
    expect(result).not.toBe('unknown');
  });

  it('returns unknown for zero', () => {
    expect(formatTimestamp(0)).toBe('unknown');
  });

  it('returns unknown for negative', () => {
    expect(formatTimestamp(-1)).toBe('unknown');
  });

  it('returns unknown for NaN', () => {
    expect(formatTimestamp(NaN)).toBe('unknown');
  });

  it('returns unknown for Infinity', () => {
    expect(formatTimestamp(Infinity)).toBe('unknown');
  });
});

describe('readBooleanEnv', () => {
  it('returns true when env var is set to true', () => {
    process.env.TEST_BOOL_VAR = 'true';
    expect(readBooleanEnv('TEST_BOOL_VAR')).toBe(true);
    delete process.env.TEST_BOOL_VAR;
  });

  it('returns false when env var is not set', () => {
    delete process.env.TEST_BOOL_VAR_UNSET;
    expect(readBooleanEnv('TEST_BOOL_VAR_UNSET')).toBe(false);
  });

  it('returns false for unknown values', () => {
    process.env.TEST_BOOL_VAR = 'maybe';
    expect(readBooleanEnv('TEST_BOOL_VAR')).toBe(false);
    delete process.env.TEST_BOOL_VAR;
  });
});

describe('hasCommand', () => {
  it('matches exact command', () => {
    expect(hasCommand('/help', '/help')).toBe(true);
    expect(hasCommand('/sessions', '/sessions')).toBe(true);
  });

  it('matches command with spaces or tabs', () => {
    expect(hasCommand('/help me', '/help')).toBe(true);
    expect(hasCommand('/help\tme', '/help')).toBe(true);
  });

  it('does not match command-like prefixes', () => {
    expect(hasCommand('/helpme', '/help')).toBe(false);
    expect(hasCommand('/help-else', '/help')).toBe(false);
    expect(hasCommand('/sessionsx', '/sessions')).toBe(false);
  });

  it('ignores collisions with command extensions', () => {
    expect(hasCommand('/skill-clear', '/skill')).toBe(false);
    expect(hasCommand('/prompt-validate', '/prompt')).toBe(false);
  });
});
