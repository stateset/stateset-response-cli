import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parsePolicyFile, makeHookPermissionKey } from '../cli/permissions.js';

describe('parsePolicyFile', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'permissions-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

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
});

describe('makeHookPermissionKey', () => {
  it('combines hook and tool names', () => {
    expect(makeHookPermissionKey('hookA', 'toolB')).toBe('hookA::toolB');
  });

  it('handles empty strings', () => {
    expect(makeHookPermissionKey('', '')).toBe('::');
  });
});
