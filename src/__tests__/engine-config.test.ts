import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockClient } = vi.hoisted(() => ({
  mockClient: {
    listBrands: vi.fn().mockResolvedValue({ items: [] }),
    createBrand: vi.fn().mockResolvedValue({ id: 'brand-1', slug: 'acme' }),
    replaceConnectors: vi.fn().mockResolvedValue({ items: [] }),
    updateBrand: vi.fn().mockResolvedValue({ id: 'brand-1' }),
    validateBrand: vi.fn().mockResolvedValue({ valid: true }),
  },
}));

vi.mock('../config.js', async () => {
  const actual = (await vi.importActual('../config.js')) as Record<string, unknown>;
  return {
    ...actual,
    getWorkflowEngineConfig: vi.fn().mockReturnValue({
      url: 'http://engine.test',
      apiKey: 'test-key',
      tenantId: 'tenant-1',
    }),
  };
});

vi.mock('../lib/engine-client.js', () => ({
  EngineClient: vi.fn().mockImplementation(() => mockClient),
  EngineClientError: class extends Error {
    status?: number;
    constructor(message: string, opts?: { status?: number }) {
      super(message);
      this.name = 'EngineClientError';
      this.status = opts?.status;
    }
  },
}));

import { getWorkflowEngineConfig } from '../config.js';
import { pushBrandStudioConfig } from '../cli/engine-config.js';
import { buildBrandStudioBundle, writeBrandStudioBundle } from '../lib/brand-studio.js';

const cleanupDirs = new Set<string>();

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stateset-engine-config-'));
  cleanupDirs.add(dir);
  return dir;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of cleanupDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  cleanupDirs.clear();
});

describe('engine config push', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('creates missing remote brands with tenant id and workflow bindings', async () => {
    const cwd = makeTempDir();
    const bundle = buildBrandStudioBundle({
      brandSlug: 'acme',
      cwd,
      displayName: 'Acme',
    });
    writeBrandStudioBundle(bundle);

    await expect(pushBrandStudioConfig('acme', cwd)).resolves.toBe(true);

    expect(mockClient.createBrand).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: 'tenant-1',
        slug: 'acme',
        display_name: 'Acme',
        routing_mode: 'shadow',
        workflow_bindings: [
          expect.objectContaining({
            workflow_type: 'response-automation-v2',
            template_key: 'ResponseAutomationV2',
            deterministic_config: expect.objectContaining({
              brand_slug: 'acme',
              workflow_name: 'ResponseAutomationV2',
            }),
          }),
        ],
      }),
    );
  });

  it('does not create a missing remote brand without an engine tenant id', async () => {
    vi.mocked(getWorkflowEngineConfig).mockReturnValueOnce({
      url: 'http://engine.test',
      apiKey: 'test-key',
    });
    const cwd = makeTempDir();
    const bundle = buildBrandStudioBundle({
      brandSlug: 'acme',
      cwd,
      displayName: 'Acme',
    });
    writeBrandStudioBundle(bundle);

    await expect(pushBrandStudioConfig('acme', cwd)).resolves.toBe(false);

    expect(mockClient.createBrand).not.toHaveBeenCalled();
  });
});
