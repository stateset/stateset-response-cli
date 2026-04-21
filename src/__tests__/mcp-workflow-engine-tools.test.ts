import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockClient } = vi.hoisted(() => ({
  mockClient: {
    health: vi.fn().mockResolvedValue({ ok: true }),
    healthz: vi.fn().mockResolvedValue({ ok: true }),
    readyz: vi.fn().mockResolvedValue({ ok: true }),
    metrics: vi.fn().mockResolvedValue('metrics 1'),
    getDispatchHealthDashboard: vi.fn().mockResolvedValue({ items: [] }),
    runDispatchGuard: vi.fn().mockResolvedValue({ actions: [] }),
    listBrands: vi.fn().mockResolvedValue({ items: [] }),
    getBrand: vi.fn().mockResolvedValue({ id: 'brand-1' }),
    createBrand: vi.fn().mockResolvedValue({ id: 'brand-1' }),
    updateBrand: vi.fn().mockResolvedValue({ id: 'brand-1' }),
    validateBrand: vi.fn().mockResolvedValue({ valid: true }),
    activateBrand: vi.fn().mockResolvedValue({ id: 'brand-1' }),
    getBrandConfig: vi.fn().mockResolvedValue({ config_version: 1 }),
    getBrandBillingState: vi.fn().mockResolvedValue({ summary: {} }),
    upsertBrandBillingProfile: vi.fn().mockResolvedValue({ provider: 'stripe' }),
    syncBrandBillingEvents: vi.fn().mockResolvedValue({ synced: 1 }),
    getBrandBillingContract: vi.fn().mockResolvedValue({ status: 'active' }),
    upsertBrandBillingContract: vi.fn().mockResolvedValue({ status: 'active' }),
    listBrandBillingPeriods: vi.fn().mockResolvedValue({ items: [] }),
    closeBrandBillingPeriod: vi.fn().mockResolvedValue({ id: 'period-1' }),
    listBrandRatedOutcomes: vi.fn().mockResolvedValue({ items: [] }),
    getBrandBillingReconciliation: vi.fn().mockResolvedValue({ balanced: true }),
    getBrandOutcomeSummary: vi.fn().mockResolvedValue({ total_count: 0 }),
    listBrandOutcomes: vi.fn().mockResolvedValue({ items: [] }),
    recordBrandOutcome: vi.fn().mockResolvedValue({ id: 'outcome-1' }),
    listBrandWorkflows: vi.fn().mockResolvedValue({ items: [] }),
    listBootstrapTemplates: vi.fn().mockResolvedValue([{ id: 'ecommerce' }]),
    bootstrapBrand: vi.fn().mockResolvedValue({ created: true }),
    listConnectors: vi.fn().mockResolvedValue({ items: [] }),
    createConnector: vi.fn().mockResolvedValue({ id: 'connector-1' }),
    replaceConnectors: vi.fn().mockResolvedValue({ items: [] }),
    checkConnectorHealth: vi.fn().mockResolvedValue({ ok: true }),
    listOnboardingRuns: vi.fn().mockResolvedValue({ items: [] }),
    createOnboardingRun: vi.fn().mockResolvedValue({ id: 'run-1' }),
    getOnboardingRun: vi.fn().mockResolvedValue({ id: 'run-1' }),
    updateOnboardingRun: vi.fn().mockResolvedValue({ id: 'run-1' }),
    getBrandMigrationState: vi.fn().mockResolvedValue({ current: {} }),
    updateBrandMigrationState: vi.fn().mockResolvedValue({ current: {} }),
    getBrandParityDashboard: vi.fn().mockResolvedValue({ summary: {} }),
    listWorkflowTemplates: vi.fn().mockResolvedValue({ items: [] }),
    getWorkflowTemplate: vi.fn().mockResolvedValue({ template_key: 'ResponseAutomationV2' }),
    createWorkflowTemplate: vi.fn().mockResolvedValue({ template_key: 'ResponseAutomationV2' }),
    updateWorkflowTemplate: vi.fn().mockResolvedValue({ template_key: 'ResponseAutomationV2' }),
    listPolicySets: vi.fn().mockResolvedValue({ items: [] }),
    getPolicySet: vi.fn().mockResolvedValue({ policy_set_key: 'default' }),
    createPolicySet: vi.fn().mockResolvedValue({ policy_set_key: 'default' }),
    updatePolicySet: vi.fn().mockResolvedValue({ policy_set_key: 'default' }),
    ingestEvent: vi.fn().mockResolvedValue({ workflow_id: 'rav2-1' }),
    startWorkflow: vi.fn().mockResolvedValue({ workflow_id: 'rav2-1' }),
    startLegacyResponseWorkflow: vi.fn().mockResolvedValue({ workflow_id: 'response-1' }),
    startSandboxAgentLoop: vi.fn().mockResolvedValue({ workflow_id: 'sandbox-agent-1' }),
    getWorkflowStatusForType: vi.fn().mockResolvedValue({ status: 'completed' }),
    reviewWorkflow: vi.fn().mockResolvedValue({ status: 'reviewed' }),
    cancelWorkflow: vi.fn().mockResolvedValue({ status: 'cancelled' }),
    restartWorkflow: vi.fn().mockResolvedValue({ status: 'restarted' }),
    terminateWorkflow: vi.fn().mockResolvedValue({ status: 'terminated' }),
    listDlq: vi.fn().mockResolvedValue({ items: [] }),
    retryDlqItem: vi.fn().mockResolvedValue({ id: 'dlq-1' }),
    resolveDlqItem: vi.fn().mockResolvedValue({ id: 'dlq-1' }),
  },
}));

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

