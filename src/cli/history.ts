import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const HISTORY_DIR = path.join(os.homedir(), '.stateset');
const HISTORY_FILE = path.join(HISTORY_DIR, 'input-history');
const MAX_HISTORY_LINES = 500;

/**
 * Load input history from ~/.stateset/input-history.
 * Returns the most recent entries (one per line), newest last.
 */
export function loadInputHistory(): string[] {
  try {
    if (!fs.existsSync(HISTORY_FILE)) return [];
    const content = fs.readFileSync(HISTORY_FILE, 'utf-8');
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
    if (!fs.existsSync(HISTORY_DIR)) {
      fs.mkdirSync(HISTORY_DIR, { recursive: true });
    }
    fs.appendFileSync(HISTORY_FILE, trimmed + '\n', 'utf-8');
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
    if (!fs.existsSync(HISTORY_FILE)) return;
    const content = fs.readFileSync(HISTORY_FILE, 'utf-8');
    const lines = content.split('\n').filter(Boolean);
    if (lines.length <= MAX_HISTORY_LINES) return;
    const trimmed = lines.slice(-MAX_HISTORY_LINES);
    fs.writeFileSync(HISTORY_FILE, trimmed.join('\n') + '\n', 'utf-8');
  } catch {
    // Best-effort
  }
}

/** Returns the path to the history file (for testing). */
export function getHistoryFilePath(): string {
  return HISTORY_FILE;
}
