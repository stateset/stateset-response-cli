import { describe, it, expect } from 'vitest';
import { stringifyToolResult } from '../mcp-server/tools/output.js';

describe('stringifyToolResult', () => {
  it('returns full JSON and truncated:false for small payloads', () => {
    const result = stringifyToolResult({ a: 1 });
    expect(result.truncated).toBe(false);
    expect(JSON.parse(result.text)).toEqual({ a: 1 });
  });

  it('truncates large payloads and sets truncated:true', () => {
    const big = { data: 'x'.repeat(15000) };
    const result = stringifyToolResult(big);
    expect(result.truncated).toBe(true);
    const parsed = JSON.parse(result.text);
    expect(parsed.truncated).toBe(true);
    expect(parsed.preview.length).toBeLessThanOrEqual(12000);
  });

  it('uses 12000 as the default maxChars', () => {
    const big = { data: 'x'.repeat(13000) };
    const result = stringifyToolResult(big);
    expect(result.truncated).toBe(true);
    expect(JSON.parse(result.text).max_chars).toBe(12000);
  });

  it('clamps maxChars to a minimum of 2000', () => {
    const big = { data: 'x'.repeat(3000) };
    const result = stringifyToolResult(big, 100);
    expect(result.truncated).toBe(true);
    expect(JSON.parse(result.text).max_chars).toBe(2000);
  });

  it('preserves the success field from the original payload when truncating', () => {
    const big = { success: false, data: 'x'.repeat(15000) };
    const result = stringifyToolResult(big);
    expect(JSON.parse(result.text).success).toBe(false);
  });

  it('defaults success to true when truncating a payload without one', () => {
    const big = { data: 'x'.repeat(15000) };
    const result = stringifyToolResult(big);
    expect(JSON.parse(result.text).success).toBe(true);
  });

  it('falls back to 12000 when maxChars is non-numeric', () => {
    const big = { data: 'x'.repeat(13000) };
    const result = stringifyToolResult(big, 'abc' as unknown as number);
    expect(result.truncated).toBe(true);
    expect(JSON.parse(result.text).max_chars).toBe(12000);
  });
});
