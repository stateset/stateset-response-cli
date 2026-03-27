/**
 * Output formatting abstraction supporting multiple output modes.
 *
 * Commands use this instead of direct console calls to support
 * --json, --pretty (default), and --minimal output modes.
 */

import chalk from 'chalk';

export type OutputMode = 'json' | 'pretty' | 'minimal';
type OutputDetails = Record<string, unknown>;

let globalMode: OutputMode = 'pretty';

export function setOutputMode(mode: OutputMode): void {
  globalMode = mode;
}

export function getOutputMode(): OutputMode {
  return globalMode;
}

export function isJsonMode(): boolean {
  return globalMode === 'json';
}

/**
 * Print structured data in the current output mode.
 *
 * - json: JSON.stringify to stdout (machine-readable)
 * - pretty: Formatted table/card output with colors
 * - minimal: Plain text, no colors, one item per line
 */
export function output(data: unknown, options?: { label?: string }): void {
  switch (globalMode) {
    case 'json':
      process.stdout.write(JSON.stringify(data, null, 2) + '\n');
      break;

    case 'minimal':
      if (Array.isArray(data)) {
        for (const item of data) {
          process.stdout.write(
            typeof item === 'string' ? item + '\n' : JSON.stringify(item) + '\n',
          );
        }
      } else if (typeof data === 'string') {
        process.stdout.write(data + '\n');
      } else {
        process.stdout.write(JSON.stringify(data) + '\n');
      }
      break;

    case 'pretty':
    default:
      if (options?.label) {
        console.log(chalk.bold(`  ${options.label}`));
      }
      if (typeof data === 'string') {
        console.log(`  ${data}`);
      } else if (Array.isArray(data)) {
        printArray(data);
      } else if (data && typeof data === 'object') {
        printObject(data as Record<string, unknown>);
      } else {
        console.log(`  ${String(data)}`);
      }
      break;
  }
}

/**
 * Print an array of items as a formatted table.
 */
function printArray(items: unknown[]): void {
  if (items.length === 0) {
    console.log(chalk.gray('  (empty)'));
    return;
  }

  // If items are simple strings/numbers, print as list
  if (items.every((item) => typeof item === 'string' || typeof item === 'number')) {
    for (const item of items) {
      console.log(`  ${item}`);
    }
    return;
  }

  // If items are objects, print as table
  const rows = items.filter(
    (item): item is Record<string, unknown> => item !== null && typeof item === 'object',
  );
  if (rows.length === 0) return;

  const allKeys = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      allKeys.add(key);
    }
  }

  // Pick display columns (skip very long values, limit to 6 columns)
  const cols = [...allKeys].slice(0, 6);
  const widths: Record<string, number> = {};
  for (const col of cols) {
    widths[col] = col.length;
    for (const row of rows) {
      const val = formatCellValue(row[col]);
      widths[col] = Math.max(widths[col], Math.min(val.length, 40));
    }
  }

  const header = cols.map((c) => c.toUpperCase().padEnd(widths[c])).join('  ');
  const separator = cols.map((c) => '─'.repeat(widths[c])).join('  ');
  console.log(`  ${chalk.bold(header)}`);
  console.log(`  ${chalk.gray(separator)}`);

  for (const row of rows) {
    const cells = cols.map((c) => {
      const val = formatCellValue(row[c]);
      return val.length > widths[c] ? val.slice(0, widths[c] - 1) + '…' : val.padEnd(widths[c]);
    });
    console.log(`  ${cells.join('  ')}`);
  }
}

/**
 * Print an object as key-value pairs.
 */
function printObject(obj: Record<string, unknown>): void {
  const maxKeyLen = Math.max(...Object.keys(obj).map((k) => k.length), 0);
  for (const [key, value] of Object.entries(obj)) {
    const displayValue = formatCellValue(value);
    console.log(`  ${chalk.gray(key.padEnd(maxKeyLen))}  ${displayValue}`);
  }
}

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return `[${value.length} items]`;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * Print a success message respecting output mode.
 */
export function outputSuccess(message: string, details?: OutputDetails): void {
  if (globalMode === 'json') {
    process.stdout.write(JSON.stringify({ ...(details ?? {}), status: 'ok', message }) + '\n');
  } else if (globalMode === 'minimal') {
    process.stdout.write(message + '\n');
  } else {
    console.log(chalk.green(`  ${message}`));
  }
}

/**
 * Print an error message respecting output mode.
 */
export function outputError(message: string, details?: Record<string, unknown>): void {
  if (globalMode === 'json') {
    process.stderr.write(JSON.stringify({ ...(details ?? {}), status: 'error', message }) + '\n');
  } else if (globalMode === 'minimal') {
    process.stderr.write(`Error: ${message}\n`);
  } else {
    console.error(chalk.red(`  Error: ${message}`));
  }
}

/**
 * Print a warning respecting output mode.
 */
export function outputWarn(message: string, details?: OutputDetails): void {
  if (globalMode === 'json') {
    process.stderr.write(JSON.stringify({ ...(details ?? {}), status: 'warning', message }) + '\n');
  } else if (globalMode === 'minimal') {
    process.stdout.write(message + '\n');
  } else {
    console.log(chalk.yellow(`  ${message}`));
  }
}
