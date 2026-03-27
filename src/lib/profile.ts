/**
 * Named profile support for config/state isolation.
 *
 * Profiles isolate the config directory so different environments
 * (dev, staging, per-brand) don't conflict.
 *
 * Usage:
 *   response --profile dev chat       # Uses ~/.stateset-dev/
 *   response --dev chat               # Shorthand for --profile dev
 *   response --profile acme chat      # Uses ~/.stateset-acme/
 *   response chat                     # Uses ~/.stateset/ (default)
 *
 * The profile is applied BEFORE config loading by setting
 * STATESET_STATE_DIR and STATESET_CONFIG_PATH env vars.
 */

import path from 'node:path';
import os from 'node:os';

const PROFILE_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

export interface ProfileParseResult {
  profile: string;
  cleanedArgv: string[];
}

/**
 * Parse --profile and --dev from argv BEFORE commander processes it.
 * Returns the profile name and argv with profile flags removed.
 */
export function parseProfileArgs(argv: string[]): ProfileParseResult {
  const cleaned: string[] = [];
  let profile = 'default';
  let i = 0;

  while (i < argv.length) {
    const arg = argv[i];

    if (arg === '--dev') {
      profile = 'dev';
      i++;
      continue;
    }

    if (arg === '--profile') {
      const next = argv[i + 1];
      if (next && !next.startsWith('-')) {
        if (!PROFILE_NAME_RE.test(next)) {
          throw new Error(
            `Invalid profile name "${next}". Use lowercase alphanumeric, dash, or underscore (max 64 chars).`,
          );
        }
        profile = next;
        i += 2;
        continue;
      } else {
        throw new Error('--profile requires a name argument.');
      }
    }

    if (arg.startsWith('--profile=')) {
      const value = arg.slice('--profile='.length);
      if (!PROFILE_NAME_RE.test(value)) {
        throw new Error(
          `Invalid profile name "${value}". Use lowercase alphanumeric, dash, or underscore (max 64 chars).`,
        );
      }
      profile = value;
      i++;
      continue;
    }

    cleaned.push(arg);
    i++;
  }

  return { profile, cleanedArgv: cleaned };
}

/**
 * Get the state directory for a profile.
 *
 * - "default" → ~/.stateset/
 * - "dev"     → ~/.stateset-dev/
 * - "acme"    → ~/.stateset-acme/
 */
export function getProfileStateDir(profile: string): string {
  const envDir = process.env.STATESET_STATE_DIR?.trim();
  if (envDir) return envDir;

  if (profile === 'default') {
    return path.join(os.homedir(), '.stateset');
  }
  return path.join(os.homedir(), `.stateset-${profile}`);
}

/**
 * Apply profile to the process environment.
 * Must be called before any config loading.
 */
export function applyProfile(profile: string): void {
  if (profile === 'default' && !process.env.STATESET_STATE_DIR) {
    // Default profile, no env changes needed
    process.env.STATESET_PROFILE = 'default';
    return;
  }

  const stateDir = getProfileStateDir(profile);
  process.env.STATESET_PROFILE = profile;
  process.env.STATESET_STATE_DIR = stateDir;
  process.env.STATESET_CONFIG_PATH = path.join(stateDir, 'config.json');
}

/**
 * Get the currently active profile name.
 */
export function getActiveProfile(): string {
  return process.env.STATESET_PROFILE || 'default';
}

/**
 * Validate a profile name.
 */
export function isValidProfileName(name: string): boolean {
  return PROFILE_NAME_RE.test(name);
}
