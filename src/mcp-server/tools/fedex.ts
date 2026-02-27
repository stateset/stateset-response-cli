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

interface FedExIdempotencyEntry {
  status: number;
  data: unknown;
}

interface FedExRatesArgs {
  shipper_postal_code: string;
  shipper_country_code: string;
  recipient_postal_code: string;
  recipient_country_code: string;
  weight_kg: number;
  package_type?: string;
  service_type?: string;
  planned_shipping_date?: string;
}

const fedexIdempotencyStore = new Map<string, FedExIdempotencyEntry>();
const FEDEX_IDEMPOTENCY_MAX_ENTRIES = 500;

function fedexScopedIdempotencyKey(operation: string, key: string): string {
  return `${operation}:${key}`;
}

function getFedExIdempotency(
  operation: string,
  key: string | undefined,
): FedExIdempotencyEntry | null {
  if (!key) return null;
  return fedexIdempotencyStore.get(fedexScopedIdempotencyKey(operation, key)) || null;
}

function withFedExIdempotency(
  operation: string,
  key: string | undefined,
  status: number,
  data: unknown,
): { deduplicated: boolean; status: number; data: unknown } {
  if (!key) return { deduplicated: false, status, data };
  const scopedKey = fedexScopedIdempotencyKey(operation, key);
  const existing = fedexIdempotencyStore.get(scopedKey);
  if (existing) {
    return { deduplicated: true, status: existing.status, data: existing.data };
  }
  if (fedexIdempotencyStore.size >= FEDEX_IDEMPOTENCY_MAX_ENTRIES) {
    const oldest = fedexIdempotencyStore.keys().next().value;
    if (oldest) {
      fedexIdempotencyStore.delete(oldest);
    }
  }
  fedexIdempotencyStore.set(scopedKey, { status, data });
  return { deduplicated: false, status, data };
}

function buildFedExRateQuoteBody(
  fedex: FedExConfig,
  args: FedExRatesArgs,
): Record<string, unknown> {
  const requestedPackageLineItem: Record<string, unknown> = {
    weight: {
      units: 'KG',
      value: args.weight_kg,
    },
  };

  const requestedShipment: Record<string, unknown> = {
    shipper: {
      address: {
        postalCode: args.shipper_postal_code,
        countryCode: args.shipper_country_code,
      },
    },
    recipient: {
      address: {
        postalCode: args.recipient_postal_code,
        countryCode: args.recipient_country_code,
      },
    },
    pickupType: 'DROPOFF_AT_FEDEX_LOCATION',
    rateRequestType: ['LIST'],
    requestedPackageLineItems: [requestedPackageLineItem],
  };

  if (args.package_type) {
    requestedShipment.packagingType = args.package_type;
  }
  if (args.service_type) {
    requestedShipment.serviceType = args.service_type;
  }
  if (args.planned_shipping_date) {
    requestedShipment.shipDateStamp = args.planned_shipping_date;
  }

  const body: Record<string, unknown> = {
    requestedShipment,
  };
  if (fedex.accountNumber) {
    body.accountNumber = { value: fedex.accountNumber };
  }
  return body;
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
      package_type: z.string().optional().describe('FedEx packaging type'),
      service_type: z.string().optional().describe('FedEx service type'),
      planned_shipping_date: z.string().optional().describe('Planned shipping date (YYYY-MM-DD)'),
      endpoint_override: z
        .string()
        .optional()
        .describe('Override default endpoint (/rate/v1/rates/quotes)'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const result = await runRequest(fedex, options, {
        method: 'POST',
        path: args.endpoint_override || '/rate/v1/rates/quotes',
        body: buildFedExRateQuoteBody(fedex, args),
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
        const existing = getFedExIdempotency('create_shipment', args.idempotency_key);
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
      const dedupe = withFedExIdempotency(
        'create_shipment',
        args.idempotency_key,
        result.status,
        result.data,
      );
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
        const existing = getFedExIdempotency('cancel_shipment', args.idempotency_key);
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
      const dedupe = withFedExIdempotency(
        'cancel_shipment',
        args.idempotency_key,
        result.status,
        result.data,
      );
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
        const existing = getFedExIdempotency('schedule_pickup', args.idempotency_key);
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
      const dedupe = withFedExIdempotency(
        'schedule_pickup',
        args.idempotency_key,
        result.status,
        result.data,
      );
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
        const existing = getFedExIdempotency('cancel_pickup', args.idempotency_key);
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
      const dedupe = withFedExIdempotency(
        'cancel_pickup',
        args.idempotency_key,
        result.status,
        result.data,
      );
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
