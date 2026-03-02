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
});
