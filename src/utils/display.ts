import chalk from 'chalk';
import { getModelAliasText } from '../config.js';
import {
  getCommandsByCategory,
  getCategoryOrder,
  getCategoryLabel,
} from '../cli/command-registry.js';

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
  const argsStr =
    Object.keys(args).length > 0
      ? ' ' +
        Object.entries(args)
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

export function formatUsage(usage: {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number | null;
  cache_creation_input_tokens: number | null;
}): string {
  const parts = [`in ${usage.input_tokens}`, `out ${usage.output_tokens}`];
  if (usage.cache_read_input_tokens !== null) {
    parts.push(`cache read ${usage.cache_read_input_tokens}`);
  }
  if (usage.cache_creation_input_tokens !== null) {
    parts.push(`cache write ${usage.cache_creation_input_tokens}`);
  }
  return chalk.gray(`Tokens: ${parts.join(', ')}`);
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

  const header = cols.map((c) => c.toUpperCase().padEnd(widths[c])).join('  ');
  const separator = cols.map((c) => '-'.repeat(widths[c])).join('  ');
  const body = rows
    .map((row) => cols.map((c) => (row[c] ?? '').padEnd(widths[c])).join('  '))
    .join('\n  ');

  return `  ${chalk.bold(header)}\n  ${chalk.gray(separator)}\n  ${body}`;
}

export function formatDate(isoOrMs: string | number): string {
  const d = typeof isoOrMs === 'number' ? new Date(isoOrMs) : new Date(isoOrMs);
  if (Number.isNaN(d.getTime())) return 'invalid date';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function formatRelativeTime(isoOrMs: string | number): string {
  const ts = typeof isoOrMs === 'number' ? isoOrMs : new Date(isoOrMs).getTime();
  if (Number.isNaN(ts)) return 'unknown';
  const diff = Date.now() - ts;
  if (diff < 0) return 'just now';
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

export function printWelcome(orgId: string, version?: string, model?: string): void {
  console.log('');
  console.log(
    chalk.bold.cyan('  StateSet Response CLI') + (version ? chalk.gray(` v${version}`) : ''),
  );
  console.log(chalk.gray(`  Organization: ${orgId}`));
  if (model) {
    console.log(chalk.gray(`  Model: ${model}`));
  }
  console.log('');
  console.log(chalk.gray('  Quick start:'));
  console.log(chalk.gray('    Just type a message to chat with your AI agent.'));
  console.log(chalk.gray('    Use /commands for platform operations, or ask in natural language.'));
  console.log('');
  console.log(chalk.gray('  Essential commands:'));
  console.log(chalk.cyan('    /help       ') + chalk.gray('Full command reference'));
  console.log(chalk.cyan('    /agents     ') + chalk.gray('Manage agents'));
  console.log(chalk.cyan('    /rules      ') + chalk.gray('Manage rules'));
  console.log(chalk.cyan('    /kb         ') + chalk.gray('Knowledge base'));
  console.log(chalk.cyan('    /status     ') + chalk.gray('Platform overview'));
  console.log(chalk.cyan('    /apply on   ') + chalk.gray('Enable write operations'));
  console.log(
    chalk.cyan('    /model      ') +
      chalk.gray(`Switch model (${getModelAliasText('list').replace(/,\s*/g, '/')})`),
  );
  console.log('');
  console.log(chalk.gray('  Tab completes commands. End a line with \\ for multi-line input.'));
  console.log('');
}

export function printHelp(): void {
  const byCategory = getCommandsByCategory();
  const order = getCategoryOrder();

  console.log('');
  console.log(chalk.bold('  Available Commands'));
  console.log('');

  for (const category of order) {
    const cmds = byCategory.get(category);
    if (!cmds || cmds.length === 0) continue;

    console.log(chalk.bold(`  ${getCategoryLabel(category)}`));
    for (const cmd of cmds) {
      console.log(chalk.cyan(`    ${cmd.usage}`) + chalk.gray(cmd.description));
    }
    console.log('');
  }

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
