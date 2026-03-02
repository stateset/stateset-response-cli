import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import https from 'node:https';
import chalk from 'chalk';

const CACHE_DIR = path.join(os.homedir(), '.stateset');
const CACHE_FILE = path.join(CACHE_DIR, '.update-check.json');
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const FETCH_TIMEOUT_MS = 3000;
const REGISTRY_URL = 'https://registry.npmjs.org/stateset-response-cli/latest';

interface CachedResult {
  latestVersion: string;
  checkedAt: number;
}

function readCache(): CachedResult | null {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
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
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
    const data: CachedResult = { latestVersion, checkedAt: Date.now() };
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data), 'utf-8');
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

function isNewer(latest: string, current: string): boolean {
  const parse = (v: string) => v.replace(/^v/, '').split('.').map(Number);
  const [lMajor = 0, lMinor = 0, lPatch = 0] = parse(latest);
  const [cMajor = 0, cMinor = 0, cPatch = 0] = parse(current);
  if (lMajor !== cMajor) return lMajor > cMajor;
  if (lMinor !== cMinor) return lMinor > cMinor;
  return lPatch > cPatch;
}

/**
 * Check for a newer version of the CLI.
 * Returns a user-facing message if an update is available, or null.
 * Uses a 24h cached result and 3s fetch timeout. Never blocks startup.
 */
export async function checkForUpdate(currentVersion: string): Promise<string | null> {
  try {
    const cached = readCache();
    if (cached) {
      if (isNewer(cached.latestVersion, currentVersion)) {
        return chalk.yellow(
          `  Update available: ${currentVersion} → ${cached.latestVersion} — npm i -g stateset-response-cli`,
        );
      }
      return null;
    }

    const latest = await fetchLatestVersion();
    if (!latest) return null;

    writeCache(latest);

    if (isNewer(latest, currentVersion)) {
      return chalk.yellow(
        `  Update available: ${currentVersion} → ${latest} — npm i -g stateset-response-cli`,
      );
    }
    return null;
  } catch {
    return null;
  }
}
