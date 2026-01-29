import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { GraphQLClient } from 'graphql-request';
import { z } from 'zod';
import { executeQuery } from '../graphql-client.js';

const DATASET_FIELDS = `
  id name description entry_count status
  created_at updated_at org_id metadata
`;

const DATASET_ENTRY_FIELDS = `
  id dataset_id content metadata created_at updated_at
`;

export function registerDatasetTools(server: McpServer, client: GraphQLClient, orgId: string) {

  server.tool(
    'list_datasets',
    'List all datasets (knowledge bases) for the current organization',
    {
      limit: z.number().optional().describe('Max number of datasets to return (default 100)'),
      offset: z.number().optional().describe('Offset for pagination (default 0)'),
    },
    async ({ limit, offset }) => {
      const query = `query ($org_id: String, $limit: Int!, $offset: Int!) {
        datasets(
          limit: $limit, offset: $offset,
          order_by: { created_at: desc },
          where: { org_id: { _eq: $org_id } }
        ) { ${DATASET_FIELDS} }
      }`;
      const data = await executeQuery<{ datasets: unknown[] }>(client, query, {
        org_id: orgId,
        limit: limit ?? 100,
        offset: offset ?? 0,
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(data.datasets, null, 2) }] };
    }
  );

  server.tool(
    'get_dataset',
    'Get a specific dataset with its entries',
    { id: z.string().describe('UUID of the dataset') },
    async ({ id }) => {
      const query = `query ($id: uuid!, $org_id: String!) {
        datasets(where: {id: {_eq: $id}, org_id: {_eq: $org_id}}) {
          ${DATASET_FIELDS}
          dataset_entries(order_by: {created_at: desc}) {
            id content metadata created_at updated_at
          }
        }
      }`;
      const data = await executeQuery<{ datasets: unknown[] }>(client, query, { id, org_id: orgId });
      if (!(data.datasets as unknown[]).length) {
        return { content: [{ type: 'text' as const, text: 'Dataset not found' }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(data.datasets[0], null, 2) }] };
    }
  );

  server.tool(
    'create_dataset',
    'Create a new dataset (knowledge base)',
    {
      name: z.string().describe('Name of the dataset'),
      description: z.string().optional().describe('Description'),
      metadata: z.any().optional().describe('Additional metadata'),
    },
    async (args) => {
      const mutation = `mutation ($object: datasets_insert_input!) {
        insert_datasets(objects: [$object]) {
          returning { ${DATASET_FIELDS} }
        }
      }`;
      const dataset = {
        org_id: orgId,
        name: args.name,
        description: args.description || '',
        entry_count: 0,
        status: 'active',
        metadata: args.metadata || {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const data = await executeQuery<{ insert_datasets: { returning: unknown[] } }>(client, mutation, { object: dataset });
      return { content: [{ type: 'text' as const, text: JSON.stringify(data.insert_datasets.returning[0], null, 2) }] };
    }
  );

  server.tool(
    'update_dataset',
    'Update an existing dataset',
    {
      id: z.string().describe('UUID of the dataset to update'),
      name: z.string().optional().describe('New dataset name'),
      description: z.string().optional().describe('New description'),
      status: z.string().optional().describe('New status (e.g. active, archived)'),
      metadata: z.any().optional().describe('Updated metadata'),
    },
    async (args) => {
      const { id, ...updates } = args;
      const setFields: Record<string, unknown> = { ...updates, updated_at: new Date().toISOString() };
      for (const key of Object.keys(setFields)) {
        if (setFields[key] === undefined) delete setFields[key];
      }
      const mutation = `mutation ($id: uuid!, $org_id: String!, $set: datasets_set_input!) {
        update_datasets(where: {id: {_eq: $id}, org_id: {_eq: $org_id}}, _set: $set) {
          returning { ${DATASET_FIELDS} }
        }
      }`;
      const data = await executeQuery<{ update_datasets: { returning: unknown[] } }>(client, mutation, { id, org_id: orgId, set: setFields });
      if (!data.update_datasets.returning.length) {
        return { content: [{ type: 'text' as const, text: 'Dataset not found' }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(data.update_datasets.returning[0], null, 2) }] };
    }
  );

  server.tool(
    'delete_dataset',
    'Delete a dataset by ID',
    { id: z.string().describe('UUID of the dataset to delete') },
    async ({ id }) => {
      const mutation = `mutation ($id: uuid!, $org_id: String!) {
        delete_datasets(where: {id: {_eq: $id}, org_id: {_eq: $org_id}}) {
          returning { id name }
        }
      }`;
      const data = await executeQuery<{ delete_datasets: { returning: unknown[] } }>(client, mutation, { id, org_id: orgId });
      if (!data.delete_datasets.returning.length) {
        return { content: [{ type: 'text' as const, text: 'Dataset not found' }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify({ deleted: data.delete_datasets.returning[0] }, null, 2) }] };
    }
  );

  server.tool(
    'add_dataset_entry',
    'Add an entry to a dataset',
    {
      dataset_id: z.string().describe('UUID of the dataset'),
      content: z.string().describe('Content of the entry'),
      metadata: z.any().optional().describe('Additional metadata for the entry'),
    },
    async (args) => {
      const mutation = `mutation ($object: dataset_entries_insert_input!) {
        insert_dataset_entries(objects: [$object]) {
          returning { ${DATASET_ENTRY_FIELDS} }
        }
      }`;
      const entry = {
        dataset_id: args.dataset_id,
        content: args.content,
        metadata: args.metadata || {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const data = await executeQuery<{ insert_dataset_entries: { returning: unknown[] } }>(client, mutation, { object: entry });
      return { content: [{ type: 'text' as const, text: JSON.stringify(data.insert_dataset_entries.returning[0], null, 2) }] };
    }
  );

  server.tool(
    'delete_dataset_entry',
    'Remove an entry from a dataset',
    {
      id: z.string().describe('UUID of the dataset entry to delete'),
    },
    async ({ id }) => {
      const mutation = `mutation ($id: uuid!) {
        delete_dataset_entries(where: {id: {_eq: $id}}) {
          returning { id dataset_id }
        }
      }`;
      const data = await executeQuery<{ delete_dataset_entries: { returning: unknown[] } }>(client, mutation, { id });
      if (!data.delete_dataset_entries.returning.length) {
        return { content: [{ type: 'text' as const, text: 'Dataset entry not found' }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify({ deleted: data.delete_dataset_entries.returning[0] }, null, 2) }] };
    }
  );
}
