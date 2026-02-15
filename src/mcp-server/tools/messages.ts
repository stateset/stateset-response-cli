import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { GraphQLClient } from 'graphql-request';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { executeQuery } from '../graphql-client.js';

const MESSAGE_FIELDS = `
  id body chat_id user_id username from timestamp created_at
  fromAgent image_url citations metadata org_id agent_id
  command_used reasoning_content isCode isCommerce isReason
`;

export function registerMessageTools(server: McpServer, client: GraphQLClient, orgId: string) {
  server.tool(
    'list_messages',
    'List messages for a specific channel thread in chronological order',
    {
      chat_id: z.string().describe('UUID of the channel thread'),
      limit: z.number().optional().describe('Max messages to return (default 100)'),
      offset: z.number().optional().describe('Offset for pagination (default 0)'),
    },
    async ({ chat_id, limit, offset }) => {
      const query = `query ($chat_id: uuid!, $limit: Int!, $offset: Int!) {
        message(
          where: { chat_id: { _eq: $chat_id } },
          order_by: { timestamp: asc },
          limit: $limit, offset: $offset
        ) { ${MESSAGE_FIELDS} }
      }`;
      const data = await executeQuery<{ message: unknown[] }>(client, query, {
        chat_id,
        limit: limit ?? 100,
        offset: offset ?? 0,
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(data.message, null, 2) }] };
    },
  );

  server.tool(
    'get_message',
    'Get a specific message by ID',
    { id: z.string().describe('UUID of the message') },
    async ({ id }) => {
      const query = `query ($id: String!) {
        message(where: { id: { _eq: $id } }) {
          ${MESSAGE_FIELDS}
        }
      }`;
      const data = await executeQuery<{ message: unknown[] }>(client, query, { id });
      if (!data.message.length) {
        return { content: [{ type: 'text' as const, text: 'Message not found' }], isError: true };
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(data.message[0], null, 2) }],
      };
    },
  );

  server.tool(
    'create_message',
    'Insert a new message into a channel thread',
    {
      chat_id: z.string().describe('UUID of the channel thread'),
      body: z.string().describe('Message body text'),
      username: z.string().optional().describe('Display name of the sender'),
      from: z.string().optional().describe('Sender identifier'),
      fromAgent: z
        .boolean()
        .optional()
        .describe('Whether this message is from an AI agent (default false)'),
      user_id: z.string().optional().describe('User ID of the sender'),
      agent_id: z.string().optional().describe('Agent ID if sent by an agent'),
      image_url: z.string().optional().describe('URL or base64 of an attached image'),
      command_used: z.string().optional().describe('Command prefix used (e.g. /chat, /reason)'),
      metadata: z.record(z.unknown()).optional().describe('Additional metadata'),
    },
    async (args) => {
      const mutation = `mutation ($message: message_insert_input!) {
        insert_message(objects: [$message]) {
          returning { ${MESSAGE_FIELDS} }
        }
      }`;
      const now = new Date();
      const message: Record<string, unknown> = {
        id: uuidv4(),
        chat_id: args.chat_id,
        body: args.body,
        username: args.username || 'system',
        from: args.from || args.username || 'system',
        timestamp: now.toUTCString(),
        created_at: now.toISOString(),
        time: now.toLocaleTimeString(),
        date: now.toISOString().split('T')[0],
        fromAgent: args.fromAgent ?? false,
        org_id: orgId,
        isCode: false,
        isCommerce: false,
        isReason: false,
      };
      if (args.user_id) message.user_id = args.user_id;
      if (args.agent_id) message.agent_id = args.agent_id;
      if (args.image_url) message.image_url = args.image_url;
      if (args.command_used) message.command_used = args.command_used;
      if (args.metadata) message.metadata = args.metadata;

      const data = await executeQuery<{ insert_message: { returning: unknown[] } }>(
        client,
        mutation,
        { message },
      );
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(data.insert_message.returning[0], null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    'update_message',
    'Update an existing message body and/or metadata',
    {
      id: z.string().describe('UUID of the message to update'),
      body: z.string().optional().describe('New message body'),
      metadata: z.record(z.unknown()).optional().describe('Updated metadata'),
    },
    async ({ id, body, metadata }) => {
      const setFields: Record<string, unknown> = {};
      if (body !== undefined) setFields.body = body;
      if (metadata !== undefined) setFields.metadata = metadata;
      if (Object.keys(setFields).length === 0) {
        return { content: [{ type: 'text' as const, text: 'No fields to update' }], isError: true };
      }

      const mutation = `mutation ($id: String!, $set: message_set_input!) {
        update_message(where: { id: { _eq: $id } }, _set: $set) {
          returning { ${MESSAGE_FIELDS} }
        }
      }`;
      const data = await executeQuery<{ update_message: { returning: unknown[] } }>(
        client,
        mutation,
        { id, set: setFields },
      );
      if (!data.update_message.returning.length) {
        return { content: [{ type: 'text' as const, text: 'Message not found' }], isError: true };
      }
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(data.update_message.returning[0], null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    'delete_message',
    'Delete a message by ID',
    { id: z.string().describe('UUID of the message to delete') },
    async ({ id }) => {
      const mutation = `mutation ($id: String!) {
        delete_message(where: { id: { _eq: $id } }) {
          affected_rows
        }
      }`;
      const data = await executeQuery<{ delete_message: { affected_rows: number } }>(
        client,
        mutation,
        { id },
      );
      if (data.delete_message.affected_rows === 0) {
        return { content: [{ type: 'text' as const, text: 'Message not found' }], isError: true };
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ deleted: true, id }, null, 2) }],
      };
    },
  );

  server.tool(
    'search_messages',
    'Search messages by body text across all channel threads in the organization',
    {
      query: z.string().describe('Text to search for in message bodies'),
      chat_id: z.string().optional().describe('Limit search to a specific channel thread UUID'),
      from_agent: z.boolean().optional().describe('Filter to only agent or only human messages'),
      limit: z.number().optional().describe('Max results (default 20)'),
    },
    async ({ query: searchQuery, chat_id, from_agent, limit }) => {
      const conditions = ['{ org_id: { _eq: $org_id } }', '{ body: { _ilike: $search } }'];
      const variables: Record<string, unknown> = {
        org_id: orgId,
        search: `%${searchQuery}%`,
        limit: limit ?? 20,
      };

      const params: string[] = [];
      if (chat_id !== undefined) {
        conditions.push('{ chat_id: { _eq: $chat_id } }');
        variables.chat_id = chat_id;
        params.push(', $chat_id: uuid!');
      }
      if (from_agent !== undefined) {
        conditions.push('{ fromAgent: { _eq: $fromAgent } }');
        variables.fromAgent = from_agent;
        params.push(', $fromAgent: Boolean!');
      }

      const whereClause = `{ _and: [${conditions.join(', ')}] }`;

      const gqlQuery = `query ($org_id: String!, $search: String!, $limit: Int!${params.join('')}) {
        message(
          where: ${whereClause},
          order_by: { timestamp: desc },
          limit: $limit
        ) { ${MESSAGE_FIELDS} }
      }`;

      const data = await executeQuery<{ message: unknown[] }>(client, gqlQuery, variables);
      return { content: [{ type: 'text' as const, text: JSON.stringify(data.message, null, 2) }] };
    },
  );

  server.tool(
    'get_message_count',
    'Get total message count, optionally for a specific channel thread',
    {
      chat_id: z.string().optional().describe('UUID of a channel thread (omit for org-wide count)'),
    },
    async ({ chat_id }) => {
      const conditions = ['{ org_id: { _eq: $org_id } }'];
      const variables: Record<string, unknown> = { org_id: orgId };
      let params = '';

      if (chat_id) {
        conditions.push('{ chat_id: { _eq: $chat_id } }');
        variables.chat_id = chat_id;
        params = ', $chat_id: uuid!';
      }

      const whereClause =
        conditions.length === 1 ? conditions[0] : `{ _and: [${conditions.join(', ')}] }`;

      const query = `query ($org_id: String!${params}) {
        message_aggregate(where: ${whereClause}) {
          aggregate { count }
        }
      }`;
      const data = await executeQuery<{ message_aggregate: { aggregate: { count: number } } }>(
        client,
        query,
        variables,
      );
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(data.message_aggregate, null, 2) }],
      };
    },
  );
}
