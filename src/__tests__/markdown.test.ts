import { describe, it, expect } from 'vitest';
import { renderMarkdown, renderInline } from '../utils/markdown.js';
import chalk from 'chalk';

describe('renderInline', () => {
  it('renders inline code', () => {
    const result = renderInline('Use `foo()` here');
    expect(result).toContain(chalk.cyan('foo()'));
  });

  it('renders bold text', () => {
    const result = renderInline('This is **bold** text');
    expect(result).toContain(chalk.bold('bold'));
  });

  it('renders italic text', () => {
    const result = renderInline('This is *italic* text');
    expect(result).toContain(chalk.italic('italic'));
  });

  it('renders links', () => {
    const result = renderInline('Visit [site](https://example.com)');
    expect(result).toContain(chalk.underline('site'));
    expect(result).toContain('https://example.com');
  });

  it('renders bold italic', () => {
    const result = renderInline('***important***');
    expect(result).toContain(chalk.bold.italic('important'));
  });

  it('passes through plain text unchanged', () => {
    expect(renderInline('hello world')).toBe('hello world');
  });
});

describe('renderMarkdown', () => {
  it('renders H1 heading', () => {
    const result = renderMarkdown('# Hello');
    expect(result).toContain(chalk.bold.underline('Hello'));
  });

  it('renders H2 heading', () => {
    const result = renderMarkdown('## Section');
    expect(result).toContain(chalk.bold('Section'));
  });

  it('renders H3 heading', () => {
    const result = renderMarkdown('### Subsection');
    expect(result).toContain(chalk.bold('Subsection'));
  });

  it('renders unordered list', () => {
    const result = renderMarkdown('- Item one\n- Item two');
    expect(result).toContain(chalk.cyan('• '));
    expect(result).toContain('Item one');
    expect(result).toContain('Item two');
  });

  it('renders ordered list', () => {
    const result = renderMarkdown('1. First\n2. Second');
    expect(result).toContain(chalk.cyan('1. '));
    expect(result).toContain('First');
    expect(result).toContain(chalk.cyan('2. '));
  });

  it('renders block quotes', () => {
    const result = renderMarkdown('> quoted text');
    expect(result).toContain(chalk.gray('│ '));
    expect(result).toContain('quoted text');
  });

  it('renders horizontal rule', () => {
    const result = renderMarkdown('---');
    expect(result).toContain('─');
  });

  it('renders fenced code blocks', () => {
    const result = renderMarkdown('```js\nconst x = 1;\n```');
    expect(result).toContain(chalk.cyan('const x = 1;'));
    expect(result).toContain('js');
  });

  it('renders code block without language', () => {
    const result = renderMarkdown('```\nhello\n```');
    expect(result).toContain(chalk.cyan('hello'));
  });

  it('handles unclosed code block', () => {
    const result = renderMarkdown('```py\nprint("hi")');
    expect(result).toContain(chalk.cyan('print("hi")'));
  });

  it('renders mixed content', () => {
    const input = '# Title\n\nSome **bold** text.\n\n- Item 1\n- Item 2\n\n```\ncode\n```';
    const result = renderMarkdown(input);
    expect(result).toContain(chalk.bold.underline('Title'));
    expect(result).toContain(chalk.bold('bold'));
    expect(result).toContain(chalk.cyan('• '));
    expect(result).toContain(chalk.cyan('code'));
  });

  it('preserves empty lines', () => {
    const result = renderMarkdown('line1\n\nline2');
    expect(result).toBe('line1\n\nline2');
  });
});
