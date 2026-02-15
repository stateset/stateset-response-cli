import { describe, it, expect } from 'vitest';
import { REDACT_KEY_RE, sanitizeAuditValue, sanitizeToolArgs } from '../cli/audit.js';

describe('REDACT_KEY_RE', () => {
  it('matches sensitive key names', () => {
    expect(REDACT_KEY_RE.test('secret')).toBe(true);
    expect(REDACT_KEY_RE.test('api_key')).toBe(true);
    expect(REDACT_KEY_RE.test('apiKey')).toBe(true);
    expect(REDACT_KEY_RE.test('authorization')).toBe(true);
    expect(REDACT_KEY_RE.test('password')).toBe(true);
    expect(REDACT_KEY_RE.test('customer_email')).toBe(true);
    expect(REDACT_KEY_RE.test('token')).toBe(true);
  });

  it('does not match non-sensitive key names', () => {
    expect(REDACT_KEY_RE.test('name')).toBe(false);
    expect(REDACT_KEY_RE.test('id')).toBe(false);
    expect(REDACT_KEY_RE.test('status')).toBe(false);
    expect(REDACT_KEY_RE.test('created_at')).toBe(false);
  });
});

describe('sanitizeAuditValue', () => {
  it('redacts sensitive keys in objects', () => {
    const result = sanitizeAuditValue({ api_key: 'sk-123', name: 'test' });
    expect(result).toEqual({ api_key: '[redacted]', name: 'test' });
  });

  it('truncates long strings', () => {
    const longStr = 'x'.repeat(300);
    const result = sanitizeAuditValue(longStr) as string;
    expect(result.length).toBeLessThanOrEqual(200);
    expect(result).toContain('...');
  });

  it('preserves short strings', () => {
    expect(sanitizeAuditValue('hello')).toBe('hello');
  });

  it('trims whitespace from strings', () => {
    expect(sanitizeAuditValue('  hello  ')).toBe('hello');
  });

  it('handles arrays', () => {
    const result = sanitizeAuditValue([{ token: 'abc' }, 'test']);
    expect(result).toEqual([{ token: '[redacted]' }, 'test']);
  });

  it('handles nested objects', () => {
    const result = sanitizeAuditValue({
      data: { secret: 'hidden', value: 'visible' },
    });
    expect(result).toEqual({
      data: { secret: '[redacted]', value: 'visible' },
    });
  });

  it('truncates deeply nested objects', () => {
    let obj: unknown = 'leaf';
    for (let i = 0; i < 7; i++) {
      obj = { nested: obj };
    }
    const result = sanitizeAuditValue(obj) as any;
    // At depth 6, it should be truncated
    expect(JSON.stringify(result)).toContain('[truncated]');
  });

  it('passes through primitives', () => {
    expect(sanitizeAuditValue(42)).toBe(42);
    expect(sanitizeAuditValue(true)).toBe(true);
    expect(sanitizeAuditValue(null)).toBe(null);
    expect(sanitizeAuditValue(undefined)).toBe(undefined);
  });
});

describe('sanitizeToolArgs', () => {
  it('sanitizes top-level args', () => {
    const result = sanitizeToolArgs({ password: 'secret', query: 'SELECT *' });
    expect(result.password).toBe('[redacted]');
    expect(result.query).toBe('SELECT *');
  });
});

describe('makeHookPermissionKey', () => {
  it('is tested via import from permissions', async () => {
    const { makeHookPermissionKey } = await import('../cli/permissions.js');
    expect(makeHookPermissionKey('myHook', 'myTool')).toBe('myHook::myTool');
  });
});
