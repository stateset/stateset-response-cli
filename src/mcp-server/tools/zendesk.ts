import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ZendeskConfig } from '../../integrations/config.js';
import { zendeskRequest } from '../../integrations/zendesk.js';
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

export type ZendeskToolOptions = IntegrationToolOptions;

const zendeskIdempotencyStore = new Map<string, unknown>();

function withZendeskIdempotency<T>(
  key: string | undefined,
  result: T,
): { deduplicated: boolean; result: T } {
  if (!key) return { deduplicated: false, result };
  if (zendeskIdempotencyStore.has(key)) {
    return { deduplicated: true, result: zendeskIdempotencyStore.get(key) as T };
  }
  zendeskIdempotencyStore.set(key, result);
  return { deduplicated: false, result };
}

// Typed response shapes for Zendesk API responses
interface ZendeskUsersResponse {
  users?: Array<{ id: number; email?: string; name?: string }>;
}

interface ZendeskGroupsResponse {
  groups?: Array<{ id: number; name?: string }>;
}

interface ZendeskMacrosResponse {
  macros?: Array<{ id: number; title?: string }>;
}

interface ZendeskTicketResponse {
  ticket?: { tags?: string[] };
}

interface ZendeskMacroApplyResponse {
  result?: { ticket?: Record<string, unknown> };
}

const runRequest = createRequestRunner<ZendeskConfig>((config, args) =>
  zendeskRequest({ zendesk: config, ...args }),
);

async function zendeskRaw(
  zendesk: ZendeskConfig,
  args: {
    method: string;
    path: string;
    query?: Record<string, string | number | boolean>;
    body?: Record<string, unknown>;
  },
) {
  return zendeskRequest({
    zendesk,
    method: args.method,
    path: args.path,
    query: args.query,
    body: args.body,
  });
}

function mergeTags(existing: string[], add?: string[], remove?: string[]): string[] {
  let tags = existing || [];
  if (add && add.length > 0) {
    tags = [...new Set([...tags, ...add])];
  }
  if (remove && remove.length > 0) {
    tags = tags.filter((tag) => !remove.includes(tag));
  }
  return tags;
}

async function resolveAssigneeId(zendesk: ZendeskConfig, email: string): Promise<number | null> {
  const response = await zendeskRaw(zendesk, {
    method: 'GET',
    path: '/users.json',
    query: { role: 'agent' },
  });
  const users = (response.data as ZendeskUsersResponse)?.users ?? [];
  const match = users.find((u) => String(u.email || '').toLowerCase() === email.toLowerCase());
  return match?.id ?? null;
}

async function resolveGroupId(zendesk: ZendeskConfig, groupName: string): Promise<number | null> {
  const response = await zendeskRaw(zendesk, { method: 'GET', path: '/groups.json' });
  const groups = (response.data as ZendeskGroupsResponse)?.groups ?? [];
  const match = groups.find((g) => String(g.name || '').toLowerCase() === groupName.toLowerCase());
  return match?.id ?? null;
}

async function resolveMacroId(zendesk: ZendeskConfig, title: string): Promise<number | null> {
  const response = await zendeskRaw(zendesk, { method: 'GET', path: '/macros.json' });
  const macros = (response.data as ZendeskMacrosResponse)?.macros ?? [];
  const match = macros.find((m) => String(m.title || '').toLowerCase() === title.toLowerCase());
  return match?.id ?? null;
}

