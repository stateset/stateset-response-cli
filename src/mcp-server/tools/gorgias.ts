import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { GorgiasConfig } from '../../integrations/config.js';
import { createGorgiasApi } from '../../integrations/gorgias.js';
import { redactPii } from '../../integrations/redact.js';
import {
  type IntegrationToolOptions,
  guardWrite,
  wrapToolResult,
  MaxCharsSchema,
  RawRequestSchema,
} from './helpers.js';

export type GorgiasToolOptions = IntegrationToolOptions;

interface GorgiasTicket {
  id?: number;
  subject?: string;
  status?: string;
  channel?: string;
  priority?: number;
  created_datetime?: string;
  updated_datetime?: string;
  tags?: Array<{ name?: string }>;
  messages_count?: number;
  assignee_user?: { email?: string };
  customer?: { email?: string; name?: string };
}

interface GorgiasMessage {
  id?: number;
  sender?: { email?: string };
  channel?: string;
  body_text?: string;
  created_datetime?: string;
  internal?: boolean;
}

function formatTicketSummary(ticket: GorgiasTicket, { redact = false }: { redact?: boolean } = {}) {
  const summary: Record<string, unknown> = {
    id: ticket.id,
    subject: ticket.subject,
    status: ticket.status,
    channel: ticket.channel,
    priority: ticket.priority,
    created_at: ticket.created_datetime,
    updated_at: ticket.updated_datetime,
    tags: ticket.tags?.map((t: { name?: string }) => t.name) || [],
    messages_count: ticket.messages_count,
    assignee: ticket.assignee_user?.email || 'unassigned',
  };

  if (!redact) {
    summary.customer_email = ticket.customer?.email;
    summary.customer_name = ticket.customer?.name;
  }

  return summary;
}

function resolveTeam(
  teams: Array<{ id?: number; name?: string }>,
  input: string,
): { team: { id: number; name: string } | null; error?: string } {
  const raw = String(input).trim();
  if (!raw) return { team: null, error: 'Team value is empty' };

  const byId = raw.match(/^\d+$/) ? teams.find((t) => String(t.id) === raw) : undefined;
  if (byId && byId.id !== undefined && byId.name) {
    return { team: { id: byId.id, name: byId.name } };
  }

  const matches = teams.filter((t) => t.name && String(t.name).toLowerCase() === raw.toLowerCase());

  if (matches.length === 0) {
    return { team: null, error: `Team "${raw}" not found` };
  }
  if (matches.length > 1) {
    return { team: null, error: `Multiple teams match "${raw}". Use the team ID instead.` };
  }

  const team = matches[0];
  if (team.id === undefined || !team.name) {
    return { team: null, error: `Team "${raw}" is missing required fields` };
  }

  return { team: { id: team.id, name: team.name } };
}

async function executeListTickets(
  api: ReturnType<typeof createGorgiasApi>,
  input: {
    status?: string;
    channel?: string;
    limit?: number;
    created_after?: string;
    created_before?: string;
    assignee_email?: string;
    tags?: string[];
    exclude_tags?: string[];
  },
  { redact = false }: { redact?: boolean } = {},
) {
  const response = await api.listTickets({
    status: input.status,
    channel: input.channel,
    limit: input.limit || 50,
    created_after: input.created_after,
    created_before: input.created_before,
    assignee_email: input.assignee_email,
  });

  let tickets = (response.data as GorgiasTicket[] | undefined) || [];

  if (input.tags && input.tags.length > 0) {
    tickets = tickets.filter((t) => {
      const ticketTags = t.tags?.map((tag) => String(tag.name).toLowerCase()) || [];
      return input.tags!.every((tag) => ticketTags.includes(tag.toLowerCase()));
    });
  }

  if (input.exclude_tags && input.exclude_tags.length > 0) {
    tickets = tickets.filter((t) => {
      const ticketTags = t.tags?.map((tag) => String(tag.name).toLowerCase()) || [];
      return !input.exclude_tags!.some((tag) => ticketTags.includes(tag.toLowerCase()));
    });
  }

  const byStatus: Record<string, number> = {};
  const byChannel: Record<string, number> = {};
  for (const t of tickets) {
    const statusKey = String(t.status || '');
    const channelKey = String(t.channel || '');
    byStatus[statusKey] = (byStatus[statusKey] || 0) + 1;
    byChannel[channelKey] = (byChannel[channelKey] || 0) + 1;
  }

  return {
    success: true,
    total_tickets: tickets.length,
    by_status: byStatus,
    by_channel: byChannel,
    tickets: tickets.slice(0, 25).map((t: GorgiasTicket) => formatTicketSummary(t, { redact })),
    has_more: tickets.length > 25,
  };
}

