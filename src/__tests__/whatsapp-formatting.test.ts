import { describe, it, expect } from 'vitest';
import { cleanForWhatsApp, chunkMessage } from '../whatsapp/gateway.js';

describe('cleanForWhatsApp', () => {
  it('converts markdown headers to WhatsApp bold', () => {
    expect(cleanForWhatsApp('# Title')).toBe('*Title*');
    expect(cleanForWhatsApp('## Subtitle')).toBe('*Subtitle*');
    expect(cleanForWhatsApp('### Heading 3')).toBe('*Heading 3*');
  });

  it('converts **bold** to *bold*', () => {
    expect(cleanForWhatsApp('This is **bold** text')).toBe('This is *bold* text');
  });

  it('converts __bold__ to *bold*', () => {
    expect(cleanForWhatsApp('This is __bold__ text')).toBe('This is *bold* text');
  });

  it('converts markdown links to plain text', () => {
    expect(cleanForWhatsApp('[click here](https://example.com)')).toBe(
      'click here (https://example.com)',
    );
  });

  it('strips language from code blocks', () => {
    expect(cleanForWhatsApp('```javascript\ncode\n```')).toBe('```\ncode\n```');
  });

  it('removes inline backticks', () => {
    expect(cleanForWhatsApp('Use `npm install`')).toBe('Use npm install');
  });

  it('normalizes bullet lists', () => {
    expect(cleanForWhatsApp('* item 1\n* item 2')).toBe('- item 1\n- item 2');
  });

  it('removes horizontal rules', () => {
    expect(cleanForWhatsApp('above\n---\nbelow')).toBe('above\n\nbelow');
  });

  it('collapses excessive blank lines', () => {
    expect(cleanForWhatsApp('a\n\n\n\n\nb')).toBe('a\n\nb');
  });

  it('trims result', () => {
    expect(cleanForWhatsApp('  hello  ')).toBe('hello');
  });
});

describe('chunkMessage (WhatsApp)', () => {
  it('returns single chunk for short messages', () => {
    const chunks = chunkMessage('Hello world');
    expect(chunks).toEqual(['Hello world']);
  });

  it('splits long messages at paragraph boundaries', () => {
    const para1 = 'A'.repeat(2000);
    const para2 = 'B'.repeat(1000);
    const text = `${para1}\n\n${para2}`;
    const chunks = chunkMessage(text, 3000);
    expect(chunks.length).toBe(2);
    expect(chunks[0]).toBe(para1);
    expect(chunks[1]).toBe(para2);
  });

  it('splits at line boundaries when no paragraph break', () => {
    const line1 = 'A'.repeat(2500);
    const line2 = 'B'.repeat(500);
    const text = `${line1}\n${line2}`;
    const chunks = chunkMessage(text, 3000);
    expect(chunks.length).toBe(2);
  });

  it('handles very long single-line text', () => {
    const text = 'A'.repeat(10000);
    const chunks = chunkMessage(text, 4000);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(4000);
    }
  });

  it('uses default max length of 4000', () => {
    const text = 'A'.repeat(5000);
    const chunks = chunkMessage(text);
    expect(chunks.length).toBe(2);
    expect(chunks[0].length).toBe(4000);
  });
});
