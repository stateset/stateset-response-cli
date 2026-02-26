import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { FedExConfig } from '../../integrations/config.js';
import { fedexRequest } from '../../integrations/fedex.js';
import {
  type IntegrationToolOptions,
  MaxCharsSchema,
  createRequestRunner,
  guardWrite,
  registerRawRequestTool,
  wrapToolResult,
} from './helpers.js';

const fedexIdempotencyStore = new Map<string, { status: number; data: unknown }>();

function withFedExIdempotency(
  key: string | undefined,
  status: number,
  data: unknown,
): { deduplicated: boolean; status: number; data: unknown } {
  if (!key) return { deduplicated: false, status, data };
  const existing = fedexIdempotencyStore.get(key);
  if (existing) {
    return { deduplicated: true, status: existing.status, data: existing.data };
  }
  fedexIdempotencyStore.set(key, { status, data });
  return { deduplicated: false, status, data };
}

const runRequest = createRequestRunner<FedExConfig>((config, args) =>
  fedexRequest({ fedex: config, ...args }),
);

export function registerFedExTools(
  server: McpServer,
  fedex: FedExConfig,
  options: IntegrationToolOptions,
) {
  server.tool(
    'fedex_track_shipment',
    'Track a FedEx shipment by tracking number.',
    {
      tracking_number: z.string().describe('Shipment tracking number'),
      endpoint_override: z
        .string()
        .optional()
        .describe('Override default endpoint (/track/v1/trackingnumbers)'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const result = await runRequest(fedex, options, {
        method: 'POST',
        path: args.endpoint_override || '/track/v1/trackingnumbers',
        body: {
          includeDetailedScans: true,
          trackingInfo: [
            {
              trackingNumberInfo: {
                trackingNumber: args.tracking_number,
              },
            },
          ],
        },
      });
      return wrapToolResult({ success: true, ...result }, args.max_chars);
    },
  );

  server.tool(
    'fedex_get_rates',
    'Get FedEx shipping rates/quote.',
    {
      shipper_postal_code: z.string().describe('Shipper postal code'),
      shipper_country_code: z.string().describe('Shipper country code'),
      recipient_postal_code: z.string().describe('Recipient postal code'),
      recipient_country_code: z.string().describe('Recipient country code'),
      weight_kg: z.number().positive().describe('Package weight in kilograms'),
      package_type: z.string().optional().describe('Package type code'),
      planned_shipping_date: z.string().optional().describe('Planned shipping date (YYYY-MM-DD)'),
      endpoint_override: z
        .string()
        .optional()
        .describe('Override default endpoint (/rate/v1/rates/quotes)'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const body: Record<string, unknown> = {
        customerDetails: {
          shipperDetails: {
            postalCode: args.shipper_postal_code,
            countryCode: args.shipper_country_code,
          },
          receiverDetails: {
            postalCode: args.recipient_postal_code,
            countryCode: args.recipient_country_code,
          },
        },
        plannedShippingDateAndTime: args.planned_shipping_date,
        unitOfMeasurement: 'metric',
        isCustomsDeclarable: false,
        packages: [{ weight: args.weight_kg }],
      };
      if (args.package_type) {
        body.packages = [{ weight: args.weight_kg, typeCode: args.package_type }];
      }

      const result = await runRequest(fedex, options, {
        method: 'POST',
        path: args.endpoint_override || '/rate/v1/rates/quotes',
        body,
      });
      return wrapToolResult({ success: true, ...result }, args.max_chars);
    },
  );

  server.tool(
    'fedex_create_shipment',
    'Create a FedEx shipment. Requires --apply or STATESET_ALLOW_APPLY unless dry_run=true.',
    {
      shipment_payload: z.record(z.unknown()).describe('FedEx create shipment payload'),
      endpoint_override: z
        .string()
        .optional()
        .describe('Override default endpoint (/ship/v1/shipments)'),
      idempotency_key: z.string().optional(),
      dry_run: z.boolean().optional().default(false),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const request = {
        method: 'POST',
        path: args.endpoint_override || '/ship/v1/shipments',
        body: args.shipment_payload,
      };

      if (args.dry_run) {
        return wrapToolResult({ success: true, dry_run: true, request }, args.max_chars);
      }

      const blocked = guardWrite(options);
      if (blocked) return blocked;

      if (args.idempotency_key) {
        const existing = fedexIdempotencyStore.get(args.idempotency_key);
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

      const result = await runRequest(fedex, options, request);
      const dedupe = withFedExIdempotency(args.idempotency_key, result.status, result.data);
      return wrapToolResult({ success: true, ...result, ...dedupe }, args.max_chars);
    },
  );

  server.tool(
    'fedex_cancel_shipment',
    'Cancel a FedEx shipment. Requires --apply or STATESET_ALLOW_APPLY unless dry_run=true.',
    {
      shipment_id: z.string().describe('Shipment ID'),
      endpoint_override: z
        .string()
        .optional()
        .describe('Override default endpoint (/ship/v1/shipments/cancel)'),
      idempotency_key: z.string().optional(),
      dry_run: z.boolean().optional().default(false),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const request = {
        method: 'POST',
        path: args.endpoint_override || '/ship/v1/shipments/cancel',
        body: {
          shipmentId: args.shipment_id,
        },
      };

      if (args.dry_run) {
        return wrapToolResult({ success: true, dry_run: true, request }, args.max_chars);
      }

      const blocked = guardWrite(options);
      if (blocked) return blocked;

      if (args.idempotency_key) {
        const existing = fedexIdempotencyStore.get(args.idempotency_key);
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

      const result = await runRequest(fedex, options, request);
      const dedupe = withFedExIdempotency(args.idempotency_key, result.status, result.data);
      return wrapToolResult({ success: true, ...result, ...dedupe }, args.max_chars);
    },
  );

  server.tool(
    'fedex_schedule_pickup',
    'Schedule a FedEx pickup. Requires --apply or STATESET_ALLOW_APPLY unless dry_run=true.',
    {
      pickup_payload: z.record(z.unknown()).describe('FedEx pickup request payload'),
      endpoint_override: z
        .string()
        .optional()
        .describe('Override default endpoint (/pickup/v1/pickups)'),
      idempotency_key: z.string().optional(),
      dry_run: z.boolean().optional().default(false),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const request = {
        method: 'POST',
        path: args.endpoint_override || '/pickup/v1/pickups',
        body: args.pickup_payload,
      };
      if (args.dry_run) {
        return wrapToolResult({ success: true, dry_run: true, request }, args.max_chars);
      }
      const blocked = guardWrite(options);
      if (blocked) return blocked;

      if (args.idempotency_key) {
        const existing = fedexIdempotencyStore.get(args.idempotency_key);
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

      const result = await runRequest(fedex, options, request);
      const dedupe = withFedExIdempotency(args.idempotency_key, result.status, result.data);
      return wrapToolResult({ success: true, ...result, ...dedupe }, args.max_chars);
    },
  );

  server.tool(
    'fedex_cancel_pickup',
    'Cancel a FedEx pickup. Requires --apply or STATESET_ALLOW_APPLY unless dry_run=true.',
    {
      pickup_id: z.string().describe('Pickup ID'),
      endpoint_override: z
        .string()
        .optional()
        .describe('Override default endpoint (/pickup/v1/pickups/cancel)'),
      idempotency_key: z.string().optional(),
      dry_run: z.boolean().optional().default(false),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const request = {
        method: 'POST',
        path: args.endpoint_override || '/pickup/v1/pickups/cancel',
        body: {
          pickupId: args.pickup_id,
        },
      };
      if (args.dry_run) {
        return wrapToolResult({ success: true, dry_run: true, request }, args.max_chars);
      }
      const blocked = guardWrite(options);
      if (blocked) return blocked;

      if (args.idempotency_key) {
        const existing = fedexIdempotencyStore.get(args.idempotency_key);
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

      const result = await runRequest(fedex, options, request);
      const dedupe = withFedExIdempotency(args.idempotency_key, result.status, result.data);
      return wrapToolResult({ success: true, ...result, ...dedupe }, args.max_chars);
    },
  );

  registerRawRequestTool(
    server,
    'fedex_request',
    'Execute a raw FedEx API request.',
    runRequest,
    fedex,
    options,
  );
}
