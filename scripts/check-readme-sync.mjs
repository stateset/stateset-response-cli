#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getCategoryLabel,
  getCategoryOrder,
  getCommandsByCategory,
  registerAllCommands,
} from '../src/cli/command-registry.ts';

const defaultRepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packagePath = process.env.STATESET_PACKAGE_PATH || path.join(defaultRepoRoot, 'package.json');
const readmePath = process.env.STATESET_README_PATH || path.join(defaultRepoRoot, 'README.md');
const BEGIN_MARKER = '<!-- BEGIN GENERATED COMMAND REFERENCE -->';
const END_MARKER = '<!-- END GENERATED COMMAND REFERENCE -->';

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatCommand(def) {
  const aliases =
    Array.isArray(def.aliases) && def.aliases.length > 0
      ? ` Aliases: ${def.aliases.map((alias) => `\`${alias}\``).join(', ')}.`
      : '';
  return `- \`${def.usage}\` ${def.description}${aliases}`;
}

function buildGeneratedCommandReference() {
  registerAllCommands();
  const commandsByCategory = getCommandsByCategory();
  const lines = [
    'Use `/help` for the full list. This reference is generated from [`src/cli/command-registry.ts`](src/cli/command-registry.ts) via `npm run readme:sync`.',
  ];

  for (const category of getCategoryOrder()) {
    const commands = commandsByCategory.get(category) ?? [];
    if (commands.length === 0) continue;
    lines.push('', `**${getCategoryLabel(category)}**`, '');
    for (const command of commands) {
      lines.push(formatCommand(command));
    }
  }

  return lines.join('\n').trim();
}

function buildReadme(readme) {
  const generatedBlock = buildGeneratedCommandReference();
  const sectionPattern = new RegExp(
    `${escapeRegExp(BEGIN_MARKER)}[\\s\\S]*?${escapeRegExp(END_MARKER)}`,
    'm',
  );
  if (!sectionPattern.test(readme)) {
    throw new Error(
      `README is missing generated command-reference markers: ${BEGIN_MARKER} / ${END_MARKER}`,
    );
  }

  return readme.replace(sectionPattern, `${BEGIN_MARKER}\n${generatedBlock}\n${END_MARKER}`);
}

function validateStaticReadmeAssertions(readme, expectedVersion) {
  const failures = [];

  if (!expectedVersion) {
    failures.push('package.json has no version field.');
  }

  const versionLine = `Current version: \`${expectedVersion}\`.`;
  if (!readme.includes(versionLine)) {
    failures.push(`README version line is out of sync. Expected: ${versionLine}`);
  }

  if (!/response doctor/.test(readme)) {
    failures.push('README quick-start should include "response doctor".');
  }

  if (!/response init/.test(readme)) {
    failures.push('README quick-start should include "response init".');
  }

  return failures;
}

function main() {
  const args = new Set(process.argv.slice(2));
  const write = args.has('--write');
  const check = write ? false : true;

  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
  const readme = fs.readFileSync(readmePath, 'utf-8');
  const expectedVersion = String(pkg.version || '').trim();

  const failures = validateStaticReadmeAssertions(readme, expectedVersion);
  let nextReadme;
  try {
    nextReadme = buildReadme(readme);
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  }

  if (nextReadme && nextReadme !== readme && check) {
    failures.push('README command reference is out of sync. Run "npm run readme:sync".');
  }

  if (failures.length > 0) {
    console.error('README sync check failed:');
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exitCode = 1;
    return;
  }

  if (write && nextReadme && nextReadme !== readme) {
    fs.writeFileSync(readmePath, nextReadme, 'utf-8');
    console.log('README command reference updated.');
    return;
  }

  console.log('README sync check passed.');
}

main();
