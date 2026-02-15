import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runDoctorChecks, type DoctorCheck } from '../cli/commands-doctor.js';

vi.mock('../config.js', () => ({
  configExists: vi.fn(() => true),
  getAnthropicApiKey: vi.fn(() => 'sk-test'),
  getCurrentOrg: vi.fn(() => ({
    orgId: 'org-1',
    config: { name: 'Test', graphqlEndpoint: 'https://api.test/graphql' },
  })),
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
});
