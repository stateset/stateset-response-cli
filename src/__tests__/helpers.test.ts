import { describe, it, expect } from 'vitest';
import {
  writeNotAllowed,
  guardWrite,
  wrapToolResult,
  buildQuery,
  MaxCharsSchema,
} from '../mcp-server/tools/helpers.js';

describe('writeNotAllowed', () => {
  it('returns a content array with error JSON', () => {
    const result = writeNotAllowed();
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toContain('Write operation not allowed');
    expect(parsed.hint).toBeDefined();
  });
});

describe('guardWrite', () => {
  it('returns null when allowApply is true', () => {
    expect(guardWrite({ allowApply: true })).toBeNull();
  });

  it('returns writeNotAllowed result when allowApply is false', () => {
    const result = guardWrite({ allowApply: false });
    expect(result).not.toBeNull();
    const parsed = JSON.parse(result!.content[0].text);
    expect(parsed.error).toContain('Write operation not allowed');
  });
});

describe('wrapToolResult', () => {
  it('wraps a simple payload into content array', () => {
    const result = wrapToolResult({ success: true, data: 'hello' });
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toBe('hello');
  });

  it('respects maxChars parameter', () => {
    const largeData = 'x'.repeat(5000);
    const result = wrapToolResult({ data: largeData }, 3000);
    expect(result.content[0].text.length).toBeLessThanOrEqual(4000);
  });

  it('returns full payload when under max chars', () => {
    const result = wrapToolResult({ a: 1 }, 20000);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.a).toBe(1);
  });
});

describe('buildQuery', () => {
  it('filters out undefined values', () => {
    const result = buildQuery({ a: 'hello', b: undefined, c: 42 });
    expect(result).toEqual({ a: 'hello', c: 42 });
  });

  it('returns undefined when all values are undefined', () => {
    const result = buildQuery({ a: undefined, b: undefined });
    expect(result).toBeUndefined();
  });

  it('returns undefined for empty input', () => {
    const result = buildQuery({});
    expect(result).toBeUndefined();
  });

  it('includes boolean values', () => {
    const result = buildQuery({ active: true, deleted: false });
    expect(result).toEqual({ active: true, deleted: false });
  });
});

describe('MaxCharsSchema', () => {
  it('accepts valid values', () => {
    expect(MaxCharsSchema.parse(5000)).toBe(5000);
    expect(MaxCharsSchema.parse(2000)).toBe(2000);
    expect(MaxCharsSchema.parse(20000)).toBe(20000);
  });

  it('rejects values below minimum', () => {
    expect(() => MaxCharsSchema.parse(1999)).toThrow();
  });

  it('rejects values above maximum', () => {
    expect(() => MaxCharsSchema.parse(20001)).toThrow();
  });

  it('accepts undefined (optional)', () => {
    expect(MaxCharsSchema.parse(undefined)).toBeUndefined();
  });
});
