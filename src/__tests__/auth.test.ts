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

vi.mock('../config.js', () => ({
  ensureConfigDir: (...args: never[]) => mockEnsureConfigDir(...args),
  saveConfig: (...args: unknown[]) => mockSaveConfig(...args),
  configExists: (...args: never[]) => mockConfigExists(...args),
  loadConfig: (...args: unknown[]) => mockLoadConfig(...args),
  getCurrentOrg: (...args: unknown[]) => mockGetCurrentOrg(...args),
}));

const mockPrompt = vi.fn();
vi.mock('inquirer', () => ({
  default: {
    prompt: (...args: unknown[]) => mockPrompt(...args),
  },
}));

import inquirer from 'inquirer';
import { registerAuthCommands } from '../cli/auth.js';

const mockedPrompt = vi.mocked(inquirer.prompt as unknown as typeof mockPrompt);
const mockedSaveConfig = vi.mocked(mockSaveConfig);

describe('auth command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfigExists.mockReturnValue(false);
    mockSaveConfig.mockClear();
    mockPrompt.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('saves trimmed manual org credentials and anthropic key', async () => {
    mockPrompt
      .mockResolvedValueOnce({ loginMethod: 'manual' })
      .mockResolvedValueOnce({ anthropicApiKey: '  sk-ant-test  ' })
      .mockResolvedValueOnce({ orgId: '  org-123  ' })
      .mockResolvedValueOnce({ orgName: '  Acme Org  ' })
      .mockResolvedValueOnce({ graphqlEndpoint: '  https://example.com/graphql  ' })
      .mockResolvedValueOnce({ adminSecret: '  admin-secret  ' });

    const program = new Command();
    registerAuthCommands(program);

    await program.parseAsync(['node', 'response', 'auth', 'login']);

    expect(mockedPrompt).toHaveBeenCalled();
    expect(mockedSaveConfig).toHaveBeenCalledWith({
      currentOrg: 'org-123',
      organizations: {
        'org-123': {
          name: 'Acme Org',
          graphqlEndpoint: 'https://example.com/graphql',
          adminSecret: 'secret',
        },
      },
      anthropicApiKey: 'sk-ant-test',
    });
  });

  it('throws on unknown authentication method', async () => {
    mockPrompt.mockResolvedValueOnce({ loginMethod: 'telepathy' });
    mockPrompt.mockResolvedValueOnce({ anthropicApiKey: '  sk-ant-test  ' });

    const program = new Command();
    registerAuthCommands(program);

    await expect(program.parseAsync(['node', 'response', 'auth', 'login'])).rejects.toThrow(
      'Unknown authentication method selected.',
    );
  });
});
