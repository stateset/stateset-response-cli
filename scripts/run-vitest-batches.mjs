import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const NODE_COMPAT = path.join(REPO_ROOT, 'scripts', 'node-compat.cjs');
const VITEST_ENTRY = path.join(REPO_ROOT, 'node_modules', 'vitest', 'vitest.mjs');
const TEST_ROOT = path.join(REPO_ROOT, 'src');
const DEFAULT_BATCH_SIZE = 25;

function collectTestFiles(rootDir) {
  const files = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith('.test.ts')) {
        files.push(path.relative(REPO_ROOT, entryPath));
      }
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}

function chunk(values, size) {
  const batches = [];
  for (let index = 0; index < values.length; index += size) {
    batches.push(values.slice(index, index + size));
  }
  return batches;
}

function parseBatchSize(rawValue) {
  const parsed = Number.parseInt(rawValue ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_BATCH_SIZE;
}

function buildVitestArgs(extraArgs) {
  return ['--require', NODE_COMPAT, VITEST_ENTRY, 'run', ...extraArgs];
}

function runVitest(extraArgs) {
  return spawnSync(process.execPath, buildVitestArgs(extraArgs), {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    env: process.env,
  });
}

function exitWithResult(result) {
  if (typeof result.status === 'number') {
    process.exit(result.status);
  }
  process.exit(1);
}

const passthroughArgs = process.argv.slice(2);

if (passthroughArgs.length > 0 || process.env.STATESET_VITEST_NO_BATCH === '1') {
  exitWithResult(runVitest(passthroughArgs));
}

const testFiles = collectTestFiles(TEST_ROOT);
const batchSize = parseBatchSize(process.env.STATESET_VITEST_BATCH_SIZE);
const batches = chunk(testFiles, batchSize);

for (let index = 0; index < batches.length; index += 1) {
  const batch = batches[index] ?? [];
  const first = batch[0] ?? '';
  const last = batch[batch.length - 1] ?? '';
  console.log(
    `[vitest-batch ${index + 1}/${batches.length}] ${batch.length} files (${first} -> ${last})`,
  );

  const result = runVitest(batch);
  if (result.status !== 0) {
    exitWithResult(result);
  }
}
