import { beforeEach, describe, expect, it, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { mockPaths } = vi.hoisted(() => ({
  mockPaths: {
    stateDir: '/tmp/operations-store-test',
  },
}));

vi.mock('../session.js', () => ({
  getStateSetDir: vi.fn(() => mockPaths.stateDir),
}));

import { createWebhook, loadOperationsStore } from '../cli/operations-store.js';

describe('operations store hardening', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stateset-ops-store-'));
    mockPaths.stateDir = tmpDir;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns an empty store when the file is missing', () => {
    expect(loadOperationsStore()).toEqual({
      version: 1,
      webhooks: [],
      webhookLogs: [],
      alerts: [],
      deployments: [],
    });
  });

  it('throws when an existing store file is invalid JSON', () => {
    const storePath = path.join(tmpDir, 'platform-operations.json');
    fs.writeFileSync(storePath, '{invalid json', 'utf-8');

    expect(() => loadOperationsStore()).toThrow(/Unable to read platform operations state:/);
  });

  it('does not overwrite a corrupt store file during mutations', () => {
    const storePath = path.join(tmpDir, 'platform-operations.json');
    fs.writeFileSync(storePath, '{invalid json', 'utf-8');

    expect(() =>
      createWebhook({
        url: 'https://example.com/webhook',
        events: 'orders/create',
      }),
    ).toThrow(/Unable to read platform operations state:/);

    expect(fs.readFileSync(storePath, 'utf-8')).toBe('{invalid json');
  });
});