import { registerWorkflowEngineTools } from '../mcp-server/tools/workflow-engine.js';

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

function makeMockServer() {
  const handlers: Record<string, ToolHandler> = {};
  const mockServer = {
    tool: vi.fn((name: string, _description: string, _schema: unknown, handler: ToolHandler) => {
      handlers[name] = handler;
    }),
  };
  return { handlers, mockServer };
}

describe('workflow engine MCP tools', () => {
  let handlers: Record<string, ToolHandler>;

  beforeEach(() => {
    vi.clearAllMocks();
    const ctx = makeMockServer();
    handlers = ctx.handlers;
    registerWorkflowEngineTools(ctx.mockServer as never, {
      url: 'http://engine.test',
      apiKey: 'test-key',
      tenantId: 'tenant-1',
    });
  });

  it('creates brands with the Rust control-plane required fields', async () => {
    const workflowBindings = [{ workflow_type: 'response-automation-v2', enabled: true }];
    await handlers.engine_create_brand({
      tenant_id: 'tenant-1',
      slug: 'acme',
      display_name: 'Acme',
      workflow_bindings: workflowBindings,
      routing_mode: 'shadow',
      metadata: { source: 'mcp' },
    });

    expect(mockClient.createBrand).toHaveBeenCalledWith({
      tenant_id: 'tenant-1',
      slug: 'acme',
      display_name: 'Acme',
      workflow_bindings: workflowBindings,
      routing_mode: 'shadow',
      metadata: { source: 'mcp' },
    });
    expect(mockClient.createBrand.mock.calls[0][0]).not.toHaveProperty('name');
    expect(mockClient.createBrand.mock.calls[0][0]).not.toHaveProperty('config');
  });

  it('updates brands with contract fields instead of legacy name/config patches', async () => {
    const workflowBindings = [{ workflow_type: 'response-automation-v2', enabled: true }];
    await handlers.engine_update_brand({
      brand_id: 'brand-1',
      display_name: 'Acme Updated',
      workflow_bindings: workflowBindings,
      quotas: { events_per_minute: 100 },
    });

    expect(mockClient.updateBrand).toHaveBeenCalledWith('brand-1', {
      display_name: 'Acme Updated',
      workflow_bindings: workflowBindings,
      quotas: { events_per_minute: 100 },
    });
  });

  it('creates connector bindings with the Rust ConnectorInput shape', async () => {
    await handlers.engine_create_connector({
      brand_id: 'brand-1',
      connector_key: 'shopify-primary',
      connector_type: 'shopify',
      direction: 'outbound',
      target: { base_url: 'https://acme.myshopify.com' },
      auth: { secret_ref: 'env://SHOPIFY_TOKEN' },
      metadata: { source: 'mcp' },
    });

    expect(mockClient.createConnector).toHaveBeenCalledWith('brand-1', {
      connector_key: 'shopify-primary',
      connector_type: 'shopify',
      direction: 'outbound',
      target: { base_url: 'https://acme.myshopify.com' },
      auth: { secret_ref: 'env://SHOPIFY_TOKEN' },
      enabled: true,
      metadata: { source: 'mcp' },
    });
    expect(mockClient.createConnector.mock.calls[0][1]).not.toHaveProperty('config');
  });

  it('creates workflow templates and policy sets with versioned engine contracts', async () => {
    await handlers.engine_create_workflow_template({
      template_key: 'ResponseAutomationV2',
      version: 1,
      workflow_type: 'response-automation-v2',
      runtime_target: 'temporal-rs',
      schema: { type: 'object' },
      determinism_contract: { max_randomness: 0 },
    });
    await handlers.engine_create_policy_set({
      policy_set_key: 'default',
      version: 1,
      definition: { rules: [] },
      status: 'active',
    });

    expect(mockClient.createWorkflowTemplate).toHaveBeenCalledWith({
      template_key: 'ResponseAutomationV2',
      version: 1,
      workflow_type: 'response-automation-v2',
      runtime_target: 'temporal-rs',
      schema: { type: 'object' },
      determinism_contract: { max_randomness: 0 },
    });
    expect(mockClient.createPolicySet).toHaveBeenCalledWith({
      policy_set_key: 'default',
      version: 1,
      definition: { rules: [] },
      status: 'active',
    });
  });

  it('exposes bootstrap, billing, outcomes, brand workflows, and dispatch parity tools', async () => {
    await handlers.engine_healthz({});
    await handlers.engine_readyz({});
    await handlers.engine_metrics({});
    await handlers.engine_bootstrap_brand({
      tenant_id: 'tenant-1',
      slug: 'acme',
      template: 'ecommerce',
      activate: true,
    });
    await handlers.engine_get_brand_billing_state({ brand_id: 'brand-1' });
    await handlers.engine_get_brand_outcome_summary({
      brand_id: 'brand-1',
      outcome_type: 'automated_resolution',
    });
    await handlers.engine_list_brand_outcomes({
      brand_id: 'brand-1',
      status: 'confirmed',
      outcome_type: 'automated_resolution',
      limit: 25,
    });
    await handlers.engine_record_brand_outcome({
      brand_id: 'brand-1',
      outcome_type: 'automated_resolution',
      status: 'confirmed',
      billable: true,
      metadata: { source: 'test' },
    });
    await handlers.engine_list_brand_workflows({ brand_id: 'brand-1', status: 'completed' });
    await handlers.engine_get_dispatch_health_dashboard({ tenant_id: 'tenant-1', limit: 10 });
    await handlers.engine_run_dispatch_guard({
      tenant_id: 'tenant-1',
      minimum_health_status: 'warning',
      max_actions: 5,
    });

    expect(mockClient.bootstrapBrand).toHaveBeenCalledWith({
      tenant_id: 'tenant-1',
      slug: 'acme',
      template: 'ecommerce',
      activate: true,
    });
    expect(mockClient.healthz).toHaveBeenCalled();
    expect(mockClient.readyz).toHaveBeenCalled();
    expect(mockClient.metrics).toHaveBeenCalled();
    expect(mockClient.getBrandBillingState).toHaveBeenCalledWith('brand-1');
    expect(mockClient.getBrandOutcomeSummary).toHaveBeenCalledWith('brand-1', {
      from: undefined,
      to: undefined,
      status: undefined,
      outcomeType: 'automated_resolution',
      source: undefined,
    });
    expect(mockClient.listBrandOutcomes).toHaveBeenCalledWith('brand-1', {
      from: undefined,
      to: undefined,
      status: 'confirmed',
      outcomeType: 'automated_resolution',
      source: undefined,
      limit: 25,
      offset: undefined,
    });
    expect(mockClient.recordBrandOutcome).toHaveBeenCalledWith('brand-1', {
      outcome_type: 'automated_resolution',
      status: 'confirmed',
      billable: true,
      metadata: { source: 'test' },
    });
    expect(mockClient.listBrandWorkflows).toHaveBeenCalledWith('brand-1', {
      status: 'completed',
      limit: undefined,
      offset: undefined,
    });
    expect(mockClient.getDispatchHealthDashboard).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      limit: 10,
      offset: undefined,
    });
    expect(mockClient.runDispatchGuard).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      apply: undefined,
      minimumHealthStatus: 'warning',
      maxActions: 5,
    });
  });

  it('exposes full brand billing parity tools with Rust-shaped payloads', async () => {
    await handlers.engine_upsert_brand_billing_profile({
      brand_id: 'brand-1',
      provider: 'stripe',
      billing_org_id: 'org-1',
      enabled: true,
    });
    await handlers.engine_sync_brand_billing_events({ brand_id: 'brand-1', limit: 25 });
    await handlers.engine_get_brand_billing_contract({ brand_id: 'brand-1' });
    await handlers.engine_upsert_brand_billing_contract({
      brand_id: 'brand-1',
      status: 'active',
      currency: 'USD',
      rates: [{ outcome_type: 'auto_respond', unit_amount_minor: 250 }],
    });
    await handlers.engine_list_brand_billing_periods({
      brand_id: 'brand-1',
      status: 'open',
      limit: 10,
    });
    await handlers.engine_close_brand_billing_period({
      brand_id: 'brand-1',
      period_id: 'period-1',
    });
    await handlers.engine_list_brand_rated_outcomes({
      brand_id: 'brand-1',
      rating_kind: 'usage',
      period_id: 'period-1',
    });
    await handlers.engine_get_brand_billing_reconciliation({ brand_id: 'brand-1' });

    expect(mockClient.upsertBrandBillingProfile).toHaveBeenCalledWith('brand-1', {
      provider: 'stripe',
      billing_org_id: 'org-1',
      enabled: true,
    });
    expect(mockClient.syncBrandBillingEvents).toHaveBeenCalledWith('brand-1', { limit: 25 });
    expect(mockClient.getBrandBillingContract).toHaveBeenCalledWith('brand-1');
    expect(mockClient.upsertBrandBillingContract).toHaveBeenCalledWith('brand-1', {
      status: 'active',
      currency: 'USD',
      rates: [{ outcome_type: 'auto_respond', unit_amount_minor: 250 }],
    });
    expect(mockClient.listBrandBillingPeriods).toHaveBeenCalledWith('brand-1', {
      status: 'open',
      limit: 10,
      offset: undefined,
    });
    expect(mockClient.closeBrandBillingPeriod).toHaveBeenCalledWith('brand-1', 'period-1');
    expect(mockClient.listBrandRatedOutcomes).toHaveBeenCalledWith('brand-1', {
      ratingKind: 'usage',
      periodId: 'period-1',
      from: undefined,
      to: undefined,
      limit: undefined,
      offset: undefined,
    });
    expect(mockClient.getBrandBillingReconciliation).toHaveBeenCalledWith('brand-1');
  });

  it('routes workflow operations through typed RAv2-compatible client methods', async () => {
    await handlers.engine_ingest_event({
      brand_slug: 'acme',
      event_type: 'message_received',
      payload: { ticket_id: 'ticket-1' },
      idempotency_key: 'idem-1',
    });
    await handlers.engine_start_legacy_response_workflow({
      brand: 'acme',
      ticket_id: 'ticket-1',
      workflow_id: 'response-custom',
    });
    await handlers.engine_start_sandbox_agent_loop({
      brand_id: '550e8400-e29b-41d4-a716-446655440000',
      request_id: '550e8400-e29b-41d4-a716-446655440001',
      loop: { commands: [['echo', 'ok']] },
    });
    await handlers.engine_get_workflow_status({
      workflow_id: 'sandbox-agent-123',
      workflow_type: 'sandbox-agent-loop',
    });
    await handlers.engine_get_workflow_status({
      workflow_id: 'workflow-1',
      workflow_type: 'response-automation-v2',
    });
    await handlers.engine_review_workflow({
      workflow_id: 'workflow-1',
      workflow_type: 'response-automation-v2',
      approved: true,
    });
    await handlers.engine_restart_workflow({
      workflow_id: 'workflow-1',
      workflow_type: 'response-automation-v2',
    });
    await handlers.engine_terminate_workflow({
      workflow_id: 'workflow-1',
      workflow_type: 'response-automation-v2',
    });

    expect(mockClient.ingestEvent).toHaveBeenCalledWith(
      'acme',
      expect.objectContaining({ workflow_type: 'response-automation-v2' }),
      'idem-1',
    );
    expect(mockClient.startLegacyResponseWorkflow).toHaveBeenCalledWith(
      { brand: 'acme', ticket_id: 'ticket-1', channel: 'email', payload: {} },
      'response-custom',
    );
    expect(mockClient.startSandboxAgentLoop).toHaveBeenCalledWith({
      brand_id: '550e8400-e29b-41d4-a716-446655440000',
      request_id: '550e8400-e29b-41d4-a716-446655440001',
      loop: { commands: [['echo', 'ok']] },
    });
    expect(mockClient.getWorkflowStatusForType).toHaveBeenCalledWith(
      'sandbox-agent-123',
      'sandbox-agent-loop',
    );
    expect(mockClient.getWorkflowStatusForType).toHaveBeenCalledWith(
      'workflow-1',
      'response-automation-v2',
    );
    expect(mockClient.reviewWorkflow).toHaveBeenCalledWith(
      'workflow-1',
      { approved: true, reason: undefined },
      'response-automation-v2',
    );
    expect(mockClient.restartWorkflow).toHaveBeenCalledWith('workflow-1', 'response-automation-v2');
    expect(mockClient.terminateWorkflow).toHaveBeenCalledWith(
      'workflow-1',
      'response-automation-v2',
    );
  });
});
