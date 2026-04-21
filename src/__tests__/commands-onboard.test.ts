import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatContext } from '../cli/types.js';
import { handleOnboardCommand } from '../cli/commands-onboard.js';

const cleanupDirs = new Set<string>();

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stateset-onboard-test-'));
  cleanupDirs.add(dir);
  return dir;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of cleanupDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  cleanupDirs.clear();
});

describe('commands-onboard', () => {
  it('rejects init slugs that would escape the .stateset directory', async () => {
    const cwd = makeTempDir();
    vi.spyOn(process, 'cwd').mockReturnValue(cwd);
    vi.spyOn(console, 'log').mockImplementation(() => {});

    await expect(handleOnboardCommand('/onboard init ..', {} as ChatContext)).rejects.toThrow(
      /Brand slug must use lowercase letters/,
    );
    expect(fs.existsSync(path.join(cwd, '.stateset'))).toBe(false);
    expect(fs.existsSync(path.join(cwd, '.gitignore'))).toBe(false);
  });

  it('initializes a valid brand inside .stateset/<brand>', async () => {
    const cwd = makeTempDir();
    vi.spyOn(process, 'cwd').mockReturnValue(cwd);
    vi.spyOn(console, 'log').mockImplementation(() => {});

    await expect(
      handleOnboardCommand('/onboard init acme-store', {} as ChatContext),
    ).resolves.toEqual({ handled: true });

    expect(fs.existsSync(path.join(cwd, '.stateset', 'acme-store'))).toBe(true);
    expect(fs.existsSync(path.join(cwd, '.stateset', 'acme-store', '.gitignore'))).toBe(true);
    expect(fs.existsSync(path.join(cwd, '.gitignore'))).toBe(false);
  });
});
