import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import inquirer from 'inquirer';
import {
  getIntegrationEnvStatus,
  printIntegrationHealth,
  printIntegrationLimits,
  printIntegrationStatus,
  runIntegrationsSetup,
} from '../cli/commands-integrations.js';
import { listIntegrations } from '../integrations/registry.js';
import {
  loadIntegrationsStore,
  loadIntegrationsStoreForScope,
  saveIntegrationsStore,
} from '../integrations/store.js';
import { readFirstEnvValue } from '../cli/utils.js';
import { formatTable } from '../utils/display.js';

vi.mock('inquirer', () => ({
  default: {
    prompt: vi.fn(),
  },
}));

vi.mock('../integrations/registry.js', () => ({
  listIntegrations: vi.fn(),
}));

vi.mock('../integrations/store.js', () => ({
  loadIntegrationsStore: vi.fn(),
  loadIntegrationsStoreForScope: vi.fn(),
  saveIntegrationsStore: vi.fn(),
}));

vi.mock('../cli/utils.js', () => ({
  readFirstEnvValue: vi.fn(),
}));

vi.mock('../utils/display.js', () => ({
  formatSuccess: vi.fn((value: string) => `SUCCESS:${value}`),
  formatWarning: vi.fn((value: string) => `WARN:${value}`),
  formatTable: vi.fn(() => 'TABLE'),
}));

const mockedInquirer = vi.mocked(inquirer);
const mockedListIntegrations = vi.mocked(listIntegrations);
const mockedLoadIntegrationsStore = vi.mocked(loadIntegrationsStore);
const mockedLoadIntegrationsStoreForScope = vi.mocked(loadIntegrationsStoreForScope);
const mockedSaveIntegrationsStore = vi.mocked(saveIntegrationsStore);
const mockedReadFirstEnvValue = vi.mocked(readFirstEnvValue);
const mockedFormatTable = vi.mocked(formatTable);

const INTEGRATIONS = [
  {
    id: 'shopify',
    label: 'Shopify',
    description: 'Shopify integration',
    fields: [{ key: 'apiKey', label: 'API key', envVars: ['SHOPIFY_API_KEY'], required: true }],
  },
  {
    id: 'shiphero',
    label: 'ShipHero',
    description: 'ShipHero integration',
    fields: [{ key: 'token', label: 'Token', envVars: ['SHIPHERO_TOKEN'], required: true }],
  },
];

describe('commands-integrations', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockedListIntegrations.mockReturnValue(INTEGRATIONS as any);
    mockedReadFirstEnvValue.mockReturnValue('');
    mockedLoadIntegrationsStore.mockReturnValue({
      scope: 'global',
      path: '/tmp/.stateset/integrations.json',
      store: { version: 1, integrations: {} },
    } as any);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('reports partial env coverage when only some required vars are set', () => {
    mockedReadFirstEnvValue.mockImplementation((envVars: string[]) =>
      envVars[0] === 'SHOPIFY_API_KEY' ? 'set' : '',
    );

    const status = getIntegrationEnvStatus({
      id: 'shopify',
      label: 'Shopify',
      description: 'Shopify integration',
      fields: [
        { key: 'apiKey', label: 'API key', envVars: ['SHOPIFY_API_KEY'], required: true },
        { key: 'domain', label: 'Domain', envVars: ['SHOPIFY_DOMAIN'], required: true },
      ],
    } as any);

    expect(status).toEqual({ status: 'partial', anySet: true });
  });

  it('prints integration status with scoped config metadata', () => {
    mockedLoadIntegrationsStore.mockReturnValue({
      scope: 'global',
      path: '/tmp/.stateset/integrations.json',
      store: {
        version: 1,
        integrations: {
          shopify: { enabled: true, config: { apiKey: 'secret' } },
          shiphero: { enabled: false, config: {} },
        },
      },
    } as any);

    printIntegrationStatus('/tmp/project');

    expect(mockedFormatTable).toHaveBeenCalledWith(
      [
        { integration: 'Shopify', env: '-', config: 'set (global)' },
        { integration: 'ShipHero', env: '-', config: 'disabled (global)' },
      ],
      ['integration', 'env', 'config'],
    );
    expect(
      consoleSpy.mock.calls.some(
        ([line]) =>
          typeof line === 'string' &&
          line.includes('Config file: /tmp/.stateset/integrations.json'),
      ),
    ).toBe(true);
  });

  it('prints warning when health target integration is missing', () => {
    printIntegrationHealth('/tmp/project', 'does-not-exist');
    expect(consoleSpy).toHaveBeenCalledWith('WARN:Integration not found: does-not-exist');
  });

  it('maps configured integrations to placeholder limits status', () => {
    mockedLoadIntegrationsStore.mockReturnValue({
      scope: 'local',
      path: '/tmp/project/.stateset/integrations.json',
      store: {
        version: 1,
        integrations: {
          shopify: { enabled: true, config: { apiKey: 'secret' } },
        },
      },
    } as any);

    printIntegrationLimits('/tmp/project', 'shopify');
    expect(mockedFormatTable).toHaveBeenCalledWith(
      [{ integration: 'Shopify', id: 'shopify', status: 'limits not wired', env: '-' }],
      ['integration', 'status', 'env'],
    );
  });

  it('saves selected integrations and disables deselected existing entries', async () => {
    const store = {
      version: 1,
      integrations: {
        shiphero: { enabled: true, config: { token: 'old' }, updatedAt: '2025-01-01T00:00:00Z' },
      },
    };

    mockedLoadIntegrationsStore.mockReturnValue({
      scope: 'global',
      path: '/tmp/.stateset/integrations.json',
      store,
    } as any);
    mockedLoadIntegrationsStoreForScope.mockReturnValue({
      path: '/tmp/project/.stateset/integrations.json',
      store,
    } as any);

    mockedInquirer.prompt
      .mockResolvedValueOnce({ scope: 'local' })
      .mockResolvedValueOnce({ selected: ['shopify'] })
      .mockResolvedValueOnce({ disable: true })
      .mockResolvedValueOnce({ apiKey: 'new-key' });
    mockedSaveIntegrationsStore.mockReturnValue('/tmp/project/.stateset/integrations.json');

    await runIntegrationsSetup('/tmp/project');

    expect(mockedSaveIntegrationsStore).toHaveBeenCalledWith(
      '/tmp/project',
      'local',
      expect.objectContaining({
        integrations: expect.objectContaining({
          shopify: expect.objectContaining({
            enabled: true,
            config: { apiKey: 'new-key' },
          }),
          shiphero: expect.objectContaining({
            enabled: false,
          }),
        }),
      }),
    );
  });
});
