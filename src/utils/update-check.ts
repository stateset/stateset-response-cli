import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import https from 'node:https';
import chalk from 'chalk';
import { ensurePrivateDirectory, writePrivateTextFileSecure } from './secure-file.js';

const CACHE_DIR = path.join(os.homedir(), '.stateset');
const CACHE_FILE = path.join(CACHE_DIR, '.update-check.json');
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const CACHE_MAX_BYTES = 4096;
const FETCH_TIMEOUT_MS = 3000;
const REGISTRY_URL = 'https://registry.npmjs.org/stateset-response-cli/latest';

interface CachedResult {
  latestVersion: string;
  checkedAt: number;
}

export interface UpdateStatus {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  source: 'cache' | 'network' | 'unavailable';
  instruction: string;
}

function readCache(): CachedResult | null {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    const stats = fs.lstatSync(CACHE_FILE);
    if (
      !stats.isFile() ||
      stats.isSymbolicLink() ||
      stats.size <= 0 ||
      stats.size > CACHE_MAX_BYTES
    ) {
      return null;
    }
    const raw = fs.readFileSync(CACHE_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as CachedResult;
    if (typeof parsed.latestVersion !== 'string' || typeof parsed.checkedAt !== 'number') {
      return null;
    }
    if (Date.now() - parsed.checkedAt > CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(latestVersion: string): void {
  try {
    ensurePrivateDirectory(CACHE_DIR, {
      symlinkErrorPrefix: 'Refusing to use symlinked update-check cache directory',
      nonDirectoryErrorPrefix: 'Update-check cache directory path is not a directory',
    });
    const data: CachedResult = { latestVersion, checkedAt: Date.now() };
    writePrivateTextFileSecure(CACHE_FILE, JSON.stringify(data), {
      label: 'Update-check cache file path',
    });
  } catch {
    // Best-effort
  }
}

function fetchLatestVersion(): Promise<string | null> {
  return new Promise((resolve) => {
    const req = https.get(REGISTRY_URL, { timeout: FETCH_TIMEOUT_MS }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        resolve(null);
        return;
      }
      let body = '';
      res.setEncoding('utf-8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (typeof parsed.version === 'string') {
            resolve(parsed.version);
          } else {
            resolve(null);
          }
        } catch {
          resolve(null);
        }
      });
    });

    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

function parseSemver(version: string): ParsedSemver | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
    version.trim(),
  );
  if (!match) return null;
  return {
    major: Number.parseInt(match[1] || '0', 10),
    minor: Number.parseInt(match[2] || '0', 10),
    patch: Number.parseInt(match[3] || '0', 10),
    prerelease: match[4] ? match[4].split('.') : [],
  };
}

function comparePrerelease(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;

  const maxLength = Math.max(a.length, b.length);
  for (let index = 0; index < maxLength; index += 1) {
    const left = a[index];
    const right = b[index];
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    if (left === right) continue;

    const leftNumeric = /^\d+$/.test(left);
    const rightNumeric = /^\d+$/.test(right);
    if (leftNumeric && rightNumeric) {
      const diff = Number.parseInt(left, 10) - Number.parseInt(right, 10);
      if (diff !== 0) return diff > 0 ? 1 : -1;
      continue;
    }
    if (leftNumeric !== rightNumeric) {
      return leftNumeric ? -1 : 1;
    }
    return left.localeCompare(right);
  }

  return 0;
}

function isNewer(latest: string, current: string): boolean {
  const parsedLatest = parseSemver(latest);
  const parsedCurrent = parseSemver(current);
  if (!parsedLatest || !parsedCurrent) {
    return latest.replace(/^v/, '') !== current.replace(/^v/, '') && latest > current;
  }

  if (parsedLatest.major !== parsedCurrent.major) {
    return parsedLatest.major > parsedCurrent.major;
  }
  if (parsedLatest.minor !== parsedCurrent.minor) {
    return parsedLatest.minor > parsedCurrent.minor;
  }
  if (parsedLatest.patch !== parsedCurrent.patch) {
    return parsedLatest.patch > parsedCurrent.patch;
  }
  return comparePrerelease(parsedLatest.prerelease, parsedCurrent.prerelease) > 0;
}

function buildUpdateStatus(
  currentVersion: string,
  latestVersion: string | null,
  source: UpdateStatus['source'],
  packageName: string,
): UpdateStatus {
  return {
    currentVersion,
    latestVersion,
    updateAvailable: latestVersion ? isNewer(latestVersion, currentVersion) : false,
    source,
    instruction: `npm i -g ${packageName}@latest`,
  };
}

export function formatUpdateMessage(status: UpdateStatus): string | null {
  if (!status.updateAvailable || !status.latestVersion) {
    return null;
  }

  return chalk.yellow(
    `  Update available: ${status.currentVersion} → ${status.latestVersion} — ${status.instruction}`,
  );
}

export async function getUpdateStatus(
  currentVersion: string,
  packageName = 'stateset-response-cli',
): Promise<UpdateStatus> {
  const cached = readCache();
  if (cached) {
    return buildUpdateStatus(currentVersion, cached.latestVersion, 'cache', packageName);
  }

  const latest = await fetchLatestVersion();
  if (!latest) {
    return buildUpdateStatus(currentVersion, null, 'unavailable', packageName);
  }

  writeCache(latest);
  return buildUpdateStatus(currentVersion, latest, 'network', packageName);
}

/**
 * Check for a newer version of the CLI.
 * Returns a user-facing message if an update is available, or null.
 * Uses a 24h cached result and 3s fetch timeout. Never blocks startup.
 */
export async function checkForUpdate(currentVersion: string): Promise<string | null> {
  try {
    const status = await getUpdateStatus(currentVersion);
    return formatUpdateMessage(status);
  } catch {
    return null;
  }
}
