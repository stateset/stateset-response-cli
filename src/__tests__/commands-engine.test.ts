import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('node:child_process', () => ({
  spawnSync: vi.fn(() => ({ status: 0 })),
}));

// Mock config before importing
vi.mock('../config.js', async () => {
  const actual = (await vi.importActual('../config.js')) as Record<string, unknown>;
  return {
    ...actual,
    loadConfig: vi.fn().mockReturnValue({
      currentOrg: 'test-org',
      organizations: {
        'test-org': {
          name: 'Test',
          graphqlEndpoint: 'https://test.com/v1/graphql',
        },
      },
    }),
    saveConfig: vi.fn(),
    configExists: vi.fn().mockReturnValue(true),
    getWorkflowEngineConfig: vi.fn().mockReturnValue(null),
  };
});

vi.mock('../lib/engine-client.js', () => {
  return {
    EngineClient: vi.fn().mockImplementation(() => ({
      health: vi.fn().mockResolvedValue({ status: 'ok' }),
      listBrands: vi.fn().mockResolvedValue({
        items: [
          {
            id: '12345678-abcd',
            name: 'Acme',
            slug: 'acme',
            status: 'active',
            routing_mode: 'live',
          },
        ],
      }),
      getBrand: vi.fn().mockResolvedValue({
        id: '12345678-abcd',
        slug: 'acme',
        status: 'active',
        routing_mode: 'live',
        config_version: 4,
        workflow_bindings: [{ workflow_type: 'response-automation-v2', enabled: true }],
      }),
      createBrand: vi.fn().mockImplementation((payload: Record<string, unknown>) => ({
        brand: {
          id: '12345678-abcd',
          slug: String(payload.slug ?? 'acme'),
          status: 'draft',
          workflow_bindings: payload.workflow_bindings ?? [],
        },
      })),
      bootstrapBrand: vi.fn().mockImplementation((payload: Record<string, unknown>) => ({
        brand: {
          id: '12345678-abcd',
          slug: String(payload.slug ?? 'acme'),
          status: payload.activate ? 'active' : 'draft',
          workflow_bindings: [{ workflow_type: 'response-automation-v2', enabled: true }],
        },
        created: true,
        binding_bootstrapped: true,
        activated: Boolean(payload.activate),
        validation: { valid: true, errors: [], warnings: [] },
      })),
      listBootstrapTemplates: vi.fn().mockResolvedValue([
        { id: 'ecommerce', name: 'E-commerce Support' },
        { id: 'subscription', name: 'Subscription Support' },
        { id: 'knowledge_base', name: 'Knowledge Base Q&A' },
      ]),
      activateBrand: vi.fn().mockResolvedValue({
        brand: { id: '12345678-abcd', slug: 'acme', status: 'active' },
        validation: { valid: true, errors: [], warnings: [] },
      }),
      validateBrand: vi.fn().mockResolvedValue({
        valid: true,
        errors: [],
        warnings: [],
        checks: [{ code: 'bindings_present', ok: true, message: 'ok' }],
      }),
      updateBrand: vi
        .fn()
        .mockImplementation((_brandId: string, patch: Record<string, unknown>) => ({
          id: '12345678-abcd',
          slug: 'acme',
          metadata: { connector_preferences: { loop_mode: 'subscriptions' } },
          ...patch,
        })),
      getBrandConfig: vi.fn().mockResolvedValue({ config_version: 4 }),
      listBrandConfigVersions: vi.fn().mockResolvedValue({
        items: [{ version: 4, status: 'active', is_active: true, published_at: null }],
      }),
      getBrandMigrationState: vi.fn().mockResolvedValue({
        current: { stage: 'shadow', routing_mode: 'shadow' },
        history: [],
      }),
      updateBrandMigrationState: vi.fn().mockResolvedValue({
        current: { stage: 'canary', routing_mode: 'canary' },
        history: [],
      }),
      getBrandParityDashboard: vi.fn().mockResolvedValue({
        summary: { total_events: 5, parity_match: 4, parity_mismatch: 1, parity_unknown: 0 },
      }),
      listBrandWorkflows: vi.fn().mockResolvedValue({
        items: [
          {
            workflow_id: 'rav2-123',
            status: 'completed',
            current_phase: 'done',
            external_id: 'ticket-1',
            started_at: '2026-04-06T12:00:00Z',
          },
        ],
        total: 1,
      }),
      listConnectors: vi.fn().mockResolvedValue({
        items: [
          {
            id: 'connector-1',
            connector_key: 'gorgias-default',
            connector_type: 'gorgias',
            enabled: true,
            direction: 'outbound',
          },
        ],
      }),
      createConnector: vi.fn().mockResolvedValue({ id: 'connector-2' }),
      checkConnectorHealth: vi.fn().mockResolvedValue({ ok: true }),
      ingestEvent: vi.fn().mockResolvedValue({ workflow_id: 'rav2-123', status: 'accepted' }),
      getWorkflowStatusForType: vi.fn().mockResolvedValue({ status: 'completed' }),
      getWorkflowTemplate: vi.fn().mockResolvedValue({ template_key: 'ResponseAutomationV2' }),
      createWorkflowTemplate: vi.fn().mockResolvedValue({ template_key: 'ResponseAutomationV2' }),
      updateWorkflowTemplate: vi.fn().mockResolvedValue({ template_key: 'ResponseAutomationV2' }),
      listPolicySets: vi.fn().mockResolvedValue({
        items: [{ id: 'ps-1', policy_set_key: 'default', version: 1, status: 'active' }],
      }),
      getPolicySet: vi.fn().mockResolvedValue({ policy_set_key: 'default', version: 1 }),
      createPolicySet: vi.fn().mockResolvedValue({ policy_set_key: 'default', version: 1 }),
      updatePolicySet: vi.fn().mockResolvedValue({ policy_set_key: 'default', version: 2 }),
      getDispatchHealthDashboard: vi.fn().mockResolvedValue({
        summary: {
          active_tenants: 1,
          active_brands: 1,
          healthy_brands: 1,
          warning_brands: 0,
          critical_brands: 0,
          pending_count: 0,
          processing_count: 0,
          failed_count: 0,
          dead_letter_count: 0,
          max_parity_mismatch_rate_24h: 0,
        },
        items: [],
      }),
      runDispatchGuard: vi.fn().mockResolvedValue({
        apply: false,
        minimum_health_status: 'critical',
        max_actions: 25,
        summary: {
          total_brands_scanned: 1,
          candidate_brands: 0,
          planned_actions: 0,
          applied_actions: 0,
          failed_actions: 0,
        },
        actions: [],
      }),
      getWorkflowStatus: vi.fn().mockResolvedValue({ status: 'completed' }),
      cancelWorkflow: vi.fn().mockResolvedValue({}),
      terminateWorkflow: vi.fn().mockResolvedValue({}),
      restartWorkflow: vi.fn().mockResolvedValue({}),
      reviewWorkflow: vi.fn().mockResolvedValue({}),
      listDlq: vi.fn().mockResolvedValue({ items: [] }),
      createOnboardingRun: vi.fn().mockResolvedValue({ id: 'run-1' }),
      listOnboardingRuns: vi.fn().mockResolvedValue({
        items: [{ id: 'run-1', status: 'pending', created_at: '2026-04-06T12:00:00Z' }],
      }),
      getOnboardingRun: vi.fn().mockResolvedValue({
        id: 'run-1',
        status: 'pending',
        notes: 'bootstrap',
      }),
      updateOnboardingRun: vi.fn().mockResolvedValue({
        id: 'run-1',
        status: 'completed',
      }),
      listWorkflowTemplates: vi.fn().mockResolvedValue({ items: [] }),
      retryDlqItem: vi.fn().mockResolvedValue({ id: 'dlq-1', status: 'retried' }),
      resolveDlqItem: vi.fn().mockResolvedValue({ id: 'dlq-1', status: 'resolved' }),
    })),
    EngineClientError: class extends Error {
      status?: number;
      constructor(msg: string, opts?: { status?: number }) {
        super(msg);
        this.name = 'EngineClientError';
        this.status = opts?.status;
      }
    },
  };
});

