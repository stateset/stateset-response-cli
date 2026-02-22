import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { GraphQLClient } from 'graphql-request';
import { z } from 'zod';
import { executeQuery } from '../graphql-client.js';
import { errorResult } from './helpers.js';

const RESPONSE_FIELDS = `
  id ticket_url channel customer_message agent_response rating
  agent_take_over served_by_agent org_id created_date ticket_id
  function_call function_status workflow_id
`;

export function registerResponseTools(server: McpServer, client: GraphQLClient, orgId: string) {
  server.tool(
    'list_responses',
    'List responses for the current organization, ordered by most recent first',
    {
      limit: z.number().optional().describe('Max number of responses to return (default 50)'),
      offset: z.number().optional().describe('Offset for pagination (default 0)'),
      channel: z.string().optional().describe('Filter by channel (e.g. email, chat, whatsapp)'),
      rating: z.string().optional().describe('Filter by rating'),
    },
    async ({ limit, offset, channel, rating }) => {
      const conditions = ['{ org_id: { _eq: $org_id } }'];
      const variables: Record<string, unknown> = {
        org_id: orgId,
        limit: limit ?? 50,
        offset: offset ?? 0,
      };

      if (channel) {
        conditions.push('{ channel: { _eq: $channel } }');
        variables.channel = channel;
      }
      if (rating) {
        conditions.push('{ rating: { _eq: $rating } }');
        variables.rating = rating;
      }

      const channelParam = channel ? ', $channel: String!' : '';
      const ratingParam = rating ? ', $rating: String!' : '';
      const whereClause =
        conditions.length === 1 ? conditions[0] : `{ _and: [${conditions.join(', ')}] }`;

      const query = `query ($org_id: String!, $limit: Int!, $offset: Int!${channelParam}${ratingParam}) {
        responses(
          limit: $limit, offset: $offset,
          order_by: { created_date: desc },
          where: ${whereClause}
        ) { ${RESPONSE_FIELDS} }
      }`;

      const data = await executeQuery<{ responses: unknown[] }>(client, query, variables);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(data.responses, null, 2) }],
      };
    },
  );

  server.tool(
    'get_response',
    'Get a specific response by ID',
    { id: z.string().describe('UUID of the response') },
    async ({ id }) => {
      const query = `query ($id: uuid!, $org_id: String!) {
        responses(where: { id: { _eq: $id }, org_id: { _eq: $org_id } }) {
          ${RESPONSE_FIELDS}
        }
      }`;
      const data = await executeQuery<{ responses: unknown[] }>(client, query, {
        id,
        org_id: orgId,
      });
      if (!data.responses.length) {
        return errorResult('Response not found');
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(data.responses[0], null, 2) }],
      };
    },
  );

  server.tool(
    'get_response_count',
    'Get the total count of responses for the current organization',
    {},
    async () => {
      const query = `query ($org_id: String!) {
        responses_aggregate(where: { org_id: { _eq: $org_id } }) {
          aggregate { count }
        }
      }`;
      const data = await executeQuery<{ responses_aggregate: { aggregate: { count: number } } }>(
        client,
        query,
        { org_id: orgId },
      );
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(data.responses_aggregate, null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    'bulk_update_response_ratings',
    'Update the rating for multiple responses at once',
    {
      response_ids: z.array(z.string()).describe('Array of response UUIDs to update'),
      rating: z.string().describe('New rating value to set'),
    },
    async ({ response_ids, rating }) => {
      const mutation = `mutation ($ids: [uuid!]!, $rating: String!, $org_id: String!) {
        update_responses(
          where: {
            id: { _in: $ids },
            org_id: { _eq: $org_id }
          },
          _set: {
            rating: $rating,
            updated_at: "now()"
          }
        ) {
          affected_rows
          returning { id rating updated_at }
        }
      }`;
      const data = await executeQuery<{
        update_responses: { affected_rows: number; returning: unknown[] };
      }>(client, mutation, { ids: response_ids, rating, org_id: orgId });

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                success: true,
                affected_rows: data.update_responses.affected_rows,
                updated_responses: data.update_responses.returning,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    'search_responses',
    'Search responses by customer message or agent response text',
    {
      query: z.string().describe('Text to search for in customer messages and agent responses'),
      limit: z.number().optional().describe('Max results (default 20)'),
    },
    async ({ query: searchQuery, limit }) => {
      const gqlQuery = `query ($org_id: String!, $search: String!, $limit: Int!) {
        responses(
          limit: $limit,
          order_by: { created_date: desc },
          where: {
            org_id: { _eq: $org_id },
            _or: [
              { customer_message: { _ilike: $search } },
              { agent_response: { _ilike: $search } }
            ]
          }
        ) { ${RESPONSE_FIELDS} }
      }`;
      const data = await executeQuery<{ responses: unknown[] }>(client, gqlQuery, {
        org_id: orgId,
        search: `%${searchQuery}%`,
        limit: limit ?? 20,
      });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(data.responses, null, 2) }],
      };
    },
  );
}
