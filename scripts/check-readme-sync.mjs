#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const packagePath = path.join(repoRoot, 'package.json');
const readmePath = path.join(repoRoot, 'README.md');

const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
const readme = fs.readFileSync(readmePath, 'utf-8');
const expectedVersion = String(pkg.version || '').trim();

const failures = [];

if (!expectedVersion) {
  failures.push('package.json has no version field.');
}

const versionLine = `Current version: \`${expectedVersion}\`.`;
if (!readme.includes(versionLine)) {
  failures.push(`README version line is out of sync. Expected: ${versionLine}`);
}

if (!/\[limit=100\]/.test(readme)) {
  failures.push('README command reference should document /search limit as [limit=100].');
}

if (!/response doctor/.test(readme)) {
  failures.push('README quick-start should include "response doctor".');
}

if (!/response init/.test(readme)) {
  failures.push('README quick-start should include "response init".');
}

if (failures.length > 0) {
  console.error('README sync check failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log('README sync check passed.');
}
