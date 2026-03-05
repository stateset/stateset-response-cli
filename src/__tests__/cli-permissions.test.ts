import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  parsePolicyFile,
  makeHookPermissionKey,
  readPolicyFile,
  writePolicyOverrides,
} from '../cli/permissions.js';

const MAX_POLICY_FILE_SIZE_BYTES = 1_048_576;
let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'permissions-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('parsePolicyFile', () => {
  it('returns empty toolHooks for non-existent file', () => {
    const result = parsePolicyFile(path.join(tmpDir, 'nonexistent.json'));
    expect(result).toEqual({ toolHooks: {} });
  });

  it('parses valid policy file', () => {
    const filePath = path.join(tmpDir, 'policy.json');
    fs.writeFileSync(
      filePath,
      JSON.stringify({ toolHooks: { 'my-hook': 'allow', 'other-hook': 'deny' } }),
    );
    const result = parsePolicyFile(filePath);
    expect(result.toolHooks['my-hook']).toBe('allow');
    expect(result.toolHooks['other-hook']).toBe('deny');
  });

  it('filters out invalid decisions', () => {
    const filePath = path.join(tmpDir, 'policy.json');
    fs.writeFileSync(filePath, JSON.stringify({ toolHooks: { valid: 'allow', invalid: 'maybe' } }));
    const result = parsePolicyFile(filePath);
    expect(result.toolHooks['valid']).toBe('allow');
    expect(result.toolHooks['invalid']).toBeUndefined();
  });

  it('handles malformed JSON', () => {
    const filePath = path.join(tmpDir, 'policy.json');
    fs.writeFileSync(filePath, 'not json');
    const result = parsePolicyFile(filePath);
    expect(result).toEqual({ toolHooks: {} });
  });

  it('handles file with no toolHooks key', () => {
    const filePath = path.join(tmpDir, 'policy.json');
    fs.writeFileSync(filePath, JSON.stringify({ other: 'data' }));
    const result = parsePolicyFile(filePath);
    expect(result).toEqual({ toolHooks: {} });
  });

  it('returns empty when policy file is too large', () => {
    const filePath = path.join(tmpDir, 'huge-policy.json');
    fs.writeFileSync(filePath, 'x'.repeat(MAX_POLICY_FILE_SIZE_BYTES + 1));
    const result = parsePolicyFile(filePath);
    expect(result).toEqual({ toolHooks: {} });
  });

  it.skipIf(process.platform === 'win32')('returns empty for symlinked policy file', () => {
    const realFile = path.join(tmpDir, 'real-policy.json');
    const symlinkFile = path.join(tmpDir, 'link-policy.json');
    fs.writeFileSync(realFile, JSON.stringify({ toolHooks: { allow: 'allow' } }));
    fs.symlinkSync(realFile, symlinkFile);
    const result = parsePolicyFile(symlinkFile);
    expect(result).toEqual({ toolHooks: {} });
  });
});

describe('readPolicyFile', () => {
  it('rejects file paths that do not exist', () => {
    const filePath = path.join(tmpDir, 'does-not-exist.json');
    expect(() => readPolicyFile(filePath)).toThrow(/Policy file not found/);
  });

  it('rejects malformed policy files during import', () => {
    const filePath = path.join(tmpDir, 'bad.json');
    fs.writeFileSync(filePath, '{ bad json }');
    expect(() => readPolicyFile(filePath)).toThrow(/Failed to parse policy file/);
  });

  it('rejects policies missing toolHooks during import', () => {
    const filePath = path.join(tmpDir, 'missing-toolhooks.json');
    fs.writeFileSync(filePath, JSON.stringify({ foo: 'bar' }));
    expect(() => readPolicyFile(filePath)).toThrow(/Invalid policy format/);
  });

  it('rejects directories', () => {
    const dirPath = path.join(tmpDir, 'policy-dir');
    fs.mkdirSync(dirPath);
    expect(() => readPolicyFile(dirPath)).toThrow(/must be a file/);
  });

  it('rejects oversized policy files', () => {
    const filePath = path.join(tmpDir, 'huge-policy.json');
    fs.writeFileSync(filePath, 'x'.repeat(MAX_POLICY_FILE_SIZE_BYTES + 1));
    expect(() => readPolicyFile(filePath)).toThrow(/Policy file too large/);
  });

  it.skipIf(process.platform === 'win32')('rejects symlink policy files', () => {
    const realFile = path.join(tmpDir, 'real-policy.json');
    const symlinkFile = path.join(tmpDir, 'link-policy.json');
    fs.writeFileSync(realFile, JSON.stringify({ toolHooks: { allow: 'allow' } }));
    fs.symlinkSync(realFile, symlinkFile);
    expect(() => readPolicyFile(symlinkFile)).toThrow(/symlink/);
  });
});

describe('makeHookPermissionKey', () => {
  it('combines hook and tool names', () => {
    expect(makeHookPermissionKey('hookA', 'toolB')).toBe('hookA::toolB');
  });

  it('handles empty strings', () => {
    expect(makeHookPermissionKey('', '')).toBe('::');
  });
});

describe('writePolicyOverrides', () => {
  it('writes policy overrides to a regular file', () => {
    const cwd = path.join(tmpDir, 'repo');
    fs.mkdirSync(cwd);

    writePolicyOverrides(cwd, { toolHooks: { 'my-hook': 'allow' } });

    const outPath = path.join(cwd, '.stateset', 'policies.json');
    const parsed = JSON.parse(fs.readFileSync(outPath, 'utf-8')) as {
      toolHooks: Record<string, string>;
    };
    expect(parsed.toolHooks['my-hook']).toBe('allow');
  });

  it.skipIf(process.platform === 'win32')('rejects symlink policy targets', () => {
    const cwd = path.join(tmpDir, 'repo');
    fs.mkdirSync(cwd);
    const statesetDir = path.join(cwd, '.stateset');
    fs.mkdirSync(statesetDir);
    const realTarget = path.join(tmpDir, 'real-policy.json');
    fs.writeFileSync(realTarget, JSON.stringify({ toolHooks: { safe: 'deny' } }));
    const symlinkPath = path.join(statesetDir, 'policies.json');
    fs.symlinkSync(realTarget, symlinkPath);

    expect(() => writePolicyOverrides(cwd, { toolHooks: { override: 'allow' } })).toThrow(
      /symlink/,
    );
    const parsed = JSON.parse(fs.readFileSync(realTarget, 'utf-8')) as {
      toolHooks: Record<string, string>;
    };
    expect(parsed.toolHooks['safe']).toBe('deny');
    expect(parsed.toolHooks['override']).toBeUndefined();
  });

  it.skipIf(process.platform === 'win32')('rejects symlinked .stateset directory', () => {
    const cwd = path.join(tmpDir, 'repo');
    fs.mkdirSync(cwd);
    const realDir = path.join(tmpDir, 'real-stateset');
    fs.mkdirSync(realDir);
    const symlinkDir = path.join(cwd, '.stateset');
    fs.symlinkSync(realDir, symlinkDir);

    expect(() => writePolicyOverrides(cwd, { toolHooks: { override: 'allow' } })).toThrow(
      /symlink/,
    );
    expect(fs.existsSync(path.join(realDir, 'policies.json'))).toBe(false);
  });
});
