import chalk from 'chalk';
import inquirer from 'inquirer';
import fs from 'node:fs';
import path from 'node:path';
import { sanitizeSessionId, getStateSetDir } from '../session.js';
import { getSessionExportPath, resolveExportFilePath } from '../utils/session-exports.js';
import { formatTable } from '../utils/display.js';
import { getErrorMessage } from '../lib/errors.js';
import {
  getOutputMode,
  isJsonMode,
  output,
  outputError,
  outputSuccess,
  outputWarn,
} from '../lib/output.js';
import { readTextFile, MAX_TEXT_FILE_SIZE_BYTES } from '../utils/file-read.js';
import type { ChatContext } from './types.js';
import {
  formatTimestamp,
  hasCommand,
  resolveSafeOutputPath,
  writePrivateTextFile,
} from './utils.js';
import {
  readSessionEntries,
  exportSessionToMarkdown,
  exportSessionToHtml,
  listExportFiles,
  deleteExportFile,
} from './session-meta.js';

const MAX_EXPORT_PREVIEW_BYTES = MAX_TEXT_FILE_SIZE_BYTES;

function readExportPreview(filePath: string): string | null {
  try {
    return readTextFile(filePath, { label: 'export file', maxBytes: MAX_EXPORT_PREVIEW_BYTES });
  } catch {
    return null;
  }
}

function printSpacer(): void {
  if (getOutputMode() === 'pretty') {
    console.log('');
  }
}

function finishHandled(ctx: ChatContext): boolean {
  printSpacer();
  ctx.rl.prompt();
  return true;
}

function outputJson(value: Record<string, unknown>): void {
  output(value);
}

async function promptWithReadlinePaused<T extends Record<string, unknown>>(
  ctx: ChatContext,
  questions: Parameters<typeof inquirer.prompt>[0],
): Promise<T> {
  ctx.rl.pause();
  try {
    return (await inquirer.prompt(questions)) as T;
  } finally {
    ctx.rl.resume();
  }
}

