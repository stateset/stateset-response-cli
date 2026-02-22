import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ShipHawkConfig } from '../../integrations/config.js';
import { shiphawkRequest } from '../../integrations/shiphawk.js';
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

interface ShipHawkRatesResponse {
  rates?: Array<{
    carrier?: string;
    service_name?: string;
    total_price?: number;
    transit_days?: number;
  }>;
}

const runRequest = createRequestRunner<ShipHawkConfig>((config, args) =>
  shiphawkRequest({ shiphawk: config, ...args }),
);

export function registerShipHawkTools(
  server: McpServer,
  shiphawk: ShipHawkConfig,
  options: IntegrationToolOptions,
) {
  server.tool(
    'shiphawk_get_rates',
    'Get ShipHawk shipping rates for parcel or freight.',
    {
      origin_zip: z.string().describe('Origin postal code'),
      origin_country: z.string().optional().default('US'),
      destination_zip: z.string().describe('Destination postal code'),
      destination_country: z.string().optional().default('US'),
      destination_residential: z.boolean().optional().default(true),
      shipment_type: z.enum(['parcel', 'ltl', 'ftl']).optional().default('parcel'),
      weight_lbs: z.number().describe('Total weight in pounds'),
      length: z.number().optional().describe('Length in inches'),
      width: z.number().optional().describe('Width in inches'),
      height: z.number().optional().describe('Height in inches'),
      freight_class: z.number().optional().describe('Freight class (for LTL)'),
      pallet_count: z.number().optional().describe('Number of pallets (for LTL)'),
      accessorials: z.array(z.string()).optional().describe('Accessorial services needed'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const packageData: Record<string, unknown> = {
        weight: args.weight_lbs,
        length: args.length || 12,
        width: args.width || 12,
        height: args.height || 12,
      };
      if (args.shipment_type === 'ltl') {
        if (args.freight_class !== undefined) packageData.freight_class = args.freight_class;
        if (args.pallet_count !== undefined) packageData.pallet_count = args.pallet_count;
      }

      const body: Record<string, unknown> = {
        origin: { zip: args.origin_zip, country: args.origin_country || 'US' },
        destination: {
          zip: args.destination_zip,
          country: args.destination_country || 'US',
          is_residential: args.destination_residential,
        },
        packages: [packageData],
      };
      if (args.accessorials && args.accessorials.length > 0) body.accessorials = args.accessorials;

      const result = await runRequest(shiphawk, options, {
        method: 'POST',
        path: '/rates',
        body,
      });
      return wrapToolResult({ success: true, ...result }, args.max_chars as number | undefined);
    },
  );

  server.tool(
    'shiphawk_create_shipment',
    'Book a ShipHawk shipment. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      rate_id: z.string().describe('Rate ID from shiphawk_get_rates'),
      origin: z.object({
        name: z.string(),
        company: z.string().optional(),
        address1: z.string(),
        address2: z.string().optional(),
        city: z.string(),
        state: z.string(),
        zip: z.string(),
        country: z.string().optional().default('US'),
        phone: z.string().optional(),
        email: z.string().optional(),
      }),
      destination: z.object({
        name: z.string(),
        company: z.string().optional(),
        address1: z.string(),
        address2: z.string().optional(),
        city: z.string(),
        state: z.string(),
        zip: z.string(),
        country: z.string().optional().default('US'),
        phone: z.string().optional(),
        email: z.string().optional(),
      }),
      reference: z.string().optional().describe('Order or reference number'),
      special_instructions: z.string().optional(),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const blocked = guardWrite(options);
      if (blocked) return blocked;

      const body: Record<string, unknown> = {
        rate_id: args.rate_id,
        origin_address: {
          name: args.origin.name,
          company: args.origin.company,
          street1: args.origin.address1,
          street2: args.origin.address2,
          city: args.origin.city,
          state: args.origin.state,
          zip: args.origin.zip,
          country: args.origin.country || 'US',
          phone: args.origin.phone,
          email: args.origin.email,
        },
        destination_address: {
          name: args.destination.name,
          company: args.destination.company,
          street1: args.destination.address1,
          street2: args.destination.address2,
          city: args.destination.city,
          state: args.destination.state,
          zip: args.destination.zip,
          country: args.destination.country || 'US',
          phone: args.destination.phone,
          email: args.destination.email,
        },
      };
      if (args.reference) body.reference = args.reference;
      if (args.special_instructions) body.special_instructions = args.special_instructions;

      const result = await runRequest(shiphawk, options, {
        method: 'POST',
        path: '/shipments',
        body,
      });
      return wrapToolResult({ success: true, ...result }, args.max_chars as number | undefined);
    },
  );

  server.tool(
    'shiphawk_get_shipment',
    'Get ShipHawk shipment details.',
    {
      shipment_id: z.string().describe('ShipHawk shipment ID'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const result = await runRequest(shiphawk, options, {
        method: 'GET',
        path: `/shipments/${args.shipment_id}`,
      });
      return wrapToolResult({ success: true, ...result }, args.max_chars as number | undefined);
    },
  );

  server.tool(
    'shiphawk_void_shipment',
    'Cancel/void a ShipHawk shipment. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      shipment_id: z.string().describe('ShipHawk shipment ID'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const blocked = guardWrite(options);
      if (blocked) return blocked;

      const result = await runRequest(shiphawk, options, {
        method: 'POST',
        path: `/shipments/${args.shipment_id}/void`,
      });
      return wrapToolResult({ success: true, ...result }, args.max_chars as number | undefined);
    },
  );

  server.tool(
    'shiphawk_track_shipment',
    'Track a ShipHawk shipment.',
    {
      shipment_id: z.string().optional().describe('ShipHawk shipment ID'),
      tracking_number: z.string().optional().describe('Carrier tracking number'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      if (!args.shipment_id && !args.tracking_number) {
        throw new Error('Provide shipment_id or tracking_number.');
      }

      if (!args.shipment_id && args.tracking_number) {
        throw new Error('Tracking by number requires shipment_id for ShipHawk.');
      }

      const result = await runRequest(shiphawk, options, {
        method: 'GET',
        path: `/shipments/${args.shipment_id}/tracking`,
      });
      return wrapToolResult({ success: true, ...result }, args.max_chars as number | undefined);
    },
  );

  server.tool(
    'shiphawk_track_by_number',
    'Track a shipment by tracking number (carrier required by some accounts).',
    {
      tracking_number: z.string().describe('Carrier tracking number'),
      carrier: z.string().optional().describe('Carrier code if required by ShipHawk'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const query = buildQuery({
        tracking_number: args.tracking_number,
        carrier: args.carrier,
      });

      const result = await runRequest(shiphawk, options, {
        method: 'GET',
        path: '/tracking',
        query,
      });
      return wrapToolResult({ success: true, ...result }, args.max_chars as number | undefined);
    },
  );

  server.tool(
    'shiphawk_list_shipments',
    'List ShipHawk shipments.',
    {
      status: z
        .enum(['quoted', 'booked', 'picked_up', 'in_transit', 'delivered', 'exception', 'voided'])
        .optional(),
      created_after: z.string().optional(),
      created_before: z.string().optional(),
      shipment_type: z.enum(['parcel', 'ltl', 'ftl']).optional(),
      limit: z.number().min(1).max(100).optional(),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const query = buildQuery({
        status: args.status,
        created_after: args.created_after,
        created_before: args.created_before,
        shipment_type: args.shipment_type,
        limit: args.limit,
      });

      const result = await runRequest(shiphawk, options, {
        method: 'GET',
        path: '/shipments',
        query,
      });
      return wrapToolResult({ success: true, ...result }, args.max_chars as number | undefined);
    },
  );

  server.tool(
    'shiphawk_schedule_pickup',
    'Schedule a carrier pickup. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      shipment_ids: z.array(z.string()).min(1).describe('Shipment IDs to pick up'),
      pickup_date: z.string().describe('Requested pickup date (ISO)'),
      ready_time: z.string().optional().describe('Time packages ready (HH:MM)'),
      close_time: z.string().optional().describe('Location close time (HH:MM)'),
      special_instructions: z.string().optional(),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const blocked = guardWrite(options);
      if (blocked) return blocked;

      const body: Record<string, unknown> = {
        shipment_ids: args.shipment_ids,
        pickup_date: args.pickup_date,
        ready_time: args.ready_time || '09:00',
        close_time: args.close_time || '17:00',
        special_instructions: args.special_instructions,
      };

      const result = await runRequest(shiphawk, options, {
        method: 'POST',
        path: '/pickups',
        body,
      });
      return wrapToolResult({ success: true, ...result }, args.max_chars as number | undefined);
    },
  );

  server.tool(
    'shiphawk_get_bol',
    'Get Bill of Lading document for a freight shipment.',
    {
      shipment_id: z.string().describe('ShipHawk shipment ID'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const result = await runRequest(shiphawk, options, {
        method: 'GET',
        path: `/shipments/${args.shipment_id}/documents/bol`,
      });
      return wrapToolResult({ success: true, ...result }, args.max_chars as number | undefined);
    },
  );

  server.tool(
    'shiphawk_batch_rate_shop',
    'Get rates for multiple shipments at once.',
    {
      shipments: z
        .array(
          z.object({
            id: z.string().describe('Reference ID'),
            origin_zip: z.string(),
            destination_zip: z.string(),
            weight_lbs: z.number(),
            shipment_type: z.enum(['parcel', 'ltl']).optional().default('parcel'),
          }),
        )
        .describe('Shipments to rate'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const results: Array<Record<string, unknown>> = [];
      const errors: Array<Record<string, unknown>> = [];

      for (const shipment of args.shipments) {
        try {
          const rateBody = {
            origin: { zip: shipment.origin_zip, country: 'US' },
            destination: { zip: shipment.destination_zip, country: 'US' },
            packages: [{ weight: shipment.weight_lbs, length: 12, width: 12, height: 12 }],
          };
          const response = await shiphawkRequest({
            shiphawk,
            method: 'POST',
            path: '/rates',
            body: rateBody,
          });
          const rates = (response.data as ShipHawkRatesResponse)?.rates ?? [];
          const cheapest = rates.sort((a, b) => (a.total_price ?? 0) - (b.total_price ?? 0))[0];

          results.push({
            id: shipment.id,
            cheapest_carrier: cheapest?.carrier,
            cheapest_service: cheapest?.service_name,
            cheapest_price: cheapest?.total_price,
            transit_days: cheapest?.transit_days,
            total_options: rates.length,
          });
        } catch (error) {
          errors.push({
            id: shipment.id,
            error: getErrorMessage(error),
          });
        }
      }

      const payload = {
        success: errors.length === 0,
        total_requested: args.shipments.length,
        rated: results.length,
        failed: errors.length,
        results,
        errors: errors.length > 0 ? errors : undefined,
      };
      return wrapToolResult(payload, args.max_chars as number | undefined);
    },
  );

  registerRawRequestTool(
    server,
    'shiphawk_request',
    'Execute a raw ShipHawk API request.',
    runRequest,
    shiphawk,
    options,
  );
}
