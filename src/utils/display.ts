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

export function formatUsage(usage: {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number | null;
  cache_creation_input_tokens: number | null;
}): string {
  const parts = [
    `in ${usage.input_tokens}`,
    `out ${usage.output_tokens}`,
  ];
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
  console.log(chalk.gray('    /apply    - Toggle write operations'));
  console.log(chalk.gray('    /redact   - Toggle redaction'));
  console.log(chalk.gray('    /usage    - Toggle usage summaries'));
  console.log(chalk.gray('    /audit    - Toggle tool audit logging'));
  console.log(chalk.gray('    /audit-show  - Show recent audit entries'));
  console.log(chalk.gray('    /audit-clear - Clear audit log'));
  console.log(chalk.gray('    /permissions - Show or clear stored permissions'));
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
  console.log(chalk.cyan('    /apply on|off    ') + chalk.gray('Enable or disable write operations'));
  console.log(chalk.cyan('    /redact on|off   ') + chalk.gray('Enable or disable redaction'));
  console.log(chalk.cyan('    /usage on|off    ') + chalk.gray('Enable or disable usage summaries'));
  console.log(chalk.cyan('    /audit on|off    ') + chalk.gray('Enable or disable tool audit logging'));
  console.log(chalk.cyan('    /audit-show [args]') + chalk.gray('Show recent audit entries'));
  console.log(chalk.cyan('    /audit-clear [id]') + chalk.gray('Clear audit log for a session'));
  console.log(chalk.cyan('    /permissions    ') + chalk.gray('List or clear stored permissions'));
  console.log(chalk.cyan('    /session-meta [id]') + chalk.gray('Show or export session metadata'));
  console.log(chalk.cyan('    /policy [cmd]    ') + chalk.gray('Manage policy overrides'));
  console.log(chalk.cyan('      list [local|global|merged]') + chalk.gray('List policy overrides'));
  console.log(chalk.cyan('      set <hook> <allow|deny>') + chalk.gray('Set a policy override'));
  console.log(chalk.cyan('      unset <hook>   ') + chalk.gray('Remove a policy override'));
  console.log(chalk.cyan('      edit          ') + chalk.gray('Show policy file path'));
  console.log(chalk.cyan('      init          ') + chalk.gray('Create a starter policy file'));
  console.log(chalk.cyan('      export [out=path]') + chalk.gray('Export policy overrides'));
  console.log(chalk.cyan('      import <path> [merge|replace]') + chalk.gray('Import policy overrides'));
  console.log(chalk.cyan('    /export [args]   ') + chalk.gray('Export session to markdown/json/jsonl'));
  console.log(chalk.cyan('    /export-list [id]') + chalk.gray('List export files for a session'));
  console.log(chalk.cyan('    /export-show <file>') + chalk.gray('Preview an export file'));
  console.log(chalk.cyan('    /export-open <file>') + chalk.gray('Show export file path'));
  console.log(chalk.cyan('    /export-delete <file>') + chalk.gray('Delete an export file'));
  console.log(chalk.cyan('    /export-prune [id]') + chalk.gray('Delete older exports (keep=5 default)'));
  console.log(chalk.cyan('    /rename <name>   ') + chalk.gray('Rename the current session'));
  console.log(chalk.cyan('    /delete [name]   ') + chalk.gray('Delete a session'));
  console.log(chalk.cyan('    /extensions      ') + chalk.gray('List loaded extensions'));
  console.log(chalk.cyan('    /reload          ') + chalk.gray('Reload extensions'));
  console.log(chalk.cyan('    /session         ') + chalk.gray('Show current session info'));
  console.log(chalk.cyan('    /sessions        ') + chalk.gray('List available sessions'));
  console.log(chalk.cyan('    /new [name]      ') + chalk.gray('Start a new session'));
  console.log(chalk.cyan('    /resume          ') + chalk.gray('Resume a saved session'));
  console.log(chalk.cyan('    /archive [name]  ') + chalk.gray('Archive a session'));
  console.log(chalk.cyan('    /unarchive [name]') + chalk.gray('Unarchive a session'));
  console.log(chalk.cyan('    /tag <action>    ') + chalk.gray('Manage session tags'));
  console.log(chalk.cyan('    /search <text>   ') + chalk.gray('Search session transcripts'));
  console.log(chalk.cyan('    /skills          ') + chalk.gray('List available skills'));
  console.log(chalk.cyan('    /skill <name>    ') + chalk.gray('Activate a skill for this session'));
  console.log(chalk.cyan('    /skill-clear     ') + chalk.gray('Clear active skills'));
  console.log(chalk.cyan('    /prompts         ') + chalk.gray('List prompt templates'));
  console.log(chalk.cyan('    /prompt <name>   ') + chalk.gray('Fill and send a prompt template'));
  console.log(chalk.cyan('    /prompt-history  ') + chalk.gray('Show recent prompt templates'));
  console.log(chalk.cyan('    /prompt-validate ') + chalk.gray('Validate prompt templates'));
  console.log(chalk.cyan('    /attach <path>   ') + chalk.gray('Attach a file or image to the next message'));
  console.log(chalk.cyan('    /attachments     ') + chalk.gray('List staged attachments'));
  console.log(chalk.cyan('    /attach-clear    ') + chalk.gray('Clear staged attachments'));
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
