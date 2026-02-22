import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runDoctorChecks, type DoctorCheck } from '../cli/commands-doctor.js';

vi.mock('../config.js', () => ({
  configExists: vi.fn(() => true),
  getAnthropicApiKey: vi.fn(() => 'sk-test'),
  getCurrentOrg: vi.fn(() => ({
    orgId: 'org-1',
    config: { name: 'Test', graphqlEndpoint: 'https://api.test/graphql' },
  })),
  getConfigPath: vi.fn(() => '/mock/.stateset/config.json'),
  getConfiguredModel: vi.fn(() => 'claude-sonnet-4-6-20250514'),
  MODEL_IDS: [
    'claude-sonnet-4-6-20250514',
    'claude-haiku-4-5-20251001',
    'claude-opus-4-6-20250514',
  ],
}));
vi.mock('../integrations/http.js', () => ({
  requestText: vi.fn(async () => ({ status: 200, body: 'ok' })),
}));
vi.mock('../integrations/registry.js', () => ({
  listIntegrations: vi.fn(() => [{ label: 'Shopify', id: 'shopify' }]),
}));
vi.mock('../cli/commands-integrations.js', () => ({
  getIntegrationEnvStatus: vi.fn(() => ({ status: 'unset' })),
}));
vi.mock('../session.js', () => ({
  getStateSetDir: vi.fn(() => '/mock/.stateset'),
  getSessionStorageStats: vi.fn(() => ({
    totalSessions: 5,
    totalBytes: 1024 * 1024,
    emptySessions: 2,
    archivedCount: 1,
    oldestMs: Date.now() - 86400000,
    newestMs: Date.now(),
  })),
  cleanupSessions: vi.fn(() => ({ removed: [], freedBytes: 0, errors: [] })),
}));

// Mock fs for permission and disk checks
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn((p: string) => {
        if (typeof p === 'string' && p.includes('config.json')) return true;
        if (typeof p === 'string' && p.includes('.stateset')) return true;
        return actual.existsSync(p);
      }),
      statSync: vi.fn((p: string) => {
        if (typeof p === 'string' && p.includes('config.json')) {
          return { mode: 0o100600, size: 200 };
        }
        return actual.statSync(p);
      }),
      readdirSync: vi.fn((p: string, opts?: unknown) => {
        if (typeof p === 'string' && p.includes('.stateset') && !p.includes('sessions')) {
          return [];
        }
        return actual.readdirSync(p, opts as any);
      }),
    },
  };
});

const { configExists, getAnthropicApiKey, getCurrentOrg } = await import('../config.js');
const { requestText } = await import('../integrations/http.js');

const find = (checks: DoctorCheck[], name: string) => checks.find((c) => c.name === name);

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('runDoctorChecks', () => {
  it('passes Node version check on Node 18+', async () => {
    const checks = await runDoctorChecks();
    expect(find(checks, 'Node.js')?.status).toBe('pass');
  });

  it('passes when config exists', async () => {
    const checks = await runDoctorChecks();
    expect(find(checks, 'Config')?.status).toBe('pass');
  });

  it('fails when config is missing', async () => {
    vi.mocked(configExists).mockReturnValue(false);
    vi.mocked(getCurrentOrg).mockImplementation(() => {
      throw new Error('no org');
    });
    const checks = await runDoctorChecks();
    expect(find(checks, 'Config')?.status).toBe('fail');
  });

  it('passes when API key is configured', async () => {
    const checks = await runDoctorChecks();
    expect(find(checks, 'API Key')?.status).toBe('pass');
  });

  it('fails when API key is missing', async () => {
    vi.mocked(getAnthropicApiKey).mockImplementation(() => {
      throw new Error('missing');
    });
    const checks = await runDoctorChecks();
    expect(find(checks, 'API Key')?.status).toBe('fail');
  });

  it('passes when org is configured', async () => {
    const checks = await runDoctorChecks();
    expect(find(checks, 'Organization')?.status).toBe('pass');
  });

  it('fails when org is not configured', async () => {
    vi.mocked(getCurrentOrg).mockImplementation(() => {
      throw new Error('no org');
    });
    const checks = await runDoctorChecks();
    expect(find(checks, 'Organization')?.status).toBe('fail');
  });

  it('passes GraphQL check with 200 response', async () => {
    const checks = await runDoctorChecks();
    expect(find(checks, 'GraphQL')?.status).toBe('pass');
  });

  it('warns on non-200 GraphQL response', async () => {
    vi.mocked(requestText).mockResolvedValue({ status: 500, body: 'err' } as any);
    const checks = await runDoctorChecks();
    expect(find(checks, 'GraphQL')?.status).toBe('warn');
  });

  it('returns warn for unconfigured integrations', async () => {
    const checks = await runDoctorChecks();
    expect(find(checks, 'Shopify')).toMatchObject({
      status: 'warn',
      message: expect.stringContaining('not configured'),
    });
  });

  // New check tests
  it('includes file permissions check', async () => {
    const checks = await runDoctorChecks();
    const permCheck = find(checks, 'Permissions');
    expect(permCheck).toBeDefined();
    // On non-Windows platform with mocked 0o600 mode, should pass
    if (process.platform !== 'win32') {
      expect(permCheck?.status).toMatch(/pass|warn/);
    }
  });

  it('includes model availability check', async () => {
    const checks = await runDoctorChecks();
    const modelCheck = find(checks, 'Model');
    expect(modelCheck).toBeDefined();
    expect(modelCheck?.status).toBe('pass');
  });

  it('includes session health check', async () => {
    const checks = await runDoctorChecks();
    const sessionCheck = find(checks, 'Sessions');
    expect(sessionCheck).toBeDefined();
    expect(sessionCheck?.status).toBe('pass');
    expect(sessionCheck?.message).toContain('5 sessions');
  });

  it('includes knowledge base check', async () => {
    const checks = await runDoctorChecks();
    const kbCheck = find(checks, 'Knowledge Base');
    expect(kbCheck).toBeDefined();
  });

  it('includes disk space check', async () => {
    const checks = await runDoctorChecks();
    const diskCheck = find(checks, 'Disk');
    expect(diskCheck).toBeDefined();
  });

  it('returns fixable checks with fix functions when issues are found', async () => {
    const checks = await runDoctorChecks();
    // Any checks that have a fix function should have a fixDescription
    for (const check of checks) {
      if (check.fix) {
        expect(check.fixDescription).toBeDefined();
        expect(typeof check.fix).toBe('function');
      }
    }
  });
});
