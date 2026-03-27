import { describe, it, expect, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { parseProfileArgs, getProfileStateDir, isValidProfileName } from '../lib/profile.js';

describe('profile', () => {
  const savedEnv = process.env.STATESET_STATE_DIR;

  afterEach(() => {
    if (savedEnv !== undefined) {
      process.env.STATESET_STATE_DIR = savedEnv;
    } else {
      delete process.env.STATESET_STATE_DIR;
    }
  });

  describe('parseProfileArgs', () => {
    it('extracts --profile name from argv', () => {
      const result = parseProfileArgs(['node', 'cli', '--profile', 'staging', 'chat']);
      expect(result.profile).toBe('staging');
      expect(result.cleanedArgv).toEqual(['node', 'cli', 'chat']);
    });

    it('extracts --dev shorthand', () => {
      const result = parseProfileArgs(['node', 'cli', '--dev', 'chat']);
      expect(result.profile).toBe('dev');
      expect(result.cleanedArgv).toEqual(['node', 'cli', 'chat']);
    });

    it('removes profile flags from argv', () => {
      const result = parseProfileArgs(['node', 'cli', '--profile', 'prod', '--verbose']);
      expect(result.cleanedArgv).not.toContain('--profile');
      expect(result.cleanedArgv).not.toContain('prod');
      expect(result.cleanedArgv).toContain('--verbose');
    });

    it('defaults to "default" when no profile flag', () => {
      const result = parseProfileArgs(['node', 'cli', 'chat']);
      expect(result.profile).toBe('default');
      expect(result.cleanedArgv).toEqual(['node', 'cli', 'chat']);
    });

    it('rejects invalid profile names with --profile', () => {
      expect(() => parseProfileArgs(['node', 'cli', '--profile', 'BAD NAME!!', 'chat'])).toThrow(
        /Invalid profile name/,
      );
    });

    it('rejects a next argument starting with a dash (treated as missing name)', () => {
      // '-bad' starts with '-', so the parser sees it as a flag, not a name
      expect(() => parseProfileArgs(['node', 'cli', '--profile', '-bad'])).toThrow(
        '--profile requires a name argument',
      );
    });

    it('throws when --profile has no argument', () => {
      expect(() => parseProfileArgs(['node', 'cli', '--profile'])).toThrow(
        '--profile requires a name argument',
      );
    });

    it('throws when --profile is followed by another flag', () => {
      expect(() => parseProfileArgs(['node', 'cli', '--profile', '--verbose'])).toThrow(
        '--profile requires a name argument',
      );
    });

    it('handles --profile=name format', () => {
      const result = parseProfileArgs(['node', 'cli', '--profile=acme', 'chat']);
      expect(result.profile).toBe('acme');
      expect(result.cleanedArgv).toEqual(['node', 'cli', 'chat']);
    });

    it('rejects invalid names in --profile=name format', () => {
      expect(() => parseProfileArgs(['node', 'cli', '--profile=BAD NAME!!'])).toThrow(
        /Invalid profile name/,
      );
    });

    it('handles --dev before other args', () => {
      const result = parseProfileArgs(['--dev', 'node', 'cli']);
      expect(result.profile).toBe('dev');
      expect(result.cleanedArgv).toEqual(['node', 'cli']);
    });

    it('last profile flag wins', () => {
      const result = parseProfileArgs(['node', 'cli', '--profile', 'staging', '--dev', 'chat']);
      expect(result.profile).toBe('dev');
    });

    it('handles empty argv', () => {
      const result = parseProfileArgs([]);
      expect(result.profile).toBe('default');
      expect(result.cleanedArgv).toEqual([]);
    });
  });

  describe('getProfileStateDir', () => {
    it('returns ~/.stateset/ for "default" profile', () => {
      delete process.env.STATESET_STATE_DIR;
      const dir = getProfileStateDir('default');
      expect(dir).toBe(path.join(os.homedir(), '.stateset'));
    });

    it('returns ~/.stateset-dev/ for "dev" profile', () => {
      delete process.env.STATESET_STATE_DIR;
      const dir = getProfileStateDir('dev');
      expect(dir).toBe(path.join(os.homedir(), '.stateset-dev'));
    });

    it('returns ~/.stateset-acme/ for "acme" profile', () => {
      delete process.env.STATESET_STATE_DIR;
      const dir = getProfileStateDir('acme');
      expect(dir).toBe(path.join(os.homedir(), '.stateset-acme'));
    });

    it('respects STATESET_STATE_DIR env var override', () => {
      process.env.STATESET_STATE_DIR = '/custom/path';
      const dir = getProfileStateDir('anything');
      expect(dir).toBe('/custom/path');
    });

    it('ignores blank STATESET_STATE_DIR', () => {
      process.env.STATESET_STATE_DIR = '   ';
      const dir = getProfileStateDir('default');
      expect(dir).toBe(path.join(os.homedir(), '.stateset'));
    });
  });

  describe('isValidProfileName', () => {
    it('accepts lowercase alphanumeric names', () => {
      expect(isValidProfileName('dev')).toBe(true);
      expect(isValidProfileName('staging')).toBe(true);
      expect(isValidProfileName('prod1')).toBe(true);
    });

    it('accepts names with dashes and underscores', () => {
      expect(isValidProfileName('my-profile')).toBe(true);
      expect(isValidProfileName('my_profile')).toBe(true);
      expect(isValidProfileName('a-b-c')).toBe(true);
    });

    it('accepts uppercase letters', () => {
      // The regex has /i flag
      expect(isValidProfileName('Dev')).toBe(true);
      expect(isValidProfileName('STAGING')).toBe(true);
    });

    it('rejects names starting with dash or underscore', () => {
      expect(isValidProfileName('-bad')).toBe(false);
      expect(isValidProfileName('_bad')).toBe(false);
    });

    it('rejects empty string', () => {
      expect(isValidProfileName('')).toBe(false);
    });

    it('rejects names with spaces', () => {
      expect(isValidProfileName('my profile')).toBe(false);
    });

    it('rejects names with special characters', () => {
      expect(isValidProfileName('my.profile')).toBe(false);
      expect(isValidProfileName('my@profile')).toBe(false);
      expect(isValidProfileName('path/inject')).toBe(false);
    });

    it('rejects names longer than 64 characters', () => {
      // Regex allows {0,63} after first char → max 64 total
      expect(isValidProfileName('a'.repeat(64))).toBe(true);
      expect(isValidProfileName('a'.repeat(65))).toBe(false);
    });
  });
});