async function executeGetTicket(
  api: ReturnType<typeof createGorgiasApi>,
  input: { ticket_id: number },
  { redact = false }: { redact?: boolean } = {},
) {
  const ticket = (await api.getTicket(input.ticket_id)) as GorgiasTicket;
  const messages = await api.getTicketMessages(input.ticket_id);

  return {
    success: true,
    ticket: formatTicketSummary(ticket, { redact }),
    messages: ((messages.data as GorgiasMessage[] | undefined) || [])
      .slice(0, 20)
      .map((m: GorgiasMessage) => ({
        id: m.id,
        sender: redact ? '[redacted]' : m.sender?.email,
        channel: m.channel,
        body_text: m.body_text?.substring(0, 500),
        created_at: m.created_datetime,
        is_internal: m.internal,
      })),
    has_more_messages: ((messages.data as GorgiasMessage[] | undefined) || []).length > 20,
  };
}

async function executeCloseTicket(
  api: ReturnType<typeof createGorgiasApi>,
  input: { ticket_id: number; internal_note?: string },
  { allowApply = false }: { allowApply?: boolean } = {},
) {
  if (!allowApply) {
    return {
      error: 'Close operation not allowed. The --apply flag or STATESET_ALLOW_APPLY must be set.',
      hint: 'Use list_tickets first to preview tickets.',
    };
  }

  if (input.internal_note) {
    await api.addMessage(input.ticket_id, {
      body_text: input.internal_note,
      internal: true,
      channel: 'internal-note',
    });
  }

  await api.updateTicket(input.ticket_id, { status: 'closed' });

  return {
    success: true,
    ticket_id: input.ticket_id,
    action: 'closed',
    internal_note_added: Boolean(input.internal_note),
  };
}

async function executeEscalateTicket(
  api: ReturnType<typeof createGorgiasApi>,
  input: {
    ticket_id: number;
    assignee_email?: string;
    team?: string;
    priority?: string;
    internal_note?: string;
  },
  { allowApply = false }: { allowApply?: boolean } = {},
) {
  if (!allowApply) {
    return {
      error:
        'Escalate operation not allowed. The --apply flag or STATESET_ALLOW_APPLY must be set.',
      hint: 'Use get_ticket first to review the ticket.',
    };
  }

  const updateData: Record<string, unknown> = {};
  let resolvedTeam: { id: number; name: string } | null = null;

  if (input.assignee_email) {
    const users = await api.listUsers();
    const user = ((users.data as Array<{ id?: number; email?: string }> | undefined) || []).find(
      (u: { id?: number; email?: string }) => u.email === input.assignee_email,
    );
    if (!user) {
      return { success: false, error: `Assignee "${input.assignee_email}" not found` };
    }
    updateData.assignee_user = { id: user.id };
  }

  if (input.team) {
    const teams = await api.listTeams();
    const resolved = resolveTeam(
      (teams.data as Array<{ id?: number; name?: string }> | undefined) || [],
      input.team,
    );
    if (resolved.error) {
      return { success: false, error: resolved.error };
    }
    if (resolved.team) {
      resolvedTeam = resolved.team;
      updateData.assignee_team = { id: resolved.team.id };
    }
  }

  if (input.priority) {
    const priorityMap: Record<string, number> = { low: 0, normal: 1, high: 2, urgent: 3 };
    updateData.priority = priorityMap[input.priority] ?? 1;
  }

  if (input.internal_note) {
    await api.addMessage(input.ticket_id, {
      body_text: `[Escalated${input.team ? ` to ${input.team}` : ''}] ${input.internal_note}`,
      internal: true,
      channel: 'internal-note',
    });
  }

  if (Object.keys(updateData).length > 0) {
    await api.updateTicket(input.ticket_id, updateData);
  }

  return {
    success: true,
    ticket_id: input.ticket_id,
    action: 'escalated',
    team: resolvedTeam?.name || input.team || null,
    team_id: resolvedTeam?.id || null,
    assignee: input.assignee_email || null,
    priority: input.priority || null,
  };
}

