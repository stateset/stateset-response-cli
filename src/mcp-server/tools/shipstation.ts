import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ShipStationConfig } from '../../integrations/config.js';
import { shipstationRequest } from '../../integrations/shipstation.js';
import { getErrorMessage } from '../../lib/errors.js';
import {
  type IntegrationToolOptions,
  MaxCharsSchema,
  buildQuery,
  createRequestRunner,
  guardWrite,
  registerRawRequestTool,
  wrapToolResult,
} from './helpers.js';

interface ShipStationLabelResponse {
  shipmentId?: number | string;
}

const runRequest = createRequestRunner<ShipStationConfig>((config, args) =>
  shipstationRequest({ shipstation: config, ...args }),
);

export function registerShipStationTools(
  server: McpServer,
  shipstation: ShipStationConfig,
  options: IntegrationToolOptions,
) {
  server.tool(
    'shipstation_list_orders',
    'List ShipStation orders with filters.',
    {
      order_status: z
        .enum(['awaiting_payment', 'awaiting_shipment', 'shipped', 'on_hold', 'cancelled'])
        .optional(),
      store_id: z.number().optional().describe('Filter by store ID'),
      tag_id: z.number().optional().describe('Filter by tag ID'),
      order_date_start: z.string().optional().describe('Orders created after (ISO date)'),
      order_date_end: z.string().optional().describe('Orders created before (ISO date)'),
      ship_by_date: z.string().optional().describe('Orders with ship-by date before this'),
      limit: z.number().min(1).max(500).optional().describe('Page size (pageSize)'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const query = buildQuery({
        orderStatus: args.order_status,
        storeId: args.store_id,
        tagId: args.tag_id,
        orderDateStart: args.order_date_start,
        orderDateEnd: args.order_date_end,
        shipByDate: args.ship_by_date,
        pageSize: args.limit,
      });

      const result = await runRequest(shipstation, options, {
        method: 'GET',
        path: '/orders',
        query,
      });
      return wrapToolResult({ success: true, ...result }, args.max_chars);
    },
  );

  server.tool(
    'shipstation_get_order',
    'Get a ShipStation order by ID.',
    {
      order_id: z.number().describe('ShipStation order ID'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const result = await runRequest(shipstation, options, {
        method: 'GET',
        path: `/orders/${args.order_id}`,
      });
      return wrapToolResult({ success: true, ...result }, args.max_chars);
    },
  );

  server.tool(
    'shipstation_update_order',
    'Update a ShipStation order. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      order_id: z.number().describe('ShipStation order ID'),
      order_status: z
        .enum(['awaiting_payment', 'awaiting_shipment', 'on_hold', 'cancelled'])
        .optional(),
      internal_notes: z.string().optional(),
      customer_notes: z.string().optional(),
      requested_shipping_service: z.string().optional(),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const blocked = guardWrite(options);
      if (blocked) return blocked;

      const body: Record<string, unknown> = {
        orderId: args.order_id,
      };
      if (args.order_status) body.orderStatus = args.order_status;
      if (args.internal_notes) body.internalNotes = args.internal_notes;
      if (args.customer_notes) body.customerNotes = args.customer_notes;
      if (args.requested_shipping_service)
        body.requestedShippingService = args.requested_shipping_service;

      const result = await runRequest(shipstation, options, {
        method: 'POST',
        path: '/orders/createorder',
        body,
      });
      return wrapToolResult({ success: true, ...result }, args.max_chars);
    },
  );

  server.tool(
    'shipstation_create_label',
    'Create a shipping label for an order. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      order_id: z.number().describe('ShipStation order ID'),
      carrier_code: z.string().describe('Carrier code (e.g., usps, ups)'),
      service_code: z.string().describe('Service code'),
      package_code: z.string().optional().default('package').describe('Package type'),
      weight_oz: z
        .number()
        .optional()
        .describe('Weight in ounces (uses order weight if not specified)'),
      test_label: z.boolean().optional().default(false),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const blocked = guardWrite(options);
      if (blocked) return blocked;

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

      const result = await runRequest(shipstation, options, {
        method: 'POST',
        path: '/orders/createlabelfororder',
        body,
      });
      return wrapToolResult({ success: true, ...result }, args.max_chars);
    },
  );

  server.tool(
    'shipstation_void_label',
    'Void a previously created shipping label. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      shipment_id: z.number().describe('Shipment ID to void'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const blocked = guardWrite(options);
      if (blocked) return blocked;

      const result = await runRequest(shipstation, options, {
        method: 'POST',
        path: '/shipments/voidlabel',
        body: { shipmentId: args.shipment_id },
      });
      return wrapToolResult({ success: true, ...result }, args.max_chars);
    },
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
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      let rateOptions: Record<string, unknown>;

      if (args.order_id !== undefined) {
        const orderResponse = await runRequest(shipstation, options, {
          method: 'GET',
          path: `/orders/${args.order_id}`,
        });
        const order = orderResponse.data as Record<string, unknown>;
        const shipFrom = (order.shipFrom ?? {}) as Record<string, unknown>;
        const shipTo = (order.shipTo ?? {}) as Record<string, unknown>;

        rateOptions = {
          carrierCode: null,
          fromPostalCode: shipFrom.postalCode,
          toPostalCode: shipTo.postalCode,
          toCountry: shipTo.country || 'US',
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

      const result = await runRequest(shipstation, options, {
        method: 'POST',
        path: '/shipments/getrates',
        body: rateOptions as Record<string, unknown>,
      });
      return wrapToolResult({ success: true, ...result }, args.max_chars);
    },
  );

  server.tool(
    'shipstation_list_shipments',
    'List ShipStation shipments with tracking information.',
    {
      shipment_date_start: z.string().optional().describe('Shipments after date'),
      shipment_date_end: z.string().optional().describe('Shipments before date'),
      carrier_code: z.string().optional().describe('Filter by carrier'),
      limit: z.number().min(1).max(500).optional().describe('Page size (pageSize)'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const query = buildQuery({
        shipDateStart: args.shipment_date_start,
        shipDateEnd: args.shipment_date_end,
        carrierCode: args.carrier_code,
        pageSize: args.limit,
      });

      const result = await runRequest(shipstation, options, {
        method: 'GET',
        path: '/shipments',
        query,
      });
      return wrapToolResult({ success: true, ...result }, args.max_chars);
    },
  );

  server.tool(
    'shipstation_list_carriers',
    'List ShipStation carriers.',
    {
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const result = await runRequest(shipstation, options, {
        method: 'GET',
        path: '/carriers',
      });
      return wrapToolResult({ success: true, ...result }, args.max_chars);
    },
  );

  server.tool(
    'shipstation_list_stores',
    'List ShipStation stores.',
    {
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const result = await runRequest(shipstation, options, {
        method: 'GET',
        path: '/stores',
      });
      return wrapToolResult({ success: true, ...result }, args.max_chars);
    },
  );

  server.tool(
    'shipstation_list_tags',
    'List ShipStation account tags.',
    {
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const result = await runRequest(shipstation, options, {
        method: 'GET',
        path: '/accounts/listtags',
      });
      return wrapToolResult({ success: true, ...result }, args.max_chars);
    },
  );

  server.tool(
    'shipstation_add_tag',
    'Add a tag to ShipStation orders. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      order_ids: z.array(z.number()).min(1).describe('Order IDs to tag'),
      tag_id: z.number().describe('Tag ID to add'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const blocked = guardWrite(options);
      if (blocked) return blocked;

      const result = await runRequest(shipstation, options, {
        method: 'POST',
        path: '/orders/addtag',
        body: { orderIds: args.order_ids, tagId: args.tag_id },
      });
      return wrapToolResult({ success: true, ...result }, args.max_chars);
    },
  );

  server.tool(
    'shipstation_batch_create_labels',
    'Create labels for multiple orders. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      order_ids: z.array(z.number()).min(1).describe('Order IDs'),
      carrier_code: z.string().describe('Carrier code for all labels'),
      service_code: z.string().describe('Service code for all labels'),
      test_label: z.boolean().optional().default(false),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const blocked = guardWrite(options);
      if (blocked) return blocked;

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
          results.push({
            order_id: orderId,
            success: true,
            shipment_id: (res.data as ShipStationLabelResponse)?.shipmentId,
          });
        } catch (error) {
          errors.push({
            order_id: orderId,
            error: getErrorMessage(error),
          });
        }
      }

      const payload = {
        success: errors.length === 0,
        total_requested: args.order_ids.length,
        created: results.length,
        failed: errors.length,
        errors: errors.length > 0 ? errors : undefined,
      };

      return wrapToolResult(payload, args.max_chars);
    },
  );

  registerRawRequestTool(
    server,
    'shipstation_request',
    'Execute a raw ShipStation API request.',
    runRequest,
    shipstation,
    options,
  );
}
