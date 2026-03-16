import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

function loadPackageVersion(): string {
  const pkgPath = path.join(REPO_ROOT, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { version?: string };
  return String(pkg.version || '').trim();
}

function runNodeScript(
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
  } = {},
) {
  return spawnSync(process.execPath, args, {
    cwd: options.cwd || REPO_ROOT,
    env: { ...process.env, ...options.env },
    encoding: 'utf-8',
  });
}

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stateset-repo-guardrails-'));
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

describe('check-release-version.mjs', () => {
  it('accepts a v-prefixed tag that matches package.json', () => {
    const version = loadPackageVersion();
    const result = runNodeScript(['scripts/check-release-version.mjs', `v${version}`]);

    expect(result.status).toBe(0);
  });

  it('rejects a mismatched tag', () => {
    const result = runNodeScript(['scripts/check-release-version.mjs', 'v0.0.0']);

    expect(result.status).toBe(1);
  });

  it('supports overriding the package path for isolated checks', () => {
    const tempDir = createTempDir();
    const tempPackagePath = path.join(tempDir, 'package.json');
    fs.writeFileSync(
      tempPackagePath,
      JSON.stringify({ name: 'stateset-response-cli', version: '9.9.9' }, null, 2),
      'utf-8',
    );

    const result = runNodeScript(['scripts/check-release-version.mjs', 'v9.9.9'], {
      env: { STATESET_PACKAGE_PATH: tempPackagePath },
    });

    expect(result.status).toBe(0);
  });
});

describe('check-readme-sync.mjs', () => {
  it('passes against the repository README', () => {
    const result = runNodeScript([
      '--no-warnings',
      '--import',
      'tsx/esm',
      'scripts/check-readme-sync.mjs',
      '--check',
    ]);

    expect(result.status).toBe(0);
  });

  it('rewrites an overridden README command block from the live command registry', () => {
    const tempDir = createTempDir();
    const tempPackagePath = path.join(tempDir, 'package.json');
    const tempReadmePath = path.join(tempDir, 'README.md');

    fs.writeFileSync(
      tempPackagePath,
      JSON.stringify({ name: 'stateset-response-cli', version: '9.9.9' }, null, 2),
      'utf-8',
    );
    fs.writeFileSync(
      tempReadmePath,
      [
        '# Temp README',
        '',
        'Current version: `9.9.9`.',
        '',
        'response init',
        'response doctor',
        '',
        '**Session commands (key):**',
        '',
        '<!-- BEGIN GENERATED COMMAND REFERENCE -->',
        'stale command block',
        '<!-- END GENERATED COMMAND REFERENCE -->',
      ].join('\n'),
      'utf-8',
    );

    const writeResult = runNodeScript(
      ['--no-warnings', '--import', 'tsx/esm', 'scripts/check-readme-sync.mjs', '--write'],
      {
        env: {
          STATESET_PACKAGE_PATH: tempPackagePath,
          STATESET_README_PATH: tempReadmePath,
        },
      },
    );

    expect(writeResult.status).toBe(0);

    const updatedReadme = fs.readFileSync(tempReadmePath, 'utf-8');
    expect(updatedReadme).toContain('/metrics [json] [reset]');
    expect(updatedReadme).toContain('/policy export [local|global] [out=path] [--unsafe-path]');

    const checkResult = runNodeScript(
      ['--no-warnings', '--import', 'tsx/esm', 'scripts/check-readme-sync.mjs', '--check'],
      {
        env: {
          STATESET_PACKAGE_PATH: tempPackagePath,
          STATESET_README_PATH: tempReadmePath,
        },
      },
    );

    expect(checkResult.status).toBe(0);
  });
});
