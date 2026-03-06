import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';

vi.mock('node:fs');
vi.mock('node:os', () => ({
  default: { homedir: () => '/mock-home' },
  homedir: () => '/mock-home',
}));

vi.mock('node:https', () => {
  const mockGet = vi.fn();
  return { default: { get: mockGet }, get: mockGet };
});

import https from 'node:https';
import { checkForUpdate } from '../utils/update-check.js';

const mockFs = vi.mocked(fs);
const mockGet = vi.mocked(https.get);

describe('checkForUpdate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFs.existsSync.mockReturnValue(false);
    mockFs.lstatSync.mockReturnValue({
      isFile: () => true,
      isSymbolicLink: () => false,
      size: 128,
    } as any);
  });

  it('returns null when fetch fails', async () => {
    mockGet.mockImplementation((_url: any, _opts: any, _cb: any) => {
      const req: Record<string, any> = {
        on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
          if (event === 'error') handler(new Error('network'));
          return req;
        }),
        destroy: vi.fn(),
      };
      return req as any;
    });

    const result = await checkForUpdate('1.7.4');
    expect(result).toBeNull();
  });

  it('returns null when on latest version (from cache)', async () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(
      JSON.stringify({ latestVersion: '1.7.4', checkedAt: Date.now() }),
    );

    const result = await checkForUpdate('1.7.4');
    expect(result).toBeNull();
  });

  it('returns update message when newer version in cache', async () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(
      JSON.stringify({ latestVersion: '1.8.0', checkedAt: Date.now() }),
    );

    const result = await checkForUpdate('1.7.4');
    expect(result).toBeTruthy();
    expect(result).toContain('1.8.0');
    expect(result).toContain('npm i -g');
  });

  it('treats a stable release as newer than a prerelease of the same version', async () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(
      JSON.stringify({ latestVersion: '1.8.0', checkedAt: Date.now() }),
    );

    const result = await checkForUpdate('1.8.0-beta.1');
    expect(result).toContain('1.8.0');
  });

  it('does not treat a prerelease as newer than the matching stable release', async () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(
      JSON.stringify({ latestVersion: '1.8.0-beta.2', checkedAt: Date.now() }),
    );

    const result = await checkForUpdate('1.8.0');
    expect(result).toBeNull();
  });

  it('returns null when cache is expired and fetch fails', async () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(
      JSON.stringify({ latestVersion: '1.8.0', checkedAt: Date.now() - 25 * 60 * 60 * 1000 }),
    );
    mockGet.mockImplementation((_url: any, _opts: any, _cb: any) => {
      const req: Record<string, any> = {
        on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
          if (event === 'error') handler(new Error('fail'));
          return req;
        }),
        destroy: vi.fn(),
      };
      return req as any;
    });

    const result = await checkForUpdate('1.7.4');
    expect(result).toBeNull();
  });

  it('returns null when cache path is a symlink', async () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.lstatSync.mockReturnValue({
      isFile: () => true,
      isSymbolicLink: () => true,
      size: 128,
    } as any);

    const result = await checkForUpdate('1.7.4');
    expect(result).toBeNull();
    expect(mockFs.readFileSync).not.toHaveBeenCalled();
  });
});
