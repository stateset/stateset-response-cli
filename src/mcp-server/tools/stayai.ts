import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { StayAiConfig } from '../../integrations/config.js';
import { stayAiRequest } from '../../integrations/stayai.js';
import {
  type IntegrationToolOptions,
  createRequestRunner,
  wrapToolResult,
  MaxCharsSchema,
  buildQuery,
  guardWrite,
  registerRawRequestTool,
} from './helpers.js';

export type StayAiToolOptions = IntegrationToolOptions;

const runRequest = createRequestRunner<StayAiConfig>((config, args) =>
  stayAiRequest({ stayai: config, ...args }),
);

interface StayAiOperationPreview {
  method: string;
  path: string;
  body?: Record<string, unknown>;
  [extra: string]: unknown;
}

const stayaiIdempotencyStore = new Map<string, { status: number; data: unknown }>();

function withIdempotencyResult(
  key: string | undefined,
  status: number,
  data: unknown,
): { deduplicated: boolean; status: number; data: unknown } {
  if (!key) {
    return { deduplicated: false, status, data };
  }
  const existing = stayaiIdempotencyStore.get(key);
  if (existing) {
    return { deduplicated: true, status: existing.status, data: existing.data };
  }
  stayaiIdempotencyStore.set(key, { status, data });
  return { deduplicated: false, status, data };
}

function buildSubscriptionChangePreview(input: {
  subscription_id: number;
  action: 'cancel' | 'pause' | 'resume' | 'swap';
  swap_variant_id?: number;
  quantity?: number;
  reason?: string;
  endpoint_override?: string;
}): StayAiOperationPreview {
  const subscriptionId = Number(input.subscription_id);
  const action = input.action;

  if (!Number.isFinite(subscriptionId) || subscriptionId <= 0) {
    throw new Error('subscription_id must be a positive number');
  }

  if (action === 'cancel') {
    return {
      method: 'POST',
      path: input.endpoint_override || `/subscriptions/${subscriptionId}/cancel`,
      body: input.reason ? { cancellation_reason: input.reason } : undefined,
    };
  }

  if (action === 'pause') {
    return {
      method: 'PUT',
      path: input.endpoint_override || `/subscriptions/${subscriptionId}`,
      body: {
        subscription: {
          status: 'cancelled',
          cancellation_reason: input.reason || 'Paused by StateSet Response CLI',
        },
      },
    };
  }

  if (action === 'resume') {
    return {
      method: 'PUT',
      path: input.endpoint_override || `/subscriptions/${subscriptionId}`,
      body: {
        subscription: {
          status: 'active',
        },
      },
    };
  }

  if (!input.swap_variant_id) {
    throw new Error('swap_variant_id is required when action is "swap"');
  }

  return {
    method: 'PUT',
    path: input.endpoint_override || `/subscriptions/${subscriptionId}`,
    body: {
      subscription: {
        shopify_variant_id: Number(input.swap_variant_id),
        quantity: input.quantity ? Math.max(1, Number(input.quantity)) : 1,
      },
    },
  };
}