export function registerZendeskTools(
  server: McpServer,
  zendesk: ZendeskConfig,
  options: IntegrationToolOptions,
) {
  server.tool(
    'zendesk_search_tickets',
    'Search Zendesk tickets using query syntax.',
    {
      query: z
        .string()
        .describe('Zendesk search query (e.g., "status:open priority:urgent tags:refund")'),
      sort_by: z
        .enum(['created_at', 'updated_at', 'priority', 'status'])
        .optional()
        .default('created_at'),
      sort_order: z.enum(['asc', 'desc']).optional().default('desc'),
      limit: z.number().min(1).max(100).optional().default(50),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const query = {
        query: `type:ticket ${args.query}`,
        sort_by: args.sort_by,
        sort_order: args.sort_order,
      } as Record<string, string | number | boolean>;

      const result = await runRequest(zendesk, options, {
        method: 'GET',
        path: '/search.json',
        query,
      });

      const data = result.data as Record<string, unknown> | undefined;
      if (data && Array.isArray(data.results)) {
        data.results = data.results.slice(0, args.limit as number);
      }

      return wrapToolResult(
        { success: true, status: result.status, data },
        args.max_chars as number | undefined,
      );
    },
  );

  server.tool(
    'zendesk_list_tickets',
    'List Zendesk tickets.',
    {
      page: z.number().min(1).optional().describe('Page number (1-based)'),
      per_page: z.number().min(1).max(100).optional().describe('Results per page'),
      query: z
        .record(z.union([z.string(), z.number(), z.boolean()]))
        .optional()
        .describe('Additional query parameters'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const query = buildQuery({
        ...(args.query || {}),
        page: args.page,
        per_page: args.per_page,
      } as Record<string, string | number | boolean | undefined>);

      const result = await runRequest(zendesk, options, {
        method: 'GET',
        path: '/tickets.json',
        query,
      });

      return wrapToolResult({ success: true, ...result }, args.max_chars as number | undefined);
    },
  );

  server.tool(
    'zendesk_search_users',
    'Search Zendesk users using query syntax.',
    {
      query: z.string().describe('Zendesk search query (e.g., "role:agent email:foo@bar.com")'),
      sort_by: z
        .enum(['created_at', 'updated_at', 'name', 'email'])
        .optional()
        .default('created_at'),
      sort_order: z.enum(['asc', 'desc']).optional().default('desc'),
      limit: z.number().min(1).max(100).optional().default(50),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const query = {
        query: `type:user ${args.query}`,
        sort_by: args.sort_by,
        sort_order: args.sort_order,
      } as Record<string, string | number | boolean>;

      const result = await runRequest(zendesk, options, {
        method: 'GET',
        path: '/search.json',
        query,
      });

      const data = result.data as Record<string, unknown> | undefined;
      if (data && Array.isArray(data.results)) {
        data.results = data.results.slice(0, args.limit as number);
      }

      return wrapToolResult(
        { success: true, status: result.status, data },
        args.max_chars as number | undefined,
      );
    },
  );

  server.tool(
    'zendesk_search_organizations',
    'Search Zendesk organizations using query syntax.',
    {
      query: z.string().describe('Zendesk search query (e.g., "name:Acme")'),
      sort_by: z.enum(['created_at', 'updated_at', 'name']).optional().default('created_at'),
      sort_order: z.enum(['asc', 'desc']).optional().default('desc'),
      limit: z.number().min(1).max(100).optional().default(50),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const query = {
        query: `type:organization ${args.query}`,
        sort_by: args.sort_by,
        sort_order: args.sort_order,
      } as Record<string, string | number | boolean>;

      const result = await runRequest(zendesk, options, {
        method: 'GET',
        path: '/search.json',
        query,
      });

      const data = result.data as Record<string, unknown> | undefined;
      if (data && Array.isArray(data.results)) {
        data.results = data.results.slice(0, args.limit as number);
      }

      return wrapToolResult(
        { success: true, status: result.status, data },
        args.max_chars as number | undefined,
      );
    },
  );

  server.tool(
    'zendesk_get_ticket',
    'Get details for a Zendesk ticket, including comments.',
    {
      ticket_id: z.number().describe('Zendesk ticket ID'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const ticketResponse = await runRequest(zendesk, options, {
        method: 'GET',
        path: `/tickets/${args.ticket_id}.json`,
      });
      const commentsResponse = await runRequest(zendesk, options, {
        method: 'GET',
        path: `/tickets/${args.ticket_id}/comments.json`,
      });

      return wrapToolResult(
        { success: true, ticket: ticketResponse.data, comments: commentsResponse.data },
        args.max_chars as number | undefined,
      );
    },
  );

  server.tool(
    'zendesk_list_ticket_audits',
    'List audits for a Zendesk ticket.',
    {
      ticket_id: z.number().describe('Zendesk ticket ID'),
      page: z.number().min(1).optional().describe('Page number (1-based)'),
      per_page: z.number().min(1).max(100).optional().describe('Results per page'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const query = buildQuery({ page: args.page, per_page: args.per_page });

      const result = await runRequest(zendesk, options, {
        method: 'GET',
        path: `/tickets/${args.ticket_id}/audits.json`,
        query,
      });

      return wrapToolResult({ success: true, ...result }, args.max_chars as number | undefined);
    },
  );

  server.tool(
    'zendesk_list_suspended_tickets',
    'List suspended tickets in Zendesk.',
    {
      page: z.number().min(1).optional().describe('Page number (1-based)'),
      per_page: z.number().min(1).max(100).optional().describe('Results per page'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const query = buildQuery({ page: args.page, per_page: args.per_page });

      const result = await runRequest(zendesk, options, {
        method: 'GET',
        path: '/suspended_tickets.json',
        query,
      });

      return wrapToolResult({ success: true, ...result }, args.max_chars as number | undefined);
    },
  );

  server.tool(
    'zendesk_list_ticket_comments',
    'List comments for a Zendesk ticket.',
    {
      ticket_id: z.number().describe('Zendesk ticket ID'),
      page: z.number().min(1).optional().describe('Page number (1-based)'),
      per_page: z.number().min(1).max(100).optional().describe('Results per page'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const query = buildQuery({ page: args.page, per_page: args.per_page });

      const result = await runRequest(zendesk, options, {
        method: 'GET',
        path: `/tickets/${args.ticket_id}/comments.json`,
        query,
      });

      return wrapToolResult({ success: true, ...result }, args.max_chars as number | undefined);
    },
  );

  server.tool(
    'zendesk_create_ticket',
    'Create a Zendesk ticket. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      subject: z.string().describe('Ticket subject'),
      comment: z.string().describe('Initial comment body'),
      public: z
        .boolean()
        .optional()
        .default(true)
        .describe('Whether the initial comment is public'),
      requester_email: z.string().optional().describe('Requester email'),
      requester_name: z.string().optional().describe('Requester name'),
      priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
      status: z.enum(['new', 'open', 'pending', 'hold', 'solved']).optional(),
      tags: z.array(z.string()).optional().describe('Tags to add'),
      assignee_email: z.string().optional().describe('Agent email to assign'),
      group_name: z.string().optional().describe('Group name to assign'),
      custom_fields: z
        .array(z.object({ id: z.number(), value: z.unknown() }))
        .optional()
        .describe('Custom fields'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const blocked = guardWrite(options);
      if (blocked) return blocked;

      const ticket: Record<string, unknown> = {
        subject: args.subject,
        comment: { body: args.comment, public: args.public },
      };

      if (args.requester_email || args.requester_name) {
        ticket.requester = {
          email: args.requester_email,
          name: args.requester_name,
        };
      }
      if (args.priority) ticket.priority = args.priority;
      if (args.status) ticket.status = args.status;
      if (args.tags) ticket.tags = args.tags;
      if (args.custom_fields) ticket.custom_fields = args.custom_fields;

      if (args.assignee_email) {
        const assigneeId = await resolveAssigneeId(zendesk, args.assignee_email);
        if (!assigneeId) {
          throw new Error(`Assignee email not found: ${args.assignee_email}`);
        }
        ticket.assignee_id = assigneeId;
      }

      if (args.group_name) {
        const groupId = await resolveGroupId(zendesk, args.group_name);
        if (!groupId) {
          throw new Error(`Group not found: ${args.group_name}`);
        }
        ticket.group_id = groupId;
      }

      const result = await runRequest(zendesk, options, {
        method: 'POST',
        path: '/tickets.json',
        body: { ticket },
      });

      return wrapToolResult({ success: true, ...result }, args.max_chars as number | undefined);
    },
  );

  server.tool(
    'zendesk_update_ticket',
    'Update Zendesk ticket fields like status, priority, assignee, or tags. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      ticket_id: z.number().describe('Zendesk ticket ID'),
      status: z.enum(['new', 'open', 'pending', 'hold', 'solved', 'closed']).optional(),
      priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
      assignee_email: z.string().optional().describe('Agent email to assign'),
      group_name: z.string().optional().describe('Group name to assign'),
      tags_to_add: z.array(z.string()).optional().describe('Tags to add'),
      tags_to_remove: z.array(z.string()).optional().describe('Tags to remove'),
      internal_note: z.string().optional().describe('Internal note to add'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const blocked = guardWrite(options);
      if (blocked) return blocked;

      const update: Record<string, unknown> = {};
      if (args.status) update.status = args.status;
      if (args.priority) update.priority = args.priority;

      if (args.assignee_email) {
        const assigneeId = await resolveAssigneeId(zendesk, args.assignee_email);
        if (!assigneeId) {
          throw new Error(`Assignee email not found: ${args.assignee_email}`);
        }
        update.assignee_id = assigneeId;
      }

      if (args.group_name) {
        const groupId = await resolveGroupId(zendesk, args.group_name);
        if (!groupId) {
          throw new Error(`Group not found: ${args.group_name}`);
        }
        update.group_id = groupId;
      }

      if (args.internal_note) {
        update.comment = { body: args.internal_note, public: false };
      }

      if (args.tags_to_add || args.tags_to_remove) {
        const ticket = await zendeskRaw(zendesk, {
          method: 'GET',
          path: `/tickets/${args.ticket_id}.json`,
        });
        const existingTags = (ticket.data as ZendeskTicketResponse)?.ticket?.tags ?? [];
        update.tags = mergeTags(existingTags, args.tags_to_add, args.tags_to_remove);
      }

      const result = await runRequest(zendesk, options, {
        method: 'PUT',
        path: `/tickets/${args.ticket_id}.json`,
        body: { ticket: update },
      });

      return wrapToolResult({ success: true, ...result }, args.max_chars as number | undefined);
    },
  );

  server.tool(
    'zendesk_add_comment',
    'Add a comment to a Zendesk ticket. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      ticket_id: z.number().describe('Zendesk ticket ID'),
      comment: z.string().describe('Comment body'),
      public: z.boolean().optional().default(true).describe('Whether the comment is public'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const blocked = guardWrite(options);
      if (blocked) return blocked;

      const result = await runRequest(zendesk, options, {
        method: 'PUT',
        path: `/tickets/${args.ticket_id}.json`,
        body: { ticket: { comment: { body: args.comment, public: args.public } } },
      });

      return wrapToolResult({ success: true, ...result }, args.max_chars as number | undefined);
    },
  );

  server.tool(
    'zendesk_reply_ticket',
    'Reply to a Zendesk ticket with custom text (public or internal). Requires --apply or STATESET_ALLOW_APPLY.',
    {
      ticket_id: z.number().describe('Zendesk ticket ID'),
      body: z.string().describe('Reply body text'),
      public: z.boolean().optional().default(true).describe('Whether reply is public'),
      close_after: z.boolean().optional().describe('Mark ticket solved after replying'),
      idempotency_key: z.string().optional().describe('Optional idempotency key'),
      dry_run: z.boolean().optional().describe('Preview without applying'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      if (args.dry_run) {
        return wrapToolResult(
          {
            success: true,
            dry_run: true,
            idempotency_key: args.idempotency_key || null,
            request: {
              action: 'reply',
              ticket_id: args.ticket_id,
              body: args.body,
              public: args.public,
              close_after: args.close_after,
            },
          },
          args.max_chars as number | undefined,
        );
      }
      const blocked = guardWrite(options);
      if (blocked) return blocked;

      const ticket: Record<string, unknown> = {
        comment: { body: args.body, public: args.public },
      };
      if (args.close_after) {
        ticket.status = 'solved';
      }

      const result = await runRequest(zendesk, options, {
        method: 'PUT',
        path: `/tickets/${args.ticket_id}.json`,
        body: { ticket },
      });

      const deduped = withZendeskIdempotency(args.idempotency_key, result);
      return wrapToolResult(
        {
          success: true,
          ...deduped.result,
          deduplicated: deduped.deduplicated,
          idempotency_key: args.idempotency_key || null,
        },
        args.max_chars as number | undefined,
      );
    },
  );

  server.tool(
    'zendesk_assign_ticket',
    'Assign/reassign a Zendesk ticket to an agent or group and optionally set priority.',
    {
      ticket_id: z.number().describe('Zendesk ticket ID'),
      assignee_email: z.string().optional().describe('Agent email to assign'),
      group_name: z.string().optional().describe('Group name to assign'),
      priority: z.enum(['low', 'normal', 'high', 'urgent']).optional().describe('Ticket priority'),
      idempotency_key: z.string().optional().describe('Optional idempotency key'),
      dry_run: z.boolean().optional().describe('Preview without applying'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      if (args.dry_run) {
        return wrapToolResult(
          {
            success: true,
            dry_run: true,
            idempotency_key: args.idempotency_key || null,
            request: {
              action: 'assign',
              ticket_id: args.ticket_id,
              assignee_email: args.assignee_email,
              group_name: args.group_name,
              priority: args.priority,
            },
          },
          args.max_chars as number | undefined,
        );
      }
      const blocked = guardWrite(options);
      if (blocked) return blocked;

      const update: Record<string, unknown> = {};
      if (args.priority) update.priority = args.priority;

      if (args.assignee_email) {
        const assigneeId = await resolveAssigneeId(zendesk, args.assignee_email);
        if (!assigneeId) {
          throw new Error(`Assignee email not found: ${args.assignee_email}`);
        }
        update.assignee_id = assigneeId;
      }

      if (args.group_name) {
        const groupId = await resolveGroupId(zendesk, args.group_name);
        if (!groupId) {
          throw new Error(`Group not found: ${args.group_name}`);
        }
        update.group_id = groupId;
      }

      if (Object.keys(update).length === 0) {
        throw new Error('Provide assignee_email, group_name, or priority');
      }

      const result = await runRequest(zendesk, options, {
        method: 'PUT',
        path: `/tickets/${args.ticket_id}.json`,
        body: { ticket: update },
      });

      const deduped = withZendeskIdempotency(args.idempotency_key, result);
      return wrapToolResult(
        {
          success: true,
          ...deduped.result,
          deduplicated: deduped.deduplicated,
          idempotency_key: args.idempotency_key || null,
        },
        args.max_chars as number | undefined,
      );
    },
  );

  server.tool(
    'zendesk_set_ticket_state',
    'Set Zendesk ticket status/priority/custom fields and optional tag add/remove in one operation.',
    {
      ticket_id: z.number().describe('Zendesk ticket ID'),
      status: z.enum(['new', 'open', 'pending', 'hold', 'solved', 'closed']).optional(),
      priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
      custom_fields: z
        .array(z.object({ id: z.number(), value: z.unknown() }))
        .optional()
        .describe('Custom fields to set'),
      tags_to_add: z.array(z.string()).optional().describe('Tags to add'),
      tags_to_remove: z.array(z.string()).optional().describe('Tags to remove'),
      internal_note: z.string().optional().describe('Optional internal note'),
      idempotency_key: z.string().optional().describe('Optional idempotency key'),
      dry_run: z.boolean().optional().describe('Preview without applying'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      if (args.dry_run) {
        return wrapToolResult(
          {
            success: true,
            dry_run: true,
            idempotency_key: args.idempotency_key || null,
            request: {
              action: 'set_state',
              ticket_id: args.ticket_id,
              status: args.status,
              priority: args.priority,
              custom_fields: args.custom_fields,
              tags_to_add: args.tags_to_add,
              tags_to_remove: args.tags_to_remove,
              internal_note: args.internal_note,
            },
          },
          args.max_chars as number | undefined,
        );
      }
      const blocked = guardWrite(options);
      if (blocked) return blocked;

      const update: Record<string, unknown> = {};
      if (args.status) update.status = args.status;
      if (args.priority) update.priority = args.priority;
      if (args.custom_fields) update.custom_fields = args.custom_fields;
      if (args.internal_note) {
        update.comment = { body: args.internal_note, public: false };
      }

      if (args.tags_to_add || args.tags_to_remove) {
        const ticket = await zendeskRaw(zendesk, {
          method: 'GET',
          path: `/tickets/${args.ticket_id}.json`,
        });
        const existingTags = (ticket.data as ZendeskTicketResponse)?.ticket?.tags ?? [];
        update.tags = mergeTags(existingTags, args.tags_to_add, args.tags_to_remove);
      }

      if (Object.keys(update).length === 0) {
        throw new Error('No fields provided for state update');
      }

      const result = await runRequest(zendesk, options, {
        method: 'PUT',
        path: `/tickets/${args.ticket_id}.json`,
        body: { ticket: update },
      });

      const deduped = withZendeskIdempotency(args.idempotency_key, result);
      return wrapToolResult(
        {
          success: true,
          ...deduped.result,
          deduplicated: deduped.deduplicated,
          idempotency_key: args.idempotency_key || null,
        },
        args.max_chars as number | undefined,
      );
    },
  );

  server.tool(
    'zendesk_close_ticket',
    'Solve or close a Zendesk ticket. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      ticket_id: z.number().describe('Zendesk ticket ID'),
      status: z.enum(['solved', 'closed']).optional().default('solved'),
      public_comment: z.string().optional().describe('Public comment to customer'),
      internal_note: z.string().optional().describe('Internal note'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const blocked = guardWrite(options);
      if (blocked) return blocked;

      const update: Record<string, unknown> = { status: args.status };
      if (args.public_comment) {
        update.comment = { body: args.public_comment, public: true };
      } else if (args.internal_note) {
        update.comment = { body: args.internal_note, public: false };
      }

      const result = await runRequest(zendesk, options, {
        method: 'PUT',
        path: `/tickets/${args.ticket_id}.json`,
        body: { ticket: update },
      });

      return wrapToolResult({ success: true, ...result }, args.max_chars as number | undefined);
    },
  );

  server.tool(
    'zendesk_escalate_ticket',
    'Escalate a Zendesk ticket to a group or agent. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      ticket_id: z.number().describe('Zendesk ticket ID'),
      group_name: z.string().optional().describe('Group name to assign'),
      assignee_email: z.string().optional().describe('Agent email to assign'),
      priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
      internal_note: z.string().optional().describe('Internal note explaining escalation'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const blocked = guardWrite(options);
      if (blocked) return blocked;

      const update: Record<string, unknown> = {};
      if (args.priority) update.priority = args.priority;

      if (args.assignee_email) {
        const assigneeId = await resolveAssigneeId(zendesk, args.assignee_email);
        if (!assigneeId) {
          throw new Error(`Assignee email not found: ${args.assignee_email}`);
        }
        update.assignee_id = assigneeId;
      }

      if (args.group_name) {
        const groupId = await resolveGroupId(zendesk, args.group_name);
        if (!groupId) {
          throw new Error(`Group not found: ${args.group_name}`);
        }
        update.group_id = groupId;
      }

      if (args.internal_note) {
        update.comment = { body: args.internal_note, public: false };
      }

      const result = await runRequest(zendesk, options, {
        method: 'PUT',
        path: `/tickets/${args.ticket_id}.json`,
        body: { ticket: update },
      });

      return wrapToolResult({ success: true, ...result }, args.max_chars as number | undefined);
    },
  );

  server.tool(
    'zendesk_apply_macro',
    'Apply a Zendesk macro to a ticket. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      ticket_id: z.number().describe('Zendesk ticket ID'),
      macro_id: z.number().optional().describe('Macro ID to apply'),
      macro_title: z.string().optional().describe('Macro title (alternative to macro_id)'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const blocked = guardWrite(options);
      if (blocked) return blocked;

      let macroId = args.macro_id;
      if (!macroId && args.macro_title) {
        const resolved = await resolveMacroId(zendesk, args.macro_title);
        macroId = resolved === null ? undefined : resolved;
      }
      if (!macroId) {
        throw new Error('macro_id or macro_title is required and must resolve to a macro.');
      }

      const applyResponse = await zendeskRaw(zendesk, {
        method: 'GET',
        path: `/macros/${macroId}/apply.json`,
        query: { ticket_id: args.ticket_id },
      });

      const ticketUpdate = (applyResponse.data as ZendeskMacroApplyResponse)?.result?.ticket;
      if (ticketUpdate) {
        await zendeskRaw(zendesk, {
          method: 'PUT',
          path: `/tickets/${args.ticket_id}.json`,
          body: { ticket: ticketUpdate },
        });
      }

      return wrapToolResult(
        { success: true, applied: Boolean(ticketUpdate), macro_id: macroId },
        args.max_chars as number | undefined,
      );
    },
  );

  server.tool(
    'zendesk_add_tags',
    'Add tags to a Zendesk ticket. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      ticket_id: z.number().describe('Zendesk ticket ID'),
      tags: z.array(z.string()).min(1).describe('Tags to add'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const blocked = guardWrite(options);
      if (blocked) return blocked;

      const ticket = await zendeskRaw(zendesk, {
        method: 'GET',
        path: `/tickets/${args.ticket_id}.json`,
      });
      const existingTags = (ticket.data as ZendeskTicketResponse)?.ticket?.tags ?? [];
      const tags = mergeTags(existingTags, args.tags, undefined);

      const result = await runRequest(zendesk, options, {
        method: 'PUT',
        path: `/tickets/${args.ticket_id}.json`,
        body: { ticket: { tags } },
      });

      return wrapToolResult({ success: true, ...result }, args.max_chars as number | undefined);
    },
  );

  server.tool(
    'zendesk_merge_tickets',
    'Merge Zendesk tickets into a target ticket. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      target_ticket_id: z.number().describe('Target ticket to merge into'),
      source_ticket_ids: z.array(z.number()).min(1).describe('Tickets to merge (will be closed)'),
      target_comment: z.string().optional().describe('Comment to add to target ticket'),
      source_comment: z.string().optional().describe('Comment to add to source tickets'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const blocked = guardWrite(options);
      if (blocked) return blocked;

      const result = await runRequest(zendesk, options, {
        method: 'POST',
        path: `/tickets/${args.target_ticket_id}/merge.json`,
        body: {
          ids: args.source_ticket_ids,
          target_comment: args.target_comment,
          source_comment: args.source_comment,
        },
      });

      return wrapToolResult({ success: true, ...result }, args.max_chars as number | undefined);
    },
  );

  server.tool(
    'zendesk_list_macros',
    'List Zendesk macros.',
    {
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const result = await runRequest(zendesk, options, {
        method: 'GET',
        path: '/macros.json',
      });

      return wrapToolResult({ success: true, ...result }, args.max_chars as number | undefined);
    },
  );

  server.tool(
    'zendesk_get_macro',
    'Get a Zendesk macro by ID.',
    {
      macro_id: z.number().describe('Zendesk macro ID'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const result = await runRequest(zendesk, options, {
        method: 'GET',
        path: `/macros/${args.macro_id}.json`,
      });

      return wrapToolResult({ success: true, ...result }, args.max_chars as number | undefined);
    },
  );

  server.tool(
    'zendesk_list_groups',
    'List Zendesk groups.',
    {
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const result = await runRequest(zendesk, options, {
        method: 'GET',
        path: '/groups.json',
      });

      return wrapToolResult({ success: true, ...result }, args.max_chars as number | undefined);
    },
  );

  server.tool(
    'zendesk_get_group',
    'Get a Zendesk group by ID.',
    {
      group_id: z.number().describe('Zendesk group ID'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const result = await runRequest(zendesk, options, {
        method: 'GET',
        path: `/groups/${args.group_id}.json`,
      });

      return wrapToolResult({ success: true, ...result }, args.max_chars as number | undefined);
    },
  );

  server.tool(
    'zendesk_list_users',
    'List Zendesk users (defaults to agents).',
    {
      role: z.string().optional().describe('Zendesk role filter (agent, admin, end-user)'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const result = await runRequest(zendesk, options, {
        method: 'GET',
        path: '/users.json',
        query: args.role ? { role: args.role } : undefined,
      });

      return wrapToolResult({ success: true, ...result }, args.max_chars as number | undefined);
    },
  );

  server.tool(
    'zendesk_create_user',
    'Create a Zendesk user. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      user: z.record(z.unknown()).describe('User payload'),
      skip_verify_email: z.boolean().optional().describe('Skip verification email'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const blocked = guardWrite(options);
      if (blocked) return blocked;

      const body: Record<string, unknown> = { user: args.user };
      if (args.skip_verify_email !== undefined) body.skip_verify_email = args.skip_verify_email;

      const result = await runRequest(zendesk, options, {
        method: 'POST',
        path: '/users.json',
        body,
      });

      return wrapToolResult({ success: true, ...result }, args.max_chars as number | undefined);
    },
  );

  server.tool(
    'zendesk_update_user',
    'Update a Zendesk user. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      user_id: z.number().describe('Zendesk user ID'),
      user: z.record(z.unknown()).describe('User fields to update'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const blocked = guardWrite(options);
      if (blocked) return blocked;

      const result = await runRequest(zendesk, options, {
        method: 'PUT',
        path: `/users/${args.user_id}.json`,
        body: { user: args.user },
      });

      return wrapToolResult({ success: true, ...result }, args.max_chars as number | undefined);
    },
  );

  server.tool(
    'zendesk_list_organizations',
    'List Zendesk organizations.',
    {
      page: z.number().min(1).optional().describe('Page number (1-based)'),
      per_page: z.number().min(1).max(100).optional().describe('Results per page'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const query = buildQuery({ page: args.page, per_page: args.per_page });

      const result = await runRequest(zendesk, options, {
        method: 'GET',
        path: '/organizations.json',
        query,
      });

      return wrapToolResult({ success: true, ...result }, args.max_chars as number | undefined);
    },
  );

  server.tool(
    'zendesk_create_organization',
    'Create a Zendesk organization. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      organization: z.record(z.unknown()).describe('Organization payload'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const blocked = guardWrite(options);
      if (blocked) return blocked;

      const result = await runRequest(zendesk, options, {
        method: 'POST',
        path: '/organizations.json',
        body: { organization: args.organization },
      });

      return wrapToolResult({ success: true, ...result }, args.max_chars as number | undefined);
    },
  );

  server.tool(
    'zendesk_update_organization',
    'Update a Zendesk organization. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      organization_id: z.number().describe('Zendesk organization ID'),
      organization: z.record(z.unknown()).describe('Organization fields to update'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const blocked = guardWrite(options);
      if (blocked) return blocked;

      const result = await runRequest(zendesk, options, {
        method: 'PUT',
        path: `/organizations/${args.organization_id}.json`,
        body: { organization: args.organization },
      });

      return wrapToolResult({ success: true, ...result }, args.max_chars as number | undefined);
    },
  );

  server.tool(
    'zendesk_get_organization',
    'Get a Zendesk organization by ID.',
    {
      organization_id: z.number().describe('Zendesk organization ID'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const result = await runRequest(zendesk, options, {
        method: 'GET',
        path: `/organizations/${args.organization_id}.json`,
      });

      return wrapToolResult({ success: true, ...result }, args.max_chars as number | undefined);
    },
  );

  server.tool(
    'zendesk_list_ticket_fields',
    'List Zendesk ticket fields.',
    {
      page: z.number().min(1).optional().describe('Page number (1-based)'),
      per_page: z.number().min(1).max(100).optional().describe('Results per page'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const query = buildQuery({ page: args.page, per_page: args.per_page });

      const result = await runRequest(zendesk, options, {
        method: 'GET',
        path: '/ticket_fields.json',
        query,
      });

      return wrapToolResult({ success: true, ...result }, args.max_chars as number | undefined);
    },
  );

  server.tool(
    'zendesk_create_ticket_field',
    'Create a Zendesk ticket field. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      ticket_field: z.record(z.unknown()).describe('Ticket field payload'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const blocked = guardWrite(options);
      if (blocked) return blocked;

      const result = await runRequest(zendesk, options, {
        method: 'POST',
        path: '/ticket_fields.json',
        body: { ticket_field: args.ticket_field },
      });

      return wrapToolResult({ success: true, ...result }, args.max_chars as number | undefined);
    },
  );

  server.tool(
    'zendesk_update_ticket_field',
    'Update a Zendesk ticket field. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      ticket_field_id: z.number().describe('Zendesk ticket field ID'),
      ticket_field: z.record(z.unknown()).describe('Ticket field fields to update'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const blocked = guardWrite(options);
      if (blocked) return blocked;

      const result = await runRequest(zendesk, options, {
        method: 'PUT',
        path: `/ticket_fields/${args.ticket_field_id}.json`,
        body: { ticket_field: args.ticket_field },
      });

      return wrapToolResult({ success: true, ...result }, args.max_chars as number | undefined);
    },
  );

  server.tool(
    'zendesk_delete_ticket_field',
    'Delete a Zendesk ticket field. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      ticket_field_id: z.number().describe('Zendesk ticket field ID'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const blocked = guardWrite(options);
      if (blocked) return blocked;

      const result = await runRequest(zendesk, options, {
        method: 'DELETE',
        path: `/ticket_fields/${args.ticket_field_id}.json`,
      });

      return wrapToolResult({ success: true, ...result }, args.max_chars as number | undefined);
    },
  );

  server.tool(
    'zendesk_get_ticket_field',
    'Get a Zendesk ticket field by ID.',
    {
      ticket_field_id: z.number().describe('Zendesk ticket field ID'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const result = await runRequest(zendesk, options, {
        method: 'GET',
        path: `/ticket_fields/${args.ticket_field_id}.json`,
      });

      return wrapToolResult({ success: true, ...result }, args.max_chars as number | undefined);
    },
  );

  server.tool(
    'zendesk_list_ticket_forms',
    'List Zendesk ticket forms.',
    {
      page: z.number().min(1).optional().describe('Page number (1-based)'),
      per_page: z.number().min(1).max(100).optional().describe('Results per page'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const query = buildQuery({ page: args.page, per_page: args.per_page });

      const result = await runRequest(zendesk, options, {
        method: 'GET',
        path: '/ticket_forms.json',
        query,
      });

      return wrapToolResult({ success: true, ...result }, args.max_chars as number | undefined);
    },
  );

  server.tool(
    'zendesk_create_ticket_form',
    'Create a Zendesk ticket form. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      ticket_form: z.record(z.unknown()).describe('Ticket form payload'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const blocked = guardWrite(options);
      if (blocked) return blocked;

      const result = await runRequest(zendesk, options, {
        method: 'POST',
        path: '/ticket_forms.json',
        body: { ticket_form: args.ticket_form },
      });

      return wrapToolResult({ success: true, ...result }, args.max_chars as number | undefined);
    },
  );

  server.tool(
    'zendesk_update_ticket_form',
    'Update a Zendesk ticket form. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      ticket_form_id: z.number().describe('Zendesk ticket form ID'),
      ticket_form: z.record(z.unknown()).describe('Ticket form fields to update'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const blocked = guardWrite(options);
      if (blocked) return blocked;

      const result = await runRequest(zendesk, options, {
        method: 'PUT',
        path: `/ticket_forms/${args.ticket_form_id}.json`,
        body: { ticket_form: args.ticket_form },
      });

      return wrapToolResult({ success: true, ...result }, args.max_chars as number | undefined);
    },
  );

  server.tool(
    'zendesk_delete_ticket_form',
    'Delete a Zendesk ticket form. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      ticket_form_id: z.number().describe('Zendesk ticket form ID'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const blocked = guardWrite(options);
      if (blocked) return blocked;

      const result = await runRequest(zendesk, options, {
        method: 'DELETE',
        path: `/ticket_forms/${args.ticket_form_id}.json`,
      });

      return wrapToolResult({ success: true, ...result }, args.max_chars as number | undefined);
    },
  );

  server.tool(
    'zendesk_get_ticket_form',
    'Get a Zendesk ticket form by ID.',
    {
      ticket_form_id: z.number().describe('Zendesk ticket form ID'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const result = await runRequest(zendesk, options, {
        method: 'GET',
        path: `/ticket_forms/${args.ticket_form_id}.json`,
      });

      return wrapToolResult({ success: true, ...result }, args.max_chars as number | undefined);
    },
  );

  server.tool(
    'zendesk_list_views',
    'List Zendesk views.',
    {
      page: z.number().min(1).optional().describe('Page number (1-based)'),
      per_page: z.number().min(1).max(100).optional().describe('Results per page'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const query = buildQuery({ page: args.page, per_page: args.per_page });

      const result = await runRequest(zendesk, options, {
        method: 'GET',
        path: '/views.json',
        query,
      });

      return wrapToolResult({ success: true, ...result }, args.max_chars as number | undefined);
    },
  );

  server.tool(
    'zendesk_get_view',
    'Get a Zendesk view by ID.',
    {
      view_id: z.number().describe('Zendesk view ID'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const result = await runRequest(zendesk, options, {
        method: 'GET',
        path: `/views/${args.view_id}.json`,
      });

      return wrapToolResult({ success: true, ...result }, args.max_chars as number | undefined);
    },
  );

  server.tool(
    'zendesk_list_triggers',
    'List Zendesk triggers.',
    {
      page: z.number().min(1).optional().describe('Page number (1-based)'),
      per_page: z.number().min(1).max(100).optional().describe('Results per page'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const query = buildQuery({ page: args.page, per_page: args.per_page });

      const result = await runRequest(zendesk, options, {
        method: 'GET',
        path: '/triggers.json',
        query,
      });

      return wrapToolResult({ success: true, ...result }, args.max_chars as number | undefined);
    },
  );

  server.tool(
    'zendesk_get_trigger',
    'Get a Zendesk trigger by ID.',
    {
      trigger_id: z.number().describe('Zendesk trigger ID'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const result = await runRequest(zendesk, options, {
        method: 'GET',
        path: `/triggers/${args.trigger_id}.json`,
      });

      return wrapToolResult({ success: true, ...result }, args.max_chars as number | undefined);
    },
  );

  server.tool(
    'zendesk_list_automations',
    'List Zendesk automations.',
    {
      page: z.number().min(1).optional().describe('Page number (1-based)'),
      per_page: z.number().min(1).max(100).optional().describe('Results per page'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const query = buildQuery({ page: args.page, per_page: args.per_page });

      const result = await runRequest(zendesk, options, {
        method: 'GET',
        path: '/automations.json',
        query,
      });

      return wrapToolResult({ success: true, ...result }, args.max_chars as number | undefined);
    },
  );

  server.tool(
    'zendesk_get_automation',
    'Get a Zendesk automation by ID.',
    {
      automation_id: z.number().describe('Zendesk automation ID'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const result = await runRequest(zendesk, options, {
        method: 'GET',
        path: `/automations/${args.automation_id}.json`,
      });

      return wrapToolResult({ success: true, ...result }, args.max_chars as number | undefined);
    },
  );

  server.tool(
    'zendesk_list_sla_policies',
    'List Zendesk SLA policies.',
    {
      page: z.number().min(1).optional().describe('Page number (1-based)'),
      per_page: z.number().min(1).max(100).optional().describe('Results per page'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const query = buildQuery({ page: args.page, per_page: args.per_page });

      const result = await runRequest(zendesk, options, {
        method: 'GET',
        path: '/slas/policies.json',
        query,
      });

      return wrapToolResult({ success: true, ...result }, args.max_chars as number | undefined);
    },
  );

  server.tool(
    'zendesk_get_sla_policy',
    'Get a Zendesk SLA policy by ID.',
    {
      sla_policy_id: z.number().describe('Zendesk SLA policy ID'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const result = await runRequest(zendesk, options, {
        method: 'GET',
        path: `/slas/policies/${args.sla_policy_id}.json`,
      });

      return wrapToolResult({ success: true, ...result }, args.max_chars as number | undefined);
    },
  );

  server.tool(
    'zendesk_get_user',
    'Get a Zendesk user by ID.',
    {
      user_id: z.number().describe('Zendesk user ID'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const result = await runRequest(zendesk, options, {
        method: 'GET',
        path: `/users/${args.user_id}.json`,
      });

      return wrapToolResult({ success: true, ...result }, args.max_chars as number | undefined);
    },
  );

  server.tool(
    'zendesk_batch_update_tickets',
    'Batch update Zendesk tickets. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      ticket_ids: z.array(z.number()).min(1).describe('Ticket IDs'),
      status: z.enum(['new', 'open', 'pending', 'hold', 'solved']).optional(),
      priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
      tags_to_add: z.array(z.string()).optional(),
      tags_to_remove: z.array(z.string()).optional(),
      internal_note: z.string().optional(),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const blocked = guardWrite(options);
      if (blocked) return blocked;

      const update: Record<string, unknown> = {};
      if (args.status) update.status = args.status;
      if (args.priority) update.priority = args.priority;
      if (args.internal_note) update.comment = { body: args.internal_note, public: false };

      if (args.tags_to_add || args.tags_to_remove) {
        const results: Array<{ ticket_id: number; success: boolean }> = [];
        const errors: Array<{ ticket_id: number; error: string }> = [];

        for (const ticketId of args.ticket_ids) {
          try {
            const ticket = await zendeskRaw(zendesk, {
              method: 'GET',
              path: `/tickets/${ticketId}.json`,
            });
            const existingTags = (ticket.data as ZendeskTicketResponse)?.ticket?.tags ?? [];
            const tags = mergeTags(existingTags, args.tags_to_add, args.tags_to_remove);
            await zendeskRaw(zendesk, {
              method: 'PUT',
              path: `/tickets/${ticketId}.json`,
              body: { ticket: { ...update, tags } },
            });
            results.push({ ticket_id: ticketId, success: true });
          } catch (error) {
            errors.push({
              ticket_id: ticketId,
              error: getErrorMessage(error),
            });
          }
        }

        return wrapToolResult(
          {
            success: errors.length === 0,
            total_requested: args.ticket_ids.length,
            updated: results.length,
            failed: errors.length,
            errors: errors.length > 0 ? errors : undefined,
          },
          args.max_chars as number | undefined,
        );
      }

      const result = await runRequest(zendesk, options, {
        method: 'PUT',
        path: `/tickets/update_many.json`,
        query: { ids: args.ticket_ids.join(',') },
        body: { ticket: update },
      });

      return wrapToolResult({ success: true, ...result }, args.max_chars as number | undefined);
    },
  );

  registerRawRequestTool(
    server,
    'zendesk_request',
    'Execute a raw Zendesk API request.',
    runRequest,
    zendesk,
    options,
  );
}
