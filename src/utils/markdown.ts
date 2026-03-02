import chalk from 'chalk';

/**
 * Line-level markdown-to-ANSI renderer for terminal output.
 * Converts common markdown constructs to chalk-styled strings.
 */

const FENCE_OPEN_RE = /^```(\w+)?$/;
const FENCE_CLOSE_RE = /^```$/;
const HEADING_RE = /^(#{1,3})\s+(.+)$/;
const UL_RE = /^(\s*)[-*+]\s+(.+)$/;
const OL_RE = /^(\s*)(\d+)[.)]\s+(.+)$/;
const BLOCKQUOTE_RE = /^>\s?(.*)$/;
const HR_RE = /^(?:---+|\*\*\*+|___+)\s*$/;

/** Render inline markdown formatting (bold, italic, code, links). */
export function renderInline(text: string): string {
  // Inline code: `code`
  text = text.replace(/`([^`]+)`/g, (_match, code: string) => chalk.cyan(code));

  // Bold + italic: ***text*** or ___text___
  text = text.replace(/\*\*\*(.+?)\*\*\*/g, (_match, inner: string) => chalk.bold.italic(inner));
  text = text.replace(/___(.+?)___/g, (_match, inner: string) => chalk.bold.italic(inner));

  // Bold: **text** or __text__
  text = text.replace(/\*\*(.+?)\*\*/g, (_match, inner: string) => chalk.bold(inner));
  text = text.replace(/__(.+?)__/g, (_match, inner: string) => chalk.bold(inner));

  // Italic: *text* or _text_
  text = text.replace(/(?<!\w)\*([^*]+?)\*(?!\w)/g, (_match, inner: string) => chalk.italic(inner));
  text = text.replace(/(?<!\w)_([^_]+?)_(?!\w)/g, (_match, inner: string) => chalk.italic(inner));

  // Links: [text](url)
  text = text.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_match, linkText: string, url: string) => chalk.underline(linkText) + chalk.gray(` (${url})`),
  );

  return text;
}

/** Render a complete markdown string to ANSI-styled terminal text. */
export function renderMarkdown(input: string): string {
  const lines = input.split('\n');
  const output: string[] = [];
  let inCodeBlock = false;
  let codeLang = '';
  const codeLines: string[] = [];

  for (const line of lines) {
    // Code block handling
    if (!inCodeBlock && FENCE_OPEN_RE.test(line)) {
      const match = FENCE_OPEN_RE.exec(line);
      inCodeBlock = true;
      codeLang = match?.[1] ?? '';
      codeLines.length = 0;
      continue;
    }
    if (inCodeBlock && FENCE_CLOSE_RE.test(line)) {
      if (codeLang) {
        output.push(chalk.dim(`  ${codeLang}`));
      }
      for (const cl of codeLines) {
        output.push('  ' + chalk.cyan(cl));
      }
      inCodeBlock = false;
      codeLang = '';
      codeLines.length = 0;
      continue;
    }
    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    // Horizontal rule
    if (HR_RE.test(line)) {
      output.push(chalk.gray('─'.repeat(40)));
      continue;
    }

    // Headings
    const headingMatch = HEADING_RE.exec(line);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2];
      if (level === 1) {
        output.push(chalk.bold.underline(text));
      } else {
        output.push(chalk.bold(text));
      }
      continue;
    }

    // Block quotes
    const bqMatch = BLOCKQUOTE_RE.exec(line);
    if (bqMatch) {
      output.push(chalk.gray('│ ') + renderInline(bqMatch[1]));
      continue;
    }

    // Unordered list
    const ulMatch = UL_RE.exec(line);
    if (ulMatch) {
      const indent = ulMatch[1];
      const text = ulMatch[2];
      output.push(indent + chalk.cyan('• ') + renderInline(text));
      continue;
    }

    // Ordered list
    const olMatch = OL_RE.exec(line);
    if (olMatch) {
      const indent = olMatch[1];
      const num = olMatch[2];
      const text = olMatch[3];
      output.push(indent + chalk.cyan(`${num}. `) + renderInline(text));
      continue;
    }

    // Regular text with inline formatting
    output.push(renderInline(line));
  }

  // Flush any unclosed code block
  if (inCodeBlock) {
    if (codeLang) {
      output.push(chalk.dim(`  ${codeLang}`));
    }
    for (const cl of codeLines) {
      output.push('  ' + chalk.cyan(cl));
    }
  }

  return output.join('\n');
}
