import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AmazonConfig } from '../../integrations/config.js';
import { amazonRequest } from '../../integrations/amazon.js';
import {
  type IntegrationToolOptions,
  createRequestRunner,
  wrapToolResult,
  MaxCharsSchema,
  buildQuery,
  guardWrite,
  registerRawRequestTool,
} from './helpers.js';

export type AmazonToolOptions = IntegrationToolOptions;

const runRequest = createRequestRunner<AmazonConfig>((config, args) =>
  amazonRequest({ amazon: config, ...args }),
);

const amazonIdempotencyStore = new Map<string, { status: number; data: unknown }>();

function withAmazonIdempotency(
  key: string | undefined,
  status: number,
  data: unknown,
): { deduplicated: boolean; status: number; data: unknown } {
  if (!key) {
    return { deduplicated: false, status, data };
  }
  const existing = amazonIdempotencyStore.get(key);
  if (existing) {
    return { deduplicated: true, status: existing.status, data: existing.data };
  }
  amazonIdempotencyStore.set(key, { status, data });
  return { deduplicated: false, status, data };
}

function resolveMarketplaceId(amazon: AmazonConfig, marketplaceId?: string): string {
  const value = (marketplaceId || amazon.marketplaceId || '').trim();
  if (!value) {
    throw new Error(
      'marketplace_id is required (or set AMAZON_SP_MARKETPLACE_ID / integrations config).',
    );
  }
  return value;
}

const AmazonAddressSchema = z.object({
  name: z.string().describe('Recipient name'),
  address_line1: z.string().describe('Address line 1'),
  address_line2: z.string().optional().describe('Address line 2'),
  city: z.string().optional(),
  state_or_region: z.string().optional(),
  district_or_county: z.string().optional(),
  postal_code: z.string().describe('Postal code'),
  country_code: z.string().describe('ISO country code'),
  phone: z.string().optional(),
});

const PerUnitDeclaredValueSchema = z.object({
  currency_code: z.string().describe('ISO currency code'),
  value: z.number().describe('Declared item value'),
});

const AmazonFulfillmentItemSchema = z.object({
  seller_sku: z.string().describe('Seller SKU'),
  quantity: z.number().min(1).describe('Item quantity'),
  seller_fulfillment_order_item_id: z.string().optional().describe('Seller item ID override'),
  per_unit_declared_value: PerUnitDeclaredValueSchema.optional(),
});

const AmazonOrderStatusEnum = z.enum([
  'Pending',
  'Unshipped',
  'PartiallyShipped',
  'Shipped',
  'Canceled',
  'InvoiceUnconfirmed',
  'Unfulfillable',
]);

const AmazonShippingSpeedEnum = z.enum(['Standard', 'Expedited', 'Priority', 'ScheduledDelivery']);

function toAddress(address: z.infer<typeof AmazonAddressSchema>): Record<string, unknown> {
  return {
    name: address.name,
    addressLine1: address.address_line1,
    addressLine2: address.address_line2,
    city: address.city,
    stateOrRegion: address.state_or_region,
    districtOrCounty: address.district_or_county,
    postalCode: address.postal_code,
    countryCode: address.country_code,
    phone: address.phone,
  };
}

function toItems(
  items: Array<z.infer<typeof AmazonFulfillmentItemSchema>>,
): Array<Record<string, unknown>> {
  return items.map((item) => ({
    sellerSku: item.seller_sku,
    quantity: item.quantity,
    sellerFulfillmentOrderItemId: item.seller_fulfillment_order_item_id,
    perUnitDeclaredValue: item.per_unit_declared_value
      ? {
          currencyCode: item.per_unit_declared_value.currency_code,
          value: item.per_unit_declared_value.value,
        }
      : undefined,
  }));
}

