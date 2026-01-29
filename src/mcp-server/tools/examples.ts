import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { GraphQLClient } from 'graphql-request';
import { z } from 'zod';
import { executeQuery } from '../graphql-client.js';

const EXAMPLE_FIELDS = `
  id example_name example_type activated description
  created_at updated_at org_id agent_id
  example_ticket_id ticket_content response_content metadata
`;

const EXAMPLE_FIELDS_WITH_MESSAGES = `
  id example_name example_type activated description
  created_at updated_at org_id agent_id
  example_ticket_id ticket_content response_content metadata
  example_messages(order_by: {created_date: asc}, limit: $message_limit) {
    id ticket_url channel customer_message agent_response
    rating agent_take_over served_by_agent org_id
    created_date ticket_id function_call workflow_id
  }
`;

export function registerExampleTools(server: McpServer, client: GraphQLClient, orgId: string) {

  server.tool(
    'list_examples',
    'List all examples for the current organization (includes associated messages)',
    {
      limit: z.number().optional().describe('Max number of examples to return (default 100)'),
      offset: z.number().optional().describe('Offset for pagination (default 0)'),
      message_limit: z.number().optional().describe('Max number of messages per example (default 50)'),
    },
    async ({ limit, offset, message_limit }) => {
      const query = `query ($org_id: String, $limit: Int!, $offset: Int!, $message_limit: Int!) {
        examples(
          where: {org_id: {_eq: $org_id}},
          limit: $limit,
          offset: $offset,
          order_by: { created_at: desc }
        ) { ${EXAMPLE_FIELDS_WITH_MESSAGES} }
      }`;
      const data = await executeQuery<{ examples: unknown[] }>(client, query, {
        org_id: orgId,
        limit: limit ?? 100,
        offset: offset ?? 0,
        message_limit: message_limit ?? 50,
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(data.examples, null, 2) }] };
    }
  );

  server.tool(
    'create_example',
    'Create a new example for training/reference',
    {
      example_name: z.string().describe('Name of the example'),
      agent_id: z.string().describe('UUID of the agent this example belongs to'),
      example_type: z.string().optional().describe('Type of example (default: "general")'),
      description: z.string().optional().describe('Description'),
      activated: z.boolean().optional().describe('Whether the example is activated'),
      example_ticket_id: z.string().optional().describe('Associated ticket ID'),
      ticket_content: z.any().optional().describe('Ticket content object with customer_message, sentiment, priority, tags'),
      response_content: z.any().optional().describe('Response content object with message, tone, actions_taken, follow_up_required'),
      metadata: z.any().optional().describe('Additional metadata'),
    },
    async (args) => {
      const mutation = `mutation ($example: examples_insert_input!) {
        insert_examples(objects: [$example]) {
          returning { ${EXAMPLE_FIELDS} }
        }
      }`;
      const example = {
        org_id: orgId,
        example_name: args.example_name,
        agent_id: args.agent_id,
        example_type: args.example_type || 'general',
        description: args.description || '',
        activated: args.activated !== undefined ? args.activated : true,
        example_ticket_id: args.example_ticket_id || null,
        ticket_content: args.ticket_content || { customer_message: '', sentiment: '', priority: '', tags: [] },
        response_content: args.response_content || { message: '', tone: '', actions_taken: [], follow_up_required: false },
        metadata: args.metadata || {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const data = await executeQuery<{ insert_examples: { returning: unknown[] } }>(client, mutation, { example });
      return { content: [{ type: 'text' as const, text: JSON.stringify(data.insert_examples.returning[0], null, 2) }] };
    }
  );

  server.tool(
    'update_example',
    'Update an existing example',
    {
      id: z.string().describe('UUID of the example to update'),
      example_name: z.string().optional().describe('New name'),
      example_type: z.string().optional().describe('New type'),
      description: z.string().optional().describe('New description'),
      activated: z.boolean().optional().describe('Activation status'),
      ticket_content: z.any().optional().describe('Updated ticket content'),
      response_content: z.any().optional().describe('Updated response content'),
      metadata: z.any().optional().describe('Updated metadata'),
    },
    async (args) => {
      const { id, ...updates } = args;
      const setFields: Record<string, unknown> = { ...updates, updated_at: new Date().toISOString() };
      for (const key of Object.keys(setFields)) {
        if (setFields[key] === undefined) delete setFields[key];
      }
      const mutation = `mutation ($id: uuid!, $org_id: String!, $set: examples_set_input!) {
        update_examples(where: {id: {_eq: $id}, org_id: {_eq: $org_id}}, _set: $set) {
          returning { ${EXAMPLE_FIELDS} }
        }
      }`;
      const data = await executeQuery<{ update_examples: { returning: unknown[] } }>(client, mutation, { id, org_id: orgId, set: setFields });
      if (!data.update_examples.returning.length) {
        return { content: [{ type: 'text' as const, text: 'Example not found' }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(data.update_examples.returning[0], null, 2) }] };
    }
  );

  server.tool(
    'delete_example',
    'Delete an example by ID',
    { id: z.string().describe('UUID of the example to delete') },
    async ({ id }) => {
      const mutation = `mutation ($id: uuid!, $org_id: String!) {
        delete_examples(where: {id: {_eq: $id}, org_id: {_eq: $org_id}}) {
          returning { id example_name }
        }
      }`;
      const data = await executeQuery<{ delete_examples: { returning: unknown[] } }>(client, mutation, { id, org_id: orgId });
      if (!data.delete_examples.returning.length) {
        return { content: [{ type: 'text' as const, text: 'Example not found' }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify({ deleted: data.delete_examples.returning[0] }, null, 2) }] };
    }
  );

  server.tool(
    'import_examples',
    'Bulk import examples (upserts on primary key conflict)',
    {
      examples: z.array(z.object({
        example_name: z.string(),
        agent_id: z.string(),
        example_type: z.string().optional(),
        description: z.string().optional(),
        activated: z.boolean().optional(),
        example_ticket_id: z.string().optional(),
        ticket_content: z.any().optional(),
        response_content: z.any().optional(),
        metadata: z.any().optional(),
      })).describe('Array of examples to import'),
    },
    async ({ examples }) => {
      const mutation = `mutation ($examples: [examples_insert_input!]!) {
        insert_examples(objects: $examples, on_conflict: {
          constraint: examples_pkey,
          update_columns: [example_name, example_type, activated, description, updated_at, ticket_content, response_content]
        }) {
          returning { id example_name example_type activated }
          affected_rows
        }
      }`;
      const timestamp = new Date().toISOString();
      const prepared = examples.map(e => ({
        ...e,
        org_id: orgId,
        example_type: e.example_type || 'general',
        activated: e.activated !== undefined ? e.activated : true,
        ticket_content: e.ticket_content || { customer_message: '', sentiment: '', priority: '', tags: [] },
        response_content: e.response_content || { message: '', tone: '', actions_taken: [], follow_up_required: false },
        metadata: e.metadata || {},
        created_at: timestamp,
        updated_at: timestamp,
      }));
      const data = await executeQuery<{ insert_examples: { returning: unknown[]; affected_rows: number } }>(client, mutation, { examples: prepared });
      return { content: [{ type: 'text' as const, text: JSON.stringify({ affected_rows: data.insert_examples.affected_rows, examples: data.insert_examples.returning }, null, 2) }] };
    }
  );
}
