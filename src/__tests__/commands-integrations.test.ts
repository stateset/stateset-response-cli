import fs from 'node:fs';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import inquirer from 'inquirer';
import {
  getIntegrationEnvStatus,
  printIntegrationHealth,
  printIntegrationLimits,
  printIntegrationLogs,
  printIntegrationStatus,
  runIntegrationsSetup,
} from '../cli/commands-integrations.js';
import { listIntegrations } from '../integrations/registry.js';
import {
  loadIntegrationsStore,
  loadIntegrationsStoreForScope,
  saveIntegrationsStore,
} from '../integrations/store.js';
import { readIntegrationTelemetry, readToolAudit } from '../cli/audit.js';
import { getSessionsDir } from '../session.js';
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

vi.mock('../cli/audit.js', () => ({
  readIntegrationTelemetry: vi.fn(),
  readToolAudit: vi.fn(),
}));

vi.mock('../session.js', () => ({
  getSessionsDir: vi.fn(() => '/tmp/.stateset/sessions'),
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
const mockedReadIntegrationTelemetry = vi.mocked(readIntegrationTelemetry);
const mockedReadToolAudit = vi.mocked(readToolAudit);
const mockedGetSessionsDir = vi.mocked(getSessionsDir);
const mockedReadFirstEnvValue = vi.mocked(readFirstEnvValue);
const mockedFormatTable = vi.mocked(formatTable);

const INTEGRATIONS = [
  {
    id: 'shopify',
    label: 'Shopify',
    description: 'Shopify integration',
    fields: [
      { key: 'apiKey', label: 'API key', envVars: ['SHOPIFY_API_KEY'], required: true },
      { key: 'baseUrl', label: 'Base URL', envVars: ['SHOPIFY_BASE_URL'], required: false },
    ],
  },
  {
    id: 'shiphero',
    label: 'ShipHero',
    description: 'ShipHero integration',
    fields: [{ key: 'token', label: 'Token', envVars: ['SHIPHERO_TOKEN'], required: true }],
  },
];

describe('commands-integrations', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let existsSpy: any;
  let readdirSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    readdirSpy = vi.spyOn(fs, 'readdirSync').mockReturnValue([]);

    mockedListIntegrations.mockReturnValue(INTEGRATIONS as any);
    mockedReadFirstEnvValue.mockReturnValue('');
    mockedLoadIntegrationsStore.mockReturnValue({
      scope: 'global',
      path: '/tmp/.stateset/integrations.json',
      store: { version: 1, integrations: {} },
    } as any);
    mockedGetSessionsDir.mockReturnValue('/tmp/.stateset/sessions');
    mockedReadIntegrationTelemetry.mockReturnValue([]);
    mockedReadToolAudit.mockReturnValue([]);
  });

  afterEach(() => {
    logSpy.mockRestore();
    existsSpy.mockRestore();
    readdirSpy.mockRestore();
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
        { integration: 'Shopify', env: '-', config: 'configured (global)' },
        { integration: 'ShipHero', env: '-', config: 'disabled (global)' },
      ],
      ['integration', 'env', 'config'],
    );
    expect(
      logSpy.mock.calls.some(
        ([line]) =>
          typeof line === 'string' &&
          line.includes('Config file: /tmp/.stateset/integrations.json'),
      ),
    ).toBe(true);
  });

  it('prints warning when health target integration is missing', () => {
    printIntegrationHealth('/tmp/project', 'does-not-exist');
    expect(logSpy).toHaveBeenCalledWith('WARN:Integration not found: does-not-exist');
  });

  it('prints detailed health diagnostics with required coverage', () => {
    mockedLoadIntegrationsStore.mockReturnValue({
      scope: 'local',
      path: '/tmp/project/.stateset/integrations.json',
      store: {
        version: 1,
        integrations: {
          shopify: { enabled: true, config: { apiKey: 'secret', baseUrl: 'https://api.example' } },
        },
      },
    } as any);

    printIntegrationHealth('/tmp/project', 'shopify', true);

    expect(mockedFormatTable).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          integration: 'Shopify',
          health: 'ready',
          required: '1/1',
          source: 'store',
          config: 'configured',
        }),
      ],
      expect.arrayContaining(['integration', 'health', 'required', 'source', 'urlStatus']),
    );
  });

  it('summarizes limits from audit telemetry', () => {
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

    mockedReadIntegrationTelemetry.mockReturnValue([
      {
        ts: '2026-02-27T10:00:00.000Z',
        type: 'tool_call',
        session: 'session-a',
        name: 'shopify_list_orders',
      },
      {
        ts: '2026-02-27T10:01:00.000Z',
        type: 'tool_result',
        session: 'session-a',
        name: 'shopify_list_orders',
        isError: true,
        reason: 'HTTP 429 rate limit',
      },
    ] as any);

    printIntegrationLimits('/tmp/project', 'shopify');

    expect(mockedFormatTable).toHaveBeenCalledWith(
      [
        {
          integration: 'Shopify',
          id: 'shopify',
          calls: '1',
          errors: '1',
          rateLimited: '1',
          lastRateLimit: '2026-02-27T10:01:00.000Z',
          lastSeen: '2026-02-27T10:01:00.000Z',
        },
      ],
      ['integration', 'calls', 'errors', 'rateLimited', 'lastRateLimit', 'lastSeen'],
    );
  });

  it('warns when logs are requested but no audit events exist', () => {
    printIntegrationLogs('/tmp/project', 'shopify', 5);
    expect(logSpy).toHaveBeenCalledWith('WARN:No integration audit events found.');
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
      .mockResolvedValueOnce({ apiKey: 'new-key' })
      .mockResolvedValueOnce({ baseUrl: '' });
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

  it('supports validation-only mode without writing config', async () => {
    mockedLoadIntegrationsStore.mockReturnValue({
      scope: 'global',
      path: '/tmp/.stateset/integrations.json',
      store: { version: 1, integrations: {} },
    } as any);
    mockedLoadIntegrationsStoreForScope.mockReturnValue({
      path: '/tmp/.stateset/integrations.json',
      store: { version: 1, integrations: {} },
    } as any);

    await runIntegrationsSetup('/tmp/project', { validateOnly: true });

    expect(mockedSaveIntegrationsStore).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith('SUCCESS:Integration validation');
    expect(mockedFormatTable).toHaveBeenCalledWith(
      [
        { integration: 'Shopify', required: '1', missing: 'apiKey', status: 'missing' },
        { integration: 'ShipHero', required: '1', missing: 'token', status: 'missing' },
      ],
      ['integration', 'required', 'missing', 'status'],
    );
  });

  it('supports from-env setup and skips prompting for covered required fields', async () => {
    const store = { version: 1, integrations: {} };
    mockedLoadIntegrationsStore.mockReturnValue({
      scope: 'global',
      path: '/tmp/.stateset/integrations.json',
      store,
    } as any);
    mockedLoadIntegrationsStoreForScope.mockReturnValue({
      path: '/tmp/project/.stateset/integrations.json',
      store,
    } as any);
    mockedReadFirstEnvValue.mockImplementation((envVars: string[]) =>
      envVars[0] === 'SHOPIFY_API_KEY' ? 'env-shop-key' : '',
    );
    mockedInquirer.prompt
      .mockResolvedValueOnce({ scope: 'local' })
      .mockResolvedValueOnce({ baseUrl: '' });
    mockedSaveIntegrationsStore.mockReturnValue('/tmp/project/.stateset/integrations.json');

    await runIntegrationsSetup('/tmp/project', { fromEnv: true, target: 'shopify' });

    expect(mockedSaveIntegrationsStore).toHaveBeenCalledWith(
      '/tmp/project',
      'local',
      expect.objectContaining({
        integrations: expect.objectContaining({
          shopify: expect.objectContaining({
            enabled: true,
            config: { apiKey: 'env-shop-key' },
          }),
        }),
      }),
    );
  });

  it('throws when targeted integration is not found', async () => {
    await expect(
      runIntegrationsSetup('/tmp/project', { target: 'missing', validateOnly: true }),
    ).rejects.toThrow('Integration not found: missing');
  });
});
