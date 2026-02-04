import { describe, it, expect } from 'vitest';
import { sanitizeSessionId } from '../session.js';

describe('sanitizeSessionId', () => {
  it('returns default for empty input', () => {
    expect(sanitizeSessionId('')).toBe('default');
  });

  it('removes path separators and traversal sequences', () => {
    const sanitized = sanitizeSessionId('../ops/../prod');
    expect(sanitized).not.toContain('..');
    expect(sanitized).not.toContain('/');
    expect(sanitized).not.toContain('\\');
    expect(sanitized.startsWith('.')).toBe(false);
    expect(sanitized.length).toBeGreaterThan(0);
  });

  it('preserves safe characters', () => {
    expect(sanitizeSessionId('ops-1.2_default')).toBe('ops-1.2_default');
  });
});
