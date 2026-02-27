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

interface GlobalEIdempotencyEntry {
  status: number;
  data: unknown;
}

const globaleIdempotencyStore = new Map<string, GlobalEIdempotencyEntry>();
const GLOBALE_IDEMPOTENCY_MAX_ENTRIES = 500;

function globaleScopedIdempotencyKey(operation: string, key: string): string {
  return `${operation}:${key}`;
}

function getGlobalEIdempotency(
  operation: string,
  key: string | undefined,
): GlobalEIdempotencyEntry | null {
  if (!key) return null;
  return globaleIdempotencyStore.get(globaleScopedIdempotencyKey(operation, key)) || null;
}

function withGlobalEIdempotency(
  operation: string,
  key: string | undefined,
  status: number,
  data: unknown,
): { deduplicated: boolean; status: number; data: unknown } {
  if (!key) return { deduplicated: false, status, data };
  const scopedKey = globaleScopedIdempotencyKey(operation, key);
  const existing = globaleIdempotencyStore.get(scopedKey);
  if (existing) {
    return { deduplicated: true, status: existing.status, data: existing.data };
  }
  if (globaleIdempotencyStore.size >= GLOBALE_IDEMPOTENCY_MAX_ENTRIES) {
    const oldest = globaleIdempotencyStore.keys().next().value;
    if (oldest) {
      globaleIdempotencyStore.delete(oldest);
    }
  }
  globaleIdempotencyStore.set(scopedKey, { status, data });
  return { deduplicated: false, status, data };
}

const runRequest = createRequestRunner<GlobalEConfig>((config, args) =>
  globalERequest({ globale: config, ...args }),
);

function requireGlobalEEndpoint(endpoint: string | undefined, action: string): string {
  const normalized = String(endpoint || '').trim();
  if (!normalized) {
    throw new Error(`endpoint_override is required for ${action}.`);
  }
  return normalized;
}

function requireGlobalERatePayload(
  payload: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!payload || Object.keys(payload).length === 0) {
    throw new Error('rate_payload is required for globale_get_rates.');
  }
  return payload;
}

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
        .describe('Global-e tracking endpoint path (required, merchant-specific).'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const endpoint = requireGlobalEEndpoint(args.endpoint_override, 'globale_track_shipment');
      const result = await runRequest(globale, options, {
        method: 'GET',
        path: endpoint,
        query: { trackingNumber: args.tracking_number },
      });
      return wrapToolResult({ success: true, ...result }, args.max_chars);
    },
  );

  server.tool(
    'globale_get_rates',
    'Get Global-e rates using a provider-native payload and explicit endpoint.',
    {
      endpoint_override: z
        .string()
        .describe('Global-e rates endpoint path (required, merchant-specific).'),
      rate_payload: z.record(z.unknown()).describe('Global-e native rates payload'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const endpoint = requireGlobalEEndpoint(args.endpoint_override, 'globale_get_rates');
      const ratePayload = requireGlobalERatePayload(args.rate_payload);
      const result = await runRequest(globale, options, {
        method: 'POST',
        path: endpoint,
        body: ratePayload,
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
        const existing = getGlobalEIdempotency('create_shipment', args.idempotency_key);
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
      const dedupe = withGlobalEIdempotency(
        'create_shipment',
        args.idempotency_key,
        result.status,
        result.data,
      );
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
        const existing = getGlobalEIdempotency('cancel_shipment', args.idempotency_key);
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
      const dedupe = withGlobalEIdempotency(
        'cancel_shipment',
        args.idempotency_key,
        result.status,
        result.data,
      );
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
        const existing = getGlobalEIdempotency('schedule_pickup', args.idempotency_key);
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
      const dedupe = withGlobalEIdempotency(
        'schedule_pickup',
        args.idempotency_key,
        result.status,
        result.data,
      );
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
        const existing = getGlobalEIdempotency('cancel_pickup', args.idempotency_key);
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
      const dedupe = withGlobalEIdempotency(
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
    'globale_request',
    'Execute a raw Global-e API request.',
    runRequest,
    globale,
    options,
  );
}
