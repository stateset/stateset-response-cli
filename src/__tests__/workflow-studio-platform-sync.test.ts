import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config.js', () => ({
  getCurrentOrg: vi.fn(() => ({
    orgId: 'org-test',
    config: {
      graphqlEndpoint: 'https://example.com/v1/graphql',
      cliToken: 'cli-token',
    },
  })),
}));

vi.mock('../mcp-server/graphql-client.js', () => ({
  createGraphQLClient: vi.fn(() => ({ request: vi.fn() })),
  executeQuery: vi.fn(),
}));

import { getCurrentOrg } from '../config.js';
import { createGraphQLClient, executeQuery } from '../mcp-server/graphql-client.js';
import {
  buildPlatformConnectorSyncPlanFromCredentials,
  fetchCurrentOrgPlatformConnectorCredentials,
} from '../lib/workflow-studio-platform-sync.js';

const TRACKED_ENV_VARS = [
  'STATESET_KB_API_KEY',
  'STATESET_KB_BASE_URL',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'MEM0_API_KEY',
  'SHOPIFY_TOKEN_org-test',
  'GORGIAS_AUTH_org-test',
  'LOOP_API_KEY_org-test',
  'RECHARGE_TOKEN_org-test',
  'SHIPHERO_TOKEN_org-test',
] as const;

const ORIGINAL_ENV = new Map<string, string | undefined>(
  TRACKED_ENV_VARS.map((name) => [name, process.env[name]]),
);

describe('workflow-studio platform sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const name of TRACKED_ENV_VARS) {
      delete process.env[name];
    }
  });

  afterEach(() => {
    for (const name of TRACKED_ENV_VARS) {
      const value = ORIGINAL_ENV.get(name);
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  });

  it('fetches and normalizes platform connector credentials for the current org', async () => {
    vi.mocked(executeQuery).mockResolvedValueOnce({
      access_tokens: [
        {
          org_id: 'org-test',
          user_id: 'user-123',
          merchant_name: 'Acme',
          domain: 'acme.com',
          shop: 'acme.myshopify.com',
          shopify_access_token: 'shp-token',
          gorgias: 'acme',
          gorgias_access_token: 'gor-token',
          gorgias_username: 'ops@acme.com',
          stateset_kb_collection: 'acme-kb',
          stateset_kb_api_key: 'kb-token',
        },
      ],
    });

    const credentials = await fetchCurrentOrgPlatformConnectorCredentials();

    expect(getCurrentOrg).toHaveBeenCalled();
    expect(createGraphQLClient).toHaveBeenCalledWith(
      'https://example.com/v1/graphql',
      { type: 'cli_token', token: 'cli-token' },
      'org-test',
    );
    expect(executeQuery).toHaveBeenCalledWith(
      expect.any(Object),
      expect.stringContaining('query GetPlatformConnectorCredentials'),
      { org_id: 'org-test' },
    );
    expect(credentials).toMatchObject({
      orgId: 'org-test',
      userId: 'user-123',
      merchantName: 'Acme',
      domain: 'acme.com',
      shopify: {
        shop: 'acme.myshopify.com',
        accessToken: 'shp-token',
        apiVersion: '2025-01',
      },
      gorgias: {
        domain: 'acme',
        apiKey: 'gor-token',
        email: 'ops@acme.com',
      },
      statesetKb: {
        collection: 'acme-kb',
        apiKey: 'kb-token',
      },
    });
  });

  it('returns null when the current org has no access token row', async () => {
    vi.mocked(executeQuery).mockResolvedValueOnce({ access_tokens: [] });

    await expect(fetchCurrentOrgPlatformConnectorCredentials()).resolves.toBeNull();
  });

  it('builds a connector sync plan from platform credentials', () => {
    process.env.STATESET_KB_API_KEY = 'kb-shell-token';
    process.env.STATESET_KB_BASE_URL = 'https://qdrant.example.test/';
    process.env.OPENAI_API_KEY = 'openai-shell-token';

    const plan = buildPlatformConnectorSyncPlanFromCredentials(
      'acme',
      {
        orgId: 'org-test',
        shopify: {
          shop: 'acme.myshopify.com',
          accessToken: 'shp-token',
          apiVersion: '2025-01',
        },
        loop: {
          apiKey: 'loop-token',
        },
        skio: {
          apiKey: 'skio-token',
        },
        statesetKb: {
          collection: 'acme-kb',
          apiKey: 'kb-token',
        },
      },
      { loop_mode: 'both' },
    );

    expect(plan.brandSlug).toBe('acme');
    expect(plan.brandEnvPrefix).toBe('ACME');
    expect(plan.connectorPreferences).toEqual({ loop_mode: 'both' });
    expect(plan.availableServices).toEqual(['shopify', 'loop', 'skio', 'stateset-kb']);
    expect(plan.syncableServices).toEqual(['loop', 'shopify', 'stateset-kb']);
    expect(plan.connectors.map((connector) => connector.connector_type)).toEqual([
      'shopify',
      'loop',
      'loop_returns',
      'qdrant',
      'openai',
    ]);
    expect(plan.requiredEnvVars.map((entry) => entry.name)).toEqual([
      'LOOP_API_KEY_org-test',
      'OPENAI_API_KEY',
      'SHOPIFY_TOKEN_org-test',
      'STATESET_KB_API_KEY',
    ]);
    expect(plan.unsupportedServices).toEqual([
      {
        service: 'skio',
        connector_type: 'skio',
        reason: 'This connector is not currently supported by the Temporal Rust workflow engine.',
      },
    ]);
    expect(plan.warnings).toContain(
      'Platform credential sync creates connector bindings from access_tokens, but it does not provision the referenced env:// secrets into the workflow engine runtime.',
    );
    expect(plan.warnings).toContain(
      'Expected SHOPIFY_TOKEN_org-test for platform-synced connector auth, but it is not set in the current shell.',
    );
    expect(plan.warnings).toContain(
      'Expected LOOP_API_KEY_org-test for platform-synced connector auth, but it is not set in the current shell.',
    );
  });

  it('warns when KB credentials exist but no explicit KB base url is configured', () => {
    process.env.STATESET_KB_API_KEY = 'kb-shell-token';
    process.env.OPENAI_API_KEY = 'openai-shell-token';

    const plan = buildPlatformConnectorSyncPlanFromCredentials(
      'acme',
      {
        orgId: 'org-test',
        statesetKb: {
          collection: 'acme-kb',
          apiKey: 'kb-token',
        },
      },
      {},
    );

    expect(plan.connectors.map((connector) => connector.connector_type)).toEqual(['openai']);
    expect(plan.warnings).toContain(
      'Platform KB credentials were found, but STATESET_KB_BASE_URL or STATESET_KB_HOST is not set in the current shell.',
    );
  });
});
