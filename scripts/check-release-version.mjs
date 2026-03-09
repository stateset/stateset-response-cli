#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packagePath = process.env.STATESET_PACKAGE_PATH || path.join(repoRoot, 'package.json');
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
const packageVersion = String(pkg.version || '').trim();
const rawTag = String(process.argv[2] || process.env.GITHUB_REF_NAME || '').trim();
const normalizedTag = rawTag.replace(/^refs\/tags\//, '');

if (!packageVersion) {
  console.error('package.json is missing a version field.');
  process.exit(1);
}

if (!normalizedTag) {
  console.error('No release tag was provided. Pass the tag name as the first argument.');
  process.exit(1);
}

const acceptedTags = new Set([packageVersion, `v${packageVersion}`]);

if (!acceptedTags.has(normalizedTag)) {
  console.error(
    `Release tag "${normalizedTag}" does not match package.json version "${packageVersion}".`,
  );
  process.exit(1);
}

console.log(`Release tag matches package version: ${normalizedTag}`);