async function executeRespondWithMacro(
  api: ReturnType<typeof createGorgiasApi>,
  input: { ticket_id: number; macro_id?: number; macro_name?: string; close_after?: boolean },
  { allowApply = false }: { allowApply?: boolean } = {},
) {
  if (!allowApply) {
    return {
      error: 'Respond operation not allowed. The --apply flag or STATESET_ALLOW_APPLY must be set.',
      hint: 'Use get_ticket to review the ticket first.',
    };
  }

  let macroId = input.macro_id;

  if (!macroId && input.macro_name) {
    const macros = await api.listMacros();
    const macro = ((macros.data as Array<{ id?: number; name?: string }> | undefined) || []).find(
      (m: { id?: number; name?: string }) =>
        String(m.name).toLowerCase() === String(input.macro_name).toLowerCase(),
    );
    if (!macro) {
      return {
        success: false,
        error: `Macro "${input.macro_name}" not found`,
      };
    }
    macroId = macro.id;
  }

  if (!macroId) {
    return {
      success: false,
      error: 'Must provide either macro_id or macro_name',
    };
  }

  await api.applyMacro(input.ticket_id, macroId);

  if (input.close_after) {
    await api.updateTicket(input.ticket_id, { status: 'closed' });
  }

  return {
    success: true,
    ticket_id: input.ticket_id,
    macro_applied: macroId,
    closed_after: input.close_after,
  };
}

async function executeAddTags(
  api: ReturnType<typeof createGorgiasApi>,
  input: { ticket_id: number; tags: string[] },
  { allowApply = false }: { allowApply?: boolean } = {},
) {
  if (!allowApply) {
    return {
      error: 'Tag operation not allowed. The --apply flag or STATESET_ALLOW_APPLY must be set.',
    };
  }

  const ticket = (await api.getTicket(input.ticket_id)) as GorgiasTicket;
  const existingTags = ticket.tags?.map((t: { name?: string }) => t.name) || [];
  const newTags = [...new Set([...existingTags, ...input.tags])];

  await api.updateTicket(input.ticket_id, {
    tags: newTags.map((name) => ({ name })),
  });

  return {
    success: true,
    ticket_id: input.ticket_id,
    tags_added: input.tags,
    all_tags: newTags,
  };
}

async function executeMergeTickets(
  api: ReturnType<typeof createGorgiasApi>,
  input: { primary_ticket_id: number; secondary_ticket_ids: number[] },
  { allowApply = false }: { allowApply?: boolean } = {},
) {
  if (!allowApply) {
    return {
      error: 'Merge operation not allowed. The --apply flag or STATESET_ALLOW_APPLY must be set.',
      hint: 'Review both tickets with get_ticket before merging.',
    };
  }

  await api.mergeTickets(input.primary_ticket_id, input.secondary_ticket_ids);

  return {
    success: true,
    primary_ticket_id: input.primary_ticket_id,
    merged_ticket_ids: input.secondary_ticket_ids,
    total_merged: input.secondary_ticket_ids.length,
  };
}

