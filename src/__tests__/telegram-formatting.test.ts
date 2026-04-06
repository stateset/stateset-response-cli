import { describe, expect, it } from 'vitest';
import { cleanForTelegram, chunkMessage } from '../telegram/gateway.js';

describe('cleanForTelegram', () => {
  it('normalizes CRLF line endings', () => {
    expect(cleanForTelegram('a\r\n\r\nb')).toBe('a\n\nb');
  });

  it('collapses excessive blank lines', () => {
    expect(cleanForTelegram('Line 1\n\n\n\nLine 2')).toBe('Line 1\n\nLine 2');
  });

  it('trims surrounding whitespace', () => {
    expect(cleanForTelegram('  hello  ')).toBe('hello');
  });
});

describe('chunkMessage (Telegram)', () => {
  it('returns single chunk for short messages', () => {
    expect(chunkMessage('Hello')).toEqual(['Hello']);
  });

  it('splits at paragraph boundaries when possible', () => {
    const para1 = 'A'.repeat(1800);
    const para2 = 'B'.repeat(1800);
    const chunks = chunkMessage(para1 + '\n\n' + para2, 2500);
    expect(chunks.length).toBe(2);
    expect(chunks[0]).toBe(para1);
    expect(chunks[1]).toBe(para2);
  });

  it('falls back to line and word boundaries', () => {
    const chunks = chunkMessage('word '.repeat(2000), 120);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(120);
    }
  });

  it('performs a hard split when no natural boundary exists', () => {
    const chunks = chunkMessage('X'.repeat(9000), 4096);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(4096);
    }
  });
});