export async function handleExportCommand(input: string, ctx: ChatContext): Promise<boolean> {
  // /export-list — list export files for a session
  if (hasCommand(input, '/export-list')) {
    const target = sanitizeSessionId(input.slice('/export-list'.length).trim() || ctx.sessionId);
    const files = listExportFiles(target);
    const rows = files.map((file) => ({
      name: file.name,
      updatedAtMs: file.updatedAtMs,
      updated: formatTimestamp(file.updatedAtMs),
      sizeBytes: file.size,
      size: `${Math.round(file.size / 1024)}kb`,
    }));
    const displayRows = rows.map((row) => ({
      name: row.name,
      updated: row.updated,
      size: row.size,
    }));

    if (isJsonMode()) {
      outputJson({
        command: 'export-list',
        session: target,
        directory: getSessionExportPath(target),
        exports: rows,
      });
    } else if (files.length === 0) {
      outputSuccess('No exports found.');
    } else {
      outputSuccess(`Exports for "${target}":`);
      console.log(formatTable(displayRows, ['name', 'updated', 'size']));
      console.log(chalk.gray(`  Directory: ${getSessionExportPath(target)}`));
    }
    return finishHandled(ctx);
  }

  // /export-show — show contents of an export file
  if (hasCommand(input, '/export-show')) {
    const usage = '/export-show <filename> [session] [head=40]';
    const tokens = input.split(/\s+/).slice(1);
    if (tokens.length === 0) {
      outputWarn(`Usage: ${usage}`, { command: 'export-show', usage });
      return finishHandled(ctx);
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
      outputWarn(err instanceof Error ? err.message : 'Invalid export filename.', {
        command: 'export-show',
        session: target,
        file: filename,
      });
      return finishHandled(ctx);
    }
    if (!fs.existsSync(filePath)) {
      outputWarn(`Export "${filename}" not found for session "${target}".`, {
        command: 'export-show',
        session: target,
        file: filename,
      });
      return finishHandled(ctx);
    }
    try {
      const content = readExportPreview(filePath);
      if (!content) {
        outputWarn(`Export "${filename}" is unavailable or exceeds safe size.`, {
          command: 'export-show',
          session: target,
          file: filename,
          path: filePath,
        });
        return finishHandled(ctx);
      }
      const allLines = content.split(/\n/);
      const lines = allLines.slice(0, head);
      if (isJsonMode()) {
        outputJson({
          command: 'export-show',
          session: target,
          file: filename,
          path: filePath,
          lineCount: lines.length,
          truncated: allLines.length > lines.length,
          preview: lines,
        });
      } else {
        outputSuccess(`Showing ${lines.length} lines from ${filename}:`);
        console.log(chalk.gray(lines.join('\n')));
      }
    } catch (err) {
      outputError(getErrorMessage(err), {
        command: 'export-show',
        session: target,
        file: filename,
      });
    }
    return finishHandled(ctx);
  }

  // /export-open — show the path of an export file
  if (hasCommand(input, '/export-open')) {
    const usage = '/export-open <filename> [session]';
    const tokens = input.split(/\s+/).slice(1);
    if (tokens.length === 0) {
      outputWarn(`Usage: ${usage}`, { command: 'export-open', usage });
      return finishHandled(ctx);
    }
    const filename = tokens[0];
    const target = sanitizeSessionId(tokens[1] || ctx.sessionId);
    let filePath: string;
    try {
      filePath = resolveExportFilePath(target, filename);
    } catch (err) {
      outputWarn(err instanceof Error ? err.message : 'Invalid export filename.', {
        command: 'export-open',
        session: target,
        file: filename,
      });
      return finishHandled(ctx);
    }
    if (!fs.existsSync(filePath)) {
      outputWarn(`Export "${filename}" not found for session "${target}".`, {
        command: 'export-open',
        session: target,
        file: filename,
      });
      return finishHandled(ctx);
    }
    if (isJsonMode()) {
      outputJson({
        command: 'export-open',
        session: target,
        file: filename,
        path: filePath,
      });
    } else {
      outputSuccess(`Export path: ${filePath}`);
    }
    return finishHandled(ctx);
  }

  // /export-delete — delete an export file
  if (hasCommand(input, '/export-delete')) {
    const usage = '/export-delete <filename> [session]';
    const tokens = input.split(/\s+/).slice(1);
    if (tokens.length === 0) {
      outputWarn(`Usage: ${usage}`, { command: 'export-delete', usage });
      return finishHandled(ctx);
    }
    const filename = tokens[0];
    const target = sanitizeSessionId(tokens[1] || ctx.sessionId);
    let filePath: string;
    try {
      filePath = resolveExportFilePath(target, filename);
    } catch (err) {
      outputWarn(err instanceof Error ? err.message : 'Invalid export filename.', {
        command: 'export-delete',
        session: target,
        file: filename,
      });
      return finishHandled(ctx);
    }
    if (!fs.existsSync(filePath)) {
      outputWarn(`Export "${filename}" not found for session "${target}".`, {
        command: 'export-delete',
        session: target,
        file: filename,
      });
      return finishHandled(ctx);
    }
    const { confirmDelete } = await promptWithReadlinePaused<{ confirmDelete?: boolean }>(ctx, [
      {
        type: 'confirm',
        name: 'confirmDelete',
        message: `Delete export "${filename}"?`,
        default: false,
      },
    ]);
    if (!confirmDelete) {
      outputWarn('Export delete cancelled.', {
        command: 'export-delete',
        session: target,
        file: filename,
        cancelled: true,
      });
      return finishHandled(ctx);
    }
    try {
      deleteExportFile(target, filename);
      if (isJsonMode()) {
        outputJson({
          command: 'export-delete',
          session: target,
          file: filename,
          path: filePath,
          deleted: true,
        });
      } else {
        outputSuccess(`Deleted export "${filename}".`);
      }
    } catch (err) {
      outputError(getErrorMessage(err), {
        command: 'export-delete',
        session: target,
        file: filename,
      });
    }
    return finishHandled(ctx);
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
      if (isJsonMode()) {
        outputJson({
          command: 'export-prune',
          session: target,
          keep,
          deleted: 0,
          remaining: files.length,
        });
      } else {
        outputSuccess(`No exports to prune (keep=${keep}).`);
      }
      return finishHandled(ctx);
    }

    const toDelete = files.slice(keep);
    const { confirmPrune } = await promptWithReadlinePaused<{ confirmPrune?: boolean }>(ctx, [
      {
        type: 'confirm',
        name: 'confirmPrune',
        message: `Delete ${toDelete.length} export(s) for "${target}"?`,
        default: false,
      },
    ]);
    if (!confirmPrune) {
      outputWarn('Export prune cancelled.', {
        command: 'export-prune',
        session: target,
        keep,
        cancelled: true,
      });
      return finishHandled(ctx);
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
    if (isJsonMode()) {
      outputJson({
        command: 'export-prune',
        session: target,
        keep,
        deleted,
      });
    } else {
      outputSuccess(`Deleted ${deleted} export(s).`);
    }
    return finishHandled(ctx);
  }

  // /export — export session messages
  if (hasCommand(input, '/export')) {
    const rawTokens = input.split(/\s+/).slice(1);
    const tokens = rawTokens.filter((token) => !token.startsWith('--'));
    const allowUnsafePath = rawTokens.includes('--unsafe-path');
    const formats = new Set(['md', 'json', 'jsonl', 'html']);
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
      outputWarn(`No messages found for session "${targetSession}".`, {
        command: 'export',
        session: targetSession,
        format,
      });
      return finishHandled(ctx);
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '').replace('Z', '');
    const defaultExt = format === 'jsonl' ? 'jsonl' : format;
    const defaultName = `session-${targetSession}-${timestamp}.${defaultExt}`;
    const defaultDir = getSessionExportPath(targetSession);
    const resolvedPath = outPath ? path.resolve(outPath) : path.join(defaultDir, defaultName);

    try {
      const finalOutputPath = outPath
        ? resolveSafeOutputPath(outPath, {
            label: 'Export output',
            allowOutside: allowUnsafePath,
            allowedRoots: [defaultDir, ctx.cwd, getStateSetDir()],
          })
        : resolveSafeOutputPath(resolvedPath, {
            label: 'Export output',
            allowOutside: true,
          });
      if (format === 'jsonl') {
        const lines = entries.map((entry) => JSON.stringify(entry));
        writePrivateTextFile(finalOutputPath, lines.join('\n') + '\n', {
          label: 'Export output',
        });
      } else if (format === 'json') {
        writePrivateTextFile(finalOutputPath, JSON.stringify(entries, null, 2), {
          label: 'Export output',
        });
      } else if (format === 'html') {
        const html = exportSessionToHtml(targetSession, entries);
        writePrivateTextFile(finalOutputPath, html, { label: 'Export output' });
      } else {
        const markdown = exportSessionToMarkdown(targetSession, entries);
        writePrivateTextFile(finalOutputPath, markdown, { label: 'Export output' });
      }
      if (isJsonMode()) {
        outputJson({
          command: 'export',
          session: targetSession,
          format,
          outputPath: finalOutputPath,
          messagesExported: entries.length,
        });
      } else {
        outputSuccess(`Exported ${entries.length} messages to ${finalOutputPath}`);
      }
    } catch (err) {
      outputError(getErrorMessage(err), {
        command: 'export',
        session: targetSession,
        format,
        requestedPath: outPath,
      });
    }

    return finishHandled(ctx);
  }

  return false;
}
