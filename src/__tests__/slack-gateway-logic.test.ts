import { describe, it, expect } from 'vitest';
import { cleanForSlack, chunkMessage } from '../slack/gateway.js';

describe('cleanForSlack', () => {
  it('converts markdown headers to bold', () => {
    expect(cleanForSlack('# Title')).toBe('*Title*');
    expect(cleanForSlack('## Subtitle')).toBe('*Subtitle*');
    expect(cleanForSlack('### H3')).toBe('*H3*');
  });

  it('converts **bold** to *bold*', () => {
    expect(cleanForSlack('This is **bold** text')).toBe('This is *bold* text');
  });

  it('converts __bold__ to *bold*', () => {
    expect(cleanForSlack('This is __underline bold__')).toBe('This is *underline bold*');
  });

  it('converts markdown links to Slack format', () => {
    expect(cleanForSlack('[Click here](https://example.com)')).toBe(
      '<https://example.com|Click here>',
    );
  });

  it('handles nested markdown formatting', () => {
    const input = '# **Bold Title**\n\nSee [link](https://example.com) for details.';
    const result = cleanForSlack(input);
    expect(result).toContain('*');
    expect(result).toContain('<https://example.com|link>');
  });

  it('handles multiple links in one line', () => {
    const input = 'Visit [A](https://a.com) and [B](https://b.com).';
    const result = cleanForSlack(input);
    expect(result).toContain('<https://a.com|A>');
    expect(result).toContain('<https://b.com|B>');
  });

  it('strips language identifiers from code blocks', () => {
    const input = '```typescript\nconst x = 1;\n```';
    const result = cleanForSlack(input);
    expect(result).not.toContain('typescript');
    expect(result).toContain('```\nconst x = 1;\n```');
  });

  it('preserves code blocks with markdown-like content', () => {
    const input = '```\n# This is inside code\n**not bold**\n```';
    const result = cleanForSlack(input);
    // Code block content should remain, outer formatting applied
    expect(result).toContain('```');
  });

  it('removes horizontal rules', () => {
    const input = 'Above\n---\nBelow';
    const result = cleanForSlack(input);
    expect(result).not.toContain('---');
  });

  it('collapses excessive blank lines', () => {
    const input = 'Line 1\n\n\n\n\nLine 2';
    const result = cleanForSlack(input);
    expect(result).toBe('Line 1\n\nLine 2');
  });

  it('handles empty string', () => {
    expect(cleanForSlack('')).toBe('');
  });

  it('passes through plain text unchanged', () => {
    expect(cleanForSlack('Just plain text')).toBe('Just plain text');
  });
});

describe('chunkMessage (Slack)', () => {
  it('returns single chunk for short messages', () => {
    expect(chunkMessage('Hello', 3000)).toEqual(['Hello']);
  });

  it('splits long messages at paragraph boundaries', () => {
    const para1 = 'A'.repeat(1500);
    const para2 = 'B'.repeat(1500);
    const text = `${para1}\n\n${para2}`;
    const chunks = chunkMessage(text, 2000);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0]).toContain('A');
    expect(chunks[chunks.length - 1]).toContain('B');
  });

  it('splits at sentence boundaries when no paragraph break', () => {
    const text = 'First sentence. Second sentence. ' + 'X'.repeat(3000);
    const chunks = chunkMessage(text, 50);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('handles text with only newlines', () => {
    const text = '\n'.repeat(100);
    const chunks = chunkMessage(text, 50);
    // Should handle gracefully, even if input is just whitespace
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });

  it('handles trailing whitespace', () => {
    const text = 'A'.repeat(2000) + '   ';
    const chunks = chunkMessage(text, 3000);
    expect(chunks.length).toBe(1);
  });

  it('performs hard split when no boundaries exist', () => {
    const text = 'X'.repeat(6000);
    const chunks = chunkMessage(text, 3000);
    expect(chunks.length).toBe(2);
    expect(chunks[0].length).toBeLessThanOrEqual(3000);
  });

  it('uses default max length of 3000', () => {
    const text = 'Y'.repeat(6001);
    const chunks = chunkMessage(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(3000);
    }
  });
});