vi.mock('../cli/engine-config.js', () => ({
  pullBrandStudioConfig: vi.fn(async () => true),
  pushBrandStudioConfig: vi.fn(async () => true),
  validateBrandStudioConfig: vi.fn(() => true),
}));

vi.mock('../lib/workflow-studio-platform-sync.js', () => ({
  fetchCurrentOrgPlatformConnectorCredentials: vi.fn(async () => ({
    orgId: 'org-test',
    shopify: { shop: 'acme.myshopify.com', accessToken: 'shp', apiVersion: '2025-01' },
  })),
  buildPlatformConnectorSyncPlanFromCredentials: vi.fn((_brandSlug: string) => ({
    brandSlug: 'acme',
    brandEnvPrefix: 'ACME',
    connectorPreferences: { loop_mode: 'subscriptions' },
    availableServices: ['shopify'],
    syncableServices: ['shopify'],
    connectors: [
      {
        connector_key: 'shopify-primary',
        connector_type: 'shopify',
        direction: 'outbound',
        target: { base_url: 'https://acme.myshopify.com', api_version: '2025-01' },
        auth: { secret_ref: 'env://SHOPIFY_TOKEN_org-test' },
        enabled: true,
        retry_policy: {},
        metadata: { source: 'platform_sync' },
      },
    ],
    requiredEnvVars: [],
    unsupportedServices: [],
    warnings: [],
  })),
}));

