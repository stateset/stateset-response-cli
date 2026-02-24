import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readJsonFile, readTextFile } from '../utils/file-read.js';

describe('file-read helpers', () => {
  let tmpDir = '';

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stateset-file-read-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = '';
  });

  it('reads utf-8 text files', () => {
    const filePath = path.join(tmpDir, 'note.txt');
    fs.writeFileSync(filePath, 'hello world', 'utf-8');

    expect(readTextFile(filePath)).toBe('hello world');
  });

  it('rejects symbolic links for text reads', () => {
    const targetPath = path.join(tmpDir, 'target.txt');
    const linkPath = path.join(tmpDir, 'link.txt');
    fs.writeFileSync(targetPath, 'secret', 'utf-8');
    fs.symlinkSync(targetPath, linkPath);

    expect(() => readTextFile(linkPath)).toThrow(/not a safe regular file/);
  });

  it('enforces max byte limits for text reads', () => {
    const filePath = path.join(tmpDir, 'big.txt');
    fs.writeFileSync(filePath, '123456', 'utf-8');

    expect(() => readTextFile(filePath, { maxBytes: 3 })).toThrow(/too large/);
  });

  it('reads JSON objects and validates expected structure', () => {
    const filePath = path.join(tmpDir, 'data.json');
    fs.writeFileSync(filePath, JSON.stringify({ ok: true, count: 1 }), 'utf-8');

    expect(readJsonFile(filePath, { expectObject: true })).toEqual({ ok: true, count: 1 });
  });

  it('rejects arrays when object structure is required', () => {
    const filePath = path.join(tmpDir, 'array.json');
    fs.writeFileSync(filePath, JSON.stringify(['a', 'b']), 'utf-8');

    expect(() => readJsonFile(filePath, { expectObject: true })).toThrow(/expected JSON object/);
  });

  it('throws for invalid JSON content', () => {
    const filePath = path.join(tmpDir, 'invalid.json');
    fs.writeFileSync(filePath, '{bad json', 'utf-8');

    expect(() => readJsonFile(filePath)).toThrow(/Invalid JSON/);
  });
});
