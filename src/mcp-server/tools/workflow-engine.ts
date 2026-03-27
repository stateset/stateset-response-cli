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
      name: z.string().describe('Brand display name'),
      slug: z.string().describe('URL-safe brand slug (e.g. "acme-co")'),
      routing_mode: z
        .enum(['legacy', 'shadow', 'canary', 'live'])
        .optional()
        .describe('Routing mode (default: legacy)'),
      config: z.record(z.unknown()).optional().describe('Initial brand configuration JSON'),
    },
    async (args) => {
      try {
        const result = await client.createBrand({
          tenant_id: args.tenant_id,
          name: args.name,
          slug: args.slug,
          routing_mode: args.routing_mode,
          config: args.config,
        });
        return text(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  server.tool(
    'engine_update_brand',
    'Update a brand in the workflow engine (name, routing_mode, status, config)',
    {
      brand_id: z.string().describe('UUID of the brand to update'),
      name: z.string().optional().describe('New brand name'),
      routing_mode: z
        .enum(['legacy', 'shadow', 'canary', 'live'])
        .optional()
        .describe('New routing mode'),
      status: z.string().optional().describe('New status'),
      config: z
        .record(z.unknown())
        .optional()
        .describe('Brand configuration patch (merged into existing)'),
    },
    async (args) => {
      try {
        const { brand_id, ...patch } = args;
        const cleaned = Object.fromEntries(
          Object.entries(patch).filter(([, v]) => v !== undefined),
        );
        const result = await client.updateBrand(brand_id, cleaned);
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
      connector_type: z
        .string()
        .describe('Connector type (e.g. "shopify", "gorgias", "recharge", "qdrant", "pinecone")'),
      config: z
        .record(z.unknown())
        .describe('Connector configuration (credentials, endpoints, etc.)'),
    },
    async (args) => {
      try {
        const result = await client.createConnector(args.brand_id, {
          connector_type: args.connector_type,
          config: args.config,
        });
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
        const cleaned = Object.fromEntries(
          Object.entries(patch).filter(([, v]) => v !== undefined),
        );
        const result = await client.updateBrandMigrationState(brand_id, cleaned);
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
      workflow_type: z.string().describe('Workflow type (e.g. "response_automation_v2")'),
      name: z.string().describe('Human-readable template name'),
      description: z.string().optional().describe('Template description'),
      config: z
        .record(z.unknown())
        .describe(
          'Template configuration (skip_rules, escalation_rules, tool_definitions, LLM settings, etc.)',
        ),
    },
    async (args) => {
      try {
        const result = await client.createWorkflowTemplate(args);
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
      name: z.string().optional().describe('New name'),
      description: z.string().optional().describe('New description'),
      status: z.string().optional().describe('New status'),
      config: z.record(z.unknown()).optional().describe('Configuration patch'),
    },
    async (args) => {
      try {
        const { template_key, version, ...patch } = args;
        const cleaned = Object.fromEntries(
          Object.entries(patch).filter(([, v]) => v !== undefined),
        );
        const result = await client.updateWorkflowTemplate(template_key, version, cleaned);
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
      name: z.string().describe('Human-readable name'),
      description: z.string().optional().describe('Description'),
      policies: z.record(z.unknown()).describe('Policy definitions'),
    },
    async (args) => {
      try {
        const result = await client.createPolicySet(args);
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
      workflow_type: z.string().optional().describe('Workflow type (default: "response")'),
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
            workflow_type: args.workflow_type ?? 'response',
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
    'engine_get_workflow_status',
    'Get the status of a running response automation workflow',
    {
      workflow_id: z.string().describe('Workflow ID'),
    },
    async ({ workflow_id }) => {
      try {
        const result = await client.getWorkflowStatus(workflow_id);
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
      approved: z.boolean().describe('Whether to approve the workflow response'),
      reason: z.string().optional().describe('Reason for the decision'),
    },
    async (args) => {
      try {
        const result = await client.reviewWorkflow(args.workflow_id, {
          approved: args.approved,
          reason: args.reason,
        });
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
    },
    async ({ workflow_id }) => {
      try {
        const result = await client.cancelWorkflow(workflow_id);
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