import { handleEngineCommand, handleWorkflowsCommand } from '../cli/commands-engine.js';
import { getWorkflowEngineConfig } from '../config.js';
import { EngineClient } from '../lib/engine-client.js';
import { spawnSync } from 'node:child_process';
import type { ChatContext } from '../cli/types.js';
import {
  pullBrandStudioConfig,
  pushBrandStudioConfig,
  validateBrandStudioConfig,
} from '../cli/engine-config.js';
import { readEngineCompletionCache } from '../cli/engine-completion-cache.js';
import {
  buildPlatformConnectorSyncPlanFromCredentials,
  fetchCurrentOrgPlatformConnectorCredentials,
} from '../lib/workflow-studio-platform-sync.js';

function makeJsonFile(data: Record<string, unknown>): string {
  const filePath = path.join(
    os.tmpdir(),
    `stateset-engine-test-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`,
  );
  fs.writeFileSync(filePath, JSON.stringify(data), 'utf-8');
  return filePath;
}

function makeMockCtx(cwd = '/tmp'): ChatContext {
  return {
    agent: {
      getModel: () => 'claude-sonnet-4-6',
      getHistoryLength: () => 0,
      callTool: vi.fn(),
    },
    cwd,
    rl: { prompt: vi.fn() },
    sessionId: 'test',
    processing: false,
    reconnectAgent: vi.fn(),
  } as unknown as ChatContext;
}

function latestEngineClientMock(): Record<string, ReturnType<typeof vi.fn>> {
  const instances = vi.mocked(EngineClient).mock.results;
  const instance = instances[instances.length - 1]?.value;
  return instance as Record<string, ReturnType<typeof vi.fn>>;
}

function makeComposeFile(rootDir?: string): string {
  const dir = fs.mkdtempSync(path.join(rootDir ?? os.tmpdir(), 'stateset-compose-'));
  const composePath = path.join(dir, 'docker-compose.yml');
  fs.writeFileSync(composePath, 'services:\n  api:\n    image: alpine:3.20\n', 'utf-8');
  return composePath;
}

