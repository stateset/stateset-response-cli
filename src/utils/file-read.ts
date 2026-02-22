import fs from 'node:fs';
import { getErrorMessage } from '../lib/errors.js';

export const MAX_JSON_FILE_SIZE_BYTES = 1_048_576;
export const MAX_TEXT_FILE_SIZE_BYTES = 1_048_576;

export interface SafeJsonReadOptions {
  label?: string;
  maxBytes?: number;
  expectObject?: boolean;
  expectArray?: boolean;
}

export interface SafeTextReadOptions {
  label?: string;
  maxBytes?: number;
  encoding?: BufferEncoding;
}

export function readTextFile(filePath: string, options: SafeTextReadOptions = {}): string {
  const label = normalizeLabel(filePath, options.label);
  const maxBytes = options.maxBytes ?? MAX_TEXT_FILE_SIZE_BYTES;
  const encoding = options.encoding ?? 'utf-8';

  let stats: fs.Stats | null = null;
  try {
    stats = fs.lstatSync(filePath);
  } catch (error) {
    const message = getErrorMessage(error);
    throw new Error(`Failed to read ${label}: ${message}`);
  }

  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error(`${label} is not a safe regular file.`);
  }
  if (stats.size > maxBytes) {
    throw new Error(`${label} is too large (${stats.size} bytes).`);
  }

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, encoding);
  } catch (error) {
    throw new Error(`Failed to read ${label}: ${getErrorMessage(error)}`);
  }

  if (Buffer.byteLength(raw, encoding) > maxBytes) {
    throw new Error(`${label} is too large.`);
  }

  return raw;
}

function normalizeLabel(filePath: string, label: string | undefined): string {
  return label ? `${label} (${filePath})` : filePath;
}

function getErrnoCode(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'code' in error) {
    return (error as NodeJS.ErrnoException).code;
  }
  return undefined;
}

export function readJsonFile(filePath: string, options: SafeJsonReadOptions = {}): unknown {
  const label = normalizeLabel(filePath, options.label);
  const maxBytes = options.maxBytes ?? MAX_JSON_FILE_SIZE_BYTES;

  let stats: fs.Stats | null = null;
  try {
    stats = fs.lstatSync(filePath);
  } catch (error) {
    const code = getErrnoCode(error);
    if (code && code !== 'ENOENT') {
      throw new Error(`Unable to access ${label}: ${getErrorMessage(error)}`);
    }
    stats = null;
  }

  if (stats) {
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new Error(`${label} is not a safe regular file.`);
    }
    if (stats.size > maxBytes) {
      throw new Error(`${label} is too large (${stats.size} bytes).`);
    }
  }

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch (error) {
    throw new Error(`Failed to read ${label}: ${getErrorMessage(error)}`);
  }

  if (Buffer.byteLength(raw, 'utf-8') > maxBytes) {
    throw new Error(`${label} is too large.`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON in ${label}: ${getErrorMessage(error)}`);
  }

  if (options.expectObject && (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))) {
    throw new Error(`Invalid structure in ${label}: expected JSON object.`);
  }
  if (options.expectArray && !Array.isArray(parsed)) {
    throw new Error(`Invalid structure in ${label}: expected JSON array.`);
  }

  return parsed;
}
