import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ShipFusionConfig } from '../../integrations/config.js';
import { shipfusionRequest } from '../../integrations/shipfusion.js';
import { redactPii } from '../../integrations/redact.js';
import { stringifyToolResult } from './output.js';

export interface ShipFusionToolOptions {
  allowApply: boolean;
  redact: boolean;
}

function writeNotAllowed() {
  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        error: 'Write operation not allowed. The --apply flag or STATESET_ALLOW_APPLY must be set.',
        hint: 'Use list/get operations when writes are disabled.',
      }, null, 2),
    }],
  };
}

async function runShipFusionRequest(
  shipfusion: ShipFusionConfig,
  options: ShipFusionToolOptions,
  args: {
    method: string;
    path: string;
    query?: Record<string, string | number | boolean>;
    body?: Record<string, unknown>;
  }
) {
  const response = await shipfusionRequest({
    shipfusion,
    method: args.method,
    path: args.path,
    query: args.query,
    body: args.body,
  });

  const data = options.redact ? redactPii(response.data) : response.data;
  return { status: response.status, data };
}

export function registerShipFusionTools(server: McpServer, shipfusion: ShipFusionConfig, options: ShipFusionToolOptions) {
  server.tool(
    'shipfusion_list_orders',
    'List ShipFusion orders with filters.',
    {
      status: z.enum(['received', 'processing', 'picking', 'packing', 'shipped', 'delivered', 'cancelled', 'on_hold', 'backorder']).optional(),
      created_after: z.string().optional().describe('Orders created after (ISO date)'),
      created_before: z.string().optional().describe('Orders created before (ISO date)'),
      sku: z.string().optional().describe('Filter by SKU'),
      limit: z.number().min(1).max(100).optional().describe('Maximum results'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      const query: Record<string, string | number | boolean> = {};
      if (args.status) query.status = args.status;
      if (args.created_after) query.created_after = args.created_after;
      if (args.created_before) query.created_before = args.created_before;
      if (args.sku) query.sku = args.sku;
      if (args.limit !== undefined) query.limit = args.limit;

      const result = await runShipFusionRequest(shipfusion, options, {
        method: 'GET',
        path: '/orders',
        query: Object.keys(query).length > 0 ? query : undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'shipfusion_get_order',
    'Get a ShipFusion order by ID.',
    {
      order_id: z.string().describe('ShipFusion order ID'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      const result = await runShipFusionRequest(shipfusion, options, {
        method: 'GET',
        path: `/orders/${args.order_id}`,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'shipfusion_cancel_order',
    'Cancel an unfulfilled ShipFusion order. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      order_id: z.string().describe('ShipFusion order ID'),
      reason: z.string().optional().describe('Cancellation reason'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      if (!options.allowApply) return writeNotAllowed();

      const result = await runShipFusionRequest(shipfusion, options, {
        method: 'POST',
        path: `/orders/${args.order_id}/cancel`,
        body: args.reason ? { reason: args.reason } : undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'shipfusion_get_inventory',
    'Check ShipFusion inventory levels for a SKU.',
    {
      sku: z.string().describe('Product SKU'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      const encodedSku = encodeURIComponent(args.sku);
      const result = await runShipFusionRequest(shipfusion, options, {
        method: 'GET',
        path: `/inventory/${encodedSku}`,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'shipfusion_list_shipments',
    'List ShipFusion shipments with tracking.',
    {
      shipped_after: z.string().optional().describe('Shipped after date'),
      shipped_before: z.string().optional().describe('Shipped before date'),
      carrier: z.string().optional().describe('Filter by carrier'),
      limit: z.number().min(1).max(100).optional().describe('Maximum results'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      const query: Record<string, string | number | boolean> = {};
      if (args.shipped_after) query.shipped_after = args.shipped_after;
      if (args.shipped_before) query.shipped_before = args.shipped_before;
      if (args.carrier) query.carrier = args.carrier;
      if (args.limit !== undefined) query.limit = args.limit;

      const result = await runShipFusionRequest(shipfusion, options, {
        method: 'GET',
        path: '/shipments',
        query: Object.keys(query).length > 0 ? query : undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'shipfusion_get_shipment',
    'Get a ShipFusion shipment by ID.',
    {
      shipment_id: z.string().describe('ShipFusion shipment ID'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      const result = await runShipFusionRequest(shipfusion, options, {
        method: 'GET',
        path: `/shipments/${args.shipment_id}`,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'shipfusion_get_order_shipments',
    'Get shipments for a ShipFusion order.',
    {
      order_id: z.string().describe('ShipFusion order ID'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      const result = await runShipFusionRequest(shipfusion, options, {
        method: 'GET',
        path: `/orders/${args.order_id}/shipments`,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'shipfusion_get_tracking',
    'Get ShipFusion tracking information by shipment ID, tracking number, or order ID.',
    {
      shipment_id: z.string().optional().describe('ShipFusion shipment ID'),
      tracking_number: z.string().optional().describe('Carrier tracking number'),
      order_id: z.string().optional().describe('Order ID to get tracking for'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
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

      const result = await runShipFusionRequest(shipfusion, options, {
        method: 'GET',
        path,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'shipfusion_create_asn',
    'Create an Advance Ship Notice (ASN). Requires --apply or STATESET_ALLOW_APPLY.',
    {
      items: z.array(z.object({
        sku: z.string(),
        quantity: z.number(),
        lot_number: z.string().optional(),
      })).describe('Items being sent'),
      carrier: z.string().describe('Shipping carrier'),
      tracking_number: z.string().describe('Tracking number'),
      expected_arrival: z.string().describe('Expected arrival date (ISO)'),
      po_number: z.string().optional().describe('Purchase order or reference number'),
      notes: z.string().optional().describe('Special instructions'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      if (!options.allowApply) return writeNotAllowed();

      const body: Record<string, unknown> = {
        items: args.items,
        carrier: args.carrier,
        tracking_number: args.tracking_number,
        expected_arrival: args.expected_arrival,
      };
      if (args.po_number) body.po_number = args.po_number;
      if (args.notes) body.notes = args.notes;

      const result = await runShipFusionRequest(shipfusion, options, {
        method: 'POST',
        path: '/asn',
        body,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'shipfusion_list_returns',
    'List ShipFusion returns.',
    {
      status: z.enum(['pending', 'received', 'inspecting', 'processed', 'completed']).optional(),
      created_after: z.string().optional(),
      created_before: z.string().optional(),
      limit: z.number().min(1).max(100).optional(),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      const query: Record<string, string | number | boolean> = {};
      if (args.status) query.status = args.status;
      if (args.created_after) query.created_after = args.created_after;
      if (args.created_before) query.created_before = args.created_before;
      if (args.limit !== undefined) query.limit = args.limit;

      const result = await runShipFusionRequest(shipfusion, options, {
        method: 'GET',
        path: '/returns',
        query: Object.keys(query).length > 0 ? query : undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'shipfusion_get_return',
    'Get a ShipFusion return by ID.',
    {
      return_id: z.string().describe('Return ID'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      const result = await runShipFusionRequest(shipfusion, options, {
        method: 'GET',
        path: `/returns/${args.return_id}`,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'shipfusion_process_return',
    'Process a ShipFusion return. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      return_id: z.string().describe('Return ID'),
      disposition: z.enum(['restock', 'damaged', 'dispose', 'quarantine']).describe('Disposition'),
      notes: z.string().optional().describe('Processing notes'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      if (!options.allowApply) return writeNotAllowed();

      const body: Record<string, unknown> = {
        disposition: args.disposition,
        notes: args.notes,
      };

      const result = await runShipFusionRequest(shipfusion, options, {
        method: 'POST',
        path: `/returns/${args.return_id}/process`,
        body,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'shipfusion_request',
    'Execute a raw ShipFusion API request. Non-GET methods require --apply or STATESET_ALLOW_APPLY.',
    {
      method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).describe('HTTP method'),
      endpoint: z.string().describe('API endpoint path (e.g., /orders, /inventory/sku)'),
      query: z.record(z.union([z.string(), z.number(), z.boolean()])).optional().describe('Optional query params'),
      body: z.record(z.any()).optional().describe('Optional JSON body'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      const method = String(args.method || '').toUpperCase();
      if (method !== 'GET' && !options.allowApply) {
        return writeNotAllowed();
      }

      const result = await runShipFusionRequest(shipfusion, options, {
        method,
        path: args.endpoint as string,
        query: args.query as Record<string, string | number | boolean> | undefined,
        body: args.body as Record<string, unknown> | undefined,
      });

      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );
}
