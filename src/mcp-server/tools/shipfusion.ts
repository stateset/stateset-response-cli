import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ShipFusionConfig } from '../../integrations/config.js';
import { shipfusionRequest } from '../../integrations/shipfusion.js';
import {
  type IntegrationToolOptions,
  createRequestRunner,
  guardWrite,
  wrapToolResult,
  MaxCharsSchema,
  buildQuery,
  registerRawRequestTool,
} from './helpers.js';

const runRequest = createRequestRunner<ShipFusionConfig>((config, args) =>
  shipfusionRequest({ shipfusion: config, ...args }),
);

const shipfusionIdempotencyStore = new Map<string, { status: number; data: unknown }>();

function withShipFusionIdempotency(
  key: string | undefined,
  status: number,
  data: unknown,
): { deduplicated: boolean; status: number; data: unknown } {
  if (!key) return { deduplicated: false, status, data };
  const existing = shipfusionIdempotencyStore.get(key);
  if (existing) {
    return { deduplicated: true, status: existing.status, data: existing.data };
  }
  shipfusionIdempotencyStore.set(key, { status, data });
  return { deduplicated: false, status, data };
}

export function registerShipFusionTools(
  server: McpServer,
  shipfusion: ShipFusionConfig,
  options: IntegrationToolOptions,
) {
  server.tool(
    'shipfusion_list_orders',
    'List ShipFusion orders with filters.',
    {
      status: z
        .enum([
          'received',
          'processing',
          'picking',
          'packing',
          'shipped',
          'delivered',
          'cancelled',
          'on_hold',
          'backorder',
        ])
        .optional(),
      created_after: z.string().optional().describe('Orders created after (ISO date)'),
      created_before: z.string().optional().describe('Orders created before (ISO date)'),
      sku: z.string().optional().describe('Filter by SKU'),
      limit: z.number().min(1).max(100).optional().describe('Maximum results'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const query = buildQuery({
        status: args.status,
        created_after: args.created_after,
        created_before: args.created_before,
        sku: args.sku,
        limit: args.limit,
      });

      const result = await runRequest(shipfusion, options, {
        method: 'GET',
        path: '/orders',
        query,
      });
      return wrapToolResult({ success: true, ...result }, args.max_chars as number | undefined);
    },
  );

  server.tool(
    'shipfusion_get_order',
    'Get a ShipFusion order by ID.',
    {
      order_id: z.string().describe('ShipFusion order ID'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const result = await runRequest(shipfusion, options, {
        method: 'GET',
        path: `/orders/${args.order_id}`,
      });
      return wrapToolResult({ success: true, ...result }, args.max_chars as number | undefined);
    },
  );

  server.tool(
    'shipfusion_cancel_order',
    'Cancel an unfulfilled ShipFusion order. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      order_id: z.string().describe('ShipFusion order ID'),
      reason: z.string().optional().describe('Cancellation reason'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const blocked = guardWrite(options);
      if (blocked) return blocked;

      const result = await runRequest(shipfusion, options, {
        method: 'POST',
        path: `/orders/${args.order_id}/cancel`,
        body: args.reason ? { reason: args.reason } : undefined,
      });
      return wrapToolResult({ success: true, ...result }, args.max_chars as number | undefined);
    },
  );

  server.tool(
    'shipfusion_get_inventory',
    'Check ShipFusion inventory levels for a SKU.',
    {
      sku: z.string().describe('Product SKU'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const encodedSku = encodeURIComponent(args.sku);
      const result = await runRequest(shipfusion, options, {
        method: 'GET',
        path: `/inventory/${encodedSku}`,
      });
      return wrapToolResult({ success: true, ...result }, args.max_chars as number | undefined);
    },
  );

  server.tool(
    'shipfusion_list_shipments',
    'List ShipFusion shipments with tracking.',
    {
      shipped_after: z.string().optional().describe('Shipped after date'),
      shipped_before: z.string().optional().describe('Shipped before date'),
      carrier: z.string().optional().describe('Filter by carrier'),
      limit: z.number().min(1).max(100).optional().describe('Maximum results'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const query = buildQuery({
        shipped_after: args.shipped_after,
        shipped_before: args.shipped_before,
        carrier: args.carrier,
        limit: args.limit,
      });

      const result = await runRequest(shipfusion, options, {
        method: 'GET',
        path: '/shipments',
        query,
      });
      return wrapToolResult({ success: true, ...result }, args.max_chars as number | undefined);
    },
  );

  server.tool(
    'shipfusion_get_shipment',
    'Get a ShipFusion shipment by ID.',
    {
      shipment_id: z.string().describe('ShipFusion shipment ID'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const result = await runRequest(shipfusion, options, {
        method: 'GET',
        path: `/shipments/${args.shipment_id}`,
      });
      return wrapToolResult({ success: true, ...result }, args.max_chars as number | undefined);
    },
  );

  server.tool(
    'shipfusion_get_order_shipments',
    'Get shipments for a ShipFusion order.',
    {
      order_id: z.string().describe('ShipFusion order ID'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const result = await runRequest(shipfusion, options, {
        method: 'GET',
        path: `/orders/${args.order_id}/shipments`,
      });
      return wrapToolResult({ success: true, ...result }, args.max_chars as number | undefined);
    },
  );

  server.tool(
    'shipfusion_get_tracking',
    'Get ShipFusion tracking information by shipment ID, tracking number, or order ID.',
    {
      shipment_id: z.string().optional().describe('ShipFusion shipment ID'),
      tracking_number: z.string().optional().describe('Carrier tracking number'),
      order_id: z.string().optional().describe('Order ID to get tracking for'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      if (!args.shipment_id && !args.tracking_number && !args.order_id) {
        throw new Error('Provide shipment_id, tracking_number, or order_id.');
      }

      let path: string;
      if (args.shipment_id) {
        path = `/shipments/${args.shipment_id}`;
      } else if (args.tracking_number) {
        path = `/shipments/tracking/${encodeURIComponent(args.tracking_number)}`;
      } else {
        path = `/orders/${args.order_id}/shipments`;
      }

      const result = await runRequest(shipfusion, options, {
        method: 'GET',
        path,
      });
      return wrapToolResult({ success: true, ...result }, args.max_chars as number | undefined);
    },
  );

  server.tool(
    'shipfusion_create_asn',
    'Create an Advance Ship Notice (ASN). Requires --apply or STATESET_ALLOW_APPLY.',
    {
      items: z
        .array(
          z.object({
            sku: z.string(),
            quantity: z.number(),
            lot_number: z.string().optional(),
          }),
        )
        .describe('Items being sent'),
      carrier: z.string().describe('Shipping carrier'),
      tracking_number: z.string().describe('Tracking number'),
      expected_arrival: z.string().describe('Expected arrival date (ISO)'),
      po_number: z.string().optional().describe('Purchase order or reference number'),
      notes: z.string().optional().describe('Special instructions'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const blocked = guardWrite(options);
      if (blocked) return blocked;

      const body: Record<string, unknown> = {
        items: args.items,
        carrier: args.carrier,
        tracking_number: args.tracking_number,
        expected_arrival: args.expected_arrival,
      };
      if (args.po_number) body.po_number = args.po_number;
      if (args.notes) body.notes = args.notes;

      const result = await runRequest(shipfusion, options, {
        method: 'POST',
        path: '/asn',
        body,
      });
      return wrapToolResult({ success: true, ...result }, args.max_chars as number | undefined);
    },
  );

  server.tool(
    'shipfusion_list_returns',
    'List ShipFusion returns.',
    {
      status: z.enum(['pending', 'received', 'inspecting', 'processed', 'completed']).optional(),
      created_after: z.string().optional(),
      created_before: z.string().optional(),
      limit: z.number().min(1).max(100).optional(),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const query = buildQuery({
        status: args.status,
        created_after: args.created_after,
        created_before: args.created_before,
        limit: args.limit,
      });

      const result = await runRequest(shipfusion, options, {
        method: 'GET',
        path: '/returns',
        query,
      });
      return wrapToolResult({ success: true, ...result }, args.max_chars as number | undefined);
    },
  );

  server.tool(
    'shipfusion_get_return',
    'Get a ShipFusion return by ID.',
    {
      return_id: z.string().describe('Return ID'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const result = await runRequest(shipfusion, options, {
        method: 'GET',
        path: `/returns/${args.return_id}`,
      });
      return wrapToolResult({ success: true, ...result }, args.max_chars as number | undefined);
    },
  );

  server.tool(
    'shipfusion_process_return',
    'Process a ShipFusion return. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      return_id: z.string().describe('Return ID'),
      disposition: z.enum(['restock', 'damaged', 'dispose', 'quarantine']).describe('Disposition'),
      notes: z.string().optional().describe('Processing notes'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const blocked = guardWrite(options);
      if (blocked) return blocked;

      const body: Record<string, unknown> = {
        disposition: args.disposition,
        notes: args.notes,
      };

      const result = await runRequest(shipfusion, options, {
        method: 'POST',
        path: `/returns/${args.return_id}/process`,
        body,
      });
      return wrapToolResult({ success: true, ...result }, args.max_chars as number | undefined);
    },
  );

  server.tool(
    'shipfusion_hold_order',
    'Put a ShipFusion order on hold or release it. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      order_id: z.string().describe('ShipFusion order ID'),
      on_hold: z.boolean().describe('true to hold, false to release'),
      reason: z.string().optional().describe('Optional hold/release reason'),
      endpoint_override: z
        .string()
        .optional()
        .describe('Override default endpoint (default /orders/{id}/hold)'),
      idempotency_key: z.string().optional().describe('Optional idempotency key'),
      dry_run: z.boolean().optional().default(false).describe('Preview without applying'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const request = {
        method: 'POST',
        path: args.endpoint_override || `/orders/${args.order_id}/hold`,
        body: { on_hold: args.on_hold, reason: args.reason },
      };
      if (args.dry_run) {
        return wrapToolResult(
          { success: true, dry_run: true, idempotency_key: args.idempotency_key || null, request },
          args.max_chars as number | undefined,
        );
      }
      const blocked = guardWrite(options);
      if (blocked) return blocked;
      const result = await runRequest(shipfusion, options, request);
      const deduped = withShipFusionIdempotency(args.idempotency_key, result.status, result.data);
      return wrapToolResult(
        { success: true, idempotency_key: args.idempotency_key || null, ...deduped },
        args.max_chars as number | undefined,
      );
    },
  );

  server.tool(
    'shipfusion_cancel_shipment',
    'Cancel a ShipFusion shipment. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      shipment_id: z.string().describe('ShipFusion shipment ID'),
      reason: z.string().optional().describe('Optional cancellation reason'),
      endpoint_override: z
        .string()
        .optional()
        .describe('Override default endpoint (default /shipments/{id}/cancel)'),
      idempotency_key: z.string().optional().describe('Optional idempotency key'),
      dry_run: z.boolean().optional().default(false).describe('Preview without applying'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const request = {
        method: 'POST',
        path: args.endpoint_override || `/shipments/${args.shipment_id}/cancel`,
        body: args.reason ? { reason: args.reason } : undefined,
      };
      if (args.dry_run) {
        return wrapToolResult(
          { success: true, dry_run: true, idempotency_key: args.idempotency_key || null, request },
          args.max_chars as number | undefined,
        );
      }
      const blocked = guardWrite(options);
      if (blocked) return blocked;
      const result = await runRequest(shipfusion, options, request);
      const deduped = withShipFusionIdempotency(args.idempotency_key, result.status, result.data);
      return wrapToolResult(
        { success: true, idempotency_key: args.idempotency_key || null, ...deduped },
        args.max_chars as number | undefined,
      );
    },
  );

  server.tool(
    'shipfusion_create_return',
    'Create a ShipFusion return request. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      return_payload: z.record(z.unknown()).describe('Return creation payload'),
      endpoint_override: z
        .string()
        .optional()
        .describe('Override default endpoint (default /returns)'),
      idempotency_key: z.string().optional().describe('Optional idempotency key'),
      dry_run: z.boolean().optional().default(false).describe('Preview without applying'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const request = {
        method: 'POST',
        path: args.endpoint_override || '/returns',
        body: args.return_payload as Record<string, unknown>,
      };
      if (args.dry_run) {
        return wrapToolResult(
          { success: true, dry_run: true, idempotency_key: args.idempotency_key || null, request },
          args.max_chars as number | undefined,
        );
      }
      const blocked = guardWrite(options);
      if (blocked) return blocked;
      const result = await runRequest(shipfusion, options, request);
      const deduped = withShipFusionIdempotency(args.idempotency_key, result.status, result.data);
      return wrapToolResult(
        { success: true, idempotency_key: args.idempotency_key || null, ...deduped },
        args.max_chars as number | undefined,
      );
    },
  );

  server.tool(
    'shipfusion_update_return',
    'Update a ShipFusion return. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      return_id: z.string().describe('Return ID'),
      return_payload: z.record(z.unknown()).describe('Return update payload'),
      endpoint_override: z
        .string()
        .optional()
        .describe('Override default endpoint (default /returns/{id})'),
      idempotency_key: z.string().optional().describe('Optional idempotency key'),
      dry_run: z.boolean().optional().default(false).describe('Preview without applying'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const request = {
        method: 'PATCH',
        path: args.endpoint_override || `/returns/${args.return_id}`,
        body: args.return_payload as Record<string, unknown>,
      };
      if (args.dry_run) {
        return wrapToolResult(
          { success: true, dry_run: true, idempotency_key: args.idempotency_key || null, request },
          args.max_chars as number | undefined,
        );
      }
      const blocked = guardWrite(options);
      if (blocked) return blocked;
      const result = await runRequest(shipfusion, options, request);
      const deduped = withShipFusionIdempotency(args.idempotency_key, result.status, result.data);
      return wrapToolResult(
        { success: true, idempotency_key: args.idempotency_key || null, ...deduped },
        args.max_chars as number | undefined,
      );
    },
  );

  server.tool(
    'shipfusion_resolve_exception',
    'Resolve a ShipFusion order/shipment exception with a standardized action. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      exception_target: z.enum(['order', 'shipment']).describe('Exception target type'),
      target_id: z.string().describe('Order ID or shipment ID'),
      resolution: z
        .enum(['release_hold', 'cancel', 'reroute', 'mark_resolved'])
        .describe('Resolution action'),
      notes: z.string().optional().describe('Optional resolution notes'),
      endpoint_override: z.string().optional().describe('Override default endpoint'),
      idempotency_key: z.string().optional().describe('Optional idempotency key'),
      dry_run: z.boolean().optional().default(false).describe('Preview without applying'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const defaultPath = `/${args.exception_target}s/${args.target_id}/exceptions/resolve`;
      const request = {
        method: 'POST',
        path: args.endpoint_override || defaultPath,
        body: { resolution: args.resolution, notes: args.notes },
      };
      if (args.dry_run) {
        return wrapToolResult(
          { success: true, dry_run: true, idempotency_key: args.idempotency_key || null, request },
          args.max_chars as number | undefined,
        );
      }
      const blocked = guardWrite(options);
      if (blocked) return blocked;
      const result = await runRequest(shipfusion, options, request);
      const deduped = withShipFusionIdempotency(args.idempotency_key, result.status, result.data);
      return wrapToolResult(
        { success: true, idempotency_key: args.idempotency_key || null, ...deduped },
        args.max_chars as number | undefined,
      );
    },
  );

  server.tool(
    'shipfusion_job_status',
    'Get status for a ShipFusion async job.',
    {
      job_id: z.string().describe('Job ID'),
      endpoint_override: z
        .string()
        .optional()
        .describe('Override default endpoint (default /jobs/{id})'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const result = await runRequest(shipfusion, options, {
        method: 'GET',
        path: args.endpoint_override || `/jobs/${args.job_id}`,
      });
      return wrapToolResult({ success: true, ...result }, args.max_chars as number | undefined);
    },
  );

  server.tool(
    'shipfusion_job_retry',
    'Retry a ShipFusion async job. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      job_id: z.string().describe('Job ID'),
      endpoint_override: z
        .string()
        .optional()
        .describe('Override default endpoint (default /jobs/{id}/retry)'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const blocked = guardWrite(options);
      if (blocked) return blocked;
      const result = await runRequest(shipfusion, options, {
        method: 'POST',
        path: args.endpoint_override || `/jobs/${args.job_id}/retry`,
      });
      return wrapToolResult({ success: true, ...result }, args.max_chars as number | undefined);
    },
  );

  server.tool(
    'shipfusion_job_rollback',
    'Rollback a ShipFusion async job when supported. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      job_id: z.string().describe('Job ID'),
      endpoint_override: z
        .string()
        .optional()
        .describe('Override default endpoint (default /jobs/{id}/rollback)'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const blocked = guardWrite(options);
      if (blocked) return blocked;
      const result = await runRequest(shipfusion, options, {
        method: 'POST',
        path: args.endpoint_override || `/jobs/${args.job_id}/rollback`,
      });
      return wrapToolResult({ success: true, ...result }, args.max_chars as number | undefined);
    },
  );

  registerRawRequestTool(
    server,
    'shipfusion_request',
    'Execute a raw ShipFusion API request.',
    runRequest,
    shipfusion,
    options,
  );
}
