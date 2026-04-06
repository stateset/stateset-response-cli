import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildLocalConnectorSyncPlan,
  mergeConnectorPreferencesIntoMetadata,
  mergeConnectorSpecs,
  normalizeBrandEnvPrefix,
} from '../lib/workflow-studio-connectors.js';
import type { ConnectorSpec } from '../lib/manifest-builder.js';
import { saveIntegrationsStore } from '../integrations/store.js';

const ORIGINAL_ENV = { ...process.env };

function resetEnv(): void {
  process.env = { ...ORIGINAL_ENV };
  for (const key of [
    'SHOPIFY_SHOP_DOMAIN',
    'SHOPIFY_SHOP',
    'SHOPIFY_DOMAIN',
    'SHOPIFY_ACCESS_TOKEN',
    'SHOPIFY_TOKEN',
    'SHOPIFY_ADMIN_ACCESS_TOKEN',
    'STATESET_SHOPIFY_SHOP_DOMAIN',
    'STATESET_SHOPIFY_ACCESS_TOKEN',
    'GORGIAS_DOMAIN',
    'GORGIAS_API_KEY',
    'GORGIAS_EMAIL',
    'STATESET_GORGIAS_DOMAIN',
    'STATESET_GORGIAS_API_KEY',
    'STATESET_GORGIAS_EMAIL',
    'RECHARGE_ACCESS_TOKEN',
    'RECHARGE_API_TOKEN',
    'RECHARGE_API_KEY',
    'STATESET_RECHARGE_ACCESS_TOKEN',
    'LOOP_API_KEY',
    'STATESET_LOOP_API_KEY',
    'SHIPHERO_ACCESS_TOKEN',
    'STATESET_SHIPHERO_ACCESS_TOKEN',
    'SHIPSTATION_API_KEY',
    'SHIPSTATION_API_SECRET',
    'STATESET_SHIPSTATION_API_KEY',
    'STATESET_SHIPSTATION_API_SECRET',
    'SKIO_API_KEY',
    'STATESET_SKIO_API_KEY',
    'STAYAI_API_KEY',
    'STATESET_STAYAI_API_KEY',
    'STATESET_KB_API_KEY',
    'STATESET_KB_COLLECTION',
    'STATESET_KB_HOST',
    'STATESET_KB_BASE_URL',
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
    'MEM0_API_KEY',
    'ZENDESK_SUBDOMAIN',
    'ZENDESK_EMAIL',
    'ZENDESK_API_TOKEN',
    'ACME_CO_SHOPIFY_ACCESS_TOKEN',
    'ACME_CO_GORGIAS_BASIC_TOKEN',
    'ACME_CO_RECHARGE_ACCESS_TOKEN',
    'ACME_CO_LOOP_API_KEY',
  ]) {
    delete process.env[key];
  }
}

afterEach(() => {
  resetEnv();
});