function buildCreateFulfillmentOrderBody(
  amazon: AmazonConfig,
  args: {
    seller_fulfillment_order_id: string;
    displayable_order_id: string;
    displayable_order_date: string;
    displayable_order_comment?: string;
    shipping_speed_category?: z.infer<typeof AmazonShippingSpeedEnum>;
    marketplace_id?: string;
    destination_address: z.infer<typeof AmazonAddressSchema>;
    items: Array<z.infer<typeof AmazonFulfillmentItemSchema>>;
    notification_emails?: string[];
    feature_constraints?: string[];
  },
): Record<string, unknown> {
  return {
    sellerFulfillmentOrderId: args.seller_fulfillment_order_id,
    displayableOrderId: args.displayable_order_id,
    displayableOrderDate: args.displayable_order_date,
    displayableOrderComment: args.displayable_order_comment,
    shippingSpeedCategory: args.shipping_speed_category || 'Standard',
    marketplaceId: resolveMarketplaceId(amazon, args.marketplace_id),
    destinationAddress: toAddress(args.destination_address),
    items: toItems(args.items),
    notificationEmails: args.notification_emails,
    featureConstraints: args.feature_constraints,
  };
}

function buildUpdateFulfillmentOrderBody(
  amazon: AmazonConfig,
  args: {
    marketplace_id?: string;
    displayable_order_comment?: string;
    shipping_speed_category?: z.infer<typeof AmazonShippingSpeedEnum>;
    destination_address?: z.infer<typeof AmazonAddressSchema>;
    items?: Array<z.infer<typeof AmazonFulfillmentItemSchema>>;
    notification_emails?: string[];
  },
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    marketplaceId: resolveMarketplaceId(amazon, args.marketplace_id),
  };

  if (args.displayable_order_comment !== undefined) {
    body.displayableOrderComment = args.displayable_order_comment;
  }
  if (args.shipping_speed_category !== undefined) {
    body.shippingSpeedCategory = args.shipping_speed_category;
  }
  if (args.destination_address) {
    body.destinationAddress = toAddress(args.destination_address);
  }
  if (args.items && args.items.length > 0) {
    body.items = toItems(args.items);
  }
  if (args.notification_emails && args.notification_emails.length > 0) {
    body.notificationEmails = args.notification_emails;
  }

  return body;
}

