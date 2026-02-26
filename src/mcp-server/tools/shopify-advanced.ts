import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ShopifyConfig } from '../../integrations/config.js';
import { shopifyGraphqlRaw, shopifyRestRequest } from '../../integrations/shopify.js';
import { redactPii } from '../../integrations/redact.js';
import {
  type IntegrationToolOptions,
  MaxCharsSchema,
  QueryParamsSchema,
  BodySchema,
  HttpMethodSchema,
  guardWrite,
  writeNotAllowed,
  wrapToolResult,
} from './helpers.js';

export type ShopifyAdvancedToolOptions = IntegrationToolOptions;

function isMutation(query: string): boolean {
  return /\bmutation\b/i.test(query);
}

type ShopifyFulfillmentOperation =
  | 'cancel_order'
  | 'create_fulfillment'
  | 'update_fulfillment'
  | 'cancel_fulfillment'
  | 'update_tracking'
  | 'remove_tags';

interface ShopifyOperationRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path?: string;
  body?: Record<string, unknown>;
  graphql?: { query: string; variables?: Record<string, unknown> };
}

const shopifyIdempotencyStore = new Map<string, { status: number; data: unknown }>();

function withShopifyIdempotency(
  key: string | undefined,
  status: number,
  data: unknown,
): { deduplicated: boolean; status: number; data: unknown } {
  if (!key) return { deduplicated: false, status, data };
  const existing = shopifyIdempotencyStore.get(key);
  if (existing) {
    return { deduplicated: true, status: existing.status, data: existing.data };
  }
  shopifyIdempotencyStore.set(key, { status, data });
  return { deduplicated: false, status, data };
}

function buildShopifyOperationRequest(args: {
  operation: ShopifyFulfillmentOperation;
  order_id?: string;
  fulfillment_id?: string;
  tags?: string[];
  payload?: Record<string, unknown>;
  endpoint_override?: string;
}): ShopifyOperationRequest {
  const operation = args.operation;
  const payload = (args.payload || {}) as Record<string, unknown>;

  if (operation === 'cancel_order') {
    if (!args.order_id) throw new Error('order_id is required for cancel_order');
    return {
      method: 'POST',
      path: args.endpoint_override || `/orders/${args.order_id}/cancel.json`,
      body: payload,
    };
  }

  if (operation === 'create_fulfillment') {
    return {
      method: 'POST',
      path: args.endpoint_override || '/fulfillments.json',
      body: payload,
    };
  }

  if (operation === 'update_fulfillment') {
    if (!args.fulfillment_id) throw new Error('fulfillment_id is required for update_fulfillment');
    return {
      method: 'PUT',
      path: args.endpoint_override || `/fulfillments/${args.fulfillment_id}.json`,
      body: payload,
    };
  }

  if (operation === 'cancel_fulfillment') {
    if (!args.fulfillment_id) throw new Error('fulfillment_id is required for cancel_fulfillment');
    return {
      method: 'POST',
      path: args.endpoint_override || `/fulfillments/${args.fulfillment_id}.json/cancel`,
      body: payload,
    };
  }

  if (operation === 'update_tracking') {
    if (!args.fulfillment_id) throw new Error('fulfillment_id is required for update_tracking');
    return {
      method: 'POST',
      path: args.endpoint_override || `/fulfillments/${args.fulfillment_id}/update_tracking.json`,
      body: payload,
    };
  }

  if (!args.order_id) throw new Error('order_id is required for remove_tags');
  const tags = (args.tags || []).map((t) => String(t).trim()).filter(Boolean);
  if (tags.length === 0) throw new Error('tags is required for remove_tags');

  return {
    method: 'POST',
    graphql: {
      query: `
        mutation RemoveTags($id: ID!, $tags: [String!]!) {
          tagsRemove(id: $id, tags: $tags) {
            node { id }
            userErrors { field message }
          }
        }
      `,
      variables: {
        id: args.order_id.startsWith('gid://')
          ? args.order_id
          : `gid://shopify/Order/${args.order_id}`,
        tags,
      },
    },
  };
}

