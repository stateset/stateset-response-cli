import { describe, expect, it } from 'vitest';
import {
  isOptionToken,
  parseCommaSeparated,
  readOptionValue,
  splitOptionToken,
} from '../cli/arg-utils.js';

describe('parseCommaSeparated', () => {
  it('deduplicates, trims, and filters empty values', () => {
    expect(parseCommaSeparated('a, b,,a,b')).toEqual(['a', 'b']);
  });
});

describe('isOptionToken', () => {
  it('detects option-like strings', () => {
    expect(isOptionToken('--model')).toBe(true);
    expect(isOptionToken('-m')).toBe(true);
    expect(isOptionToken('value')).toBe(false);
    expect(isOptionToken('')).toBe(false);
  });
});

describe('readOptionValue', () => {
  it('returns inline values without advancing beyond current index', () => {
    const args = ['--model=opus', '--other'];
    const result = readOptionValue(args, 0, '--model', 'opus');
    expect(result.value).toBe('opus');
    expect(result.index).toBe(0);
  });

  it('reads the next token and returns its index', () => {
    const args = ['--model', 'opus', '--other'];
    const result = readOptionValue(args, 0, '--model');
    expect(result.value).toBe('opus');
    expect(result.index).toBe(1);
  });

  it('throws for missing value at end', () => {
    const args = ['--model'];
    expect(() => readOptionValue(args, 0, '--model')).toThrow('Missing value for --model.');
  });

  it('throws when missing value starts with hyphen', () => {
    const args = ['--model', '--other'];
    expect(() => readOptionValue(args, 0, '--model')).toThrow('Missing value for --model.');
  });

  it('throws when inline value is empty', () => {
    const args = ['--model='];
    expect(() => readOptionValue(args, 0, '--model', '')).toThrow('Missing value for --model.');
  });
});

describe('splitOptionToken', () => {
  it('splits --flag=value', () => {
    expect(splitOptionToken('--model=opus')).toEqual({ option: '--model', inlineValue: 'opus' });
  });

  it('handles repeated equals signs', () => {
    expect(splitOptionToken('--model=a=b')).toEqual({ option: '--model', inlineValue: 'a=b' });
  });

  it('returns no inline value when no equals exists', () => {
    expect(splitOptionToken('--model')).toEqual({ option: '--model' });
    expect(splitOptionToken('--')).toEqual({ option: '--' });
  });
});
