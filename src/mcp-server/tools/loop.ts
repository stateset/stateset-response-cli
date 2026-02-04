import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { LoopConfig } from '../../integrations/config.js';
import { loopRequest } from '../../integrations/loop.js';
import { redactPii } from '../../integrations/redact.js';
import { stringifyToolResult } from './output.js';

export interface LoopToolOptions {
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

async function runLoopRequest(
  loop: LoopConfig,
  options: LoopToolOptions,
  args: {
    method: string;
    path: string;
    query?: Record<string, string | number | boolean>;
    body?: Record<string, unknown>;
  }
) {
  const response = await loopRequest({
    loop,
    method: args.method,
    path: args.path,
    query: args.query,
    body: args.body,
  });

  const data = options.redact ? redactPii(response.data) : response.data;
  return { status: response.status, data };
}

export function registerLoopTools(server: McpServer, loop: LoopConfig, options: LoopToolOptions) {
  server.tool(
    'loop_list_returns',
    'List Loop Returns return requests with filters.',
    {
      status: z.enum(['pending', 'approved', 'in_transit', 'delivered', 'inspecting', 'processed', 'rejected', 'cancelled']).optional(),
      outcome: z.enum(['refund', 'store_credit', 'exchange', 'gift_card']).optional(),
      reason: z.string().optional().describe('Return reason (damaged, wrong_item, doesnt_fit, changed_mind, defective)'),
      created_after: z.string().optional().describe('Returns created after (ISO date)'),
      created_before: z.string().optional().describe('Returns created before (ISO date)'),
      order_number: z.string().optional().describe('Filter by original order number'),
      limit: z.number().min(1).max(100).optional().describe('Maximum results'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      const query: Record<string, string | number | boolean> = {};
      if (args.status) query.status = args.status;
      if (args.outcome) query.outcome = args.outcome;
      if (args.reason) query.reason = args.reason;
      if (args.created_after) query.created_at_min = args.created_after;
      if (args.created_before) query.created_at_max = args.created_before;
      if (args.order_number) query.order_name = args.order_number;
      if (args.limit !== undefined) query.limit = args.limit;

      const result = await runLoopRequest(loop, options, {
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
    'loop_get_return',
    'Get details for a Loop return.',
    {
      return_id: z.string().describe('Loop return ID'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      const result = await runLoopRequest(loop, options, {
        method: 'GET',
        path: `/returns/${args.return_id}`,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'loop_approve_return',
    'Approve a pending return request (generates label). Requires --apply or STATESET_ALLOW_APPLY.',
    {
      return_id: z.string().describe('Loop return ID'),
      destination: z.enum(['warehouse', 'donate', 'keep']).optional().describe('Return destination'),
      internal_note: z.string().optional().describe('Internal note'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      if (!options.allowApply) return writeNotAllowed();

      const body: Record<string, unknown> = {};
      if (args.destination) body.destination = args.destination;
      if (args.internal_note) body.internal_note = args.internal_note;

      const result = await runLoopRequest(loop, options, {
        method: 'POST',
        path: `/returns/${args.return_id}/approve`,
        body: Object.keys(body).length > 0 ? body : undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'loop_reject_return',
    'Reject a return request. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      return_id: z.string().describe('Loop return ID'),
      reason: z.string().describe('Rejection reason'),
      internal_note: z.string().optional().describe('Internal note'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      if (!options.allowApply) return writeNotAllowed();

      const body: Record<string, unknown> = { reason: args.reason };
      if (args.internal_note) body.internal_note = args.internal_note;

      const result = await runLoopRequest(loop, options, {
        method: 'POST',
        path: `/returns/${args.return_id}/reject`,
        body,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'loop_process_exchange',
    'Process a return as an exchange. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      return_id: z.string().describe('Loop return ID'),
      exchange_items: z.array(z.object({
        variant_id: z.string().describe('Shopify variant ID for new item'),
        quantity: z.number().optional().default(1),
      })).describe('Items to send in exchange'),
      charge_difference: z.boolean().optional().default(true).describe('Charge customer if exchange costs more'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      if (!options.allowApply) return writeNotAllowed();

      const body = {
        exchange_items: args.exchange_items,
        charge_difference: args.charge_difference,
      };

      const result = await runLoopRequest(loop, options, {
        method: 'POST',
        path: `/returns/${args.return_id}/exchange`,
        body,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'loop_issue_refund',
    'Issue a refund for a return. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      return_id: z.string().describe('Loop return ID'),
      refund_type: z.enum(['original_payment', 'store_credit', 'gift_card']).describe('Type of refund'),
      store_credit_bonus_percent: z.number().optional().describe('Bonus percentage for store credit'),
      amount_override: z.number().optional().describe('Override refund amount'),
      internal_note: z.string().optional().describe('Internal note'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      if (!options.allowApply) return writeNotAllowed();

      const body: Record<string, unknown> = {
        refund_type: args.refund_type,
      };
      if (args.internal_note) body.internal_note = args.internal_note;
      if (args.store_credit_bonus_percent !== undefined && args.refund_type === 'store_credit') {
        body.bonus_percent = args.store_credit_bonus_percent;
      }
      if (args.amount_override !== undefined) {
        body.amount = args.amount_override;
      }

      const result = await runLoopRequest(loop, options, {
        method: 'POST',
        path: `/returns/${args.return_id}/refund`,
        body,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'loop_create_label',
    'Create a return shipping label. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      return_id: z.string().describe('Loop return ID'),
      carrier: z.string().optional().describe('Preferred carrier'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      if (!options.allowApply) return writeNotAllowed();

      const body: Record<string, unknown> = {};
      if (args.carrier) body.carrier = args.carrier;

      const result = await runLoopRequest(loop, options, {
        method: 'POST',
        path: `/returns/${args.return_id}/label`,
        body: Object.keys(body).length > 0 ? body : undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'loop_add_note',
    'Add an internal note to a return. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      return_id: z.string().describe('Loop return ID'),
      note: z.string().describe('Note content'),
      visible_to_customer: z.boolean().optional().default(false),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      if (!options.allowApply) return writeNotAllowed();

      const body = {
        note: args.note,
        visible_to_customer: args.visible_to_customer,
      };

      const result = await runLoopRequest(loop, options, {
        method: 'POST',
        path: `/returns/${args.return_id}/notes`,
        body,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'loop_batch_approve_returns',
    'Approve multiple returns at once. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      return_ids: z.array(z.string()).min(1).describe('Return IDs to approve'),
      destination: z.enum(['warehouse', 'donate', 'keep']).optional().describe('Return destination'),
      internal_note: z.string().optional().describe('Internal note'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      if (!options.allowApply) return writeNotAllowed();

      const results: Array<{ return_id: string; success: boolean }> = [];
      const errors: Array<{ return_id: string; error: string }> = [];

      for (const returnId of args.return_ids) {
        try {
          await loopRequest({
            loop,
            method: 'POST',
            path: `/returns/${returnId}/approve`,
            body: {
              destination: args.destination || 'warehouse',
              internal_note: args.internal_note,
            },
          });
          results.push({ return_id: returnId, success: true });
        } catch (error) {
          errors.push({ return_id: returnId, error: error instanceof Error ? error.message : String(error) });
        }
      }

      const payload = {
        success: errors.length === 0,
        total_requested: args.return_ids.length,
        approved: results.length,
        failed: errors.length,
        destination: args.destination || 'warehouse',
        errors: errors.length > 0 ? errors : undefined,
      };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'loop_request',
    'Execute a raw Loop Returns API request. Non-GET methods require --apply or STATESET_ALLOW_APPLY.',
    {
      method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).describe('HTTP method'),
      endpoint: z.string().describe('API endpoint path (e.g., /returns, /returns/123)'),
      query: z.record(z.union([z.string(), z.number(), z.boolean()])).optional().describe('Optional query params'),
      body: z.record(z.any()).optional().describe('Optional JSON body'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      const method = String(args.method || '').toUpperCase();
      if (method !== 'GET' && !options.allowApply) {
        return writeNotAllowed();
      }

      const result = await runLoopRequest(loop, options, {
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
