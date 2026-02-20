import chalk from 'chalk';
import { getModelAliasText } from '../config.js';

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
  console.log(chalk.gray('  Manage your agents, rules, skills, attributes, examples, evals,'));
  console.log(chalk.gray('  datasets, functions, responses, channels, messages, knowledge'));
  console.log(chalk.gray('  base, settings, and organizations using natural language.'));
  console.log('');
  console.log(chalk.gray('  Commands:'));
  console.log(chalk.gray('    /help     - Show available commands'));
  console.log(chalk.gray('    /clear    - Reset conversation history'));
  console.log(chalk.gray('    /history  - Show conversation turn count'));
  console.log(
    chalk.gray(`    /model    - Switch model (${getModelAliasText('list').replace(/,\s*/g, '/')})`),
  );
  console.log(chalk.gray('    /rules    - List and manage rules'));
  console.log(chalk.gray('    /kb       - Search and manage knowledge base entries'));
  console.log(chalk.gray('    /agents   - List and manage agents'));
  console.log(chalk.gray('    /convos   - Search and inspect conversations'));
  console.log(chalk.gray('    /conversations - Alias for /convos'));
  console.log(chalk.gray('    /channels - List and inspect channels'));
  console.log(chalk.gray('    /messages - List and manage messages'));
  console.log(chalk.gray('    /responses - List and rate responses'));
  console.log(chalk.gray('    /analytics - Show analytics and usage snapshots'));
  console.log(chalk.gray('    /status   - Show platform status summary'));
  console.log(chalk.gray('    /stats    - Show platform stats'));
  console.log(chalk.gray('    /snapshot - List/create/show local snapshots'));
  console.log(chalk.gray('    /bulk     - Bulk import/export organization data'));
  console.log(chalk.gray('    /pull     - Pull organization config into .stateset'));
  console.log(chalk.gray('    /push     - Push .stateset config into current organization'));
  console.log(chalk.gray('    /validate - Validate a local state-set bundle'));
  console.log(chalk.gray('    /watch    - Watch .stateset and auto-sync changes'));
  console.log(chalk.gray('    /test     - Test an input against active agent (--agent optional)'));
  console.log(chalk.gray('    /diff     - Show config diff'));
  console.log(chalk.gray('    /deploy   - Deploy pending changes (supports --schedule/--approve)'));
  console.log(
    chalk.gray('    /rollback - Rollback pending changes (supports --schedule/--approve)'),
  );
  console.log(chalk.gray('    /deployments - Inspect deployment history and scheduled jobs'));
  console.log(chalk.gray('    /webhooks - Manage webhook subscriptions'));
  console.log(chalk.gray('    /alerts   - Manage alert rules'));
  console.log(chalk.gray('    /monitor  - Watch live platform metrics'));
  console.log(chalk.gray('    /apply    - Toggle write operations'));
  console.log(chalk.gray('    /redact   - Toggle redaction'));
  console.log(chalk.gray('    /usage    - Toggle usage summaries'));
  console.log(chalk.gray('    /audit    - Toggle tool audit logging'));
  console.log(chalk.gray('    /audit-show  - Show recent audit entries'));
  console.log(chalk.gray('    /audit-clear - Clear audit log'));
  console.log(chalk.gray('    /permissions - Show or clear stored permissions'));
  console.log(chalk.gray('    /integrations - Show integration status'));
  console.log(chalk.gray('    /session-meta - Show session metadata'));
  console.log(chalk.gray('    /policy   - Manage policy overrides'));
  console.log(chalk.gray('    /export   - Export a session transcript'));
  console.log(chalk.gray('    /export-list - List session exports'));
  console.log(chalk.gray('    /export-show - Preview an export file'));
  console.log(chalk.gray('    /export-open - Show export path'));
  console.log(chalk.gray('    /export-delete - Delete an export file'));
  console.log(chalk.gray('    /export-prune  - Delete older exports'));
  console.log(chalk.gray('    /rename   - Rename the current session'));
  console.log(chalk.gray('    /delete   - Delete a session'));
  console.log(chalk.gray('    /extensions - List loaded extensions'));
  console.log(chalk.gray('    /reload     - Reload extensions'));
  console.log(chalk.gray('    /session  - Show session info'));
  console.log(chalk.gray('    /sessions - List sessions'));
  console.log(chalk.gray('    /new      - Start a new session'));
  console.log(chalk.gray('    /resume   - Resume a session'));
  console.log(chalk.gray('    /archive  - Archive a session'));
  console.log(chalk.gray('    /unarchive- Unarchive a session'));
  console.log(chalk.gray('    /tag      - Manage session tags'));
  console.log(chalk.gray('    /search   - Search session transcripts'));
  console.log(chalk.gray('    /skills   - List available skills'));
  console.log(chalk.gray('    /skill    - Activate a skill'));
  console.log(chalk.gray('    /prompts  - List prompt templates'));
  console.log(chalk.gray('    /prompt   - Use a prompt template'));
  console.log(chalk.gray('    /prompt-history - Show recent prompt templates'));
  console.log(chalk.gray('    /prompt-validate - Validate prompt templates'));
  console.log(chalk.gray('    /exit /quit - End the session'));
  console.log('');
}

