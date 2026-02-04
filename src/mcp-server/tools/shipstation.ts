import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ShipStationConfig } from '../../integrations/config.js';
import { shipstationRequest } from '../../integrations/shipstation.js';
import { redactPii } from '../../integrations/redact.js';
import { stringifyToolResult } from './output.js';

export interface ShipStationToolOptions {
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

async function runShipStationRequest(
  shipstation: ShipStationConfig,
  options: ShipStationToolOptions,
  args: {
    method: string;
    path: string;
    query?: Record<string, string | number | boolean>;
    body?: Record<string, unknown>;
  }
) {
  const response = await shipstationRequest({
    shipstation,
    method: args.method,
    path: args.path,
    query: args.query,
    body: args.body,
  });

  const data = options.redact ? redactPii(response.data) : response.data;
  return { status: response.status, data };
}

export function registerShipStationTools(server: McpServer, shipstation: ShipStationConfig, options: ShipStationToolOptions) {
  server.tool(
    'shipstation_list_orders',
    'List ShipStation orders with filters.',
    {
      order_status: z.enum(['awaiting_payment', 'awaiting_shipment', 'shipped', 'on_hold', 'cancelled']).optional(),
      store_id: z.number().optional().describe('Filter by store ID'),
      tag_id: z.number().optional().describe('Filter by tag ID'),
      order_date_start: z.string().optional().describe('Orders created after (ISO date)'),
      order_date_end: z.string().optional().describe('Orders created before (ISO date)'),
      ship_by_date: z.string().optional().describe('Orders with ship-by date before this'),
      limit: z.number().min(1).max(500).optional().describe('Page size (pageSize)'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      const query: Record<string, string | number | boolean> = {};
      if (args.order_status) query.orderStatus = args.order_status;
      if (args.store_id !== undefined) query.storeId = args.store_id;
      if (args.tag_id !== undefined) query.tagId = args.tag_id;
      if (args.order_date_start) query.orderDateStart = args.order_date_start;
      if (args.order_date_end) query.orderDateEnd = args.order_date_end;
      if (args.ship_by_date) query.shipByDate = args.ship_by_date;
      if (args.limit !== undefined) query.pageSize = args.limit;

      const result = await runShipStationRequest(shipstation, options, {
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
    'shipstation_get_order',
    'Get a ShipStation order by ID.',
    {
      order_id: z.number().describe('ShipStation order ID'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      const result = await runShipStationRequest(shipstation, options, {
        method: 'GET',
        path: `/orders/${args.order_id}`,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'shipstation_update_order',
    'Update a ShipStation order. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      order_id: z.number().describe('ShipStation order ID'),
      order_status: z.enum(['awaiting_payment', 'awaiting_shipment', 'on_hold', 'cancelled']).optional(),
      internal_notes: z.string().optional(),
      customer_notes: z.string().optional(),
      requested_shipping_service: z.string().optional(),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      if (!options.allowApply) return writeNotAllowed();

      const body: Record<string, unknown> = {
        orderId: args.order_id,
      };
      if (args.order_status) body.orderStatus = args.order_status;
      if (args.internal_notes) body.internalNotes = args.internal_notes;
      if (args.customer_notes) body.customerNotes = args.customer_notes;
      if (args.requested_shipping_service) body.requestedShippingService = args.requested_shipping_service;

      const result = await runShipStationRequest(shipstation, options, {
        method: 'POST',
        path: '/orders/createorder',
        body,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'shipstation_create_label',
    'Create a shipping label for an order. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      order_id: z.number().describe('ShipStation order ID'),
      carrier_code: z.string().describe('Carrier code (e.g., usps, ups)'),
      service_code: z.string().describe('Service code'),
      package_code: z.string().optional().default('package').describe('Package type'),
      weight_oz: z.number().optional().describe('Weight in ounces (uses order weight if not specified)'),
      test_label: z.boolean().optional().default(false),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      if (!options.allowApply) return writeNotAllowed();

      const body: Record<string, unknown> = {
        orderId: args.order_id,
        carrierCode: args.carrier_code,
        serviceCode: args.service_code,
        packageCode: args.package_code || 'package',
        testLabel: args.test_label,
      };
      if (args.weight_oz !== undefined) {
        body.weight = { value: args.weight_oz, units: 'ounces' };
      }

      const result = await runShipStationRequest(shipstation, options, {
        method: 'POST',
        path: '/orders/createlabelfororder',
        body,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'shipstation_void_label',
    'Void a previously created shipping label. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      shipment_id: z.number().describe('Shipment ID to void'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      if (!options.allowApply) return writeNotAllowed();

      const result = await runShipStationRequest(shipstation, options, {
        method: 'POST',
        path: '/shipments/voidlabel',
        body: { shipmentId: args.shipment_id },
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'shipstation_get_rates',
    'Get shipping rates for an order or ad-hoc shipment.',
    {
      order_id: z.number().optional().describe('Get rates for existing order'),
      from_postal_code: z.string().optional().describe('Origin postal code (if not using order)'),
      to_postal_code: z.string().optional().describe('Destination postal code'),
      to_country: z.string().optional().default('US').describe('Destination country code'),
      weight_oz: z.number().optional().describe('Package weight in ounces'),
      length: z.number().optional().describe('Package length in inches'),
      width: z.number().optional().describe('Package width in inches'),
      height: z.number().optional().describe('Package height in inches'),
      residential: z.boolean().optional().default(true),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      let rateOptions: Record<string, unknown>;

      if (args.order_id !== undefined) {
        const orderResponse = await runShipStationRequest(shipstation, options, {
          method: 'GET',
          path: `/orders/${args.order_id}`,
        });
        const order = orderResponse.data as Record<string, any>;

        rateOptions = {
          carrierCode: null,
          fromPostalCode: order.shipFrom?.postalCode,
          toPostalCode: order.shipTo?.postalCode,
          toCountry: order.shipTo?.country || 'US',
          weight: order.weight || { value: args.weight_oz || 16, units: 'ounces' },
          residential: args.residential,
        };
      } else {
        rateOptions = {
          carrierCode: null,
          fromPostalCode: args.from_postal_code,
          toPostalCode: args.to_postal_code,
          toCountry: args.to_country || 'US',
          weight: { value: args.weight_oz || 16, units: 'ounces' },
          residential: args.residential,
        };

        if (args.length && args.width && args.height) {
          rateOptions.dimensions = {
            length: args.length,
            width: args.width,
            height: args.height,
            units: 'inches',
          };
        }
      }

      const result = await runShipStationRequest(shipstation, options, {
        method: 'POST',
        path: '/shipments/getrates',
        body: rateOptions as Record<string, unknown>,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'shipstation_list_shipments',
    'List ShipStation shipments with tracking information.',
    {
      shipment_date_start: z.string().optional().describe('Shipments after date'),
      shipment_date_end: z.string().optional().describe('Shipments before date'),
      carrier_code: z.string().optional().describe('Filter by carrier'),
      limit: z.number().min(1).max(500).optional().describe('Page size (pageSize)'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      const query: Record<string, string | number | boolean> = {};
      if (args.shipment_date_start) query.shipDateStart = args.shipment_date_start;
      if (args.shipment_date_end) query.shipDateEnd = args.shipment_date_end;
      if (args.carrier_code) query.carrierCode = args.carrier_code;
      if (args.limit !== undefined) query.pageSize = args.limit;

      const result = await runShipStationRequest(shipstation, options, {
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
    'shipstation_list_carriers',
    'List ShipStation carriers.',
    {
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      const result = await runShipStationRequest(shipstation, options, {
        method: 'GET',
        path: '/carriers',
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'shipstation_list_stores',
    'List ShipStation stores.',
    {
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      const result = await runShipStationRequest(shipstation, options, {
        method: 'GET',
        path: '/stores',
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'shipstation_list_tags',
    'List ShipStation account tags.',
    {
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      const result = await runShipStationRequest(shipstation, options, {
        method: 'GET',
        path: '/accounts/listtags',
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'shipstation_add_tag',
    'Add a tag to ShipStation orders. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      order_ids: z.array(z.number()).min(1).describe('Order IDs to tag'),
      tag_id: z.number().describe('Tag ID to add'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      if (!options.allowApply) return writeNotAllowed();

      const result = await runShipStationRequest(shipstation, options, {
        method: 'POST',
        path: '/orders/addtag',
        body: { orderIds: args.order_ids, tagId: args.tag_id },
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'shipstation_batch_create_labels',
    'Create labels for multiple orders. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      order_ids: z.array(z.number()).min(1).describe('Order IDs'),
      carrier_code: z.string().describe('Carrier code for all labels'),
      service_code: z.string().describe('Service code for all labels'),
      test_label: z.boolean().optional().default(false),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      if (!options.allowApply) return writeNotAllowed();

      const results: Array<{ order_id: number; success: boolean; shipment_id?: unknown }> = [];
      const errors: Array<{ order_id: number; error: string }> = [];

      for (const orderId of args.order_ids) {
        try {
          const res = await shipstationRequest({
            shipstation,
            method: 'POST',
            path: '/orders/createlabelfororder',
            body: {
              orderId,
              carrierCode: args.carrier_code,
              serviceCode: args.service_code,
              testLabel: args.test_label,
            },
          });
          results.push({ order_id: orderId, success: true, shipment_id: (res.data as any)?.shipmentId });
        } catch (error) {
          errors.push({ order_id: orderId, error: error instanceof Error ? error.message : String(error) });
        }
      }

      const payload = {
        success: errors.length === 0,
        total_requested: args.order_ids.length,
        created: results.length,
        failed: errors.length,
        errors: errors.length > 0 ? errors : undefined,
      };

      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'shipstation_request',
    'Execute a raw ShipStation API request. Non-GET methods require --apply or STATESET_ALLOW_APPLY.',
    {
      method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).describe('HTTP method'),
      endpoint: z.string().describe('API endpoint path (e.g., /orders, /shipments/voidlabel)'),
      query: z.record(z.union([z.string(), z.number(), z.boolean()])).optional().describe('Optional query params'),
      body: z.record(z.any()).optional().describe('Optional JSON body'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      const method = String(args.method || '').toUpperCase();
      if (method !== 'GET' && !options.allowApply) {
        return writeNotAllowed();
      }

      const result = await runShipStationRequest(shipstation, options, {
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
