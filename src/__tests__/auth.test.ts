import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';

const mockConfigExists = vi.fn(() => false);
const mockLoadConfig = vi.fn(
  () =>
    ({
      currentOrg: '',
      organizations: {},
    }) as { currentOrg: string; organizations: Record<string, never> },
);
const mockSaveConfig = vi.fn();
const mockGetCurrentOrg = vi.fn(() => ({
  orgId: 'org-123',
  config: { name: 'Acme' },
}));
const mockEnsureConfigDir = vi.fn();
const mockRequestJson = vi.fn();

vi.mock('../config.js', () => ({
  ensureConfigDir: () => mockEnsureConfigDir(),
  saveConfig: (...args: unknown[]) => mockSaveConfig(...args),
  configExists: () => mockConfigExists(),
  loadConfig: () => mockLoadConfig(),
  getCurrentOrg: () => mockGetCurrentOrg(),
}));

vi.mock('../integrations/http.js', () => ({
  requestJson: (...args: unknown[]) => mockRequestJson(...args),
}));

const mockPrompt = vi.fn();
vi.mock('inquirer', () => ({
  default: {
    prompt: (...args: unknown[]) => mockPrompt(...args),
  },
}));

import inquirer from 'inquirer';
import { registerAuthCommands } from '../cli/auth.js';

const _mockedPrompt = vi.mocked(inquirer.prompt as unknown as typeof mockPrompt);
const mockedSaveConfig = vi.mocked(mockSaveConfig);

describe('auth command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfigExists.mockReturnValue(false);
    mockSaveConfig.mockClear();
    mockPrompt.mockReset();
    mockRequestJson.mockReset();
    delete process.env.STATESET_ALLOW_INSECURE_HTTP;
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('saves trimmed manual org credentials and anthropic key', async () => {
    mockPrompt
      .mockResolvedValueOnce({ loginMethod: 'manual' })
      .mockResolvedValueOnce({ anthropicApiKey: '  sk-ant-test  ' })
      .mockResolvedValueOnce({
        orgId: 'org-123',
        orgName: 'Acme Org',
        graphqlEndpoint: 'https://example.com/graphql',
        adminSecret: 'admin-secret',
      });

    const program = new Command();
    registerAuthCommands(program);

    await program.parseAsync(['node', 'response', 'auth', 'login']);

    expect(mockPrompt).toHaveBeenCalled();
    expect(mockedSaveConfig).toHaveBeenCalledWith({
      currentOrg: 'org-123',
      organizations: {
        'org-123': {
          name: 'Acme Org',
          graphqlEndpoint: 'https://example.com/graphql',
          adminSecret: 'admin-secret',
        },
      },
      anthropicApiKey: 'sk-ant-test',
    });
  });

  it('rejects insecure http GraphQL endpoint by default', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const program = new Command();
    registerAuthCommands(program);

    await program.parseAsync([
      'node',
      'response',
      'auth',
      'login',
      '--manual',
      '--org-id',
      'org-123',
      '--org-name',
      'Acme Org',
      '--graphql-endpoint',
      'http://example.com/graphql',
      '--admin-secret',
      'admin-secret',
      '--non-interactive',
    ]);

    expect(
      errSpy.mock.calls.some(
        ([line]) => typeof line === 'string' && line.includes('GraphQL endpoint must use https://'),
      ),
    ).toBe(true);
    expect(mockedSaveConfig).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    errSpy.mockRestore();
  });

  it('prints an error for unknown authentication method', async () => {
    mockPrompt.mockResolvedValueOnce({ loginMethod: 'telepathy' });
    mockPrompt.mockResolvedValueOnce({ anthropicApiKey: '  sk-ant-test  ' });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const program = new Command();
    registerAuthCommands(program);

    await program.parseAsync(['node', 'response', 'auth', 'login']);

    expect(
      errSpy.mock.calls.some(
        ([line]) =>
          typeof line === 'string' && line.includes('Unknown authentication method selected.'),
      ),
    ).toBe(true);
    expect(process.exitCode).toBe(1);
    errSpy.mockRestore();
  });

  it('requires an explicit login method in non-interactive mode', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const program = new Command();
    registerAuthCommands(program);

    await program.parseAsync(['node', 'response', 'auth', 'login', '--non-interactive']);

    expect(
      errSpy.mock.calls.some(
        ([line]) =>
          typeof line === 'string' &&
          line.includes('In non-interactive mode, pass either --device or --manual.'),
      ),
    ).toBe(true);
    expect(process.exitCode).toBe(1);
    errSpy.mockRestore();
  });

  it('supports non-interactive device login', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockRequestJson
      .mockResolvedValueOnce({
        status: 200,
        data: {
          device_code: 'dev-code',
          user_code: 'USER123',
          verification_url: 'https://verify.example.com',
          expires_in: 60,
          interval: 0,
        },
      })
      .mockResolvedValueOnce({
        status: 200,
        data: {
          status: 'authorized',
          token: 'cli-token-123',
          org: { id: 'org-device', name: 'Device Org' },
          graphqlEndpoint: 'https://example.com/graphql',
        },
      });

    const program = new Command();
    registerAuthCommands(program);

    await program.parseAsync([
      'node',
      'response',
      'auth',
      'login',
      '--device',
      '--instance-url',
      'https://response.example.com',
      '--non-interactive',
      '--no-open-browser',
    ]);

    expect(mockPrompt).not.toHaveBeenCalled();
    expect(mockedSaveConfig).toHaveBeenCalledWith({
      currentOrg: 'org-device',
      organizations: {
        'org-device': {
          name: 'Device Org',
          graphqlEndpoint: 'https://example.com/graphql',
          cliToken: 'cli-token-123',
        },
      },
    });
    expect(mockRequestJson).toHaveBeenCalledTimes(2);
    logSpy.mockRestore();
  });
});
