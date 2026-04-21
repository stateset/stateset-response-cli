import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readJsonObjectFromFile } from '../cli/engine-support.js';

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stateset-engine-support-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('readJsonObjectFromFile', () => {
  it('reads a regular JSON object file', () => {
    const dir = createTempDir();
    const inputPath = path.join(dir, 'brand.json');
    fs.writeFileSync(inputPath, JSON.stringify({ slug: 'acme', enabled: true }), 'utf-8');

    expect(readJsonObjectFromFile(inputPath)).toEqual({ slug: 'acme', enabled: true });
  });

  it('rejects symlinked input files', () => {
    const dir = createTempDir();
    const realPath = path.join(dir, 'brand-real.json');
    const linkedPath = path.join(dir, 'brand-link.json');
    fs.writeFileSync(realPath, JSON.stringify({ slug: 'acme' }), 'utf-8');
    fs.symlinkSync(realPath, linkedPath);

    expect(() => readJsonObjectFromFile(linkedPath)).toThrow(/safe regular file/i);
  });

  it('rejects non-object JSON payloads', () => {
    const dir = createTempDir();
    const inputPath = path.join(dir, 'brand-array.json');
    fs.writeFileSync(inputPath, JSON.stringify(['acme']), 'utf-8');

    expect(() => readJsonObjectFromFile(inputPath)).toThrow(/expected json object/i);
  });
});
