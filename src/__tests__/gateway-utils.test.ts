import { describe, it, expect } from 'vitest';
import { cleanForSlack, chunkMessage as slackChunkMessage } from '../slack/gateway.js';
import { cleanForWhatsApp, chunkMessage as whatsappChunkMessage } from '../whatsapp/gateway.js';

// =============================================================================
// Slack: cleanForSlack
// =============================================================================

describe('cleanForSlack', () => {
  it('converts markdown headers to bold', () => {
    expect(cleanForSlack('# Title')).toBe('*Title*');
    expect(cleanForSlack('## Subtitle')).toBe('*Subtitle*');
    expect(cleanForSlack('### Heading 3')).toBe('*Heading 3*');
    expect(cleanForSlack('###### Heading 6')).toBe('*Heading 6*');
  });

  it('converts **bold** to *bold*', () => {
    expect(cleanForSlack('This is **bold** text')).toBe('This is *bold* text');
  });

  it('converts __bold__ to *bold*', () => {
    expect(cleanForSlack('This is __bold__ text')).toBe('This is *bold* text');
  });

  it('converts markdown links to Slack format', () => {
    expect(cleanForSlack('[Click here](https://example.com)')).toBe(
      '<https://example.com|Click here>',
    );
  });

  it('strips language identifier from code blocks', () => {
    expect(cleanForSlack('```typescript\nconst x = 1;\n```')).toBe('```\nconst x = 1;\n```');
    expect(cleanForSlack('```json\n{}\n```')).toBe('```\n{}\n```');
  });

  it('normalizes bullet lists', () => {
    expect(cleanForSlack('* Item 1\n- Item 2\n* Item 3')).toBe('- Item 1\n- Item 2\n- Item 3');
  });

  it('removes horizontal rules', () => {
    expect(cleanForSlack('Above\n---\nBelow')).toBe('Above\n\nBelow');
    expect(cleanForSlack('Above\n-----\nBelow')).toBe('Above\n\nBelow');
  });

  it('cleans up excessive blank lines', () => {
    expect(cleanForSlack('A\n\n\n\nB')).toBe('A\n\nB');
    expect(cleanForSlack('A\n\n\n\n\n\nB')).toBe('A\n\nB');
  });

  it('trims whitespace', () => {
    expect(cleanForSlack('  hello  ')).toBe('hello');
  });

  it('handles empty string', () => {
    expect(cleanForSlack('')).toBe('');
  });

  it('handles plain text without markdown', () => {
    expect(cleanForSlack('Just plain text')).toBe('Just plain text');
  });

  it('handles multiple formatting in one text', () => {
    const input =
      '# Welcome\n\nThis is **important** with a [link](https://x.com)\n\n---\n\n* Item';
    const output = cleanForSlack(input);
    expect(output).toContain('*Welcome*');
    expect(output).toContain('*important*');
    expect(output).toContain('<https://x.com|link>');
    expect(output).toContain('- Item');
    expect(output).not.toContain('---');
  });

  it('handles unicode content', () => {
    expect(cleanForSlack('Hello! Prices in \u00a3 and \u20ac')).toBe(
      'Hello! Prices in \u00a3 and \u20ac',
    );
  });

  it('preserves code blocks without language', () => {
    expect(cleanForSlack('```\ncode\n```')).toBe('```\ncode\n```');
  });
});

// =============================================================================
// Slack: chunkMessage
// =============================================================================

describe('slackChunkMessage', () => {
  it('returns single chunk for short text', () => {
    expect(slackChunkMessage('hello')).toEqual(['hello']);
  });

  it('returns single chunk for text at exact limit', () => {
    const text = 'a'.repeat(3000);
    expect(slackChunkMessage(text)).toEqual([text]);
  });

  it('splits at paragraph boundary', () => {
    const para1 = 'a'.repeat(2000);
    const para2 = 'b'.repeat(2000);
    const text = `${para1}\n\n${para2}`;
    const chunks = slackChunkMessage(text);
    expect(chunks.length).toBe(2);
    expect(chunks[0]).toBe(para1);
    expect(chunks[1]).toBe(para2);
  });

  it('splits at sentence boundary when no paragraph break', () => {
    const sentence1 = 'A'.repeat(1500) + '. ';
    const sentence2 = 'B'.repeat(2000);
    const text = sentence1 + sentence2;
    const chunks = slackChunkMessage(text);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });

  it('splits at word boundary as fallback', () => {
    // Create text with spaces but no sentence breaks
    const words = Array.from({ length: 500 }, (_, i) => `word${i}`).join(' ');
    const chunks = slackChunkMessage(words, 100);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(100);
    }
  });

  it('does hard split when no boundaries', () => {
    const text = 'x'.repeat(6000);
    const chunks = slackChunkMessage(text, 3000);
    expect(chunks.length).toBe(2);
    expect(chunks[0].length).toBe(3000);
  });

  it('respects custom maxLength', () => {
    const text = 'Hello world. This is a test. Foo bar.';
    const chunks = slackChunkMessage(text, 15);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(15);
    }
  });

  it('handles empty string', () => {
    expect(slackChunkMessage('')).toEqual(['']);
  });

  it('handles text with only whitespace', () => {
    // Whitespace-only text is under the max length, so returned as-is (single chunk)
    const chunks = slackChunkMessage('   ');
    expect(chunks).toEqual(['   ']);
  });
});