async function executeShopifyOperation(
  shopify: ShopifyConfig,
  options: ShopifyAdvancedToolOptions,
  request: ShopifyOperationRequest,
) {
  if (request.graphql) {
    const data = await shopifyGraphqlRaw({
      shopify,
      query: request.graphql.query,
      variables: request.graphql.variables,
    });
    return { status: 200, data: options.redact ? redactPii(data) : data };
  }

  if (!request.path) {
    throw new Error('Missing request path for Shopify REST operation');
  }

  const result = await shopifyRestRequest({
    shopify,
    method: request.method,
    path: request.path,
    body: request.body,
  });
  return { status: result.status, data: options.redact ? redactPii(result.data) : result.data };
}

export function registerShopifyAdvancedTools(
  server: McpServer,
  shopify: ShopifyConfig,
  options: ShopifyAdvancedToolOptions,
) {
  server.tool(
    'shopify_graphql',
    'Execute a raw Shopify Admin GraphQL query or mutation. Mutations require --apply or STATESET_ALLOW_APPLY.',
    {
      query: z.string().describe('GraphQL query or mutation string'),
      variables: z.record(z.unknown()).optional().describe('Optional GraphQL variables object'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const query = String(args.query || '').trim();
      if (!query) throw new Error('Query is required');
      if (isMutation(query) && !options.allowApply) {
        return writeNotAllowed();
      }

      const data = await shopifyGraphqlRaw({
        shopify,
        query,
        variables: args.variables as Record<string, unknown> | undefined,
      });

      const result = options.redact ? redactPii(data) : data;
      const payload = { success: true, data: result };
      return wrapToolResult(payload, args.max_chars as number | undefined);
    },
  );

  server.tool(
    'shopify_rest',
    'Execute a raw Shopify Admin REST request. Non-GET methods require --apply or STATESET_ALLOW_APPLY.',
    {
      method: HttpMethodSchema,
      path: z
        .string()
        .describe('REST path relative to /admin/api/{version}, e.g. /orders/123.json'),
      query: QueryParamsSchema,
      body: BodySchema,
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const method = String(args.method || '').toUpperCase();
      if (!method) throw new Error('Method is required');
      if (method !== 'GET' && !options.allowApply) {
        return writeNotAllowed();
      }

      const result = await shopifyRestRequest({
        shopify,
        method,
        path: args.path as string,
        query: args.query as Record<string, string | number | boolean> | undefined,
        body: args.body as Record<string, unknown> | undefined,
      });

      const data = options.redact ? redactPii(result.data) : result.data;
      const payload = { success: true, status: result.status, data };
      return wrapToolResult(payload, args.max_chars as number | undefined);
    },
  );

  server.tool(
    'shopify_preview_fulfillment_operation',
    'Preview a Shopify fulfillment/order write operation without applying it.',
    {
      operation: z
        .enum([
          'cancel_order',
          'create_fulfillment',
          'update_fulfillment',
          'cancel_fulfillment',
          'update_tracking',
          'remove_tags',
        ])
        .describe('Shopify operation to run'),
      order_id: z.string().optional().describe('Order ID (required for cancel_order/remove_tags)'),
      fulfillment_id: z
        .string()
        .optional()
        .describe('Fulfillment ID (required for fulfillment operations)'),
      tags: z.array(z.string()).optional().describe('Tags to remove (remove_tags only)'),
      payload: z
        .record(z.unknown())
        .optional()
        .describe('Operation payload for REST-based operations'),
      endpoint_override: z.string().optional().describe('Override default REST endpoint path'),
      idempotency_key: z.string().optional().describe('Optional idempotency key'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const request = buildShopifyOperationRequest({
        operation: args.operation,
        order_id: args.order_id,
        fulfillment_id: args.fulfillment_id,
        tags: args.tags as string[] | undefined,
        payload: args.payload as Record<string, unknown> | undefined,
        endpoint_override: args.endpoint_override,
      });
      return wrapToolResult(
        {
          success: true,
          dry_run: true,
          idempotency_key: args.idempotency_key || null,
          request,
          next_step:
            'Run shopify_confirm_fulfillment_operation with the same payload to execute this operation.',
        },
        args.max_chars as number | undefined,
      );
    },
  );

  server.tool(
    'shopify_confirm_fulfillment_operation',
    'Confirm a Shopify fulfillment/order write operation. Requires --apply or STATESET_ALLOW_APPLY unless dry_run=true.',
    {
      operation: z
        .enum([
          'cancel_order',
          'create_fulfillment',
          'update_fulfillment',
          'cancel_fulfillment',
          'update_tracking',
          'remove_tags',
        ])
        .describe('Shopify operation to run'),
      order_id: z.string().optional().describe('Order ID (required for cancel_order/remove_tags)'),
      fulfillment_id: z
        .string()
        .optional()
        .describe('Fulfillment ID (required for fulfillment operations)'),
      tags: z.array(z.string()).optional().describe('Tags to remove (remove_tags only)'),
      payload: z
        .record(z.unknown())
        .optional()
        .describe('Operation payload for REST-based operations'),
      endpoint_override: z.string().optional().describe('Override default REST endpoint path'),
      idempotency_key: z.string().optional().describe('Optional idempotency key'),
      dry_run: z.boolean().optional().default(false).describe('Preview without applying'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const request = buildShopifyOperationRequest({
        operation: args.operation,
        order_id: args.order_id,
        fulfillment_id: args.fulfillment_id,
        tags: args.tags as string[] | undefined,
        payload: args.payload as Record<string, unknown> | undefined,
        endpoint_override: args.endpoint_override,
      });

      if (args.dry_run) {
        return wrapToolResult(
          {
            success: true,
            dry_run: true,
            idempotency_key: args.idempotency_key || null,
            request,
          },
          args.max_chars as number | undefined,
        );
      }

      const blocked = guardWrite(options);
      if (blocked) return blocked;

      const result = await executeShopifyOperation(shopify, options, request);
      const deduped = withShopifyIdempotency(args.idempotency_key, result.status, result.data);
      return wrapToolResult(
        {
          success: true,
          idempotency_key: args.idempotency_key || null,
          deduplicated: deduped.deduplicated,
          status: deduped.status,
          data: deduped.data,
        },
        args.max_chars as number | undefined,
      );
    },
  );

  server.tool(
    'shopify_cancel_order',
    'Cancel a Shopify order. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      order_id: z.string().describe('Order numeric ID or GID'),
      payload: z
        .record(z.unknown())
        .optional()
        .describe('Optional cancellation payload accepted by Shopify REST'),
      idempotency_key: z.string().optional().describe('Optional idempotency key'),
      dry_run: z.boolean().optional().default(false).describe('Preview without applying'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const request = buildShopifyOperationRequest({
        operation: 'cancel_order',
        order_id: args.order_id,
        payload: args.payload as Record<string, unknown> | undefined,
      });
      if (args.dry_run) {
        return wrapToolResult(
          { success: true, dry_run: true, idempotency_key: args.idempotency_key || null, request },
          args.max_chars as number | undefined,
        );
      }
      const blocked = guardWrite(options);
      if (blocked) return blocked;
      const result = await executeShopifyOperation(shopify, options, request);
      const deduped = withShopifyIdempotency(args.idempotency_key, result.status, result.data);
      return wrapToolResult(
        { success: true, idempotency_key: args.idempotency_key || null, ...deduped },
        args.max_chars as number | undefined,
      );
    },
  );

  server.tool(
    'shopify_create_fulfillment',
    'Create a Shopify fulfillment. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      payload: z
        .record(z.unknown())
        .describe('Fulfillment payload (typically includes fulfillment_order_line_items)'),
      idempotency_key: z.string().optional().describe('Optional idempotency key'),
      dry_run: z.boolean().optional().default(false).describe('Preview without applying'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const request = buildShopifyOperationRequest({
        operation: 'create_fulfillment',
        payload: args.payload as Record<string, unknown>,
      });
      if (args.dry_run) {
        return wrapToolResult(
          { success: true, dry_run: true, idempotency_key: args.idempotency_key || null, request },
          args.max_chars as number | undefined,
        );
      }
      const blocked = guardWrite(options);
      if (blocked) return blocked;
      const result = await executeShopifyOperation(shopify, options, request);
      const deduped = withShopifyIdempotency(args.idempotency_key, result.status, result.data);
      return wrapToolResult(
        { success: true, idempotency_key: args.idempotency_key || null, ...deduped },
        args.max_chars as number | undefined,
      );
    },
  );

  server.tool(
    'shopify_update_fulfillment',
    'Update a Shopify fulfillment payload. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      fulfillment_id: z.string().describe('Fulfillment ID'),
      payload: z.record(z.unknown()).describe('Fulfillment update payload'),
      idempotency_key: z.string().optional().describe('Optional idempotency key'),
      dry_run: z.boolean().optional().default(false).describe('Preview without applying'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const request = buildShopifyOperationRequest({
        operation: 'update_fulfillment',
        fulfillment_id: args.fulfillment_id,
        payload: args.payload as Record<string, unknown>,
      });
      if (args.dry_run) {
        return wrapToolResult(
          { success: true, dry_run: true, idempotency_key: args.idempotency_key || null, request },
          args.max_chars as number | undefined,
        );
      }
      const blocked = guardWrite(options);
      if (blocked) return blocked;
      const result = await executeShopifyOperation(shopify, options, request);
      const deduped = withShopifyIdempotency(args.idempotency_key, result.status, result.data);
      return wrapToolResult(
        { success: true, idempotency_key: args.idempotency_key || null, ...deduped },
        args.max_chars as number | undefined,
      );
    },
  );

  server.tool(
    'shopify_cancel_fulfillment',
    'Cancel a Shopify fulfillment. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      fulfillment_id: z.string().describe('Fulfillment ID'),
      payload: z.record(z.unknown()).optional().describe('Optional cancel payload'),
      idempotency_key: z.string().optional().describe('Optional idempotency key'),
      dry_run: z.boolean().optional().default(false).describe('Preview without applying'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const request = buildShopifyOperationRequest({
        operation: 'cancel_fulfillment',
        fulfillment_id: args.fulfillment_id,
        payload: args.payload as Record<string, unknown> | undefined,
      });
      if (args.dry_run) {
        return wrapToolResult(
          { success: true, dry_run: true, idempotency_key: args.idempotency_key || null, request },
          args.max_chars as number | undefined,
        );
      }
      const blocked = guardWrite(options);
      if (blocked) return blocked;
      const result = await executeShopifyOperation(shopify, options, request);
      const deduped = withShopifyIdempotency(args.idempotency_key, result.status, result.data);
      return wrapToolResult(
        { success: true, idempotency_key: args.idempotency_key || null, ...deduped },
        args.max_chars as number | undefined,
      );
    },
  );

  server.tool(
    'shopify_update_tracking',
    'Update tracking information for a Shopify fulfillment. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      fulfillment_id: z.string().describe('Fulfillment ID'),
      payload: z
        .record(z.unknown())
        .describe('Tracking payload (tracking_number/tracking_company/tracking_url, etc.)'),
      idempotency_key: z.string().optional().describe('Optional idempotency key'),
      dry_run: z.boolean().optional().default(false).describe('Preview without applying'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const request = buildShopifyOperationRequest({
        operation: 'update_tracking',
        fulfillment_id: args.fulfillment_id,
        payload: args.payload as Record<string, unknown>,
      });
      if (args.dry_run) {
        return wrapToolResult(
          { success: true, dry_run: true, idempotency_key: args.idempotency_key || null, request },
          args.max_chars as number | undefined,
        );
      }
      const blocked = guardWrite(options);
      if (blocked) return blocked;
      const result = await executeShopifyOperation(shopify, options, request);
      const deduped = withShopifyIdempotency(args.idempotency_key, result.status, result.data);
      return wrapToolResult(
        { success: true, idempotency_key: args.idempotency_key || null, ...deduped },
        args.max_chars as number | undefined,
      );
    },
  );

  server.tool(
    'shopify_remove_tags',
    'Remove tags from a Shopify order. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      order_id: z.string().describe('Order numeric ID or GID'),
      tags: z.array(z.string()).min(1).describe('Tags to remove'),
      idempotency_key: z.string().optional().describe('Optional idempotency key'),
      dry_run: z.boolean().optional().default(false).describe('Preview without applying'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const request = buildShopifyOperationRequest({
        operation: 'remove_tags',
        order_id: args.order_id,
        tags: args.tags as string[],
      });
      if (args.dry_run) {
        return wrapToolResult(
          { success: true, dry_run: true, idempotency_key: args.idempotency_key || null, request },
          args.max_chars as number | undefined,
        );
      }
      const blocked = guardWrite(options);
      if (blocked) return blocked;
      const result = await executeShopifyOperation(shopify, options, request);
      const deduped = withShopifyIdempotency(args.idempotency_key, result.status, result.data);
      return wrapToolResult(
        { success: true, idempotency_key: args.idempotency_key || null, ...deduped },
        args.max_chars as number | undefined,
      );
    },
  );

  server.tool(
    'shopify_job_status',
    'Check status for a Shopify async/bulk operation job.',
    {
      job_id: z.string().describe('Shopify job identifier'),
      endpoint_override: z
        .string()
        .optional()
        .describe('Override endpoint (default /bulk_operations/{job_id}.json)'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const path = args.endpoint_override || `/bulk_operations/${args.job_id}.json`;
      const result = await shopifyRestRequest({ shopify, method: 'GET', path });
      const data = options.redact ? redactPii(result.data) : result.data;
      return wrapToolResult(
        { success: true, status: result.status, data },
        args.max_chars as number | undefined,
      );
    },
  );

  server.tool(
    'shopify_job_retry',
    'Retry a Shopify async/bulk operation when supported. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      job_id: z.string().describe('Shopify job identifier'),
      endpoint_override: z
        .string()
        .optional()
        .describe('Override endpoint (default /bulk_operations/{job_id}/retry.json)'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const blocked = guardWrite(options);
      if (blocked) return blocked;
      const path = args.endpoint_override || `/bulk_operations/${args.job_id}/retry.json`;
      const result = await shopifyRestRequest({ shopify, method: 'POST', path });
      const data = options.redact ? redactPii(result.data) : result.data;
      return wrapToolResult(
        { success: true, status: result.status, data },
        args.max_chars as number | undefined,
      );
    },
  );

  server.tool(
    'shopify_job_rollback',
    'Rollback a Shopify async/bulk operation when supported. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      job_id: z.string().describe('Shopify job identifier'),
      endpoint_override: z
        .string()
        .optional()
        .describe('Override endpoint (default /bulk_operations/{job_id}/rollback.json)'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const blocked = guardWrite(options);
      if (blocked) return blocked;
      const path = args.endpoint_override || `/bulk_operations/${args.job_id}/rollback.json`;
      const result = await shopifyRestRequest({ shopify, method: 'POST', path });
      const data = options.redact ? redactPii(result.data) : result.data;
      return wrapToolResult(
        { success: true, status: result.status, data },
        args.max_chars as number | undefined,
      );
    },
  );
}