export function printHelp(): void {
  console.log('');
  console.log(chalk.bold('  Available Commands'));
  console.log('');
  console.log(chalk.bold('  Core'));
  console.log(chalk.cyan('    /help                  ') + chalk.gray('Show this help message'));
  console.log(chalk.cyan('    /clear                 ') + chalk.gray('Reset conversation history'));
  console.log(
    chalk.cyan('    /history               ') + chalk.gray('Show conversation turn count'),
  );
  console.log(
    chalk.cyan('    /model <name>          ') +
      chalk.gray(`Switch model (${getModelAliasText('list')})`),
  );
  console.log(
    chalk.cyan('    /usage on|off          ') + chalk.gray('Enable or disable usage summaries'),
  );
  console.log(
    chalk.cyan('    /attach <path>         ') +
      chalk.gray('Attach a file or image to the next message'),
  );
  console.log(chalk.cyan('    /attachments           ') + chalk.gray('List staged attachments'));
  console.log(chalk.cyan('    /attach-clear          ') + chalk.gray('Clear staged attachments'));
  console.log('');

  console.log(chalk.bold('  Safety & Policy'));
  console.log(
    chalk.cyan('    /apply on|off           ') + chalk.gray('Enable or disable write operations'),
  );
  console.log(
    chalk.cyan('    /redact on|off          ') + chalk.gray('Enable or disable PII redaction'),
  );
  console.log(
    chalk.cyan('    /audit on|off [detail]  ') +
      chalk.gray('Toggle tool audit logging (optional excerpts)'),
  );
  console.log(
    chalk.cyan('    /audit-show [session] [tool=name] [errors] [limit=20]') +
      chalk.gray('Show recent audit entries'),
  );
  console.log(
    chalk.cyan('    /audit-clear [session]  ') + chalk.gray('Clear audit log for a session'),
  );
  console.log(
    chalk.cyan('    /permissions [list|clear]') + chalk.gray('List or clear stored permissions'),
  );
  console.log(
    chalk.cyan('    /policy list|set|unset|clear|edit|init|import') +
      chalk.gray('Manage policy overrides'),
  );
  console.log(
    chalk.cyan('    /policy export [local|global] [out=path] [--unsafe-path]') +
      chalk.gray('Export policy overrides'),
  );
  console.log(
    chalk.cyan('    /policy import <path> [merge|replace]') +
      chalk.gray('Import policy overrides from JSON'),
  );
  console.log('');

  console.log(chalk.bold('  Integrations'));
  console.log(chalk.cyan('    /integrations           ') + chalk.gray('Show integration status'));
  console.log(
    chalk.cyan('    /integrations setup     ') + chalk.gray('Run integration setup wizard'),
  );
  console.log('');

  console.log(chalk.bold('  Sessions'));
  console.log(chalk.cyan('    /session               ') + chalk.gray('Show current session info'));
  console.log(
    chalk.cyan('    /sessions [all] [tag=tag]') +
      chalk.gray('List sessions (optionally include archived or filter by tag)'),
  );
  console.log(chalk.cyan('    /new [name]            ') + chalk.gray('Start a new session'));
  console.log(chalk.cyan('    /resume <name>         ') + chalk.gray('Resume a saved session'));
  console.log(chalk.cyan('    /archive [name]        ') + chalk.gray('Archive a session'));
  console.log(chalk.cyan('    /unarchive [name]      ') + chalk.gray('Unarchive a session'));
  console.log(chalk.cyan('    /rename <name>         ') + chalk.gray('Rename the current session'));
  console.log(chalk.cyan('    /delete [name]         ') + chalk.gray('Delete a session'));
  console.log(
    chalk.cyan('    /tag list|add|remove <tag> [session]') + chalk.gray('Manage session tags'),
  );
  console.log(
    chalk.cyan(
      '    /search <text> [all] [role=user|assistant] [since=YYYY-MM-DD] [until=YYYY-MM-DD] [regex=/.../] [limit=100]',
    ) + chalk.gray('Search session transcripts (scans up to 5000 entries)'),
  );
  console.log(
    chalk.cyan('    /session-meta [session] [json|md] [out=path] [--unsafe-path]') +
      chalk.gray('Show or export session metadata'),
  );
  console.log('');

  console.log(chalk.bold('  Shortcut Commands'));
  console.log(
    chalk.cyan('    /rules [get|list|create|toggle|delete|import|export|agent|<id>]') +
      chalk.gray('Manage agent rules'),
  );
  console.log(
    chalk.cyan('    /kb [search|add|delete|scroll|list|info]') + chalk.gray('Manage KB entries'),
  );
  console.log(
    chalk.cyan('    /agents [list|get|create|switch|export|import|bootstrap|<id>]') +
      chalk.gray('Manage agents'),
  );
  console.log(
    chalk.cyan('    /channels [list|create|messages|<id>]') +
      chalk.gray('Manage conversation channels'),
  );
  console.log(
    chalk.cyan('    /convos [get|recent|search|count|export|replay|tag|<id>]') +
      chalk.gray('Inspect conversations'),
  );
  console.log(
    chalk.cyan('    /conversations [get|recent|search|count|export|replay|tag|<id>]') +
      chalk.gray('Alias for /convos'),
  );
  console.log(
    chalk.cyan('    /messages [list|get|search|count|create|annotate|delete|<id>]') +
      chalk.gray('Manage messages'),
  );
  console.log(
    chalk.cyan('    /responses [list|search|count|get|rate|<id>]') +
      chalk.gray('Inspect and rate responses'),
  );
  console.log(
    chalk.cyan('    /status                ') + chalk.gray('Show platform status summary'),
  );
  console.log(
    chalk.cyan('    /stats                 ') +
      chalk.gray('Show analytics summary (supports positional window: 7d/30d/90d)'),
  );
  console.log(
    chalk.cyan('    /analytics            ') +
      chalk.gray('Show analytics summaries (supports positional window: 7d/30d/90d)'),
  );
  console.log(
    chalk.cyan('    /snapshot [list|create|show]') + chalk.gray('Manage local snapshots'),
  );
  console.log(
    chalk.cyan('    /bulk [export|import] ') + chalk.gray('Bulk import/export workflows'),
  );
  console.log(
    chalk.cyan('    /pull [dir]           ') + chalk.gray('Pull remote config into a directory'),
  );
  console.log(
    chalk.cyan('    /push [source]        ') + chalk.gray('Push a local config file or directory'),
  );
  console.log(
    chalk.cyan('    /validate [source]    ') + chalk.gray('Validate local state-set payload'),
  );
  console.log(
    chalk.cyan('    /watch [dir]          ') + chalk.gray('Watch .stateset for changes and sync'),
  );
  console.log(
    chalk.cyan('    /webhooks [list|create|test|logs|delete]') +
      chalk.gray('Manage webhook subscriptions'),
  );
  console.log(
    chalk.cyan('    /alerts [list|get|create|delete]') + chalk.gray('Manage alert rules'),
  );
  console.log(chalk.cyan('    /monitor [status|live]') + chalk.gray('Watch live platform metrics'));
  console.log(
    chalk.cyan('    /test [message...] [--agent <agent-id>]') +
      chalk.gray('Run a non-persistent test message'),
  );
  console.log(chalk.cyan('    /diff                  ') + chalk.gray('Show config diff'));
  console.log(
    chalk.cyan('    /deploy                ') +
      chalk.gray('Push snapshot-backed changes (--schedule/--approve)'),
  );
  console.log(
    chalk.cyan('    /rollback              ') +
      chalk.gray('Rollback config changes (--schedule/--approve)'),
  );
  console.log(
    chalk.cyan('    /deployments           ') +
      chalk.gray('Inspect deployment history and scheduled jobs'),
  );
  console.log('');

  console.log(chalk.bold('  Exports'));
  console.log(
    chalk.cyan('    /export [session] [md|json|jsonl] [path] [--unsafe-path]') +
      chalk.gray('Export session to markdown/json/jsonl'),
  );
  console.log(
    chalk.cyan('    /export-list [session]') + chalk.gray('List export files for a session'),
  );
  console.log(
    chalk.cyan('    /export-show <file> [session] [head=40]') +
      chalk.gray('Preview an export file'),
  );
  console.log(
    chalk.cyan('    /export-open <file> [session]') + chalk.gray('Show export file path'),
  );
  console.log(
    chalk.cyan('    /export-delete <file> [session]') + chalk.gray('Delete an export file'),
  );
  console.log(
    chalk.cyan('    /export-prune [session] keep=5') + chalk.gray('Delete older exports'),
  );
  console.log('');

  console.log(chalk.bold('  Prompts & Skills'));
  console.log(chalk.cyan('    /prompts              ') + chalk.gray('List prompt templates'));
  console.log(
    chalk.cyan('    /prompt <name>        ') + chalk.gray('Fill and send a prompt template'),
  );
  console.log(
    chalk.cyan('    /prompt-history       ') + chalk.gray('Show recent prompt templates'),
  );
  console.log(
    chalk.cyan('    /prompt-validate [name|all]') + chalk.gray('Validate prompt templates'),
  );
  console.log(chalk.cyan('    /skills               ') + chalk.gray('List available skills'));
  console.log(
    chalk.cyan('    /skill <name>         ') + chalk.gray('Activate a skill for this session'),
  );
  console.log(chalk.cyan('    /skill-clear          ') + chalk.gray('Clear active skills'));
  console.log('');

  console.log(chalk.bold('  Extensions'));
  console.log(chalk.cyan('    /extensions           ') + chalk.gray('List loaded extensions'));
  console.log(chalk.cyan('    /reload               ') + chalk.gray('Reload extensions'));
  console.log('');

  console.log(chalk.cyan('    /exit /quit         ') + chalk.gray('End the session'));
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
