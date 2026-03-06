import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

function resolveProjectRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

function resolveOutDir(args) {
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === '--outDir') {
      return args[index + 1] ?? 'dist';
    }
    if (value.startsWith('--outDir=')) {
      return value.slice('--outDir='.length) || 'dist';
    }
  }
  return 'dist';
}

const rootDir = resolveProjectRoot();
const extraArgs = process.argv.slice(2);
const outDir = resolveOutDir(extraArgs);
const outputPath = path.resolve(rootDir, outDir);
const tscEntry = path.join(rootDir, 'node_modules', 'typescript', 'bin', 'tsc');

fs.rmSync(outputPath, { recursive: true, force: true });

const result = spawnSync(process.execPath, [tscEntry, '-p', 'tsconfig.build.json', ...extraArgs], {
  cwd: rootDir,
  stdio: 'inherit',
});

if (typeof result.status === 'number') {
  process.exit(result.status);
}
if (result.error) {
  throw result.error;
}
process.exit(1);
