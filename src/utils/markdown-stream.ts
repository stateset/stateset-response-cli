import { renderMarkdown, renderInline } from './markdown.js';

/**
 * Streaming-aware markdown buffer.
 * Accumulates tokens, renders complete lines, and buffers incomplete
 * constructs (code fences, bold markers) until disambiguated.
 */
export class MarkdownStreamRenderer {
  private buffer = '';
  private inCodeBlock = false;
  private codeBlockLines: string[] = [];
  private codeLang = '';

  /** Push a token delta. Returns rendered ANSI text ready to write to stdout, or ''. */
  push(delta: string): string {
    this.buffer += delta;
    return this.processBuffer();
  }

  /** Flush remaining buffer at end of response. Returns rendered text. */
  flush(): string {
    const remaining = this.buffer;
    this.buffer = '';

    if (this.inCodeBlock) {
      // Flush unclosed code block
      const lines = remaining.split('\n');
      for (const line of lines) {
        if (line) this.codeBlockLines.push(line);
      }
      const result = this.flushCodeBlock(false);
      this.inCodeBlock = false;
      this.codeBlockLines = [];
      this.codeLang = '';
      return result;
    }

    if (!remaining) return '';
    return this.renderLines(remaining.split('\n'));
  }

  /** Reset internal state for reuse. */
  reset(): void {
    this.buffer = '';
    this.inCodeBlock = false;
    this.codeBlockLines = [];
    this.codeLang = '';
  }

  private processBuffer(): string {
    const output: string[] = [];

    while (true) {
      const newlineIdx = this.buffer.indexOf('\n');
      if (newlineIdx === -1) break;

      const line = this.buffer.slice(0, newlineIdx);
      this.buffer = this.buffer.slice(newlineIdx + 1);

      const rendered = this.processLine(line);
      if (rendered !== null) {
        output.push(rendered);
      }
    }

    // If not in a code block and buffer has content but no newline,
    // keep buffering (incomplete line)
    return output.length > 0 ? output.join('\n') + '\n' : '';
  }

  private processLine(line: string): string | null {
    const FENCE_OPEN_RE = /^```(\w+)?$/;
    const FENCE_CLOSE_RE = /^```$/;

    if (!this.inCodeBlock && FENCE_OPEN_RE.test(line)) {
      const match = FENCE_OPEN_RE.exec(line);
      this.inCodeBlock = true;
      this.codeLang = match?.[1] ?? '';
      this.codeBlockLines = [];
      return null; // buffer until close
    }

    if (this.inCodeBlock) {
      if (FENCE_CLOSE_RE.test(line)) {
        const result = this.flushCodeBlock(true);
        this.inCodeBlock = false;
        this.codeBlockLines = [];
        this.codeLang = '';
        return result;
      }
      this.codeBlockLines.push(line);
      return null; // buffer
    }

    // Regular line — render immediately
    return this.renderSingleLine(line);
  }

  private flushCodeBlock(_closed: boolean): string {
    const parts: string[] = [];
    if (this.codeLang) {
      parts.push(`\x1b[2m  ${this.codeLang}\x1b[22m`); // dim
    }
    for (const cl of this.codeBlockLines) {
      parts.push('  \x1b[36m' + cl + '\x1b[39m'); // cyan
    }
    // Don't add trailing newline — processBuffer adds it
    return parts.join('\n');
  }

  private renderSingleLine(line: string): string {
    // Use renderMarkdown for a single line (handles headings, lists, etc.)
    return renderMarkdown(line);
  }

  private renderLines(lines: string[]): string {
    return lines.map((l) => (l ? renderInline(l) : l)).join('\n');
  }
}