export function registerStayAiTools(
  server: McpServer,
  stayai: StayAiConfig,
  options: StayAiToolOptions,
) {
  server.tool(
    'stayai_list_customers',
    'List StayAi customers. Pass query params for filters (e.g., email, status, updated_at_min).',
    {
      limit: z.number().min(1).max(250).optional().describe('Maximum number of records to return'),
      page: z.number().min(1).optional().describe('Page number (1-based)'),
      query: z
        .record(z.union([z.string(), z.number(), z.boolean()]))
        .optional()
        .describe('Additional query parameters'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const result = await runRequest(stayai, options, {
        method: 'GET',
        path: '/customers',
        query: buildQuery({ ...args.query, limit: args.limit, page: args.page }),
      });
      return wrapToolResult({ success: true, ...result }, args.max_chars);
    },
  );

  server.tool(
    'stayai_get_customer',
    'Get a StayAi customer by ID.',
    {
      customer_id: z.number().describe('StayAi customer ID'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const result = await runRequest(stayai, options, {
        method: 'GET',
        path: `/customers/${args.customer_id}`,
      });
      return wrapToolResult({ success: true, ...result }, args.max_chars);
    },
  );

  server.tool(
    'stayai_list_subscriptions',
    'List StayAi subscriptions. Pass query params for filters (e.g., customer_id, status, updated_at_min).',
    {
      limit: z.number().min(1).max(250).optional().describe('Maximum number of records to return'),
      page: z.number().min(1).optional().describe('Page number (1-based)'),
      query: z
        .record(z.union([z.string(), z.number(), z.boolean()]))
        .optional()
        .describe('Additional query parameters'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const result = await runRequest(stayai, options, {
        method: 'GET',
        path: '/subscriptions',
        query: buildQuery({ ...args.query, limit: args.limit, page: args.page }),
      });
      return wrapToolResult({ success: true, ...result }, args.max_chars);
    },
  );

  server.tool(
    'stayai_get_subscription',
    'Get a StayAi subscription by ID.',
    {
      subscription_id: z.number().describe('StayAi subscription ID'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const result = await runRequest(stayai, options, {
        method: 'GET',
        path: `/subscriptions/${args.subscription_id}`,
      });
      return wrapToolResult({ success: true, ...result }, args.max_chars);
    },
  );

  server.tool(
    'stayai_list_charges',
    'List StayAi charges. Pass query params for filters (e.g., customer_id, status, updated_at_min).',
    {
      limit: z.number().min(1).max(250).optional().describe('Maximum number of records to return'),
      page: z.number().min(1).optional().describe('Page number (1-based)'),
      query: z
        .record(z.union([z.string(), z.number(), z.boolean()]))
        .optional()
        .describe('Additional query parameters'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const result = await runRequest(stayai, options, {
        method: 'GET',
        path: '/charges',
        query: buildQuery({ ...args.query, limit: args.limit, page: args.page }),
      });
      return wrapToolResult({ success: true, ...result }, args.max_chars);
    },
  );

  server.tool(
    'stayai_get_charge',
    'Get a StayAi charge by ID.',
    {
      charge_id: z.number().describe('StayAi charge ID'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const result = await runRequest(stayai, options, {
        method: 'GET',
        path: `/charges/${args.charge_id}`,
      });
      return wrapToolResult({ success: true, ...result }, args.max_chars);
    },
  );

  server.tool(
    'stayai_list_orders',
    'List StayAi orders. Pass query params for filters (e.g., customer_id, status, updated_at_min).',
    {
      limit: z.number().min(1).max(250).optional().describe('Maximum number of records to return'),
      page: z.number().min(1).optional().describe('Page number (1-based)'),
      query: z
        .record(z.union([z.string(), z.number(), z.boolean()]))
        .optional()
        .describe('Additional query parameters'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const result = await runRequest(stayai, options, {
        method: 'GET',
        path: '/orders',
        query: buildQuery({ ...args.query, limit: args.limit, page: args.page }),
      });
      return wrapToolResult({ success: true, ...result }, args.max_chars);
    },
  );

  server.tool(
    'stayai_get_order',
    'Get a StayAi order by ID.',
    {
      order_id: z.number().describe('StayAi order ID'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const result = await runRequest(stayai, options, {
        method: 'GET',
        path: `/orders/${args.order_id}`,
      });
      return wrapToolResult({ success: true, ...result }, args.max_chars);
    },
  );

  server.tool(
    'stayai_preview_subscription_change',
    'Preview a StayAi subscription lifecycle change (cancel, pause, resume, swap) without applying it.',
    {
      subscription_id: z.number().describe('StayAi subscription ID'),
      action: z.enum(['cancel', 'pause', 'resume', 'swap']).describe('Lifecycle change to apply'),
      swap_variant_id: z
        .number()
        .optional()
        .describe('New variant ID (required for action="swap")'),
      quantity: z.number().min(1).optional().describe('New quantity when swapping'),
      reason: z.string().optional().describe('Optional cancellation/pause reason'),
      endpoint_override: z
        .string()
        .optional()
        .describe('Override default endpoint for this operation'),
      idempotency_key: z
        .string()
        .optional()
        .describe('Optional idempotency key reused by confirm_subscription_change'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const preview = buildSubscriptionChangePreview({
        subscription_id: args.subscription_id,
        action: args.action,
        swap_variant_id: args.swap_variant_id,
        quantity: args.quantity,
        reason: args.reason,
        endpoint_override: args.endpoint_override,
      });
      return wrapToolResult(
        {
          success: true,
          dry_run: true,
          idempotency_key: args.idempotency_key || null,
          request: preview,
          next_step:
            'Run stayai_confirm_subscription_change with the same payload to execute this operation.',
        },
        args.max_chars,
      );
    },
  );

  server.tool(
    'stayai_confirm_subscription_change',
    'Apply a StayAi subscription lifecycle change (cancel, pause, resume, swap). Requires --apply or STATESET_ALLOW_APPLY unless dry_run=true.',
    {
      subscription_id: z.number().describe('StayAi subscription ID'),
      action: z.enum(['cancel', 'pause', 'resume', 'swap']).describe('Lifecycle change to apply'),
      swap_variant_id: z
        .number()
        .optional()
        .describe('New variant ID (required for action="swap")'),
      quantity: z.number().min(1).optional().describe('New quantity when swapping'),
      reason: z.string().optional().describe('Optional cancellation/pause reason'),
      endpoint_override: z
        .string()
        .optional()
        .describe('Override default endpoint for this operation'),
      idempotency_key: z.string().optional().describe('Optional idempotency key'),
      dry_run: z.boolean().optional().default(false).describe('Preview without applying'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const preview = buildSubscriptionChangePreview({
        subscription_id: args.subscription_id,
        action: args.action,
        swap_variant_id: args.swap_variant_id,
        quantity: args.quantity,
        reason: args.reason,
        endpoint_override: args.endpoint_override,
      });

      if (args.dry_run) {
        return wrapToolResult(
          {
            success: true,
            dry_run: true,
            idempotency_key: args.idempotency_key || null,
            request: preview,
          },
          args.max_chars,
        );
      }

      const blocked = guardWrite(options);
      if (blocked) return blocked;

      const result = await runRequest(stayai, options, preview);
      const deduped = withIdempotencyResult(args.idempotency_key, result.status, result.data);
      return wrapToolResult(
        {
          success: true,
          idempotency_key: args.idempotency_key || null,
          deduplicated: deduped.deduplicated,
          status: deduped.status,
          data: deduped.data,
        },
        args.max_chars,
      );
    },
  );

  server.tool(
    'stayai_skip_charge',
    'Skip a pending StayAi charge. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      charge_id: z.number().describe('StayAi charge ID'),
      endpoint_override: z
        .string()
        .optional()
        .describe('Override default endpoint (default /charges/{id}/skip)'),
      idempotency_key: z.string().optional().describe('Optional idempotency key'),
      dry_run: z.boolean().optional().default(false).describe('Preview without applying'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const request = {
        method: 'POST',
        path: args.endpoint_override || `/charges/${args.charge_id}/skip`,
      };
      if (args.dry_run) {
        return wrapToolResult(
          { success: true, dry_run: true, idempotency_key: args.idempotency_key || null, request },
          args.max_chars,
        );
      }
      const blocked = guardWrite(options);
      if (blocked) return blocked;
      const result = await runRequest(stayai, options, request);
      const deduped = withIdempotencyResult(args.idempotency_key, result.status, result.data);
      return wrapToolResult(
        {
          success: true,
          idempotency_key: args.idempotency_key || null,
          deduplicated: deduped.deduplicated,
          status: deduped.status,
          data: deduped.data,
        },
        args.max_chars,
      );
    },
  );

  server.tool(
    'stayai_reschedule_charge',
    'Reschedule a StayAi charge. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      charge_id: z.number().describe('StayAi charge ID'),
      scheduled_at: z.string().describe('New schedule date/time (ISO string)'),
      endpoint_override: z
        .string()
        .optional()
        .describe('Override default endpoint (default /charges/{id}/change_next_charge_date)'),
      idempotency_key: z.string().optional().describe('Optional idempotency key'),
      dry_run: z.boolean().optional().default(false).describe('Preview without applying'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const request = {
        method: 'POST',
        path: args.endpoint_override || `/charges/${args.charge_id}/change_next_charge_date`,
        body: { charge: { next_charge_scheduled_at: args.scheduled_at } },
      };
      if (args.dry_run) {
        return wrapToolResult(
          { success: true, dry_run: true, idempotency_key: args.idempotency_key || null, request },
          args.max_chars,
        );
      }
      const blocked = guardWrite(options);
      if (blocked) return blocked;
      const result = await runRequest(stayai, options, request);
      const deduped = withIdempotencyResult(args.idempotency_key, result.status, result.data);
      return wrapToolResult(
        {
          success: true,
          idempotency_key: args.idempotency_key || null,
          deduplicated: deduped.deduplicated,
          status: deduped.status,
          data: deduped.data,
        },
        args.max_chars,
      );
    },
  );

  server.tool(
    'stayai_issue_refund',
    'Issue a StayAi refund for a charge or order. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      charge_id: z.number().optional().describe('StayAi charge ID to refund'),
      order_id: z.number().optional().describe('StayAi order ID to refund'),
      amount: z.number().optional().describe('Optional partial refund amount'),
      reason: z.string().optional().describe('Optional refund reason'),
      endpoint_override: z
        .string()
        .optional()
        .describe('Override default endpoint (/charges/{id}/refund or /orders/{id}/refund)'),
      idempotency_key: z.string().optional().describe('Optional idempotency key'),
      dry_run: z.boolean().optional().default(false).describe('Preview without applying'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      if (!args.charge_id && !args.order_id) {
        throw new Error('Provide either charge_id or order_id');
      }
      const path =
        args.endpoint_override ||
        (args.charge_id
          ? `/charges/${args.charge_id}/refund`
          : `/orders/${args.order_id as number}/refund`);
      const request = {
        method: 'POST',
        path,
        body: {
          amount: args.amount,
          reason: args.reason,
        } as Record<string, unknown>,
      };
      if (args.dry_run) {
        return wrapToolResult(
          { success: true, dry_run: true, idempotency_key: args.idempotency_key || null, request },
          args.max_chars,
        );
      }
      const blocked = guardWrite(options);
      if (blocked) return blocked;
      const result = await runRequest(stayai, options, request);
      const deduped = withIdempotencyResult(args.idempotency_key, result.status, result.data);
      return wrapToolResult(
        {
          success: true,
          idempotency_key: args.idempotency_key || null,
          deduplicated: deduped.deduplicated,
          status: deduped.status,
          data: deduped.data,
        },
        args.max_chars,
      );
    },
  );

  server.tool(
    'stayai_update_customer_shipping',
    'Update StayAi customer shipping address. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      customer_id: z.number().describe('StayAi customer ID'),
      shipping_address: z
        .record(z.unknown())
        .describe('Shipping address object to apply on the customer record'),
      endpoint_override: z
        .string()
        .optional()
        .describe('Override default endpoint (default /customers/{id})'),
      dry_run: z.boolean().optional().default(false).describe('Preview without applying'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const request = {
        method: 'PUT',
        path: args.endpoint_override || `/customers/${args.customer_id}`,
        body: { customer: { shipping_address: args.shipping_address } },
      };
      if (args.dry_run) {
        return wrapToolResult({ success: true, dry_run: true, request }, args.max_chars);
      }
      const blocked = guardWrite(options);
      if (blocked) return blocked;
      const result = await runRequest(stayai, options, request);
      return wrapToolResult({ success: true, ...result }, args.max_chars);
    },
  );

  server.tool(
    'stayai_update_customer_payment',
    'Update StayAi customer payment details. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      customer_id: z.number().describe('StayAi customer ID'),
      payment_details: z.record(z.unknown()).describe('Payment details payload accepted by StayAi'),
      endpoint_override: z
        .string()
        .optional()
        .describe('Override default endpoint (default /customers/{id})'),
      dry_run: z.boolean().optional().default(false).describe('Preview without applying'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const request = {
        method: 'PUT',
        path: args.endpoint_override || `/customers/${args.customer_id}`,
        body: { customer: { payment_details: args.payment_details } },
      };
      if (args.dry_run) {
        return wrapToolResult({ success: true, dry_run: true, request }, args.max_chars);
      }
      const blocked = guardWrite(options);
      if (blocked) return blocked;
      const result = await runRequest(stayai, options, request);
      return wrapToolResult({ success: true, ...result }, args.max_chars);
    },
  );

  server.tool(
    'stayai_job_status',
    'Fetch status for an async StayAi job.',
    {
      job_id: z.string().describe('StayAi job identifier'),
      endpoint_override: z
        .string()
        .optional()
        .describe('Override default endpoint (default /batches/{job_id})'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const result = await runRequest(stayai, options, {
        method: 'GET',
        path: args.endpoint_override || `/batches/${args.job_id}`,
      });
      return wrapToolResult({ success: true, ...result }, args.max_chars);
    },
  );

  server.tool(
    'stayai_job_retry',
    'Retry a failed StayAi async job. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      job_id: z.string().describe('StayAi job identifier'),
      endpoint_override: z
        .string()
        .optional()
        .describe('Override default endpoint (default /batches/{job_id}/retry)'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const blocked = guardWrite(options);
      if (blocked) return blocked;
      const result = await runRequest(stayai, options, {
        method: 'POST',
        path: args.endpoint_override || `/batches/${args.job_id}/retry`,
      });
      return wrapToolResult({ success: true, ...result }, args.max_chars);
    },
  );

  server.tool(
    'stayai_job_rollback',
    'Rollback a StayAi async job when supported. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      job_id: z.string().describe('StayAi job identifier'),
      endpoint_override: z
        .string()
        .optional()
        .describe('Override default endpoint (default /batches/{job_id}/rollback)'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const blocked = guardWrite(options);
      if (blocked) return blocked;
      const result = await runRequest(stayai, options, {
        method: 'POST',
        path: args.endpoint_override || `/batches/${args.job_id}/rollback`,
      });
      return wrapToolResult({ success: true, ...result }, args.max_chars);
    },
  );

  registerRawRequestTool(
    server,
    'stayai_request',
    'Execute a raw StayAi API request.',
    runRequest,
    stayai,
    options,
    { version: z.string().optional().describe('Override X-StayAi-Version header') },
  );
}
