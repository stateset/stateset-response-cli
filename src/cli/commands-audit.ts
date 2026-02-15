import chalk from 'chalk';
import inquirer from 'inquirer';
import fs from 'node:fs';
import { sanitizeSessionId } from '../session.js';
import { formatError, formatSuccess, formatWarning, formatTable } from '../utils/display.js';
import type { ChatContext, CommandResult } from './types.js';
import { parseToggleValue } from './utils.js';
import { readToolAudit, getToolAuditPath } from './audit.js';

export async function handleAuditCommand(
  input: string,
  ctx: ChatContext,
): Promise<CommandResult | null> {
  // /audit — toggle or show audit status
  if (
    input.startsWith('/audit') &&
    !input.startsWith('/audit-show') &&
    !input.startsWith('/audit-clear')
  ) {
    const args = input.split(/\s+/).slice(1);
    const mode = args[0];
    if (!mode) {
      console.log(formatSuccess(`Tool audit: ${ctx.auditEnabled ? 'enabled' : 'disabled'}`));
      console.log(chalk.gray(`  Path: ${getToolAuditPath(ctx.sessionId)}`));
      console.log(chalk.gray(`  Excerpts: ${ctx.auditIncludeExcerpt ? 'enabled' : 'disabled'}`));
      console.log(chalk.gray('  Usage: /audit on|off [detail]'));
      console.log('');
      ctx.rl.prompt();
      return { handled: true };
    }

    const toggle = parseToggleValue(mode);
    if (toggle === undefined) {
      console.log(formatWarning('Usage: /audit on|off [detail]'));
      console.log('');
      ctx.rl.prompt();
      return { handled: true };
    }

    ctx.auditEnabled = toggle;
    process.env.STATESET_TOOL_AUDIT = toggle ? 'true' : 'false';
    if (args[1]) {
      const detailToggle = parseToggleValue(args[1]);
      if (detailToggle !== undefined) {
        ctx.auditIncludeExcerpt = detailToggle;
        process.env.STATESET_TOOL_AUDIT_DETAIL = detailToggle ? 'true' : 'false';
      }
    }
    console.log(formatSuccess(`Tool audit ${ctx.auditEnabled ? 'enabled' : 'disabled'}.`));
    console.log(chalk.gray(`  Excerpts: ${ctx.auditIncludeExcerpt ? 'enabled' : 'disabled'}`));
    console.log('');
    ctx.rl.prompt();
    return { handled: true };
  }

  // /audit-show — show audit log entries
  if (input.startsWith('/audit-show')) {
    const tokens = input.split(/\s+/).slice(1);
    let targetSession = ctx.sessionId;
    let toolFilter: string | null = null;
    let errorsOnly = false;
    let limit = 20;

    for (const token of tokens) {
      if (!token) continue;
      if (token === 'errors' || token === 'error') {
        errorsOnly = true;
        continue;
      }
      if (token.startsWith('tool=')) {
        toolFilter = token.slice('tool='.length).trim() || null;
        continue;
      }
      if (token.startsWith('limit=')) {
        const val = Number(token.slice('limit='.length));
        if (Number.isFinite(val) && val > 0) {
          limit = Math.min(100, Math.floor(val));
        }
        continue;
      }
      if (!token.includes('=')) {
        targetSession = sanitizeSessionId(token);
      }
    }

    const entries = readToolAudit(targetSession);
    if (entries.length === 0) {
      console.log(formatSuccess('No audit entries found.'));
      console.log('');
      ctx.rl.prompt();
      return { handled: true };
    }

    let filtered = entries;
    if (toolFilter) {
      const lower = toolFilter.toLowerCase();
      filtered = filtered.filter((entry) => entry.name.toLowerCase().includes(lower));
    }
    if (errorsOnly) {
      filtered = filtered.filter((entry) => entry.isError);
    }

    const display = filtered.slice(-limit).reverse();
    if (display.length === 0) {
      console.log(formatSuccess('No matching audit entries.'));
      console.log('');
      ctx.rl.prompt();
      return { handled: true };
    }

    console.log(formatSuccess(`Audit entries (${display.length}) for "${targetSession}":`));
    const rows = display.map((entry) => ({
      time: entry.ts ? new Date(entry.ts).toLocaleString() : '',
      type: entry.type,
      tool: entry.name,
      status: entry.isError ? 'error' : 'ok',
      duration: entry.durationMs ? `${entry.durationMs}ms` : '',
    }));
    console.log(formatTable(rows, ['time', 'type', 'tool', 'status', 'duration']));
    console.log('');
    ctx.rl.prompt();
    return { handled: true };
  }

  // /audit-clear — clear audit log
  if (input.startsWith('/audit-clear')) {
    const target = sanitizeSessionId(input.slice('/audit-clear'.length).trim() || ctx.sessionId);
    const auditPath = getToolAuditPath(target);
    if (!fs.existsSync(auditPath)) {
      console.log(formatSuccess('No audit log found.'));
      console.log('');
      ctx.rl.prompt();
      return { handled: true };
    }
    ctx.rl.pause();
    const { confirmClear } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmClear',
        message: `Clear audit log for "${target}"?`,
        default: false,
      },
    ]);
    ctx.rl.resume();
    if (!confirmClear) {
      console.log(formatWarning('Audit clear cancelled.'));
      console.log('');
      ctx.rl.prompt();
      return { handled: true };
    }
    try {
      fs.writeFileSync(auditPath, '', 'utf-8');
      console.log(formatSuccess(`Cleared audit log for "${target}".`));
    } catch (err) {
      console.error(formatError(err instanceof Error ? err.message : String(err)));
    }
    console.log('');
    ctx.rl.prompt();
    return { handled: true };
  }

  return null;
}
