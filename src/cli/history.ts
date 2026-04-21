import fs from 'node:fs';
import path from 'node:path';
import { writePrivateTextFile } from './utils.js';
import { appendLineSecure, ensurePrivateDirectory } from '../utils/secure-file.js';
import { readTextFile } from '../utils/file-read.js';
import { getStateSetDir } from '../session.js';

const MAX_HISTORY_LINES = 500;

function getHistoryDirPath(): string {
  return getStateSetDir();
}

function resolveHistoryFilePath(): string {
  return path.join(getHistoryDirPath(), 'input-history');
}

/**
 * Load input history from the active CLI state directory.
 * Returns the most recent entries (one per line), newest last.
 */
export function loadInputHistory(): string[] {
  try {
    const historyFile = resolveHistoryFilePath();
    if (!fs.existsSync(historyFile)) return [];
    const content = readTextFile(historyFile, {
      label: 'input history',
    });
    const lines = content.split('\n').filter(Boolean);
    return lines.slice(-MAX_HISTORY_LINES);
  } catch {
    return [];
  }
}

/**
 * Append a single line to the input history file.
 * Skips empty lines and exit/quit commands.
 */
export function appendHistoryLine(line: string): void {
  const trimmed = line.trim();
  if (!trimmed) return;
  if (trimmed === '/exit' || trimmed === '/quit' || trimmed === 'exit' || trimmed === 'quit') {
    return;
  }

  try {
    const historyDir = getHistoryDirPath();
    const historyFile = resolveHistoryFilePath();
    ensurePrivateDirectory(historyDir, {
      symlinkErrorPrefix: 'Refusing to use symlinked history directory',
      nonDirectoryErrorPrefix: 'History directory path is not a directory',
    });
    appendLineSecure(historyFile, trimmed + '\n', {
      symlinkErrorPrefix: 'Refusing to append to symlinked history file',
      nonRegularFileErrorPrefix: 'Refusing to append history to non-regular file',
    });
  } catch {
    // Best-effort — don't break the CLI if history can't be written
  }
}

/**
 * Trim the history file to MAX_HISTORY_LINES.
 * Called periodically to prevent unbounded growth.
 */
export function trimHistoryFile(): void {
  try {
    const historyFile = resolveHistoryFilePath();
    if (!fs.existsSync(historyFile)) return;
    const content = readTextFile(historyFile, {
      label: 'input history',
    });
    const lines = content.split('\n').filter(Boolean);
    if (lines.length <= MAX_HISTORY_LINES) return;
    const trimmed = lines.slice(-MAX_HISTORY_LINES);
    writePrivateTextFile(historyFile, trimmed.join('\n') + '\n', {
      label: 'Input history path',
      atomic: true,
    });
  } catch {
    // Best-effort
  }
}

/** Returns the path to the history file (for testing). */
export function getHistoryFilePath(): string {
  return resolveHistoryFilePath();
}
