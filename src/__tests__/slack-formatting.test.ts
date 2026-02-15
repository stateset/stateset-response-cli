import { describe, it, expect } from 'vitest';
import { cleanForSlack, chunkMessage } from '../slack/gateway.js';

describe('cleanForSlack', () => {
  it('converts markdown headers to Slack bold', () => {
    expect(cleanForSlack('# Title')).toBe('*Title*');
    expect(cleanForSlack('## Subtitle')).toBe('*Subtitle*');
  });

  it('converts **bold** to *bold*', () => {
    expect(cleanForSlack('This is **bold** text')).toBe('This is *bold* text');
  });

  it('converts __bold__ to *bold*', () => {
    expect(cleanForSlack('This is __bold__ text')).toBe('This is *bold* text');
  });

  it('converts markdown links to Slack format', () => {
    expect(cleanForSlack('[click here](https://example.com)')).toBe(
      '<https://example.com|click here>',
    );
  });

  it('strips language from code blocks', () => {
    expect(cleanForSlack('```typescript\ncode\n```')).toBe('```\ncode\n```');
  });

  it('normalizes bullet lists', () => {
    expect(cleanForSlack('* item 1\n* item 2')).toBe('- item 1\n- item 2');
  });

  it('removes horizontal rules', () => {
    expect(cleanForSlack('above\n---\nbelow')).toBe('above\n\nbelow');
  });

  it('collapses excessive blank lines', () => {
    expect(cleanForSlack('a\n\n\n\n\nb')).toBe('a\n\nb');
  });

  it('trims result', () => {
    expect(cleanForSlack('  hello  ')).toBe('hello');
  });
});

describe('chunkMessage (Slack)', () => {
  it('returns single chunk for short messages', () => {
    const chunks = chunkMessage('Hello');
    expect(chunks).toEqual(['Hello']);
  });

  it('splits at 3000 chars by default', () => {
    const text = 'A'.repeat(5000);
    const chunks = chunkMessage(text);
    expect(chunks.length).toBe(2);
    expect(chunks[0].length).toBe(3000);
  });

  it('respects custom max length', () => {
    const text = 'word '.repeat(500);
    const chunks = chunkMessage(text, 100);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(100);
    }
  });

  it('splits at paragraph boundaries when possible', () => {
    const para1 = 'X'.repeat(1500);
    const para2 = 'Y'.repeat(1000);
    const text = `${para1}\n\n${para2}`;
    const chunks = chunkMessage(text, 2000);
    expect(chunks.length).toBe(2);
    expect(chunks[0]).toBe(para1);
    expect(chunks[1]).toBe(para2);
  });
});