describe('handleEngineCommand', () => {
  beforeEach(() => {
    vi.mocked(EngineClient).mockClear();
    vi.mocked(spawnSync).mockClear();
    vi.mocked(spawnSync).mockReturnValue({ status: 0 } as never);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('returns not handled for non-engine input', async () => {
    const result = await handleEngineCommand('/help', makeMockCtx());
    expect(result.handled).toBe(false);
  });

  it('shows not-configured when engine is not set up', async () => {
    vi.mocked(getWorkflowEngineConfig).mockReturnValue(null);
    const result = await handleEngineCommand('/engine', makeMockCtx());
    expect(result.handled).toBe(true);
  });

  it('handles /engine status subcommand', async () => {
    vi.mocked(getWorkflowEngineConfig).mockReturnValue({
      url: 'http://localhost:8080',
      apiKey: 'test-key',
    });
    const result = await handleEngineCommand('/engine status', makeMockCtx());
    expect(result.handled).toBe(true);
  });

  it('handles /engine health subcommand', async () => {
    vi.mocked(getWorkflowEngineConfig).mockReturnValue({
      url: 'http://localhost:8080',
      apiKey: 'test-key',
    });
    const result = await handleEngineCommand('/engine health', makeMockCtx());
    expect(result.handled).toBe(true);
  });

  it('handles /engine dispatch-health', async () => {
    vi.mocked(getWorkflowEngineConfig).mockReturnValue({
      url: 'http://localhost:8080',
      apiKey: 'test-key',
    });
    const result = await handleEngineCommand(
      '/engine dispatch-health --tenant-id tenant-1 --limit 10 --offset 5',
      makeMockCtx(),
    );
    expect(result.handled).toBe(true);
    const client = latestEngineClientMock();
    expect(client.getDispatchHealthDashboard).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      limit: 10,
      offset: 5,
    });
  });

  it('handles /engine dispatch-guard', async () => {
    vi.mocked(getWorkflowEngineConfig).mockReturnValue({
      url: 'http://localhost:8080',
      apiKey: 'test-key',
    });
    const result = await handleEngineCommand(
      '/engine dispatch-guard --tenant-id tenant-1 --apply true --minimum-health-status warning --max-actions 10',
      makeMockCtx(),
    );
    expect(result.handled).toBe(true);
    const client = latestEngineClientMock();
    expect(client.runDispatchGuard).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      apply: true,
      minimumHealthStatus: 'warning',
      maxActions: 10,
    });
  });

  it('handles /engine brands subcommand', async () => {
    vi.mocked(getWorkflowEngineConfig).mockReturnValue({
      url: 'http://localhost:8080',
      apiKey: 'test-key',
    });
    const result = await handleEngineCommand('/engine brands', makeMockCtx());
    expect(result.handled).toBe(true);
  });

  it('handles /engine brands show', async () => {
    vi.mocked(getWorkflowEngineConfig).mockReturnValue({
      url: 'http://localhost:8080',
      apiKey: 'test-key',
    });
    const result = await handleEngineCommand('/engine brands show acme', makeMockCtx());
    expect(result.handled).toBe(true);
  });

  it('handles /engine brands create', async () => {
    vi.mocked(getWorkflowEngineConfig).mockReturnValue({
      url: 'http://localhost:8080',
      apiKey: 'test-key',
      tenantId: 'tenant-1',
    });
    const filePath = makeJsonFile({ slug: 'acme', display_name: 'Acme', workflow_bindings: [] });
    const result = await handleEngineCommand(`/engine brands create ${filePath}`, makeMockCtx());
    expect(result.handled).toBe(true);
  });

  it('bootstraps template config during /engine brands create when workflow bindings are omitted', async () => {
    vi.mocked(getWorkflowEngineConfig).mockReturnValue({
      url: 'http://localhost:8080',
      apiKey: 'test-key',
      tenantId: 'tenant-1',
    });
    const filePath = makeJsonFile({
      slug: 'acme',
      display_name: 'Acme',
      template: 'subscription',
    });
    const result = await handleEngineCommand(`/engine brands create ${filePath}`, makeMockCtx());
    expect(result.handled).toBe(true);

    const client = latestEngineClientMock();
    expect(client.createBrand).toHaveBeenCalled();
    expect(client.updateBrand).toHaveBeenCalledWith(
      '12345678-abcd',
      expect.objectContaining({
        workflow_bindings: [
          expect.objectContaining({
            workflow_type: 'response-automation-v2',
            deterministic_config: expect.objectContaining({
              brand_id: '12345678-abcd',
              brand_slug: 'acme',
              post_actions: expect.any(Array),
            }),
          }),
        ],
      }),
    );
  });

  it('handles /engine brands bootstrap', async () => {
    vi.mocked(getWorkflowEngineConfig).mockReturnValue({
      url: 'http://localhost:8080',
      apiKey: 'test-key',
      tenantId: 'tenant-1',
    });
    const result = await handleEngineCommand(
      '/engine brands bootstrap new-brand ecommerce activate',
      makeMockCtx(),
    );
    expect(result.handled).toBe(true);

    const client = latestEngineClientMock();
    expect(client.listBootstrapTemplates).toHaveBeenCalled();
    expect(client.bootstrapBrand).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: 'tenant-1',
        slug: 'new-brand',
        template: 'ecommerce',
        activate: true,
      }),
    );
  });

  it('handles /engine brands update', async () => {
    vi.mocked(getWorkflowEngineConfig).mockReturnValue({
      url: 'http://localhost:8080',
      apiKey: 'test-key',
    });
    const filePath = makeJsonFile({
      display_name: 'Acme Updated',
      connector_preferences: { loop_mode: 'both' },
    });
    const result = await handleEngineCommand(
      `/engine brands update acme ${filePath}`,
      makeMockCtx(),
    );
    expect(result.handled).toBe(true);
  });

  it('handles /engine onboard without brand-id', async () => {
    vi.mocked(getWorkflowEngineConfig).mockReturnValue({
      url: 'http://localhost:8080',
      apiKey: 'test-key',
    });
    const result = await handleEngineCommand('/engine onboard', makeMockCtx());
    expect(result.handled).toBe(true);
  });

  it('handles /engine onboard list', async () => {
    vi.mocked(getWorkflowEngineConfig).mockReturnValue({
      url: 'http://localhost:8080',
      apiKey: 'test-key',
    });
    const result = await handleEngineCommand('/engine onboard list acme', makeMockCtx());
    expect(result.handled).toBe(true);
  });

  it('caches onboarding run ids after listing runs', async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'stateset-engine-cache-'));
    vi.mocked(getWorkflowEngineConfig).mockReturnValue({
      url: 'http://localhost:8080',
      apiKey: 'test-key',
    });

    const result = await handleEngineCommand('/engine onboard list acme', makeMockCtx(cwd));
    expect(result.handled).toBe(true);

    const cache = readEngineCompletionCache('acme', cwd);
    expect(cache?.onboardingRunIds).toContain('run-1');
  });

  it('handles /engine onboard show', async () => {
    vi.mocked(getWorkflowEngineConfig).mockReturnValue({
      url: 'http://localhost:8080',
      apiKey: 'test-key',
    });
    const result = await handleEngineCommand('/engine onboard show acme run-1', makeMockCtx());
    expect(result.handled).toBe(true);
  });

  it('handles /engine onboard update', async () => {
    vi.mocked(getWorkflowEngineConfig).mockReturnValue({
      url: 'http://localhost:8080',
      apiKey: 'test-key',
    });
    const result = await handleEngineCommand(
      '/engine onboard update acme run-1 completed done',
      makeMockCtx(),
    );
    expect(result.handled).toBe(true);
  });

  it('handles /engine templates subcommand', async () => {
    vi.mocked(getWorkflowEngineConfig).mockReturnValue({
      url: 'http://localhost:8080',
      apiKey: 'test-key',
    });
    const result = await handleEngineCommand('/engine templates', makeMockCtx());
    expect(result.handled).toBe(true);
  });

  it('handles /engine dlq without brand-id', async () => {
    vi.mocked(getWorkflowEngineConfig).mockReturnValue({
      url: 'http://localhost:8080',
      apiKey: 'test-key',
    });
    const result = await handleEngineCommand('/engine dlq', makeMockCtx());
    expect(result.handled).toBe(true);
  });

  it('handles /engine dlq list', async () => {
    vi.mocked(getWorkflowEngineConfig).mockReturnValue({
      url: 'http://localhost:8080',
      apiKey: 'test-key',
    });
    const result = await handleEngineCommand('/engine dlq acme pending', makeMockCtx());
    expect(result.handled).toBe(true);
  });

  it('caches dlq ids after retrying a dlq item', async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'stateset-engine-cache-'));
    vi.mocked(getWorkflowEngineConfig).mockReturnValue({
      url: 'http://localhost:8080',
      apiKey: 'test-key',
    });

    const result = await handleEngineCommand('/engine dlq retry acme dlq-1', makeMockCtx(cwd));
    expect(result.handled).toBe(true);

    const cache = readEngineCompletionCache('acme', cwd);
    expect(cache?.dlqItemIds).toContain('dlq-1');
  });

  it('handles /engine dlq retry', async () => {
    vi.mocked(getWorkflowEngineConfig).mockReturnValue({
      url: 'http://localhost:8080',
      apiKey: 'test-key',
    });
    const result = await handleEngineCommand('/engine dlq retry acme dlq-1', makeMockCtx());
    expect(result.handled).toBe(true);
  });

  it('handles /engine dlq resolve', async () => {
    vi.mocked(getWorkflowEngineConfig).mockReturnValue({
      url: 'http://localhost:8080',
      apiKey: 'test-key',
    });
    const result = await handleEngineCommand(
      '/engine dlq resolve acme dlq-1 resolved fixed manually',
      makeMockCtx(),
    );
    expect(result.handled).toBe(true);
  });

  it('handles /engine config validate', async () => {
    const result = await handleEngineCommand('/engine config validate acme', makeMockCtx());
    expect(result.handled).toBe(true);
    expect(validateBrandStudioConfig).toHaveBeenCalledWith('acme', '/tmp');
  });

  it('handles /engine config pull', async () => {
    const result = await handleEngineCommand('/engine config pull acme', makeMockCtx());
    expect(result.handled).toBe(true);
    expect(pullBrandStudioConfig).toHaveBeenCalledWith('acme', '/tmp');
  });

  it('handles /engine config history', async () => {
    vi.mocked(getWorkflowEngineConfig).mockReturnValue({
      url: 'http://localhost:8080',
      apiKey: 'test-key',
    });
    const result = await handleEngineCommand('/engine config history acme', makeMockCtx());
    expect(result.handled).toBe(true);
  });

  it('handles /engine config push', async () => {
    const result = await handleEngineCommand('/engine config push acme', makeMockCtx());
    expect(result.handled).toBe(true);
    expect(pushBrandStudioConfig).toHaveBeenCalledWith('acme', '/tmp');
  });

  it('handles /engine activate', async () => {
    vi.mocked(getWorkflowEngineConfig).mockReturnValue({
      url: 'http://localhost:8080',
      apiKey: 'test-key',
    });
    const result = await handleEngineCommand('/engine activate acme 4', makeMockCtx());
    expect(result.handled).toBe(true);
  });

  it('handles /engine executions', async () => {
    vi.mocked(getWorkflowEngineConfig).mockReturnValue({
      url: 'http://localhost:8080',
      apiKey: 'test-key',
    });
    const result = await handleEngineCommand('/engine executions acme completed', makeMockCtx());
    expect(result.handled).toBe(true);
  });

  it('handles /engine connectors list', async () => {
    vi.mocked(getWorkflowEngineConfig).mockReturnValue({
      url: 'http://localhost:8080',
      apiKey: 'test-key',
    });
    const result = await handleEngineCommand('/engine connectors acme', makeMockCtx());
    expect(result.handled).toBe(true);
  });

  it('handles /engine connectors plan with platform source', async () => {
    vi.mocked(getWorkflowEngineConfig).mockReturnValue({
      url: 'http://localhost:8080',
      apiKey: 'test-key',
    });
    const result = await handleEngineCommand(
      '/engine connectors acme plan both --source platform',
      makeMockCtx(),
    );
    expect(result.handled).toBe(true);
    expect(fetchCurrentOrgPlatformConnectorCredentials).toHaveBeenCalled();
    expect(buildPlatformConnectorSyncPlanFromCredentials).toHaveBeenCalledWith(
      'acme',
      expect.any(Object),
      { loop_mode: 'both' },
    );
  });

  it('handles /engine connectors sync with platform source', async () => {
    vi.mocked(getWorkflowEngineConfig).mockReturnValue({
      url: 'http://localhost:8080',
      apiKey: 'test-key',
    });
    const result = await handleEngineCommand(
      '/engine connectors acme sync --source platform',
      makeMockCtx(),
    );
    expect(result.handled).toBe(true);
    const client = latestEngineClientMock();
    expect(fetchCurrentOrgPlatformConnectorCredentials).toHaveBeenCalled();
    expect(client.createConnector).toHaveBeenCalledWith(
      '12345678-abcd',
      expect.objectContaining({
        connector_key: 'shopify-primary',
        connector_type: 'shopify',
      }),
    );
  });

  it('handles /engine connectors health', async () => {
    vi.mocked(getWorkflowEngineConfig).mockReturnValue({
      url: 'http://localhost:8080',
      apiKey: 'test-key',
    });
    const result = await handleEngineCommand(
      '/engine connectors acme health connector-1',
      makeMockCtx(),
    );
    expect(result.handled).toBe(true);
  });

  it('handles /engine validate', async () => {
    vi.mocked(getWorkflowEngineConfig).mockReturnValue({
      url: 'http://localhost:8080',
      apiKey: 'test-key',
    });
    const result = await handleEngineCommand('/engine validate acme', makeMockCtx());
    expect(result.handled).toBe(true);
  });

  it('handles /engine config show', async () => {
    vi.mocked(getWorkflowEngineConfig).mockReturnValue({
      url: 'http://localhost:8080',
      apiKey: 'test-key',
    });
    const result = await handleEngineCommand('/engine config show acme', makeMockCtx());
    expect(result.handled).toBe(true);
  });

  it('handles /engine connectors create', async () => {
    vi.mocked(getWorkflowEngineConfig).mockReturnValue({
      url: 'http://localhost:8080',
      apiKey: 'test-key',
    });
    const filePath = makeJsonFile({
      connector_key: 'shopify-primary',
      connector_type: 'shopify',
      direction: 'outbound',
      target: { base_url: 'https://acme.myshopify.com' },
      auth: { secret_ref: 'env://ACME_SHOPIFY_ACCESS_TOKEN' },
      enabled: true,
    });
    const result = await handleEngineCommand(
      `/engine connectors acme create ${filePath}`,
      makeMockCtx(),
    );
    expect(result.handled).toBe(true);
  });

  it('handles /engine connectors plan', async () => {
    vi.mocked(getWorkflowEngineConfig).mockReturnValue({
      url: 'http://localhost:8080',
      apiKey: 'test-key',
    });
    const result = await handleEngineCommand('/engine connectors acme plan both', makeMockCtx());
    expect(result.handled).toBe(true);
  });

  it('handles /engine connectors sync', async () => {
    vi.mocked(getWorkflowEngineConfig).mockReturnValue({
      url: 'http://localhost:8080',
      apiKey: 'test-key',
    });
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'stateset-engine-sync-'));
    const result = await handleEngineCommand(
      '/engine connectors acme sync subscriptions',
      makeMockCtx(cwd),
    );
    expect(result.handled).toBe(true);
  });

  it('handles /engine connectors env', async () => {
    vi.mocked(getWorkflowEngineConfig).mockReturnValue({
      url: 'http://localhost:8080',
      apiKey: 'test-key',
    });
    const result = await handleEngineCommand(
      '/engine connectors acme env subscriptions dotenv out=.stateset/acme/engine-secrets.env',
      makeMockCtx('/tmp'),
    );
    expect(result.handled).toBe(true);
  });

  it('handles /engine local apply in write-only mode', async () => {
    vi.mocked(getWorkflowEngineConfig).mockReturnValue({
      url: 'http://localhost:8080',
      apiKey: 'test-key',
    });
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'stateset-local-apply-'));
    const composeFile = makeComposeFile(cwd);
    const result = await handleEngineCommand(
      `/engine local apply acme subscriptions compose=${composeFile} --write-only`,
      makeMockCtx(cwd),
    );
    expect(result.handled).toBe(true);
    expect(fs.existsSync(path.join(cwd, '.stateset', 'acme', 'engine-secrets.env'))).toBe(true);
    expect(spawnSync).not.toHaveBeenCalled();
  });

  it('handles /engine local apply and runs docker compose', async () => {
    vi.mocked(getWorkflowEngineConfig).mockReturnValue({
      url: 'http://localhost:8080',
      apiKey: 'test-key',
    });
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'stateset-local-run-'));
    const composeFile = makeComposeFile(cwd);
    const result = await handleEngineCommand(
      `/engine local apply acme compose=${composeFile} services=api,worker`,
      makeMockCtx(cwd),
    );
    expect(result.handled).toBe(true);
    expect(spawnSync).toHaveBeenCalledWith(
      'docker',
      expect.arrayContaining([
        'compose',
        '--env-file',
        path.join(cwd, '.stateset', 'acme', 'engine-secrets.env'),
        '-f',
        composeFile,
        'up',
        '-d',
        'api',
        'worker',
      ]),
      expect.objectContaining({
        cwd: path.dirname(composeFile),
        stdio: 'inherit',
      }),
    );
  });

  it('handles /engine test', async () => {
    vi.mocked(getWorkflowEngineConfig).mockReturnValue({
      url: 'http://localhost:8080',
      apiKey: 'test-key',
    });
    const result = await handleEngineCommand('/engine test acme 12345', makeMockCtx());
    expect(result.handled).toBe(true);
  });

  it('handles /engine event', async () => {
    vi.mocked(getWorkflowEngineConfig).mockReturnValue({
      url: 'http://localhost:8080',
      apiKey: 'test-key',
    });
    const filePath = makeJsonFile({
      event_type: 'message_received',
      workflow_type: 'response-automation-v2',
      payload: { ticket_id: '12345' },
    });
    const result = await handleEngineCommand(`/engine event acme ${filePath}`, makeMockCtx());
    expect(result.handled).toBe(true);
    expect(latestEngineClientMock().ingestEvent).toHaveBeenCalled();
  });

  it('handles /engine migration', async () => {
    vi.mocked(getWorkflowEngineConfig).mockReturnValue({
      url: 'http://localhost:8080',
      apiKey: 'test-key',
    });
    const result = await handleEngineCommand('/engine migration acme', makeMockCtx());
    expect(result.handled).toBe(true);
  });

  it('handles /engine migration update', async () => {
    vi.mocked(getWorkflowEngineConfig).mockReturnValue({
      url: 'http://localhost:8080',
      apiKey: 'test-key',
    });
    const filePath = makeJsonFile({ stage: 'canary', routing_mode: 'canary' });
    const result = await handleEngineCommand(
      `/engine migration update acme ${filePath}`,
      makeMockCtx(),
    );
    expect(result.handled).toBe(true);
  });

  it('handles /engine parity', async () => {
    vi.mocked(getWorkflowEngineConfig).mockReturnValue({
      url: 'http://localhost:8080',
      apiKey: 'test-key',
    });
    const result = await handleEngineCommand('/engine parity acme', makeMockCtx());
    expect(result.handled).toBe(true);
  });

  it('handles /engine templates create', async () => {
    vi.mocked(getWorkflowEngineConfig).mockReturnValue({
      url: 'http://localhost:8080',
      apiKey: 'test-key',
    });
    const filePath = makeJsonFile({
      template_key: 'ResponseAutomationV2',
      version: 1,
      workflow_type: 'response-automation-v2',
      runtime_target: 'temporal-rs',
      schema: {},
      determinism_contract: {},
    });
    const result = await handleEngineCommand(`/engine templates create ${filePath}`, makeMockCtx());
    expect(result.handled).toBe(true);
  });

  it('handles /engine templates update', async () => {
    vi.mocked(getWorkflowEngineConfig).mockReturnValue({
      url: 'http://localhost:8080',
      apiKey: 'test-key',
    });
    const filePath = makeJsonFile({ status: 'deprecated' });
    const result = await handleEngineCommand(
      `/engine templates update ResponseAutomationV2 1 ${filePath}`,
      makeMockCtx(),
    );
    expect(result.handled).toBe(true);
  });

  it('handles /engine policy-sets create', async () => {
    vi.mocked(getWorkflowEngineConfig).mockReturnValue({
      url: 'http://localhost:8080',
      apiKey: 'test-key',
    });
    const filePath = makeJsonFile({
      policy_set_key: 'default',
      version: 1,
      definition: {},
    });
    const result = await handleEngineCommand(
      `/engine policy-sets create ${filePath}`,
      makeMockCtx(),
    );
    expect(result.handled).toBe(true);
  });

  it('handles /engine policy-sets update', async () => {
    vi.mocked(getWorkflowEngineConfig).mockReturnValue({
      url: 'http://localhost:8080',
      apiKey: 'test-key',
    });
    const filePath = makeJsonFile({ status: 'deprecated' });
    const result = await handleEngineCommand(
      `/engine policy-sets update default 1 ${filePath}`,
      makeMockCtx(),
    );
    expect(result.handled).toBe(true);
  });

  it('falls through unknown subcommands to agent', async () => {
    vi.mocked(getWorkflowEngineConfig).mockReturnValue({
      url: 'http://localhost:8080',
      apiKey: 'test-key',
    });
    const result = await handleEngineCommand('/engine something-else', makeMockCtx());
    expect(result.handled).toBe(true);
    expect(result.sendMessage).toBeDefined();
  });
});

