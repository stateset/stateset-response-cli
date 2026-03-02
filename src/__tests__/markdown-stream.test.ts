import { describe, it, expect } from 'vitest';
import { MarkdownStreamRenderer } from '../utils/markdown-stream.js';

describe('MarkdownStreamRenderer', () => {
  it('renders a complete line when newline arrives', () => {
    const renderer = new MarkdownStreamRenderer();
    const result = renderer.push('Hello world\n');
    expect(result).toContain('Hello world');
    expect(result).toBe('Hello world\n');
  });

  it('buffers incomplete lines', () => {
    const renderer = new MarkdownStreamRenderer();
    expect(renderer.push('Hello ')).toBe('');
    expect(renderer.push('world')).toBe('');
    const flushed = renderer.flush();
    expect(flushed).toContain('Hello world');
  });

  it('renders heading from a complete line', () => {
    const renderer = new MarkdownStreamRenderer();
    const result = renderer.push('# Title\n');
    expect(result).toBeTruthy();
    expect(result).toContain('Title');
  });

  it('buffers code block until closing fence', () => {
    const renderer = new MarkdownStreamRenderer();
    expect(renderer.push('```js\n')).toBe('');
    expect(renderer.push('const x = 1;\n')).toBe('');
    const result = renderer.push('```\n');
    expect(result).toContain('const x = 1;');
    expect(result).toContain('js');
  });

  it('flushes unclosed code block', () => {
    const renderer = new MarkdownStreamRenderer();
    renderer.push('```py\n');
    renderer.push('print("hi")\n');
    const flushed = renderer.flush();
    expect(flushed).toContain('print("hi")');
  });

  it('handles multiple lines in a single push', () => {
    const renderer = new MarkdownStreamRenderer();
    const result = renderer.push('line1\nline2\n');
    expect(result).toContain('line1');
    expect(result).toContain('line2');
  });

  it('renders bold inline', () => {
    const renderer = new MarkdownStreamRenderer();
    const result = renderer.push('This is **bold** text\n');
    expect(result).toBeTruthy();
  });

  it('reset clears state', () => {
    const renderer = new MarkdownStreamRenderer();
    renderer.push('```\n');
    renderer.push('code\n');
    renderer.reset();
    // After reset, should process fresh
    const result = renderer.push('plain text\n');
    expect(result).toContain('plain text');
  });

  it('handles token-by-token streaming', () => {
    const renderer = new MarkdownStreamRenderer();
    const parts: string[] = [];
    for (const char of 'Hello\n') {
      const r = renderer.push(char);
      if (r) parts.push(r);
    }
    const output = parts.join('');
    expect(output).toContain('Hello');
  });

  it('returns empty string for empty flush', () => {
    const renderer = new MarkdownStreamRenderer();
    expect(renderer.flush()).toBe('');
  });
});