async function executeBatchCloseTickets(
  api: ReturnType<typeof createGorgiasApi>,
  input: { ticket_ids: number[]; internal_note?: string; add_tag?: string },
  { allowApply = false }: { allowApply?: boolean } = {},
) {
  if (!allowApply) {
    return {
      error:
        'Batch close operation not allowed. The --apply flag or STATESET_ALLOW_APPLY must be set.',
      hint: 'Use list_tickets first to preview which tickets will be closed.',
    };
  }

  const results: Array<{ ticket_id: number; success: true }> = [];
  const errors: Array<{ ticket_id: number; error: string }> = [];

  for (const ticketId of input.ticket_ids) {
    try {
      if (input.add_tag) {
        const ticket = (await api.getTicket(ticketId)) as GorgiasTicket;
        const existingTags = ticket.tags?.map((t: { name?: string }) => t.name) || [];
        if (!existingTags.includes(input.add_tag)) {
          await api.updateTicket(ticketId, {
            tags: [...existingTags, input.add_tag].map((name) => ({ name })),
          });
        }
      }

      if (input.internal_note) {
        await api.addMessage(ticketId, {
          body_text: input.internal_note,
          internal: true,
          channel: 'internal-note',
        });
      }

      await api.updateTicket(ticketId, { status: 'closed' });
      results.push({ ticket_id: ticketId, success: true });
    } catch (error) {
      errors.push({
        ticket_id: ticketId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    success: errors.length === 0,
    total_requested: input.ticket_ids.length,
    closed: results.length,
    failed: errors.length,
    tag_added: input.add_tag || null,
    errors: errors.length > 0 ? errors : undefined,
  };
}

async function executeBatchTagTickets(
  api: ReturnType<typeof createGorgiasApi>,
  input: { ticket_ids: number[]; tags: string[] },
  { allowApply = false }: { allowApply?: boolean } = {},
) {
  if (!allowApply) {
    return {
      error:
        'Batch tag operation not allowed. The --apply flag or STATESET_ALLOW_APPLY must be set.',
    };
  }

  const results: Array<{ ticket_id: number; success: true }> = [];
  const errors: Array<{ ticket_id: number; error: string }> = [];

  for (const ticketId of input.ticket_ids) {
    try {
      const ticket = (await api.getTicket(ticketId)) as GorgiasTicket;
      const existingTags = ticket.tags?.map((t: { name?: string }) => t.name) || [];
      const newTags = [...new Set([...existingTags, ...input.tags])];

      await api.updateTicket(ticketId, {
        tags: newTags.map((name) => ({ name })),
      });

      results.push({ ticket_id: ticketId, success: true });
    } catch (error) {
      errors.push({
        ticket_id: ticketId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    success: errors.length === 0,
    total_requested: input.ticket_ids.length,
    tagged: results.length,
    failed: errors.length,
    tags_added: input.tags,
    errors: errors.length > 0 ? errors : undefined,
  };
}

export function registerGorgiasTools(
  server: McpServer,
  gorgias: GorgiasConfig,
  options: GorgiasToolOptions,
) {
  const api = createGorgiasApi(gorgias);

  server.tool(
    'gorgias_list_tickets',
    'Search and list Gorgias tickets with filters. Use this to find tickets by status, channel, tags, or date.',
    {
      status: z.enum(['open', 'closed', 'snoozed']).optional().describe('Filter by ticket status'),
      channel: z
        .string()
        .optional()
        .describe('Filter by channel (email, chat, facebook, instagram, twitter, phone)'),
      tags: z
        .array(z.string())
        .optional()
        .describe('Filter by tags (tickets must have all specified tags)'),
      exclude_tags: z.array(z.string()).optional().describe('Exclude tickets with these tags'),
      assignee_email: z.string().optional().describe('Filter by assignee email'),
      created_after: z
        .string()
        .optional()
        .describe('Filter tickets created after this date (ISO format)'),
      created_before: z
        .string()
        .optional()
        .describe('Filter tickets created before this date (ISO format)'),
      limit: z.number().min(1).max(100).optional().describe('Maximum number of tickets to return'),
    },
    async (args) => {
      const result = await executeListTickets(api, args, { redact: options.redact });
      return wrapToolResult(result);
    },
  );

  server.tool(
    'gorgias_get_ticket',
    'Get detailed information about a specific Gorgias ticket including messages and customer data.',
    {
      ticket_id: z.number().describe('The Gorgias ticket ID'),
    },
    async (args) => {
      const result = await executeGetTicket(api, args, { redact: options.redact });
      return wrapToolResult(result);
    },
  );

  server.tool(
    'gorgias_close_ticket',
    'Close a Gorgias ticket with an optional internal note.',
    {
      ticket_id: z.number().describe('The Gorgias ticket ID'),
      internal_note: z.string().optional().describe('Internal note to add when closing'),
    },
    async (args) => {
      const result = await executeCloseTicket(api, args, { allowApply: options.allowApply });
      return wrapToolResult(result);
    },
  );

  server.tool(
    'gorgias_escalate_ticket',
    'Escalate a ticket to a team or specific agent with priority.',
    {
      ticket_id: z.number().describe('The Gorgias ticket ID'),
      team: z.string().optional().describe('Team name or ID to escalate to'),
      assignee_email: z.string().optional().describe('Agent email to assign to'),
      priority: z.enum(['low', 'normal', 'high', 'urgent']).optional().describe('Priority level'),
      internal_note: z.string().optional().describe('Internal note explaining escalation'),
    },
    async (args) => {
      const result = await executeEscalateTicket(api, args, { allowApply: options.allowApply });
      return wrapToolResult(result);
    },
  );

  server.tool(
    'gorgias_respond_with_macro',
    'Send a macro response to a ticket. Macros are predefined response templates.',
    {
      ticket_id: z.number().describe('The Gorgias ticket ID'),
      macro_id: z.number().optional().describe('The macro ID to apply'),
      macro_name: z
        .string()
        .optional()
        .describe('The macro name to apply (alternative to macro_id)'),
      close_after: z.boolean().optional().describe('Close the ticket after sending'),
    },
    async (args) => {
      const result = await executeRespondWithMacro(api, args, { allowApply: options.allowApply });
      return wrapToolResult(result);
    },
  );

  server.tool(
    'gorgias_add_tags',
    'Add tags to a Gorgias ticket.',
    {
      ticket_id: z.number().describe('The Gorgias ticket ID'),
      tags: z.array(z.string()).describe('Tags to add to the ticket'),
    },
    async (args) => {
      const result = await executeAddTags(api, args, { allowApply: options.allowApply });
      return wrapToolResult(result);
    },
  );

  server.tool(
    'gorgias_merge_tickets',
    'Merge duplicate tickets into a primary ticket. All messages are preserved.',
    {
      primary_ticket_id: z.number().describe('The ticket to merge into (will be kept)'),
      secondary_ticket_ids: z.array(z.number()).describe('Tickets to merge (will be closed)'),
    },
    async (args) => {
      const result = await executeMergeTickets(api, args, { allowApply: options.allowApply });
      return wrapToolResult(result);
    },
  );

  server.tool(
    'gorgias_batch_close_tickets',
    'Close multiple tickets at once. Use after previewing with list_tickets.',
    {
      ticket_ids: z.array(z.number()).describe('Array of ticket IDs to close'),
      internal_note: z.string().optional().describe('Internal note to add to all tickets'),
      add_tag: z.string().optional().describe('Tag to add before closing'),
    },
    async (args) => {
      const result = await executeBatchCloseTickets(api, args, { allowApply: options.allowApply });
      return wrapToolResult(result);
    },
  );

  server.tool(
    'gorgias_batch_tag_tickets',
    'Add tags to multiple tickets at once.',
    {
      ticket_ids: z.array(z.number()).describe('Array of ticket IDs to tag'),
      tags: z.array(z.string()).describe('Tags to add to all tickets'),
    },
    async (args) => {
      const result = await executeBatchTagTickets(api, args, { allowApply: options.allowApply });
      return wrapToolResult(result);
    },
  );

  server.tool('gorgias_list_macros', 'List available Gorgias macros.', {}, async () => {
    const response = await api.listMacros();
    const data = response?.data || response || [];
    const macros = Array.isArray(data) ? data : [];
    const safeMacros = options.redact ? macros.map(redactPii) : macros;
    const result = {
      success: true,
      total_macros: safeMacros.length,
      macros: safeMacros.slice(0, 50),
      has_more: safeMacros.length > 50,
    };
    return wrapToolResult(result);
  });

  server.tool(
    'gorgias_get_macro',
    'Get a specific Gorgias macro by ID.',
    { macro_id: z.number().describe('The macro ID') },
    async (args) => {
      const macro = await api.getMacro(args.macro_id);
      const safeMacro = options.redact ? redactPii(macro) : macro;
      return wrapToolResult({ success: true, macro: safeMacro });
    },
  );

  server.tool('gorgias_list_users', 'List Gorgias users (agents).', {}, async () => {
    const response = await api.listUsers();
    const data = response?.data || response || [];
    const users = Array.isArray(data) ? data : [];
    const safeUsers = options.redact ? users.map(redactPii) : users;
    const result = {
      success: true,
      total_users: safeUsers.length,
      users: safeUsers.slice(0, 50),
      has_more: safeUsers.length > 50,
    };
    return wrapToolResult(result);
  });

  server.tool('gorgias_list_teams', 'List Gorgias teams.', {}, async () => {
    const response = await api.listTeams();
    const data = response?.data || response || [];
    const teams = Array.isArray(data) ? data : [];
    const safeTeams = options.redact ? teams.map(redactPii) : teams;
    const result = {
      success: true,
      total_teams: safeTeams.length,
      teams: safeTeams.slice(0, 50),
      has_more: safeTeams.length > 50,
    };
    return wrapToolResult(result);
  });

  server.tool(
    'gorgias_request',
    'Execute a raw Gorgias API request. Non-GET methods require --apply or STATESET_ALLOW_APPLY.',
    {
      method: RawRequestSchema.method,
      endpoint: RawRequestSchema.endpoint,
      query: RawRequestSchema.query,
      body: RawRequestSchema.body,
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const method = String(args.method || '').toUpperCase();
      if (method !== 'GET') {
        const blocked = guardWrite(options);
        if (blocked) return blocked;
      }

      const response = await api.requestRaw(
        method,
        args.endpoint as string,
        args.query as Record<string, string | number | boolean> | undefined,
        args.body as Record<string, unknown> | undefined,
      );

      const data = options.redact ? redactPii(response) : response;
      return wrapToolResult({ success: true, data }, args.max_chars as number | undefined);
    },
  );
}