describe('handleWorkflowsCommand', () => {
  beforeEach(() => {
    vi.mocked(EngineClient).mockClear();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('returns not handled for non-workflows input', async () => {
    const result = await handleWorkflowsCommand('/help', makeMockCtx());
    expect(result.handled).toBe(false);
  });

  it('shows not-configured when engine is not set up', async () => {
    vi.mocked(getWorkflowEngineConfig).mockReturnValue(null);
    const result = await handleWorkflowsCommand('/workflows list acme', makeMockCtx());
    expect(result.handled).toBe(true);
  });

  it('handles /workflows status without id', async () => {
    vi.mocked(getWorkflowEngineConfig).mockReturnValue({
      url: 'http://localhost:8080',
      apiKey: 'test-key',
    });
    const result = await handleWorkflowsCommand('/workflows status', makeMockCtx());
    expect(result.handled).toBe(true);
  });

  it('handles /workflows cancel without id', async () => {
    vi.mocked(getWorkflowEngineConfig).mockReturnValue({
      url: 'http://localhost:8080',
      apiKey: 'test-key',
    });
    const result = await handleWorkflowsCommand('/workflows cancel', makeMockCtx());
    expect(result.handled).toBe(true);
  });

  it('handles /workflows retry without brand-id', async () => {
    vi.mocked(getWorkflowEngineConfig).mockReturnValue({
      url: 'http://localhost:8080',
      apiKey: 'test-key',
    });
    const result = await handleWorkflowsCommand('/workflows retry', makeMockCtx());
    expect(result.handled).toBe(true);
  });

  it('handles /wf alias', async () => {
    vi.mocked(getWorkflowEngineConfig).mockReturnValue(null);
    const result = await handleWorkflowsCommand('/wf list acme', makeMockCtx());
    expect(result.handled).toBe(true);
  });

  it('handles /workflows list', async () => {
    vi.mocked(getWorkflowEngineConfig).mockReturnValue({
      url: 'http://localhost:8080',
      apiKey: 'test-key',
    });
    const result = await handleWorkflowsCommand('/workflows list acme completed', makeMockCtx());
    expect(result.handled).toBe(true);
  });

  it('handles /workflows start delegates to agent', async () => {
    vi.mocked(getWorkflowEngineConfig).mockReturnValue({
      url: 'http://localhost:8080',
      apiKey: 'test-key',
    });
    const result = await handleWorkflowsCommand('/workflows start acme 12345', makeMockCtx());
    expect(result.handled).toBe(true);
    expect(result.sendMessage).toContain('acme');
  });

  it('handles /workflows restart', async () => {
    vi.mocked(getWorkflowEngineConfig).mockReturnValue({
      url: 'http://localhost:8080',
      apiKey: 'test-key',
    });
    const result = await handleWorkflowsCommand('/workflows restart rav2-123', makeMockCtx());
    expect(result.handled).toBe(true);
  });

  it('handles /workflows terminate', async () => {
    vi.mocked(getWorkflowEngineConfig).mockReturnValue({
      url: 'http://localhost:8080',
      apiKey: 'test-key',
    });
    const result = await handleWorkflowsCommand('/workflows terminate rav2-123', makeMockCtx());
    expect(result.handled).toBe(true);
  });

  it('handles /workflows review', async () => {
    vi.mocked(getWorkflowEngineConfig).mockReturnValue({
      url: 'http://localhost:8080',
      apiKey: 'test-key',
    });
    const result = await handleWorkflowsCommand(
      '/workflows review rav2-123 approve looks good',
      makeMockCtx(),
    );
    expect(result.handled).toBe(true);
  });
});
