import chalk from 'chalk';
import inquirer from 'inquirer';
import fs from 'node:fs';
import path from 'node:path';
import { sanitizeSessionId, getStateSetDir } from '../session.js';
import { getSessionExportPath, resolveExportFilePath } from '../utils/session-exports.js';
import { formatSuccess, formatWarning, formatError, formatTable } from '../utils/display.js';
import type { ChatContext } from './types.js';
import { formatTimestamp, ensureDirExists, hasCommand, resolveSafeOutputPath } from './utils.js';
import {
  readSessionEntries,
  exportSessionToMarkdown,
  listExportFiles,
  deleteExportFile,
} from './session-meta.js';

export async function handleExportCommand(input: string, ctx: ChatContext): Promise<boolean> {
  // /export-list — list export files for a session
  if (hasCommand(input, '/export-list')) {
    const target = sanitizeSessionId(input.slice('/export-list'.length).trim() || ctx.sessionId);
    const files = listExportFiles(target);
    if (files.length === 0) {
      console.log(formatSuccess('No exports found.'));
    } else {
      console.log(formatSuccess(`Exports for "${target}":`));
      const rows = files.map((file) => ({
        name: file.name,
        updated: formatTimestamp(file.updatedAtMs),
        size: `${Math.round(file.size / 1024)}kb`,
      }));
      console.log(formatTable(rows, ['name', 'updated', 'size']));
      console.log(chalk.gray(`  Directory: ${getSessionExportPath(target)}`));
    }
    console.log('');
    ctx.rl.prompt();
    return true;
  }

  // /export-show — show contents of an export file
  if (hasCommand(input, '/export-show')) {
    const tokens = input.split(/\s+/).slice(1);
    if (tokens.length === 0) {
      console.log(formatWarning('Usage: /export-show <filename> [session] [head=40]'));
      console.log('');
      ctx.rl.prompt();
      return true;
    }
    const filename = tokens[0];
    const sessionArg = tokens[1];
    let head = 40;
    for (const token of tokens.slice(2)) {
      if (token.startsWith('head=')) {
        const val = Number(token.slice('head='.length));
        if (Number.isFinite(val) && val > 0) {
          head = Math.min(200, Math.floor(val));
        }
      }
    }
    const target = sanitizeSessionId(sessionArg || ctx.sessionId);
    let filePath: string;
    try {
      filePath = resolveExportFilePath(target, filename);
    } catch (err) {
      console.log(formatWarning(err instanceof Error ? err.message : 'Invalid export filename.'));
      console.log('');
      ctx.rl.prompt();
      return true;
    }
    if (!fs.existsSync(filePath)) {
      console.log(formatWarning(`Export "${filename}" not found for session "${target}".`));
      console.log('');
      ctx.rl.prompt();
      return true;
    }
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split(/\n/).slice(0, head);
      console.log(formatSuccess(`Showing ${lines.length} lines from ${filename}:`));
      console.log(chalk.gray(lines.join('\n')));
    } catch (err) {
      console.error(formatError(err instanceof Error ? err.message : String(err)));
    }
    console.log('');
    ctx.rl.prompt();
    return true;
  }

  // /export-open — show the path of an export file
  if (hasCommand(input, '/export-open')) {
    const tokens = input.split(/\s+/).slice(1);
    if (tokens.length === 0) {
      console.log(formatWarning('Usage: /export-open <filename> [session]'));
      console.log('');
      ctx.rl.prompt();
      return true;
    }
    const filename = tokens[0];
    const target = sanitizeSessionId(tokens[1] || ctx.sessionId);
    let filePath: string;
    try {
      filePath = resolveExportFilePath(target, filename);
    } catch (err) {
      console.log(formatWarning(err instanceof Error ? err.message : 'Invalid export filename.'));
      console.log('');
      ctx.rl.prompt();
      return true;
    }
    if (!fs.existsSync(filePath)) {
      console.log(formatWarning(`Export "${filename}" not found for session "${target}".`));
      console.log('');
      ctx.rl.prompt();
      return true;
    }
    console.log(formatSuccess(`Export path: ${filePath}`));
    console.log('');
    ctx.rl.prompt();
    return true;
  }

  // /export-delete — delete an export file
  if (hasCommand(input, '/export-delete')) {
    const tokens = input.split(/\s+/).slice(1);
    if (tokens.length === 0) {
      console.log(formatWarning('Usage: /export-delete <filename> [session]'));
      console.log('');
      ctx.rl.prompt();
      return true;
    }
    const filename = tokens[0];
    const target = sanitizeSessionId(tokens[1] || ctx.sessionId);
    let filePath: string;
    try {
      filePath = resolveExportFilePath(target, filename);
    } catch (err) {
      console.log(formatWarning(err instanceof Error ? err.message : 'Invalid export filename.'));
      console.log('');
      ctx.rl.prompt();
      return true;
    }
    if (!fs.existsSync(filePath)) {
      console.log(formatWarning(`Export "${filename}" not found for session "${target}".`));
      console.log('');
      ctx.rl.prompt();
      return true;
    }
    ctx.rl.pause();
    const { confirmDelete } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmDelete',
        message: `Delete export "${filename}"?`,
        default: false,
      },
    ]);
    ctx.rl.resume();
    if (!confirmDelete) {
      console.log(formatWarning('Export delete cancelled.'));
      console.log('');
      ctx.rl.prompt();
      return true;
    }
    try {
      deleteExportFile(target, filename);
      console.log(formatSuccess(`Deleted export "${filename}".`));
    } catch (err) {
      console.error(formatError(err instanceof Error ? err.message : String(err)));
    }
    console.log('');
    ctx.rl.prompt();
    return true;
  }

  // /export-prune — prune old export files
  if (hasCommand(input, '/export-prune')) {
    const tokens = input.split(/\s+/).slice(1);
    let target = ctx.sessionId;
    let keep = 5;
    for (const token of tokens) {
      if (!token) continue;
      if (token.startsWith('keep=')) {
        const val = Number(token.slice('keep='.length));
        if (Number.isFinite(val) && val >= 0) {
          keep = Math.min(50, Math.floor(val));
        }
        continue;
      }
      if (!token.includes('=')) {
        target = sanitizeSessionId(token);
      }
    }

    const files = listExportFiles(target);
    if (files.length <= keep) {
      console.log(formatSuccess(`No exports to prune (keep=${keep}).`));
      console.log('');
      ctx.rl.prompt();
      return true;
    }

    const toDelete = files.slice(keep);
    ctx.rl.pause();
    const { confirmPrune } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmPrune',
        message: `Delete ${toDelete.length} export(s) for "${target}"?`,
        default: false,
      },
    ]);
    ctx.rl.resume();
    if (!confirmPrune) {
      console.log(formatWarning('Export prune cancelled.'));
      console.log('');
      ctx.rl.prompt();
      return true;
    }

    let deleted = 0;
    for (const file of toDelete) {
      try {
        if (deleteExportFile(target, file.name)) {
          deleted++;
        }
      } catch {
        // ignore
      }
    }
    console.log(formatSuccess(`Deleted ${deleted} export(s).`));
    console.log('');
    ctx.rl.prompt();
    return true;
  }

  // /export — export session messages
  if (hasCommand(input, '/export')) {
    const rawTokens = input.split(/\s+/).slice(1);
    const tokens = rawTokens.filter((token) => !token.startsWith('--'));
    const allowUnsafePath = rawTokens.includes('--unsafe-path');
    const formats = new Set(['md', 'json', 'jsonl']);
    let targetSession = ctx.sessionId;
    let format = 'md';
    let outPath: string | undefined;

    if (tokens.length > 0) {
      const first = tokens[0].toLowerCase();
      if (formats.has(first)) {
        format = first;
        outPath = tokens[1];
      } else {
        targetSession = sanitizeSessionId(tokens[0]);
        if (tokens[1] && formats.has(tokens[1].toLowerCase())) {
          format = tokens[1].toLowerCase();
          outPath = tokens[2];
        } else {
          outPath = tokens[1];
        }
      }
    }

    const entries = readSessionEntries(targetSession);
    if (entries.length === 0) {
      console.log(formatWarning(`No messages found for session "${targetSession}".`));
      console.log('');
      ctx.rl.prompt();
      return true;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '').replace('Z', '');
    const defaultExt = format === 'jsonl' ? 'jsonl' : format;
    const defaultName = `session-${targetSession}-${timestamp}.${defaultExt}`;
    const defaultDir = getSessionExportPath(targetSession);
    const resolvedPath = outPath ? path.resolve(outPath) : path.join(defaultDir, defaultName);
    const finalOutputPath = outPath
      ? resolveSafeOutputPath(outPath, {
          label: 'Export output',
          allowOutside: allowUnsafePath,
          allowedRoots: [defaultDir, ctx.cwd, getStateSetDir()],
        })
      : resolvedPath;

    try {
      ensureDirExists(finalOutputPath);
      if (format === 'jsonl') {
        const lines = entries.map((entry) => JSON.stringify(entry));
        fs.writeFileSync(finalOutputPath, lines.join('\n') + '\n', 'utf-8');
      } else if (format === 'json') {
        fs.writeFileSync(finalOutputPath, JSON.stringify(entries, null, 2), 'utf-8');
      } else {
        const markdown = exportSessionToMarkdown(targetSession, entries);
        fs.writeFileSync(finalOutputPath, markdown, 'utf-8');
      }
      console.log(formatSuccess(`Exported ${entries.length} messages to ${finalOutputPath}`));
    } catch (err) {
      console.error(formatError(err instanceof Error ? err.message : String(err)));
    }

    console.log('');
    ctx.rl.prompt();
    return true;
  }

  return false;
}