export function registerAmazonTools(
  server: McpServer,
  amazon: AmazonConfig,
  options: AmazonToolOptions,
) {
  server.tool(
    'amazon_list_orders',
    'List Amazon orders using Selling Partner Orders API.',
    {
      created_after: z.string().optional().describe('Only orders created after this ISO timestamp'),
      created_before: z
        .string()
        .optional()
        .describe('Only orders created before this ISO timestamp'),
      last_updated_after: z
        .string()
        .optional()
        .describe('Only orders updated after this ISO timestamp'),
      last_updated_before: z
        .string()
        .optional()
        .describe('Only orders updated before this ISO timestamp'),
      order_statuses: z
        .array(AmazonOrderStatusEnum)
        .optional()
        .describe('Filter by order statuses'),
      fulfillment_channels: z
        .array(z.enum(['AFN', 'MFN']))
        .optional()
        .describe('Filter by fulfillment channels'),
      marketplace_ids: z
        .array(z.string())
        .optional()
        .describe('Marketplace IDs (defaults to configured marketplace ID)'),
      next_token: z.string().optional().describe('Pagination token from prior response'),
      max_results: z.number().min(1).max(100).optional().describe('Max orders per page'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const marketplaces =
        args.marketplace_ids && args.marketplace_ids.length > 0
          ? args.marketplace_ids
          : amazon.marketplaceId
            ? [amazon.marketplaceId]
            : [];

      if (!args.next_token && marketplaces.length === 0) {
        throw new Error('marketplace_ids is required when next_token is not provided.');
      }

      const query = buildQuery({
        CreatedAfter: args.created_after,
        CreatedBefore: args.created_before,
        LastUpdatedAfter: args.last_updated_after,
        LastUpdatedBefore: args.last_updated_before,
        OrderStatuses: args.order_statuses?.join(','),
        FulfillmentChannels: args.fulfillment_channels?.join(','),
        MarketplaceIds: marketplaces.length > 0 ? marketplaces.join(',') : undefined,
        NextToken: args.next_token,
        MaxResultsPerPage: args.max_results,
      });

      const result = await runRequest(amazon, options, {
        method: 'GET',
        path: '/orders/v0/orders',
        query,
      });
      return wrapToolResult({ success: true, ...result }, args.max_chars);
    },
  );

  server.tool(
    'amazon_get_order',
    'Get a single Amazon order by Amazon order ID.',
    {
      order_id: z.string().describe('Amazon order ID'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const result = await runRequest(amazon, options, {
        method: 'GET',
        path: `/orders/v0/orders/${encodeURIComponent(args.order_id)}`,
      });
      return wrapToolResult({ success: true, ...result }, args.max_chars);
    },
  );

  server.tool(
    'amazon_list_order_items',
    'List line items for an Amazon order.',
    {
      order_id: z.string().describe('Amazon order ID'),
      next_token: z.string().optional(),
      max_results: z.number().min(1).max(100).optional(),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const query = buildQuery({
        NextToken: args.next_token,
        MaxResultsPerPage: args.max_results,
      });

      const result = await runRequest(amazon, options, {
        method: 'GET',
        path: `/orders/v0/orders/${encodeURIComponent(args.order_id)}/orderItems`,
        query,
      });
      return wrapToolResult({ success: true, ...result }, args.max_chars);
    },
  );

  server.tool(
    'amazon_list_fulfillment_orders',
    'List Amazon FBA fulfillment orders.',
    {
      query_start_date: z
        .string()
        .optional()
        .describe('Required for first page: ISO timestamp to start query window'),
      marketplace_id: z
        .string()
        .optional()
        .describe('Marketplace ID (defaults to configured marketplace ID)'),
      include_delivered_orders: z.boolean().optional(),
      next_token: z.string().optional(),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      if (!args.next_token && !args.query_start_date) {
        throw new Error('query_start_date is required when next_token is not provided.');
      }

      const query = buildQuery({
        queryStartDate: args.query_start_date,
        marketplaceId: resolveMarketplaceId(amazon, args.marketplace_id),
        includeDeliveredOrders: args.include_delivered_orders,
        nextToken: args.next_token,
      });

      const result = await runRequest(amazon, options, {
        method: 'GET',
        path: '/fba/outbound/2020-07-01/fulfillmentOrders',
        query,
      });
      return wrapToolResult({ success: true, ...result }, args.max_chars);
    },
  );

  server.tool(
    'amazon_get_fulfillment_order',
    'Get an Amazon FBA fulfillment order by seller fulfillment order ID.',
    {
      seller_fulfillment_order_id: z.string().describe('Seller fulfillment order ID'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const result = await runRequest(amazon, options, {
        method: 'GET',
        path: `/fba/outbound/2020-07-01/fulfillmentOrders/${encodeURIComponent(args.seller_fulfillment_order_id)}`,
      });
      return wrapToolResult({ success: true, ...result }, args.max_chars);
    },
  );

  server.tool(
    'amazon_get_fulfillment_preview',
    'Get FBA fulfillment preview rates/options before creating an order.',
    {
      marketplace_id: z.string().optional().describe('Marketplace ID override'),
      destination_address: AmazonAddressSchema,
      items: z.array(AmazonFulfillmentItemSchema).min(1),
      shipping_speed_category: AmazonShippingSpeedEnum.optional(),
      feature_constraints: z.array(z.string()).optional(),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const body: Record<string, unknown> = {
        marketplaceId: resolveMarketplaceId(amazon, args.marketplace_id),
        address: toAddress(args.destination_address),
        items: toItems(args.items),
      };
      if (args.shipping_speed_category) body.shippingSpeedCategory = args.shipping_speed_category;
      if (args.feature_constraints) body.featureConstraints = args.feature_constraints;

      const result = await runRequest(amazon, options, {
        method: 'POST',
        path: '/fba/outbound/2020-07-01/fulfillmentOrderPreview',
        body,
      });
      return wrapToolResult({ success: true, ...result }, args.max_chars);
    },
  );

  server.tool(
    'amazon_preview_create_fulfillment_order',
    'Preview creation of an Amazon FBA fulfillment order without applying it.',
    {
      seller_fulfillment_order_id: z.string().describe('Seller fulfillment order ID'),
      displayable_order_id: z.string().describe('Displayable customer-facing order ID'),
      displayable_order_date: z.string().describe('Displayable order date/time (ISO string)'),
      displayable_order_comment: z.string().optional(),
      shipping_speed_category: AmazonShippingSpeedEnum.optional(),
      marketplace_id: z.string().optional().describe('Marketplace ID override'),
      destination_address: AmazonAddressSchema,
      items: z.array(AmazonFulfillmentItemSchema).min(1),
      notification_emails: z.array(z.string().email()).optional(),
      feature_constraints: z.array(z.string()).optional(),
      endpoint_override: z.string().optional(),
      idempotency_key: z.string().optional(),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const request = {
        method: 'POST',
        path: args.endpoint_override || '/fba/outbound/2020-07-01/fulfillmentOrders',
        body: buildCreateFulfillmentOrderBody(amazon, args),
      };
      return wrapToolResult(
        {
          success: true,
          dry_run: true,
          idempotency_key: args.idempotency_key || null,
          request,
          next_step:
            'Run amazon_confirm_create_fulfillment_order with the same payload to execute this operation.',
        },
        args.max_chars,
      );
    },
  );

  server.tool(
    'amazon_confirm_create_fulfillment_order',
    'Create an Amazon FBA fulfillment order. Requires --apply or STATESET_ALLOW_APPLY unless dry_run=true.',
    {
      seller_fulfillment_order_id: z.string().describe('Seller fulfillment order ID'),
      displayable_order_id: z.string().describe('Displayable customer-facing order ID'),
      displayable_order_date: z.string().describe('Displayable order date/time (ISO string)'),
      displayable_order_comment: z.string().optional(),
      shipping_speed_category: AmazonShippingSpeedEnum.optional(),
      marketplace_id: z.string().optional().describe('Marketplace ID override'),
      destination_address: AmazonAddressSchema,
      items: z.array(AmazonFulfillmentItemSchema).min(1),
      notification_emails: z.array(z.string().email()).optional(),
      feature_constraints: z.array(z.string()).optional(),
      endpoint_override: z.string().optional(),
      idempotency_key: z.string().optional(),
      dry_run: z.boolean().optional().default(false),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const request = {
        method: 'POST',
        path: args.endpoint_override || '/fba/outbound/2020-07-01/fulfillmentOrders',
        body: buildCreateFulfillmentOrderBody(amazon, args),
      };

      if (args.dry_run) {
        return wrapToolResult({ success: true, dry_run: true, request }, args.max_chars);
      }

      const blocked = guardWrite(options);
      if (blocked) return blocked;

      if (args.idempotency_key) {
        const existing = amazonIdempotencyStore.get(args.idempotency_key);
        if (existing) {
          return wrapToolResult(
            {
              success: true,
              deduplicated: true,
              idempotency_key: args.idempotency_key,
              status: existing.status,
              data: existing.data,
            },
            args.max_chars,
          );
        }
      }

      const result = await runRequest(amazon, options, request);
      const idempotency = withAmazonIdempotency(args.idempotency_key, result.status, result.data);
      return wrapToolResult({ success: true, ...result, ...idempotency }, args.max_chars);
    },
  );

  server.tool(
    'amazon_preview_update_fulfillment_order',
    'Preview updates to an Amazon FBA fulfillment order without applying it.',
    {
      seller_fulfillment_order_id: z.string().describe('Seller fulfillment order ID'),
      marketplace_id: z.string().optional().describe('Marketplace ID override'),
      displayable_order_comment: z.string().optional(),
      shipping_speed_category: AmazonShippingSpeedEnum.optional(),
      destination_address: AmazonAddressSchema.optional(),
      items: z.array(AmazonFulfillmentItemSchema).min(1).optional(),
      notification_emails: z.array(z.string().email()).optional(),
      endpoint_override: z.string().optional(),
      idempotency_key: z.string().optional(),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const request = {
        method: 'PUT',
        path:
          args.endpoint_override ||
          `/fba/outbound/2020-07-01/fulfillmentOrders/${encodeURIComponent(args.seller_fulfillment_order_id)}`,
        body: buildUpdateFulfillmentOrderBody(amazon, args),
      };
      return wrapToolResult(
        {
          success: true,
          dry_run: true,
          idempotency_key: args.idempotency_key || null,
          request,
          next_step:
            'Run amazon_confirm_update_fulfillment_order with the same payload to execute this operation.',
        },
        args.max_chars,
      );
    },
  );

  server.tool(
    'amazon_confirm_update_fulfillment_order',
    'Update an Amazon FBA fulfillment order. Requires --apply or STATESET_ALLOW_APPLY unless dry_run=true.',
    {
      seller_fulfillment_order_id: z.string().describe('Seller fulfillment order ID'),
      marketplace_id: z.string().optional().describe('Marketplace ID override'),
      displayable_order_comment: z.string().optional(),
      shipping_speed_category: AmazonShippingSpeedEnum.optional(),
      destination_address: AmazonAddressSchema.optional(),
      items: z.array(AmazonFulfillmentItemSchema).min(1).optional(),
      notification_emails: z.array(z.string().email()).optional(),
      endpoint_override: z.string().optional(),
      idempotency_key: z.string().optional(),
      dry_run: z.boolean().optional().default(false),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const request = {
        method: 'PUT',
        path:
          args.endpoint_override ||
          `/fba/outbound/2020-07-01/fulfillmentOrders/${encodeURIComponent(args.seller_fulfillment_order_id)}`,
        body: buildUpdateFulfillmentOrderBody(amazon, args),
      };

      if (args.dry_run) {
        return wrapToolResult({ success: true, dry_run: true, request }, args.max_chars);
      }

      const blocked = guardWrite(options);
      if (blocked) return blocked;

      if (args.idempotency_key) {
        const existing = amazonIdempotencyStore.get(args.idempotency_key);
        if (existing) {
          return wrapToolResult(
            {
              success: true,
              deduplicated: true,
              idempotency_key: args.idempotency_key,
              status: existing.status,
              data: existing.data,
            },
            args.max_chars,
          );
        }
      }

      const result = await runRequest(amazon, options, request);
      const idempotency = withAmazonIdempotency(args.idempotency_key, result.status, result.data);
      return wrapToolResult({ success: true, ...result, ...idempotency }, args.max_chars);
    },
  );

  server.tool(
    'amazon_cancel_fulfillment_order',
    'Cancel an Amazon FBA fulfillment order. Requires --apply or STATESET_ALLOW_APPLY unless dry_run=true.',
    {
      seller_fulfillment_order_id: z.string().describe('Seller fulfillment order ID'),
      endpoint_override: z.string().optional(),
      idempotency_key: z.string().optional(),
      dry_run: z.boolean().optional().default(false),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const request = {
        method: 'DELETE',
        path:
          args.endpoint_override ||
          `/fba/outbound/2020-07-01/fulfillmentOrders/${encodeURIComponent(args.seller_fulfillment_order_id)}`,
      };

      if (args.dry_run) {
        return wrapToolResult({ success: true, dry_run: true, request }, args.max_chars);
      }

      const blocked = guardWrite(options);
      if (blocked) return blocked;

      if (args.idempotency_key) {
        const existing = amazonIdempotencyStore.get(args.idempotency_key);
        if (existing) {
          return wrapToolResult(
            {
              success: true,
              deduplicated: true,
              idempotency_key: args.idempotency_key,
              status: existing.status,
              data: existing.data,
            },
            args.max_chars,
          );
        }
      }

      const result = await runRequest(amazon, options, request);
      const idempotency = withAmazonIdempotency(args.idempotency_key, result.status, result.data);
      return wrapToolResult({ success: true, ...result, ...idempotency }, args.max_chars);
    },
  );

  server.tool(
    'amazon_get_package_tracking',
    'Get tracking details for an Amazon FBA outbound package number.',
    {
      package_number: z.string().describe('FBA package number'),
      marketplace_id: z.string().optional().describe('Marketplace ID override'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const result = await runRequest(amazon, options, {
        method: 'GET',
        path: '/fba/outbound/2020-07-01/tracking',
        query: buildQuery({
          packageNumber: args.package_number,
          marketplaceId: resolveMarketplaceId(amazon, args.marketplace_id),
        }),
      });
      return wrapToolResult({ success: true, ...result }, args.max_chars);
    },
  );

  registerRawRequestTool(
    server,
    'amazon_request',
    'Execute a raw Amazon Selling Partner API request.',
    runRequest,
    amazon,
    options,
  );
}
