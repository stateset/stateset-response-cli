import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

function resolveProjectRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

function loadPackageJson(rootDir) {
  const pkgPath = path.join(rootDir, 'package.json');
  return JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
}

function runCase(rootDir, testCase) {
  const binPath = path.join(rootDir, testCase.bin);
  const result = spawnSync(process.execPath, [binPath, ...testCase.args], {
    cwd: rootDir,
    encoding: 'utf-8',
    env: { ...process.env },
  });

  const stdout = result.stdout || '';
  const stderr = result.stderr || '';

  if (result.status !== 0) {
    throw new Error(
      [
        `Smoke test failed for ${testCase.name} (exit ${result.status ?? 'unknown'})`,
        stdout && `stdout:\n${stdout}`,
        stderr && `stderr:\n${stderr}`,
      ]
        .filter(Boolean)
        .join('\n\n'),
    );
  }

  for (const expected of testCase.expect) {
    if (!stdout.includes(expected) && !stderr.includes(expected)) {
      throw new Error(
        [
          `Smoke test failed for ${testCase.name}: missing expected text "${expected}"`,
          stdout && `stdout:\n${stdout}`,
          stderr && `stderr:\n${stderr}`,
        ]
          .filter(Boolean)
          .join('\n\n'),
      );
    }
  }

  console.log(`ok ${testCase.name}`);
}

const rootDir = resolveProjectRoot();
const pkg = loadPackageJson(rootDir);
const bins = pkg.bin || {};

const cases = [
  {
    name: 'response --version',
    bin: bins.response,
    args: ['--version'],
    expect: [],
  },
  {
    name: 'response ask --help',
    bin: bins.response,
    args: ['ask', '--help'],
    expect: [],
  },
  {
    name: 'response chat --help',
    bin: bins.response,
    args: ['chat', '--help'],
    expect: [],
  },
  {
    name: 'response init --help',
    bin: bins.response,
    args: ['init', '--help'],
    expect: [],
  },
  {
    name: 'response config path',
    bin: bins.response,
    args: ['config', 'path'],
    expect: [],
  },
  {
    name: 'response-gateway --help',
    bin: bins['response-gateway'],
    args: ['--help'],
    expect: [],
  },
  {
    name: 'response-slack --help',
    bin: bins['response-slack'],
    args: ['--help'],
    expect: [],
  },
  {
    name: 'response-whatsapp --help',
    bin: bins['response-whatsapp'],
    args: ['--help'],
    expect: [],
  },
];

for (const testCase of cases) {
  runCase(rootDir, testCase);
}