describe('workflow-studio connector helpers', () => {
  it('normalizes connector preferences into metadata', () => {
    const result = mergeConnectorPreferencesIntoMetadata(
      { foo: 'bar', connector_preferences: { loop_mode: 'bad-value' } },
      { loop_mode: 'both' },
    );

    expect(result).toEqual({
      foo: 'bar',
      connector_preferences: { loop_mode: 'both' },
    });
  });

  it('builds a connector sync plan from local integrations', () => {
    process.env.SHOPIFY_SHOP_DOMAIN = 'acme.myshopify.com';
    process.env.SHOPIFY_ACCESS_TOKEN = 'shpat_test_token_value';
    process.env.GORGIAS_DOMAIN = 'acme-support';
    process.env.GORGIAS_API_KEY = 'gorgias-api-key-value';
    process.env.GORGIAS_EMAIL = 'support@acme.test';
    process.env.RECHARGE_ACCESS_TOKEN = 'recharge-access-token';
    process.env.LOOP_API_KEY = 'loop-api-key';
    process.env.STATESET_KB_API_KEY = 'kb-api-key';
    process.env.STATESET_KB_COLLECTION = 'acme-kb';
    process.env.STATESET_KB_HOST = 'http://localhost:6333/';
    process.env.OPENAI_API_KEY = 'openai-api-key';
    process.env.ANTHROPIC_API_KEY = 'anthropic-api-key';
    process.env.MEM0_API_KEY = 'mem0-api-key';

    const plan = buildLocalConnectorSyncPlan('acme-co', { loop_mode: 'both' });

    expect(plan.brandEnvPrefix).toBe('ACME_CO');
    expect(plan.connectorPreferences.loop_mode).toBe('both');
    expect(plan.connectors.map((connector) => connector.connector_type)).toEqual([
      'shopify',
      'gorgias',
      'recharge',
      'loop',
      'loop_returns',
      'qdrant',
      'openai',
      'anthropic',
      'mem0',
    ]);
    expect(plan.connectors[0]).toMatchObject({
      connector_key: 'shopify-primary',
      auth: { secret_ref: 'env://ACME_CO_SHOPIFY_ACCESS_TOKEN' },
    });
    expect(plan.connectors[1]).toMatchObject({
      connector_key: 'gorgias-primary',
      auth: { secret_ref: 'env://ACME_CO_GORGIAS_BASIC_TOKEN' },
    });
    expect(plan.connectors[5]).toMatchObject({
      connector_key: 'stateset-kb-primary',
      target: { base_url: 'http://localhost:6333' },
      metadata: { collection: 'acme-kb' },
    });
    expect(plan.requiredEnvVars).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'ACME_CO_SHOPIFY_ACCESS_TOKEN',
          presentInShell: false,
        }),
        expect.objectContaining({
          name: 'OPENAI_API_KEY',
          presentInShell: true,
        }),
      ]),
    );
    expect(plan.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('ACME_CO_SHOPIFY_ACCESS_TOKEN'),
        expect.stringContaining('ACME_CO_GORGIAS_BASIC_TOKEN'),
      ]),
    );
  });

  it('marks unsupported configured integrations separately', () => {
    process.env.ZENDESK_SUBDOMAIN = 'acme-support';
    process.env.ZENDESK_EMAIL = 'support@acme.test';
    process.env.ZENDESK_API_TOKEN = 'zendesk-token-value';

    const plan = buildLocalConnectorSyncPlan('acme', {});

    expect(plan.connectors).toEqual([]);
    expect(plan.unsupportedServices).toEqual([
      expect.objectContaining({
        service: 'zendesk',
        connector_type: 'zendesk',
      }),
    ]);
  });

  it('reads integration config from the provided cwd store', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'stateset-ws-connectors-'));
    saveIntegrationsStore(cwd, 'local', {
      version: 1,
      integrations: {
        shopify: {
          enabled: true,
          config: {
            shop: 'acme.myshopify.com',
            accessToken: 'shpat_store_token_value',
          },
          updatedAt: new Date().toISOString(),
        },
      },
    });

    const plan = buildLocalConnectorSyncPlan('acme', {}, cwd);

    expect(plan.connectors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          connector_type: 'shopify',
          auth: { secret_ref: 'env://ACME_SHOPIFY_ACCESS_TOKEN' },
        }),
      ]),
    );
    expect(plan.availableServices).toContain('shopify');
  });

  it('merges generated connectors into an existing bundle by type and direction', () => {
    const existing: ConnectorSpec[] = [
      {
        connector_key: 'shopify-main',
        connector_type: 'shopify',
        direction: 'outbound',
        target: { base_url: 'https://old.example' },
        auth: { secret_ref: 'env://OLD_TOKEN' },
        enabled: true,
      },
      {
        connector_key: 'gorgias-inbound',
        connector_type: 'gorgias',
        direction: 'inbound',
        target: { base_url: 'https://acme.gorgias.com' },
        auth: { secret_ref: '' },
        enabled: true,
      },
    ];

    const generated: ConnectorSpec[] = [
      {
        connector_key: 'shopify-primary',
        connector_type: 'shopify',
        direction: 'outbound',
        target: { base_url: 'https://new.example' },
        auth: { secret_ref: 'env://NEW_TOKEN' },
        enabled: true,
      },
    ];

    const merged = mergeConnectorSpecs(existing, generated);

    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({
      connector_key: 'shopify-primary',
      target: { base_url: 'https://new.example' },
      auth: { secret_ref: 'env://NEW_TOKEN' },
    });
    expect(merged[1]?.connector_key).toBe('gorgias-inbound');
  });

  it('normalizes brand slugs into env prefixes', () => {
    expect(normalizeBrandEnvPrefix('Acme Co. / Canada')).toBe('ACME_CO_CANADA');
  });
});
