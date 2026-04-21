import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { EngineClient, EngineClientError } from '../../lib/engine-client.js';
import type { WorkflowEngineConfig } from '../../config.js';

function text(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

function errorResult(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true as const };
}

function handleError(err: unknown) {
  if (err instanceof EngineClientError) {
    return errorResult(`Engine error (${err.status ?? 'unknown'}): ${err.message}`);
  }
  return errorResult(String(err));
}

function cleanObject<T extends Record<string, unknown>>(value: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

const brandStatusSchema = z.enum(['draft', 'validating', 'active', 'suspended', 'archived']);
const routingModeSchema = z.enum(['legacy', 'shadow', 'canary', 'live']);
const runtimeTargetSchema = z.enum(['temporal-rs', 'stateset-engine']);
const versionedStatusSchema = z.enum(['active', 'deprecated']);
const billingContractRateSchema = z.object({
  outcome_type: z.string().describe('Outcome type this rate applies to'),
  display_name: z.string().optional().describe('Human-readable rate label'),
  unit_amount_minor: z.number().optional().describe('Per-unit amount in minor currency units'),
  included_quantity: z.number().optional().describe('Included units before overage pricing'),
  committed_unit_amount_minor: z
    .number()
    .optional()
    .describe('Committed per-unit amount in minor currency units'),
  metadata: z.record(z.unknown()).optional().describe('Rate metadata object'),
});

export function registerWorkflowEngineTools(server: McpServer, config: WorkflowEngineConfig) {
  const client = new EngineClient(config);

  /* ------------------------------------------------------------------ */
  /*  Health                                                            */
  /* ------------------------------------------------------------------ */

  server.tool('engine_health', 'Check the workflow engine health status', {}, async () => {
    try {
      const result = await client.health();
      return text(result);
    } catch (err) {
      return handleError(err);
    }
  });

  server.tool('engine_healthz', 'Check the Kubernetes-style liveness endpoint', {}, async () => {
    try {
      const result = await client.healthz();
      return text(result);
    } catch (err) {
      return handleError(err);
    }
  });

  server.tool('engine_readyz', 'Check the Kubernetes-style readiness endpoint', {}, async () => {
    try {
      const result = await client.readyz();
      return text(result);
    } catch (err) {
      return handleError(err);
    }
  });

  server.tool('engine_metrics', 'Fetch raw workflow engine metrics', {}, async () => {
    try {
      const result = await client.metrics();
      return text(result);
    } catch (err) {
      return handleError(err);
    }
  });

  server.tool(
    'engine_get_dispatch_health_dashboard',
    'Get dispatch health across tenants and brands',
    {
      tenant_id: z.string().optional().describe('Tenant UUID filter'),
      limit: z.number().optional().describe('Max results'),
      offset: z.number().optional().describe('Pagination offset'),
    },
    async (args) => {
      try {
        const result = await client.getDispatchHealthDashboard({
          tenantId: args.tenant_id,
          limit: args.limit,
          offset: args.offset,
        });
        return text(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  server.tool(
    'engine_run_dispatch_guard',
    'Plan or apply dispatch guard remediations for unhealthy brands',
    {
      tenant_id: z.string().optional().describe('Tenant UUID filter'),
      apply: z.boolean().optional().describe('Apply planned guard actions'),
      minimum_health_status: z
        .enum(['warning', 'critical'])
        .optional()
        .describe('Minimum health threshold for actions'),
      max_actions: z.number().optional().describe('Maximum actions to plan/apply'),
    },
    async (args) => {
      try {
        const result = await client.runDispatchGuard({
          tenantId: args.tenant_id,
          apply: args.apply,
          minimumHealthStatus: args.minimum_health_status,
          maxActions: args.max_actions,
        });
        return text(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  /* ------------------------------------------------------------------ */
  /*  Brands                                                            */
  /* ------------------------------------------------------------------ */

  server.tool(
    'engine_list_brands',
    'List brands in the workflow engine control plane',
    {
      status: z.string().optional().describe('Filter by status (e.g. "active", "onboarding")'),
      slug: z.string().optional().describe('Filter by brand slug'),
      limit: z.number().optional().describe('Max results (default 50)'),
      offset: z.number().optional().describe('Pagination offset'),
    },
    async (args) => {
      try {
        const result = await client.listBrands({
          status: args.status,
          slug: args.slug,
          limit: args.limit ?? 50,
          offset: args.offset,
        });
        return text(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  server.tool(
    'engine_get_brand',
    'Get a specific brand by ID from the workflow engine',
    {
      brand_id: z.string().describe('UUID of the brand'),
    },
    async ({ brand_id }) => {
      try {
        const result = await client.getBrand(brand_id);
        return text(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  server.tool(
    'engine_create_brand',
    'Create a new brand in the workflow engine control plane',
    {
      tenant_id: z.string().describe('UUID of the tenant'),
      slug: z.string().describe('URL-safe brand slug (e.g. "acme-co")'),
      display_name: z.string().describe('Brand display name'),
      workflow_bindings: z
        .array(z.record(z.unknown()))
        .min(1)
        .describe('Workflow bindings accepted by the Rust control-plane contract'),
      status: brandStatusSchema.optional().describe('Initial brand status'),
      routing_mode: routingModeSchema.optional().describe('Routing mode (default: shadow/draft)'),
      canary_percent: z.number().optional().describe('Canary percentage (0-100)'),
      region: z.string().optional().describe('Region identifier (e.g. "us")'),
      default_locale: z.string().optional().describe('Default locale (e.g. "en-US")'),
      policy_set_key: z.string().optional().describe('Policy set key to bind'),
      quotas: z.record(z.unknown()).optional().describe('Brand quota object'),
      metadata: z.record(z.unknown()).optional().describe('Brand metadata object'),
    },
    async (args) => {
      try {
        const result = await client.createBrand(
          cleanObject({
            tenant_id: args.tenant_id,
            slug: args.slug,
            display_name: args.display_name,
            workflow_bindings: args.workflow_bindings,
            status: args.status,
            routing_mode: args.routing_mode,
            canary_percent: args.canary_percent,
            region: args.region,
            default_locale: args.default_locale,
            policy_set_key: args.policy_set_key,
            quotas: args.quotas,
            metadata: args.metadata,
          }),
        );
        return text(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  server.tool(
    'engine_update_brand',
    'Update a brand in the workflow engine',
    {
      brand_id: z.string().describe('UUID of the brand to update'),
      display_name: z.string().optional().describe('New brand display name'),
      status: brandStatusSchema.optional().describe('New status'),
      routing_mode: routingModeSchema.optional().describe('New routing mode'),
      canary_percent: z.number().optional().describe('Canary percentage (0-100)'),
      region: z.string().optional().describe('Region identifier'),
      default_locale: z.string().optional().describe('Default locale'),
      policy_set_key: z.string().optional().describe('Policy set key to bind'),
      quotas: z.record(z.unknown()).optional().describe('Brand quota object'),
      metadata: z.record(z.unknown()).optional().describe('Brand metadata object'),
      workflow_bindings: z
        .array(z.record(z.unknown()))
        .optional()
        .describe('Replacement workflow bindings'),
    },
    async (args) => {
      try {
        const { brand_id, ...patch } = args;
        const result = await client.updateBrand(brand_id, cleanObject(patch));
        return text(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  server.tool(
    'engine_validate_brand',
    'Validate a brand configuration (checks connectors, workflow bindings, readiness)',
    {
      brand_id: z.string().describe('UUID of the brand to validate'),
    },
    async ({ brand_id }) => {
      try {
        const result = await client.validateBrand(brand_id);
        return text(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  server.tool(
    'engine_activate_brand',
    'Activate a brand for live workflow processing',
    {
      brand_id: z.string().describe('UUID of the brand to activate'),
      expected_config_version: z
        .number()
        .optional()
        .describe('Expected config version for optimistic concurrency'),
    },
    async (args) => {
      try {
        const result = await client.activateBrand(args.brand_id, args.expected_config_version);
        return text(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  server.tool(
    'engine_get_brand_config',
    'Get the effective (merged) configuration for a brand',
    {
      brand_id: z.string().describe('UUID of the brand'),
    },
    async ({ brand_id }) => {
      try {
        const result = await client.getBrandConfig(brand_id);
        return text(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  server.tool(
    'engine_get_brand_billing_state',
    'Get billing profile, forecast, and sync state for a brand',
    {
      brand_id: z.string().describe('UUID of the brand'),
    },
    async ({ brand_id }) => {
      try {
        const result = await client.getBrandBillingState(brand_id);
        return text(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  server.tool(
    'engine_upsert_brand_billing_profile',
    'Create or update the billing profile for a brand',
    {
      brand_id: z.string().describe('UUID of the brand'),
      provider: z.string().optional().describe('Billing provider identifier'),
      billing_org_id: z.string().optional().describe('Provider organization/customer grouping ID'),
      stripe_customer_id: z.string().optional().describe('Stripe customer ID'),
      stripe_subscription_id: z.string().optional().describe('Stripe subscription ID'),
      billing_email: z.string().optional().describe('Billing contact email'),
      pricing_model: z.string().optional().describe('Pricing model key'),
      default_currency: z.string().optional().describe('Default currency code'),
      meter_event_namespace: z.string().optional().describe('Meter event namespace'),
      meter_event_overrides: z.record(z.unknown()).optional().describe('Meter override map'),
      enabled: z.boolean().optional().describe('Whether billing sync is enabled'),
      metadata: z.record(z.unknown()).optional().describe('Billing profile metadata'),
    },
    async (args) => {
      try {
        const result = await client.upsertBrandBillingProfile(
          args.brand_id,
          cleanObject({
            provider: args.provider,
            billing_org_id: args.billing_org_id,
            stripe_customer_id: args.stripe_customer_id,
            stripe_subscription_id: args.stripe_subscription_id,
            billing_email: args.billing_email,
            pricing_model: args.pricing_model,
            default_currency: args.default_currency,
            meter_event_namespace: args.meter_event_namespace,
            meter_event_overrides: args.meter_event_overrides,
            enabled: args.enabled,
            metadata: args.metadata,
          }),
        );
        return text(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  server.tool(
    'engine_sync_brand_billing_events',
    'Sync pending billing events for a brand',
    {
      brand_id: z.string().describe('UUID of the brand'),
      limit: z.number().optional().describe('Maximum events to sync'),
    },
    async (args) => {
      try {
        const result = await client.syncBrandBillingEvents(args.brand_id, {
          limit: args.limit,
        });
        return text(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  server.tool(
    'engine_get_brand_billing_contract',
    'Get the active billing contract for a brand',
    {
      brand_id: z.string().describe('UUID of the brand'),
    },
    async ({ brand_id }) => {
      try {
        const result = await client.getBrandBillingContract(brand_id);
        return text(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  server.tool(
    'engine_upsert_brand_billing_contract',
    'Create or update the billing contract and nested outcome rates for a brand',
    {
      brand_id: z.string().describe('UUID of the brand'),
      status: z.string().optional().describe('Contract status'),
      currency: z.string().optional().describe('Contract currency code'),
      period: z.string().optional().describe('Billing period key'),
      display_name: z.string().optional().describe('Contract display name'),
      commitment_label: z.string().optional().describe('Commitment label'),
      commitment_fee_minor: z.number().optional().describe('Commitment fee in minor units'),
      default_unit_amount_minor: z.number().optional().describe('Default per-unit amount'),
      included_quantity: z.number().optional().describe('Included units for the contract'),
      starts_at: z.string().optional().describe('Contract start timestamp (ISO 8601)'),
      ends_at: z.string().optional().describe('Contract end timestamp (ISO 8601)'),
      metadata: z.record(z.unknown()).optional().describe('Contract metadata'),
      rates: z.array(billingContractRateSchema).optional().describe('Outcome-specific rates'),
    },
    async (args) => {
      try {
        const result = await client.upsertBrandBillingContract(
          args.brand_id,
          cleanObject({
            status: args.status,
            currency: args.currency,
            period: args.period,
            display_name: args.display_name,
            commitment_label: args.commitment_label,
            commitment_fee_minor: args.commitment_fee_minor,
            default_unit_amount_minor: args.default_unit_amount_minor,
            included_quantity: args.included_quantity,
            starts_at: args.starts_at,
            ends_at: args.ends_at,
            metadata: args.metadata,
            rates: args.rates,
          }),
        );
        return text(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  server.tool(
    'engine_list_brand_billing_periods',
    'List billing contract periods for a brand',
    {
      brand_id: z.string().describe('UUID of the brand'),
      status: z.string().optional().describe('Period status filter'),
      limit: z.number().optional().describe('Max results'),
      offset: z.number().optional().describe('Pagination offset'),
    },
    async (args) => {
      try {
        const result = await client.listBrandBillingPeriods(args.brand_id, {
          status: args.status,
          limit: args.limit,
          offset: args.offset,
        });
        return text(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  server.tool(
    'engine_close_brand_billing_period',
    'Close a billing period for a brand',
    {
      brand_id: z.string().describe('UUID of the brand'),
      period_id: z.string().describe('UUID of the billing period'),
    },
    async ({ brand_id, period_id }) => {
      try {
        const result = await client.closeBrandBillingPeriod(brand_id, period_id);
        return text(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  server.tool(
    'engine_list_brand_rated_outcomes',
    'List rated billing outcomes for a brand',
    {
      brand_id: z.string().describe('UUID of the brand'),
      rating_kind: z.string().optional().describe('Rating kind filter'),
      period_id: z.string().optional().describe('Billing period UUID filter'),
      from: z.string().optional().describe('Start timestamp (ISO 8601)'),
      to: z.string().optional().describe('End timestamp (ISO 8601)'),
      limit: z.number().optional().describe('Max results'),
      offset: z.number().optional().describe('Pagination offset'),
    },
    async (args) => {
      try {
        const result = await client.listBrandRatedOutcomes(args.brand_id, {
          ratingKind: args.rating_kind,
          periodId: args.period_id,
          from: args.from,
          to: args.to,
          limit: args.limit,
          offset: args.offset,
        });
        return text(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  server.tool(
    'engine_get_brand_billing_reconciliation',
    'Get the billing reconciliation report for a brand',
    {
      brand_id: z.string().describe('UUID of the brand'),
    },
    async ({ brand_id }) => {
      try {
        const result = await client.getBrandBillingReconciliation(brand_id);
        return text(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  server.tool(
    'engine_get_brand_outcome_summary',
    'Get outcome counts and values for a brand',
    {
      brand_id: z.string().describe('UUID of the brand'),
      from: z.string().optional().describe('Start date/time (ISO 8601)'),
      to: z.string().optional().describe('End date/time (ISO 8601)'),
      status: z.string().optional().describe('Outcome status filter'),
      outcome_type: z.string().optional().describe('Outcome type filter'),
      source: z.string().optional().describe('Outcome source filter'),
    },
    async (args) => {
      try {
        const result = await client.getBrandOutcomeSummary(args.brand_id, {
          from: args.from,
          to: args.to,
          status: args.status,
          outcomeType: args.outcome_type,
          source: args.source,
        });
        return text(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  server.tool(
    'engine_list_brand_outcomes',
    'List recorded outcomes for a brand',
    {
      brand_id: z.string().describe('UUID of the brand'),
      from: z.string().optional().describe('Start date/time (ISO 8601)'),
      to: z.string().optional().describe('End date/time (ISO 8601)'),
      status: z.string().optional().describe('Outcome status filter'),
      outcome_type: z.string().optional().describe('Outcome type filter'),
      source: z.string().optional().describe('Outcome source filter'),
      limit: z.number().optional().describe('Max results'),
      offset: z.number().optional().describe('Pagination offset'),
    },
    async (args) => {
      try {
        const result = await client.listBrandOutcomes(args.brand_id, {
          from: args.from,
          to: args.to,
          status: args.status,
          outcomeType: args.outcome_type,
          source: args.source,
          limit: args.limit,
          offset: args.offset,
        });
        return text(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  server.tool(
    'engine_record_brand_outcome',
    'Record an outcome for a brand',
    {
      brand_id: z.string().describe('UUID of the brand'),
      workflow_execution_id: z.string().optional().describe('Workflow execution UUID'),
      workflow_id: z.string().optional().describe('Temporal workflow ID'),
      external_id: z.string().optional().describe('External ticket/order/message ID'),
      outcome_type: z.string().optional().describe('Outcome type'),
      status: z.string().optional().describe('Outcome status'),
      source: z.string().optional().describe('Outcome source'),
      channel: z.string().optional().describe('Channel, e.g. email or chat'),
      currency: z.string().optional().describe('Currency code'),
      value_minor: z.number().optional().describe('Outcome value in minor currency units'),
      quantity: z.number().optional().describe('Outcome quantity'),
      dedupe_key: z.string().optional().describe('Idempotency/deduplication key'),
      billable: z.boolean().optional().describe('Whether this outcome is billable'),
      metadata: z.record(z.unknown()).optional().describe('Outcome metadata'),
      occurred_at: z.string().optional().describe('Occurrence timestamp (ISO 8601)'),
    },
    async (args) => {
      try {
        const { brand_id, ...payload } = args;
        const result = await client.recordBrandOutcome(brand_id, cleanObject(payload));
        return text(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  server.tool(
    'engine_list_brand_workflows',
    'List workflow executions for a brand',
    {
      brand_id: z.string().describe('UUID of the brand'),
      status: z.string().optional().describe('Workflow status filter'),
      limit: z.number().optional().describe('Max results'),
      offset: z.number().optional().describe('Pagination offset'),
    },
    async (args) => {
      try {
        const result = await client.listBrandWorkflows(args.brand_id, {
          status: args.status,
          limit: args.limit,
          offset: args.offset,
        });
        return text(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  server.tool(
    'engine_list_bootstrap_templates',
    'List workflow engine bootstrap templates for new brands',
    {},
    async () => {
      try {
        const result = await client.listBootstrapTemplates();
        return text(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  server.tool(
    'engine_bootstrap_brand',
    'Bootstrap a brand with a workflow template and optional activation',
    {
      tenant_id: z.string().optional().describe('Tenant UUID; required when creating by slug'),
      brand_id: z.string().optional().describe('Existing brand UUID to bootstrap'),
      slug: z.string().optional().describe('New or existing brand slug'),
      display_name: z.string().optional().describe('Display name when creating by slug'),
      template: z.string().optional().describe('Bootstrap template id'),
      routing_mode: routingModeSchema.optional().describe('Initial routing mode'),
      activate: z.boolean().optional().describe('Validate and activate after bootstrapping'),
      metadata: z.record(z.unknown()).optional().describe('Brand metadata object'),
    },
    async (args) => {
      try {
        const result = await client.bootstrapBrand(cleanObject(args));
        return text(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  /* ------------------------------------------------------------------ */
  /*  Connectors                                                        */
  /* ------------------------------------------------------------------ */

  server.tool(
    'engine_list_connectors',
    'List connector bindings for a brand (Shopify, Gorgias, Recharge, etc.)',
    {
      brand_id: z.string().describe('UUID of the brand'),
    },
    async ({ brand_id }) => {
      try {
        const result = await client.listConnectors(brand_id);
        return text(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  server.tool(
    'engine_create_connector',
    'Create a connector binding for a brand (e.g. Shopify, Gorgias, Recharge, Qdrant)',
    {
      brand_id: z.string().describe('UUID of the brand'),
      connector_key: z.string().describe('Stable connector key (e.g. "shopify-primary")'),
      connector_type: z
        .string()
        .describe('Connector type (e.g. "shopify", "gorgias", "recharge", "qdrant", "pinecone")'),
      direction: z.enum(['inbound', 'outbound']).describe('Connector direction'),
      target: z
        .record(z.unknown())
        .describe('Connector target object (base_url, api_version, etc.)'),
      auth: z
        .record(z.unknown())
        .optional()
        .describe('Connector auth object with env:// secret_ref'),
      retry_policy: z.record(z.unknown()).optional().describe('Connector retry policy'),
      enabled: z.boolean().optional().describe('Whether the connector is enabled'),
      metadata: z.record(z.unknown()).optional().describe('Connector metadata'),
    },
    async (args) => {
      try {
        const result = await client.createConnector(
          args.brand_id,
          cleanObject({
            connector_key: args.connector_key,
            connector_type: args.connector_type,
            direction: args.direction,
            target: args.target,
            auth: args.auth ?? {},
            retry_policy: args.retry_policy,
            enabled: args.enabled ?? true,
            metadata: args.metadata,
          }),
        );
        return text(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  server.tool(
    'engine_replace_connectors',
    'Replace all connector bindings for a brand with the provided contract-safe connector list',
    {
      brand_id: z.string().describe('UUID of the brand'),
      connectors: z.array(z.record(z.unknown())).describe('Full connector binding list'),
    },
    async (args) => {
      try {
        const result = await client.replaceConnectors(args.brand_id, args.connectors);
        return text(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  server.tool(
    'engine_check_connector_health',
    'Check health of a specific connector binding',
    {
      brand_id: z.string().describe('UUID of the brand'),
      connector_id: z.string().describe('UUID of the connector'),
    },
    async (args) => {
      try {
        const result = await client.checkConnectorHealth(args.brand_id, args.connector_id);
        return text(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  /* ------------------------------------------------------------------ */
  /*  Onboarding                                                        */
  /* ------------------------------------------------------------------ */

  server.tool(
    'engine_list_onboarding_runs',
    'List onboarding runs for a brand',
    {
      brand_id: z.string().describe('UUID of the brand'),
    },
    async ({ brand_id }) => {
      try {
        const result = await client.listOnboardingRuns(brand_id);
        return text(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  server.tool(
    'engine_create_onboarding_run',
    'Start a new onboarding run for a brand',
    {
      brand_id: z.string().describe('UUID of the brand'),
      notes: z.string().optional().describe('Optional notes for the onboarding run'),
    },
    async (args) => {
      try {
        const result = await client.createOnboardingRun(args.brand_id, args.notes);
        return text(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  server.tool(
    'engine_get_onboarding_run',
    'Get details of a specific onboarding run',
    {
      brand_id: z.string().describe('UUID of the brand'),
      run_id: z.string().describe('UUID of the onboarding run'),
    },
    async (args) => {
      try {
        const result = await client.getOnboardingRun(args.brand_id, args.run_id);
        return text(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  server.tool(
    'engine_update_onboarding_run',
    'Update an onboarding run (status, checks, notes)',
    {
      brand_id: z.string().describe('UUID of the brand'),
      run_id: z.string().describe('UUID of the onboarding run'),
      status: z.string().optional().describe('New status'),
      checks: z.record(z.unknown()).optional().describe('Onboarding check results'),
      notes: z.string().optional().describe('Notes'),
    },
    async (args) => {
      try {
        const result = await client.updateOnboardingRun(args.brand_id, args.run_id, {
          status: args.status,
          checks: args.checks,
          notes: args.notes,
        });
        return text(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  /* ------------------------------------------------------------------ */
  /*  Migration & Parity                                                */
  /* ------------------------------------------------------------------ */

  server.tool(
    'engine_get_migration_state',
    'Get the migration state for a brand (legacy → new engine)',
    {
      brand_id: z.string().describe('UUID of the brand'),
    },
    async ({ brand_id }) => {
      try {
        const result = await client.getBrandMigrationState(brand_id);
        return text(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  server.tool(
    'engine_update_migration_state',
    'Update migration state for a brand (routing_mode, shadow %, canary %)',
    {
      brand_id: z.string().describe('UUID of the brand'),
      routing_mode: z
        .enum(['legacy', 'shadow', 'canary', 'live'])
        .optional()
        .describe('Target routing mode'),
      canary_percent: z.number().optional().describe('Canary percentage (0-100)'),
      shadow_enabled: z.boolean().optional().describe('Enable shadow mode'),
    },
    async (args) => {
      try {
        const { brand_id, ...patch } = args;
        const result = await client.updateBrandMigrationState(brand_id, cleanObject(patch));
        return text(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  server.tool(
    'engine_get_parity_dashboard',
    'Get parity comparison dashboard for a brand (old vs new engine outcomes)',
    {
      brand_id: z.string().describe('UUID of the brand'),
      from: z.string().optional().describe('Start date (ISO 8601)'),
      to: z.string().optional().describe('End date (ISO 8601)'),
    },
    async (args) => {
      try {
        const result = await client.getBrandParityDashboard(args.brand_id, {
          from: args.from,
          to: args.to,
        });
        return text(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  /* ------------------------------------------------------------------ */
  /*  Workflow Templates                                                */
  /* ------------------------------------------------------------------ */

  server.tool(
    'engine_list_workflow_templates',
    'List workflow templates (versioned automation configurations)',
    {
      template_key: z.string().optional().describe('Filter by template key'),
      workflow_type: z.string().optional().describe('Filter by workflow type'),
      status: z.string().optional().describe('Filter by status'),
      limit: z.number().optional().describe('Max results'),
      offset: z.number().optional().describe('Pagination offset'),
    },
    async (args) => {
      try {
        const result = await client.listWorkflowTemplates(args);
        return text(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  server.tool(
    'engine_get_workflow_template',
    'Get a workflow template by key (optionally at a specific version)',
    {
      template_key: z.string().describe('Template key identifier'),
      version: z.number().optional().describe('Specific version number'),
    },
    async (args) => {
      try {
        const result = await client.getWorkflowTemplate(args.template_key, args.version);
        return text(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  server.tool(
    'engine_create_workflow_template',
    'Create a new workflow template',
    {
      template_key: z.string().describe('Unique template key'),
      version: z.number().describe('Template version'),
      workflow_type: z.string().describe('Workflow type (e.g. "response-automation-v2")'),
      runtime_target: runtimeTargetSchema.describe('Runtime target for this template'),
      schema: z.record(z.unknown()).describe('Template JSON schema'),
      determinism_contract: z
        .record(z.unknown())
        .describe('Determinism contract enforced by the Rust engine'),
      status: versionedStatusSchema.optional().describe('Template status'),
    },
    async (args) => {
      try {
        const result = await client.createWorkflowTemplate(cleanObject(args));
        return text(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  server.tool(
    'engine_update_workflow_template',
    'Update a workflow template at a specific version',
    {
      template_key: z.string().describe('Template key'),
      version: z.number().describe('Version number to update'),
      workflow_type: z.string().optional().describe('New workflow type'),
      runtime_target: runtimeTargetSchema.optional().describe('New runtime target'),
      schema: z.record(z.unknown()).optional().describe('Replacement template JSON schema'),
      determinism_contract: z
        .record(z.unknown())
        .optional()
        .describe('Replacement determinism contract'),
      status: versionedStatusSchema.optional().describe('New status'),
    },
    async (args) => {
      try {
        const { template_key, version, ...patch } = args;
        const result = await client.updateWorkflowTemplate(
          template_key,
          version,
          cleanObject(patch),
        );
        return text(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  /* ------------------------------------------------------------------ */
  /*  Policy Sets                                                       */
  /* ------------------------------------------------------------------ */

  server.tool(
    'engine_list_policy_sets',
    'List policy sets (versioned policy configurations for workflow behavior)',
    {
      policy_set_key: z.string().optional().describe('Filter by policy set key'),
      status: z.string().optional().describe('Filter by status'),
      limit: z.number().optional().describe('Max results'),
      offset: z.number().optional().describe('Pagination offset'),
    },
    async (args) => {
      try {
        const result = await client.listPolicySets(args);
        return text(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  server.tool(
    'engine_get_policy_set',
    'Get a policy set by key (optionally at a specific version)',
    {
      policy_set_key: z.string().describe('Policy set key identifier'),
      version: z.number().optional().describe('Specific version number'),
    },
    async (args) => {
      try {
        const result = await client.getPolicySet(args.policy_set_key, args.version);
        return text(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  server.tool(
    'engine_create_policy_set',
    'Create a new policy set',
    {
      policy_set_key: z.string().describe('Unique policy set key'),
      version: z.number().describe('Policy set version'),
      definition: z.record(z.unknown()).describe('Policy set definition'),
      status: versionedStatusSchema.optional().describe('Policy set status'),
    },
    async (args) => {
      try {
        const result = await client.createPolicySet(cleanObject(args));
        return text(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  server.tool(
    'engine_update_policy_set',
    'Update a policy set at a specific version',
    {
      policy_set_key: z.string().describe('Policy set key'),
      version: z.number().describe('Version number to update'),
      definition: z.record(z.unknown()).optional().describe('Replacement policy definition'),
      status: versionedStatusSchema.optional().describe('New status'),
    },
    async (args) => {
      try {
        const { policy_set_key, version, ...patch } = args;
        const result = await client.updatePolicySet(policy_set_key, version, cleanObject(patch));
        return text(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  /* ------------------------------------------------------------------ */
  /*  Events                                                            */
  /* ------------------------------------------------------------------ */

  server.tool(
    'engine_ingest_event',
    'Ingest an event for a brand to trigger workflow processing',
    {
      brand_slug: z.string().describe('Brand slug (e.g. "acme-co")'),
      event_type: z.string().describe('Event type (e.g. "message_received")'),
      workflow_type: z
        .string()
        .optional()
        .describe('Workflow type (default: "response-automation-v2")'),
      source: z.string().optional().describe('Event source (e.g. "gorgias")'),
      external_id: z.string().optional().describe('External event ID'),
      payload: z.record(z.unknown()).describe('Event payload (ticket_id, dry_run, etc.)'),
      idempotency_key: z.string().describe('Unique idempotency key for deduplication'),
    },
    async (args) => {
      try {
        const result = await client.ingestEvent(
          args.brand_slug,
          {
            event_type: args.event_type,
            workflow_type: args.workflow_type ?? 'response-automation-v2',
            source: args.source,
            external_id: args.external_id,
            payload: args.payload,
          },
          args.idempotency_key,
        );
        return text(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  /* ------------------------------------------------------------------ */
  /*  Workflows                                                         */
  /* ------------------------------------------------------------------ */

  server.tool(
    'engine_start_workflow',
    'Start a response automation v2 workflow',
    {
      brand: z.string().describe('Brand slug'),
      ticket_id: z.string().describe('Ticket ID to process'),
      channel: z.string().optional().describe('Channel (e.g. "email", "chat")'),
      payload: z.record(z.unknown()).optional().describe('Additional payload'),
      workflow_id: z.string().optional().describe('Custom workflow ID (auto-generated if omitted)'),
    },
    async (args) => {
      try {
        const result = await client.startWorkflow(
          {
            brand: args.brand,
            ticket_id: args.ticket_id,
            channel: args.channel ?? 'email',
            payload: args.payload ?? {},
          },
          args.workflow_id,
        );
        return text(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  server.tool(
    'engine_start_legacy_response_workflow',
    'Start a legacy response workflow through the v1 response endpoint',
    {
      brand: z.string().describe('Brand slug'),
      ticket_id: z.string().describe('Ticket ID to process'),
      channel: z.string().optional().describe('Channel (e.g. "email", "chat")'),
      payload: z.record(z.unknown()).optional().describe('Additional payload'),
      workflow_id: z.string().optional().describe('Custom workflow ID (auto-generated if omitted)'),
    },
    async (args) => {
      try {
        const result = await client.startLegacyResponseWorkflow(
          {
            brand: args.brand,
            ticket_id: args.ticket_id,
            channel: args.channel ?? 'email',
            payload: args.payload ?? {},
          },
          args.workflow_id,
        );
        return text(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  server.tool(
    'engine_start_sandbox_agent_loop',
    'Start a sandbox agent loop workflow',
    {
      brand_id: z.string().describe('Brand UUID'),
      request_id: z.string().describe('Request UUID used to derive workflow ID'),
      loop: z
        .record(z.unknown())
        .describe('SandboxAgentLoopInput object with session and non-empty commands'),
    },
    async (args) => {
      try {
        const result = await client.startSandboxAgentLoop({
          brand_id: args.brand_id,
          request_id: args.request_id,
          loop: args.loop,
        });
        return text(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  server.tool(
    'engine_get_workflow_status',
    'Get the status of a running response automation workflow',
    {
      workflow_id: z.string().describe('Workflow ID'),
      workflow_type: z
        .enum(['response-automation-v2', 'connector', 'snooze', 'sandbox-agent-loop', 'legacy'])
        .optional()
        .describe('Workflow type override when the id prefix is ambiguous'),
    },
    async ({ workflow_id, workflow_type }) => {
      try {
        const result = await client.getWorkflowStatusForType(workflow_id, workflow_type);
        return text(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  server.tool(
    'engine_review_workflow',
    'Submit a review decision (approve/reject) for a workflow awaiting review',
    {
      workflow_id: z.string().describe('Workflow ID'),
      workflow_type: z
        .enum(['response-automation-v2', 'legacy'])
        .optional()
        .describe('Workflow type override when the id prefix is ambiguous'),
      approved: z.boolean().describe('Whether to approve the workflow response'),
      reason: z.string().optional().describe('Reason for the decision'),
    },
    async (args) => {
      try {
        const result = await client.reviewWorkflow(
          args.workflow_id,
          {
            approved: args.approved,
            reason: args.reason,
          },
          args.workflow_type,
        );
        return text(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  server.tool(
    'engine_cancel_workflow',
    'Cancel a running workflow',
    {
      workflow_id: z.string().describe('Workflow ID to cancel'),
      workflow_type: z
        .enum(['response-automation-v2', 'connector', 'snooze', 'sandbox-agent-loop', 'legacy'])
        .optional()
        .describe('Workflow type override when the id prefix is ambiguous'),
    },
    async ({ workflow_id, workflow_type }) => {
      try {
        const result = await client.cancelWorkflow(workflow_id, workflow_type);
        return text(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  server.tool(
    'engine_restart_workflow',
    'Restart a response automation v2 workflow',
    {
      workflow_id: z.string().describe('Workflow ID to restart'),
      workflow_type: z
        .enum(['response-automation-v2'])
        .optional()
        .describe('Workflow type override; only response-automation-v2 supports restart'),
    },
    async ({ workflow_id, workflow_type }) => {
      try {
        const result = await client.restartWorkflow(workflow_id, workflow_type);
        return text(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  server.tool(
    'engine_terminate_workflow',
    'Terminate a running workflow',
    {
      workflow_id: z.string().describe('Workflow ID to terminate'),
      workflow_type: z
        .enum(['response-automation-v2', 'connector', 'snooze', 'sandbox-agent-loop', 'legacy'])
        .optional()
        .describe('Workflow type override when the id prefix is ambiguous'),
    },
    async ({ workflow_id, workflow_type }) => {
      try {
        const result = await client.terminateWorkflow(workflow_id, workflow_type);
        return text(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  /* ------------------------------------------------------------------ */
  /*  DLQ                                                               */
  /* ------------------------------------------------------------------ */

  server.tool(
    'engine_list_dlq',
    'List dead-letter queue items for a brand (failed workflow dispatches)',
    {
      brand_id: z.string().describe('UUID of the brand'),
      status: z.string().optional().describe('Filter by DLQ status'),
      limit: z.number().optional().describe('Max results'),
      offset: z.number().optional().describe('Pagination offset'),
    },
    async (args) => {
      try {
        const result = await client.listDlq(args.brand_id, {
          status: args.status,
          limit: args.limit,
          offset: args.offset,
        });
        return text(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  server.tool(
    'engine_retry_dlq_item',
    'Retry a dead-letter queue item (re-dispatch the failed workflow)',
    {
      brand_id: z.string().describe('UUID of the brand'),
      dlq_id: z.string().describe('UUID of the DLQ item'),
    },
    async (args) => {
      try {
        const result = await client.retryDlqItem(args.brand_id, args.dlq_id);
        return text(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  server.tool(
    'engine_resolve_dlq_item',
    'Resolve (acknowledge) a dead-letter queue item without retrying',
    {
      brand_id: z.string().describe('UUID of the brand'),
      dlq_id: z.string().describe('UUID of the DLQ item'),
      action: z.string().optional().describe('Resolution action'),
      notes: z.string().optional().describe('Resolution notes'),
    },
    async (args) => {
      try {
        const result = await client.resolveDlqItem(args.brand_id, args.dlq_id, {
          action: args.action,
          notes: args.notes,
        });
        return text(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );
}
