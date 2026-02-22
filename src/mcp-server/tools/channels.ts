import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { GraphQLClient } from 'graphql-request';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { executeQuery } from '../graphql-client.js';
import { errorResult } from './helpers.js';

const CHANNEL_FIELDS = `
  id name uuid user_id org_id agent_id model
  created_at status channel escalated tags
  response_system_prompt voice_id voice_model_id voice_model_provider
`;

const CHANNEL_WITH_AGENT = `
  ${CHANNEL_FIELDS}
  agent {
    id agent_name description voice_model voice_model_id voice_model_provider
  }
`;

export function registerChannelTools(server: McpServer, client: GraphQLClient, orgId: string) {
  server.tool(
    'list_channels',
    'List channel threads for the current organization, most recent first',
    {
      limit: z.number().optional().describe('Max number of channels to return (default 50)'),
      offset: z.number().optional().describe('Offset for pagination (default 0)'),
      status: z
        .string()
        .optional()
        .describe('Filter by status (open, closed, in_progress, needs_attention)'),
      agent_id: z.string().optional().describe('Filter by agent ID'),
      escalated: z.boolean().optional().describe('Filter by escalation status'),
    },
    async ({ limit, offset, status, agent_id, escalated }) => {
      const conditions = ['{ org_id: { _eq: $org_id } }'];
      const variables: Record<string, unknown> = {
        org_id: orgId,
        limit: limit ?? 50,
        offset: offset ?? 0,
      };

      const params: string[] = [];
      if (status !== undefined) {
        conditions.push('{ status: { _eq: $status } }');
        variables.status = status;
        params.push(', $status: String!');
      }
      if (agent_id !== undefined) {
        conditions.push('{ agent_id: { _eq: $agent_id } }');
        variables.agent_id = agent_id;
        params.push(', $agent_id: String!');
      }
      if (escalated !== undefined) {
        conditions.push('{ escalated: { _eq: $escalated } }');
        variables.escalated = escalated;
        params.push(', $escalated: Boolean!');
      }

      const whereClause =
        conditions.length === 1 ? conditions[0] : `{ _and: [${conditions.join(', ')}] }`;

      const query = `query ($org_id: String!, $limit: Int!, $offset: Int!${params.join('')}) {
        channel_thread(
          limit: $limit, offset: $offset,
          order_by: { created_at: desc_nulls_last },
          where: ${whereClause}
        ) { ${CHANNEL_WITH_AGENT} }
      }`;

      const data = await executeQuery<{ channel_thread: unknown[] }>(client, query, variables);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(data.channel_thread, null, 2) }],
      };
    },
  );

  server.tool(
    'get_channel',
    'Get a specific channel thread by UUID, including its linked agent',
    { uuid: z.string().describe('UUID of the channel thread') },
    async ({ uuid }) => {
      const query = `query ($uuid: uuid!, $org_id: String!) {
        channel_thread(where: { uuid: { _eq: $uuid }, org_id: { _eq: $org_id } }, limit: 1) {
          ${CHANNEL_WITH_AGENT}
        }
      }`;
      const data = await executeQuery<{ channel_thread: unknown[] }>(client, query, {
        uuid,
        org_id: orgId,
      });
      if (!data.channel_thread.length) {
        return errorResult('Channel thread not found');
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(data.channel_thread[0], null, 2) }],
      };
    },
  );

  server.tool(
    'get_channel_with_messages',
    'Get a channel thread along with all its messages in chronological order',
    {
      uuid: z.string().describe('UUID of the channel thread'),
      message_limit: z.number().optional().describe('Max messages to return (default 100)'),
    },
    async ({ uuid, message_limit }) => {
      const query = `query ($uuid: uuid!, $org_id: String!, $msg_limit: Int!) {
        channel_thread(where: { uuid: { _eq: $uuid }, org_id: { _eq: $org_id } }, limit: 1) {
          ${CHANNEL_FIELDS}
          messages(order_by: { timestamp: asc }, limit: $msg_limit) {
            id body user_id username from timestamp created_at
            fromAgent image_url citations metadata agent_id
            command_used reasoning_content isCode isCommerce isReason
          }
        }
      }`;
      const data = await executeQuery<{ channel_thread: unknown[] }>(client, query, {
        uuid,
        org_id: orgId,
        msg_limit: message_limit ?? 100,
      });
      if (!data.channel_thread.length) {
        return errorResult('Channel thread not found');
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(data.channel_thread[0], null, 2) }],
      };
    },
  );

  server.tool(
    'create_channel',
    'Create a new channel thread',
    {
      name: z.string().describe('Name/title for the channel thread'),
      agent_id: z.string().optional().describe('Agent ID to assign'),
      model: z.string().optional().describe('Model to use (default gpt-4o-2024-11-20)'),
      user_id: z.string().optional().describe('User ID that owns the thread'),
      channel: z.string().optional().describe('Channel type (e.g. chat, email, whatsapp)'),
      response_system_prompt: z
        .string()
        .optional()
        .describe('Custom system prompt for this thread'),
    },
    async (args) => {
      const mutation = `mutation ($object: channel_thread_insert_input!) {
        insert_channel_thread(objects: [$object]) {
          returning { ${CHANNEL_FIELDS} }
        }
      }`;
      const object: Record<string, unknown> = {
        name: args.name,
        uuid: uuidv4(),
        org_id: orgId,
        model: args.model || 'gpt-4o-2024-11-20',
        created_at: new Date().toISOString(),
      };
      if (args.agent_id) object.agent_id = args.agent_id;
      if (args.user_id) object.user_id = args.user_id;
      if (args.channel) object.channel = args.channel;
      if (args.response_system_prompt) object.response_system_prompt = args.response_system_prompt;

      const data = await executeQuery<{ insert_channel_thread: { returning: unknown[] } }>(
        client,
        mutation,
        { object },
      );
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(data.insert_channel_thread.returning[0], null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    'update_channel',
    'Update an existing channel thread',
    {
      uuid: z.string().describe('UUID of the channel thread to update'),
      name: z.string().optional().describe('New name'),
      agent_id: z.string().optional().describe('New agent ID'),
      model: z.string().optional().describe('New model'),
      status: z
        .string()
        .optional()
        .describe('New status (open, closed, in_progress, needs_attention)'),
      escalated: z.boolean().optional().describe('Set escalation flag'),
      tags: z.array(z.string()).optional().describe('Set tags'),
      response_system_prompt: z.string().optional().describe('New system prompt'),
    },
    async (args) => {
      const { uuid, ...updates } = args;
      const setFields: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(updates)) {
        if (value !== undefined) setFields[key] = value;
      }
      if (Object.keys(setFields).length === 0) {
        return errorResult('No fields to update');
      }

      const mutation = `mutation ($uuid: uuid!, $org_id: String!, $set: channel_thread_set_input!) {
        update_channel_thread(
          where: { uuid: { _eq: $uuid }, org_id: { _eq: $org_id } },
          _set: $set
        ) {
          affected_rows
          returning { ${CHANNEL_FIELDS} }
        }
      }`;
      const data = await executeQuery<{
        update_channel_thread: { affected_rows: number; returning: unknown[] };
      }>(client, mutation, { uuid, org_id: orgId, set: setFields });
      if (!data.update_channel_thread.returning.length) {
        return errorResult('Channel thread not found');
      }
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(data.update_channel_thread.returning[0], null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    'delete_channel',
    'Delete a channel thread by UUID',
    { uuid: z.string().describe('UUID of the channel thread to delete') },
    async ({ uuid }) => {
      const mutation = `mutation ($uuid: uuid!, $org_id: String!) {
        delete_channel_thread(where: { uuid: { _eq: $uuid }, org_id: { _eq: $org_id } }) {
          affected_rows
        }
      }`;
      const data = await executeQuery<{ delete_channel_thread: { affected_rows: number } }>(
        client,
        mutation,
        { uuid, org_id: orgId },
      );
      if (data.delete_channel_thread.affected_rows === 0) {
        return errorResult('Channel thread not found');
      }
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify({ deleted: true, uuid }, null, 2) },
        ],
      };
    },
  );

  server.tool(
    'get_channel_count',
    'Get total count of channel threads for the current organization',
    {},
    async () => {
      const query = `query ($org_id: String!) {
        channel_thread_aggregate(where: { org_id: { _eq: $org_id } }) {
          aggregate { count }
        }
      }`;
      const data = await executeQuery<{
        channel_thread_aggregate: { aggregate: { count: number } };
      }>(client, query, { org_id: orgId });
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(data.channel_thread_aggregate, null, 2) },
        ],
      };
    },
  );
}
