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

function loadPackageJson(): { version?: string; scripts?: Record<string, string> } {
  const pkgPath = path.join(REPO_ROOT, 'package.json');
  return JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as {
    version?: string;
    scripts?: Record<string, string>;
  };
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
      '--loader',
      'tsx',
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
      ['--no-warnings', '--loader', 'tsx', 'scripts/check-readme-sync.mjs', '--write'],
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
      ['--no-warnings', '--loader', 'tsx', 'scripts/check-readme-sync.mjs', '--check'],
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

describe('check-engine-contract-parity.mjs', () => {
  it('passes when reusable Rust routes are represented by the engine client', () => {
    const tempDir = createTempDir();
    const rustMainPath = path.join(tempDir, 'main.rs');
    const clientPath = path.join(tempDir, 'engine-client.ts');

    fs.writeFileSync(
      rustMainPath,
      [
        'let app = Router::new()',
        '    .route("/health", get(health))',
        '    .route("/v1/brands/{brand_id}/billing", get(cp_get).put(cp_put))',
        '    .route("/v1/workflows/{workflow_id}/events", get(stream_workflow_events))',
        '    .route("/v1/brands/yse-beauty/tickets", post(start_yse_beauty_workflow));',
      ].join('\n'),
      'utf-8',
    );
    fs.writeFileSync(
      clientPath,
      [
        "return this.fetchWithRetry('/health');",
        'return this.request(`/v1/brands/${brandId}/billing`, { method: "PUT" });',
        "return this.fetchWithRetry(`/v1/brands/${brandId}/config-versions${qs ? `?${qs}` : ''}`);",
      ].join('\n'),
      'utf-8',
    );

    const result = runNodeScript(['scripts/check-engine-contract-parity.mjs', '--strict'], {
      env: {
        STATESET_ENGINE_API_MAIN: rustMainPath,
        STATESET_ENGINE_CLIENT_PATH: clientPath,
      },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Engine contract parity check passed');
  });

  it('rejects reusable Rust routes that are missing from the engine client', () => {
    const tempDir = createTempDir();
    const rustMainPath = path.join(tempDir, 'main.rs');
    const clientPath = path.join(tempDir, 'engine-client.ts');

    fs.writeFileSync(
      rustMainPath,
      [
        'let app = Router::new()',
        '    .route("/health", get(health))',
        '    .route("/readyz", get(readyz));',
      ].join('\n'),
      'utf-8',
    );
    fs.writeFileSync(clientPath, "return this.fetchWithRetry('/health');", 'utf-8');

    const result = runNodeScript(['scripts/check-engine-contract-parity.mjs', '--strict'], {
      env: {
        STATESET_ENGINE_API_MAIN: rustMainPath,
        STATESET_ENGINE_CLIENT_PATH: clientPath,
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('/readyz');
  });
});

describe('dist CLI guardrails', () => {
  it('keeps built top-level command modules aligned with src/cli.ts', () => {
    const srcCliPath = path.join(REPO_ROOT, 'src', 'cli.ts');
    const distCliPath = path.join(REPO_ROOT, 'dist', 'cli.js');
    const srcCli = fs.readFileSync(srcCliPath, 'utf-8');
    const distCli = fs.readFileSync(distCliPath, 'utf-8');

    const expectedModules = [
      {
        importPath: './cli/commands-dashboard.js',
        distFile: path.join(REPO_ROOT, 'dist', 'cli', 'commands-dashboard.js'),
        registerCall: 'registerDashboardCommand(program)',
      },
      {
        importPath: './cli/commands-reset.js',
        distFile: path.join(REPO_ROOT, 'dist', 'cli', 'commands-reset.js'),
        registerCall: 'registerResetCommand(program)',
      },
      {
        importPath: './cli/commands-update.js',
        distFile: path.join(REPO_ROOT, 'dist', 'cli', 'commands-update.js'),
        registerCall: "registerUpdateCommand(program, pkg.version || '0.0.0')",
      },
    ];

    for (const expected of expectedModules) {
      expect(srcCli).toContain(expected.importPath);
      expect(srcCli).toContain(expected.registerCall);
      expect(fs.existsSync(expected.distFile)).toBe(true);
      expect(distCli).toContain(expected.importPath);
      expect(distCli).toContain(expected.registerCall);
    }
  });
});

describe('release verification guardrails', () => {
  it('defines a release verification script that rebuilds, smoke-tests, and dry-runs the package', () => {
    const pkg = loadPackageJson();
    const script = pkg.scripts?.['release:verify'];

    expect(script).toBeTruthy();
    expect(script).toContain('npm run build');
    expect(script).toContain('npm run smoke:bins');
    expect(script).toContain('npm pack --dry-run');
  });
});
