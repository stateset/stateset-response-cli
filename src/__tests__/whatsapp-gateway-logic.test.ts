import { describe, it, expect } from 'vitest';
import { cleanForWhatsApp, chunkMessage } from '../whatsapp/gateway.js';

describe('cleanForWhatsApp', () => {
  it('converts markdown headers to bold', () => {
    expect(cleanForWhatsApp('# Title')).toBe('*Title*');
    expect(cleanForWhatsApp('## Subtitle')).toBe('*Subtitle*');
  });

  it('converts **bold** to *bold*', () => {
    expect(cleanForWhatsApp('This is **bold** text')).toBe('This is *bold* text');
  });

  it('converts __bold__ to *bold*', () => {
    expect(cleanForWhatsApp('This is __underline bold__')).toBe('This is *underline bold*');
  });

  it('converts markdown links to plain text with URL', () => {
    expect(cleanForWhatsApp('[Click here](https://example.com)')).toBe(
      'Click here (https://example.com)',
    );
  });

  it('strips triple backtick language identifiers', () => {
    const input = '```javascript\nconsole.log("hi");\n```';
    const result = cleanForWhatsApp(input);
    expect(result).not.toContain('javascript');
    expect(result).toContain('```\nconsole.log("hi");\n```');
  });

  it('removes inline backtick code markers', () => {
    const result = cleanForWhatsApp('Use the `command` here');
    expect(result).toBe('Use the command here');
  });

  it('handles triple backtick blocks correctly', () => {
    const input = '```\ncode block content\n```';
    const result = cleanForWhatsApp(input);
    expect(result).toContain('```');
    expect(result).toContain('code block content');
  });

  it('passes through plain text unchanged', () => {
    expect(cleanForWhatsApp('Just plain text')).toBe('Just plain text');
  });

  it('handles nested lists', () => {
    const input = '- Item 1\n- Item 2\n  - Nested item';
    const result = cleanForWhatsApp(input);
    expect(result).toContain('- Item 1');
    expect(result).toContain('- Item 2');
  });

  it('removes horizontal rules', () => {
    const input = 'Above\n---\nBelow';
    const result = cleanForWhatsApp(input);
    expect(result).not.toContain('---');
  });

  it('collapses excessive blank lines', () => {
    const input = 'Line 1\n\n\n\n\nLine 2';
    const result = cleanForWhatsApp(input);
    expect(result).toBe('Line 1\n\nLine 2');
  });

  it('handles empty string', () => {
    expect(cleanForWhatsApp('')).toBe('');
  });

  it('preserves strikethrough formatting', () => {
    expect(cleanForWhatsApp('~strikethrough~')).toBe('~strikethrough~');
  });
});

describe('chunkMessage (WhatsApp)', () => {
  it('returns single chunk for short messages', () => {
    expect(chunkMessage('Hello')).toEqual(['Hello']);
  });

  it('defaults to 4000 character limit', () => {
    const text = 'Z'.repeat(8001);
    const chunks = chunkMessage(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(4000);
    }
  });

  it('splits at paragraph boundaries', () => {
    const para1 = 'A'.repeat(2000);
    const para2 = 'B'.repeat(2000);
    const text = `${para1}\n\n${para2}`;
    const chunks = chunkMessage(text, 3000);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });

  it('performs hard split when no natural boundaries exist', () => {
    const text = 'X'.repeat(10000);
    const chunks = chunkMessage(text, 4000);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(4000);
    }
  });

  it('handles single-character chunks', () => {
    const text = 'ABCDE';
    const chunks = chunkMessage(text, 2);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(2);
    }
  });

  it('handles text with only newlines', () => {
    const text = '\n'.repeat(50);
    const chunks = chunkMessage(text, 20);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });
});
