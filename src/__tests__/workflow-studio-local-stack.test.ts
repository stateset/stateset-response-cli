import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildLocalStackApplyCommand,
  parseLocalStackServices,
  resolveLocalStackComposeFile,
} from '../lib/workflow-studio-local-stack.js';

function makeComposeFile(rootDir?: string): string {
  const dir = fs.mkdtempSync(path.join(rootDir ?? os.tmpdir(), 'stateset-local-compose-'));
  const composePath = path.join(dir, 'docker-compose.yml');
  fs.writeFileSync(composePath, 'services:\n  api:\n    image: alpine:3.20\n', 'utf-8');
  return composePath;
}

describe('workflow-studio-local-stack', () => {
  it('parses service lists and removes duplicates', () => {
    expect(parseLocalStackServices('api,worker,api')).toEqual(['api', 'worker']);
  });

  it('rejects invalid service names', () => {
    expect(() => parseLocalStackServices('api,$worker')).toThrow(/Invalid local stack service/);
  });

  it('resolves an explicit compose file path', () => {
    const composeFile = makeComposeFile();
    expect(resolveLocalStackComposeFile(process.cwd(), composeFile)).toBe(composeFile);
  });

  it('builds the docker compose apply command', () => {
    const composeFile = makeComposeFile();
    const envFile = path.join(os.tmpdir(), 'acme.env');
    const plan = buildLocalStackApplyCommand({
      composeFilePath: composeFile,
      envFilePath: envFile,
      services: ['api', 'worker'],
    });
    expect(plan.composeFilePath).toBe(composeFile);
    expect(plan.composeProjectDir).toBe(path.dirname(composeFile));
    expect(plan.args).toEqual([
      'compose',
      '--env-file',
      path.resolve(envFile),
      '-f',
      composeFile,
      'up',
      '-d',
      'api',
      'worker',
    ]);
    expect(plan.command).toContain('docker compose');
  });
});
