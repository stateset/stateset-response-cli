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

  registerRawRequestTool(
    server,
    'shipfusion_request',
    'Execute a raw ShipFusion API request.',
    runRequest,
    shipfusion,
    options,
  );
}