// =============================================================================
// WhatsApp: cleanForWhatsApp
// =============================================================================

describe('cleanForWhatsApp', () => {
  it('converts markdown headers to bold', () => {
    expect(cleanForWhatsApp('# Title')).toBe('*Title*');
    expect(cleanForWhatsApp('## Subtitle')).toBe('*Subtitle*');
  });

  it('converts **bold** to *bold*', () => {
    expect(cleanForWhatsApp('This is **bold** text')).toBe('This is *bold* text');
  });

  it('converts __bold__ to *bold*', () => {
    expect(cleanForWhatsApp('This is __bold__ text')).toBe('This is *bold* text');
  });

  it('converts markdown links to plain text', () => {
    expect(cleanForWhatsApp('[Click here](https://example.com)')).toBe(
      'Click here (https://example.com)',
    );
  });

  it('strips language identifier from code blocks', () => {
    expect(cleanForWhatsApp('```python\nprint("hi")\n```')).toBe('```\nprint("hi")\n```');
  });

  it('strips inline backticks (single)', () => {
    expect(cleanForWhatsApp('Use `console.log` for debug')).toBe('Use console.log for debug');
  });

  it('preserves triple backtick code blocks', () => {
    const input = '```\ncode here\n```';
    expect(cleanForWhatsApp(input)).toBe('```\ncode here\n```');
  });

  it('normalizes bullet lists', () => {
    expect(cleanForWhatsApp('* Item 1\n- Item 2')).toBe('- Item 1\n- Item 2');
  });

  it('removes horizontal rules', () => {
    expect(cleanForWhatsApp('Above\n---\nBelow')).toBe('Above\n\nBelow');
  });

  it('cleans up excessive blank lines', () => {
    expect(cleanForWhatsApp('A\n\n\n\nB')).toBe('A\n\nB');
  });

  it('trims whitespace', () => {
    expect(cleanForWhatsApp('  hello  ')).toBe('hello');
  });

  it('handles empty string', () => {
    expect(cleanForWhatsApp('')).toBe('');
  });

  it('handles plain text', () => {
    expect(cleanForWhatsApp('No formatting here')).toBe('No formatting here');
  });

  it('handles multiple formatting elements', () => {
    const input = '# Heading\n\n**Bold** and [link](https://x.com)\n\n---\n\n* Item';
    const output = cleanForWhatsApp(input);
    expect(output).toContain('*Heading*');
    expect(output).toContain('*Bold*');
    expect(output).toContain('link (https://x.com)');
    expect(output).toContain('- Item');
    expect(output).not.toContain('---');
  });

  it('handles unicode content', () => {
    expect(cleanForWhatsApp('\u00a1Hola! \u00bfC\u00f3mo est\u00e1s?')).toBe(
      '\u00a1Hola! \u00bfC\u00f3mo est\u00e1s?',
    );
  });
});

// =============================================================================
// WhatsApp: chunkMessage
// =============================================================================

describe('whatsappChunkMessage', () => {
  it('returns single chunk for short text', () => {
    expect(whatsappChunkMessage('hello')).toEqual(['hello']);
  });

  it('returns single chunk for text at exact limit', () => {
    const text = 'a'.repeat(4000);
    expect(whatsappChunkMessage(text)).toEqual([text]);
  });

  it('splits at paragraph boundary', () => {
    const para1 = 'a'.repeat(3000);
    const para2 = 'b'.repeat(3000);
    const text = `${para1}\n\n${para2}`;
    const chunks = whatsappChunkMessage(text);
    expect(chunks.length).toBe(2);
    expect(chunks[0]).toBe(para1);
    expect(chunks[1]).toBe(para2);
  });

  it('splits at sentence boundary', () => {
    const sentence1 = 'A'.repeat(2000) + '. ';
    const sentence2 = 'B'.repeat(3000);
    const text = sentence1 + sentence2;
    const chunks = whatsappChunkMessage(text);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });

  it('splits at word boundary', () => {
    const words = Array.from({ length: 600 }, (_, i) => `word${i}`).join(' ');
    const chunks = whatsappChunkMessage(words, 100);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(100);
    }
  });

  it('does hard split when no boundaries', () => {
    const text = 'x'.repeat(8000);
    const chunks = whatsappChunkMessage(text, 4000);
    expect(chunks.length).toBe(2);
    expect(chunks[0].length).toBe(4000);
  });

  it('respects custom maxLength', () => {
    const text = 'Hello world. This is a test. Foo bar baz.';
    const chunks = whatsappChunkMessage(text, 20);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(20);
    }
  });

  it('handles empty string', () => {
    expect(whatsappChunkMessage('')).toEqual(['']);
  });

  it('splits at line boundary', () => {
    const line1 = 'a'.repeat(80);
    const line2 = 'b'.repeat(80);
    const text = `${line1}\n${line2}`;
    const chunks = whatsappChunkMessage(text, 100);
    expect(chunks.length).toBe(2);
  });
});
