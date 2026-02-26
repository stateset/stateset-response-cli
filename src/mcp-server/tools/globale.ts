import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { GlobalEConfig } from '../../integrations/config.js';
import { globalERequest } from '../../integrations/globale.js';
import {
  type IntegrationToolOptions,
  MaxCharsSchema,
  createRequestRunner,
  guardWrite,
  registerRawRequestTool,
  wrapToolResult,
} from './helpers.js';

const globaleIdempotencyStore = new Map<string, { status: number; data: unknown }>();

function withGlobalEIdempotency(
  key: string | undefined,
  status: number,
  data: unknown,
): { deduplicated: boolean; status: number; data: unknown } {
  if (!key) return { deduplicated: false, status, data };
  const existing = globaleIdempotencyStore.get(key);
  if (existing) {
    return { deduplicated: true, status: existing.status, data: existing.data };
  }
  globaleIdempotencyStore.set(key, { status, data });
  return { deduplicated: false, status, data };
}

const runRequest = createRequestRunner<GlobalEConfig>((config, args) =>
  globalERequest({ globale: config, ...args }),
);

export function registerGlobalETools(
  server: McpServer,
  globale: GlobalEConfig,
  options: IntegrationToolOptions,
) {
  server.tool(
    'globale_track_shipment',
    'Track a Global-e shipment by tracking number.',
    {
      tracking_number: z.string().describe('Shipment tracking number'),
      endpoint_override: z
        .string()
        .optional()
        .describe('Override default endpoint (/track/shipments)'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const result = await runRequest(globale, options, {
        method: 'GET',
        path: args.endpoint_override || '/track/shipments',
        query: { trackingNumber: args.tracking_number },
      });
      return wrapToolResult({ success: true, ...result }, args.max_chars);
    },
  );

  server.tool(
    'globale_get_rates',
    'Get Global-e shipping rates/quote.',
    {
      shipper_postal_code: z.string().describe('Shipper postal code'),
      shipper_country_code: z.string().describe('Shipper country code'),
      recipient_postal_code: z.string().describe('Recipient postal code'),
      recipient_country_code: z.string().describe('Recipient country code'),
      weight_kg: z.number().positive().describe('Package weight in kilograms'),
      package_type: z.string().optional().describe('Package type code'),
      planned_shipping_date: z.string().optional().describe('Planned shipping date (YYYY-MM-DD)'),
      endpoint_override: z.string().optional().describe('Override default endpoint (/rates)'),
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

      const result = await runRequest(globale, options, {
        method: 'POST',
        path: args.endpoint_override || '/rates',
        body,
      });
      return wrapToolResult({ success: true, ...result }, args.max_chars);
    },
  );

  server.tool(
    'globale_create_shipment',
    'Create a Global-e shipment. Requires --apply or STATESET_ALLOW_APPLY unless dry_run=true.',
    {
      shipment_payload: z.record(z.unknown()).describe('Global-e create shipment payload'),
      endpoint_override: z.string().optional().describe('Override default endpoint (/shipments)'),
      idempotency_key: z.string().optional(),
      dry_run: z.boolean().optional().default(false),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const request = {
        method: 'POST',
        path: args.endpoint_override || '/shipments',
        body: args.shipment_payload,
      };

      if (args.dry_run) {
        return wrapToolResult({ success: true, dry_run: true, request }, args.max_chars);
      }

      const blocked = guardWrite(options);
      if (blocked) return blocked;

      if (args.idempotency_key) {
        const existing = globaleIdempotencyStore.get(args.idempotency_key);
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

      const result = await runRequest(globale, options, request);
      const dedupe = withGlobalEIdempotency(args.idempotency_key, result.status, result.data);
      return wrapToolResult({ success: true, ...result, ...dedupe }, args.max_chars);
    },
  );

  server.tool(
    'globale_cancel_shipment',
    'Cancel a Global-e shipment. Requires --apply or STATESET_ALLOW_APPLY unless dry_run=true.',
    {
      shipment_id: z.string().describe('Shipment ID'),
      endpoint_override: z
        .string()
        .optional()
        .describe('Override default endpoint (/shipments/{shipment_id})'),
      idempotency_key: z.string().optional(),
      dry_run: z.boolean().optional().default(false),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const request = {
        method: 'DELETE',
        path: args.endpoint_override || `/shipments/${args.shipment_id}`,
      };

      if (args.dry_run) {
        return wrapToolResult({ success: true, dry_run: true, request }, args.max_chars);
      }

      const blocked = guardWrite(options);
      if (blocked) return blocked;

      if (args.idempotency_key) {
        const existing = globaleIdempotencyStore.get(args.idempotency_key);
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

      const result = await runRequest(globale, options, request);
      const dedupe = withGlobalEIdempotency(args.idempotency_key, result.status, result.data);
      return wrapToolResult({ success: true, ...result, ...dedupe }, args.max_chars);
    },
  );

  server.tool(
    'globale_schedule_pickup',
    'Schedule a Global-e pickup. Requires --apply or STATESET_ALLOW_APPLY unless dry_run=true.',
    {
      pickup_payload: z.record(z.unknown()).describe('Global-e pickup request payload'),
      endpoint_override: z.string().optional().describe('Override default endpoint (/pickups)'),
      idempotency_key: z.string().optional(),
      dry_run: z.boolean().optional().default(false),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const request = {
        method: 'POST',
        path: args.endpoint_override || '/pickups',
        body: args.pickup_payload,
      };
      if (args.dry_run) {
        return wrapToolResult({ success: true, dry_run: true, request }, args.max_chars);
      }
      const blocked = guardWrite(options);
      if (blocked) return blocked;

      if (args.idempotency_key) {
        const existing = globaleIdempotencyStore.get(args.idempotency_key);
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

      const result = await runRequest(globale, options, request);
      const dedupe = withGlobalEIdempotency(args.idempotency_key, result.status, result.data);
      return wrapToolResult({ success: true, ...result, ...dedupe }, args.max_chars);
    },
  );

  server.tool(
    'globale_cancel_pickup',
    'Cancel a Global-e pickup. Requires --apply or STATESET_ALLOW_APPLY unless dry_run=true.',
    {
      pickup_id: z.string().describe('Pickup ID'),
      endpoint_override: z
        .string()
        .optional()
        .describe('Override default endpoint (/pickups/{pickup_id})'),
      idempotency_key: z.string().optional(),
      dry_run: z.boolean().optional().default(false),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const request = {
        method: 'DELETE',
        path: args.endpoint_override || `/pickups/${args.pickup_id}`,
      };
      if (args.dry_run) {
        return wrapToolResult({ success: true, dry_run: true, request }, args.max_chars);
      }
      const blocked = guardWrite(options);
      if (blocked) return blocked;

      if (args.idempotency_key) {
        const existing = globaleIdempotencyStore.get(args.idempotency_key);
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

      const result = await runRequest(globale, options, request);
      const dedupe = withGlobalEIdempotency(args.idempotency_key, result.status, result.data);
      return wrapToolResult({ success: true, ...result, ...dedupe }, args.max_chars);
    },
  );

  registerRawRequestTool(
    server,
    'globale_request',
    'Execute a raw Global-e API request.',
    runRequest,
    globale,
    options,
  );
}
