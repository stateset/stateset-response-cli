import { describe, it, expect, vi } from 'vitest';

vi.mock('../integrations/redact.js', () => ({
  redactPii: vi.fn((v: unknown) => ({ ...(v as Record<string, unknown>), redacted: true })),
}));

import {
  writeNotAllowed,
  guardWrite,
  wrapToolResult,
  buildQuery,
  createRequestRunner,
} from '../mcp-server/tools/helpers.js';
import { redactPii } from '../integrations/redact.js';

const redactPiiMock = vi.mocked(redactPii);

describe('writeNotAllowed', () => {
  it('returns MCP structure with error and hint', () => {
    const result = writeNotAllowed();
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toMatch(/Write operation not allowed/);
    expect(parsed.hint).toMatch(/list\/get operations/i);
  });
});

describe('guardWrite', () => {
  it('returns null when allowApply is true', () => {
    expect(guardWrite({ allowApply: true })).toBeNull();
  });

  it('returns error structure when allowApply is false', () => {
    const result = guardWrite({ allowApply: false });
    expect(result).not.toBeNull();
    expect(result?.isError).toBe(true);
    const parsed = JSON.parse(result!.content[0].text);
    expect(parsed.error).toMatch(/Write operation not allowed/);
  });
});

describe('wrapToolResult', () => {
  it('wraps payload into MCP content structure', () => {
    const result = wrapToolResult({ ok: true });
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    expect(JSON.parse(result.content[0].text)).toEqual({ ok: true });
  });

  it('truncates large payloads when maxChars is set', () => {
    const large = { data: 'x'.repeat(5000) };
    const result = wrapToolResult(large, 2000);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.truncated).toBe(true);
    expect(parsed.preview.length).toBeLessThanOrEqual(2000);
  });
});

describe('buildQuery', () => {
  it('filters out undefined values', () => {
    expect(buildQuery({ a: 'yes', b: undefined, c: 42 })).toEqual({ a: 'yes', c: 42 });
  });

  it('returns undefined when all values are undefined', () => {
    expect(buildQuery({ a: undefined, b: undefined })).toBeUndefined();
  });
});

describe('createRequestRunner', () => {
  const makeRequest = vi.fn().mockResolvedValue({ status: 200, data: { email: 'a@b.com' } });

  it('applies PII redaction when redact is true', async () => {
    const run = createRequestRunner(makeRequest);
    const result = await run({}, { allowApply: true, redact: true }, { method: 'GET', path: '/' });
    expect(redactPiiMock).toHaveBeenCalledWith({ email: 'a@b.com' });
    expect(result.status).toBe(200);
    expect(result.data).toHaveProperty('redacted', true);
  });

  it('passes data through unchanged when redact is false', async () => {
    const run = createRequestRunner(makeRequest);
    const result = await run({}, { allowApply: true, redact: false }, { method: 'GET', path: '/' });
    expect(result.data).toEqual({ email: 'a@b.com' });
  });
});
