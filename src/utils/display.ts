import chalk from 'chalk';

const SENSITIVE_KEY_RE = /(secret|token|authorization|api[-_]?key|password|admin)/i;

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactValue);
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = SENSITIVE_KEY_RE.test(k) ? '[redacted]' : redactValue(v);
    }
    return out;
  }
  return value;
}

export function formatToolCall(name: string, args: Record<string, unknown>): string {
  const argsStr = Object.keys(args).length > 0
    ? ' ' + Object.entries(args)
        .map(([k, v]) => {
          const safeValue = SENSITIVE_KEY_RE.test(k) ? '[redacted]' : redactValue(v);
          const val = typeof safeValue === 'string' ? safeValue : JSON.stringify(safeValue);
          const display = val.length > 80 ? val.slice(0, 77) + '...' : val;
          return `${chalk.gray(k)}=${chalk.white(display)}`;
        })
        .join(' ')
    : '';
  return chalk.yellow(`  -> ${name}`) + argsStr;
}

export function formatToolResult(result: string): string {
  const maxLen = 2000;
  const display = result.length > maxLen ? result.slice(0, maxLen) + '\n... (truncated)' : result;
  return chalk.gray(display);
}

export function formatError(error: string): string {
  return chalk.red(`Error: ${error}`);
}

export function formatSuccess(message: string): string {
  return chalk.green(`  ${message}`);
}

export function formatWarning(message: string): string {
  return chalk.yellow(`  ${message}`);
}

export function formatAssistantMessage(text: string): string {
  return chalk.white(text);
}

export function formatElapsed(ms: number): string {
  if (ms < 1000) return chalk.gray(` (${ms}ms)`);
  return chalk.gray(` (${(ms / 1000).toFixed(1)}s)`);
}

export function formatTable(rows: Record<string, string>[], columns?: string[]): string {
  if (rows.length === 0) return chalk.gray('  (no results)');

  const cols = columns || Object.keys(rows[0]);
  const widths: Record<string, number> = {};
  for (const col of cols) {
    widths[col] = col.length;
    for (const row of rows) {
      const val = row[col] ?? '';
      widths[col] = Math.max(widths[col], val.length);
    }
  }

  const header = cols.map(c => c.toUpperCase().padEnd(widths[c])).join('  ');
  const separator = cols.map(c => '-'.repeat(widths[c])).join('  ');
  const body = rows
    .map(row => cols.map(c => (row[c] ?? '').padEnd(widths[c])).join('  '))
    .join('\n  ');

  return `  ${chalk.bold(header)}\n  ${chalk.gray(separator)}\n  ${body}`;
}

export function printWelcome(orgId: string, version?: string, model?: string): void {
  console.log('');
  console.log(chalk.bold.cyan('  StateSet Response CLI') + (version ? chalk.gray(` v${version}`) : ''));
  console.log(chalk.gray(`  Organization: ${orgId}`));
  if (model) {
    console.log(chalk.gray(`  Model: ${model}`));
  }
  console.log('');
  console.log(chalk.gray('  Manage your agents, rules, skills, attributes, examples, evals,'));
  console.log(chalk.gray('  datasets, functions, responses, channels, messages, knowledge'));
  console.log(chalk.gray('  base, settings, and organizations using natural language.'));
  console.log('');
  console.log(chalk.gray('  Commands:'));
  console.log(chalk.gray('    /help     - Show available commands'));
  console.log(chalk.gray('    /clear    - Reset conversation history'));
  console.log(chalk.gray('    /history  - Show conversation turn count'));
  console.log(chalk.gray('    /model    - Switch model (sonnet/haiku/opus)'));
  console.log(chalk.gray('    exit      - End the session'));
  console.log('');
}

export function printHelp(): void {
  console.log('');
  console.log(chalk.bold('  Available Commands'));
  console.log('');
  console.log(chalk.cyan('    /help            ') + chalk.gray('Show this help message'));
  console.log(chalk.cyan('    /clear           ') + chalk.gray('Reset conversation history'));
  console.log(chalk.cyan('    /history         ') + chalk.gray('Show conversation turn count'));
  console.log(chalk.cyan('    /model <name>    ') + chalk.gray('Switch model (sonnet, haiku, opus)'));
  console.log(chalk.cyan('    exit / quit      ') + chalk.gray('End the session'));
  console.log('');
  console.log(chalk.gray('  Multi-line input: end a line with \\ to continue on the next line.'));
  console.log(chalk.gray('  Press Ctrl+C to cancel the current request.'));
  console.log('');
}

export function printAuthHelp(): void {
  console.log('');
  console.log(chalk.bold('  Setup required'));
  console.log('');
  console.log(chalk.gray('  Run the following to configure your credentials:'));
  console.log(chalk.cyan('    response auth login'));
  console.log('');
}
