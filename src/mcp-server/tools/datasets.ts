import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { GraphQLClient } from 'graphql-request';
import { z } from 'zod';
import { executeQuery } from '../graphql-client.js';
import {
  paginationLimit,
  paginationOffset,
  metadataSchema,
  MAX_NAME_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_STRING_LENGTH,
} from '../../lib/validation.js';
import { errorResult } from './helpers.js';

const DATASET_FIELDS = `
  id name description entry_count status
  created_at updated_at org_id metadata
`;

const DATASET_ENTRY_FIELDS = `
  id dataset_id messages created_at updated_at
`;

const datasetStatusSchema = z.enum(['active', 'archived', 'draft']);
const datasetMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string().max(MAX_STRING_LENGTH),
});
const datasetEntryInputSchema = z.object({
  messages: z.array(datasetMessageSchema).min(1),
});

type DatasetEntryInput = z.infer<typeof datasetEntryInputSchema>;

function nowIso(): string {
  return new Date().toISOString();
}

async function ensureDatasetExists(
  client: GraphQLClient,
  datasetId: string,
  orgId: string,
): Promise<boolean> {
  const query = `query ($id: uuid!, $org_id: String!) {
    datasets(where: { id: { _eq: $id }, org_id: { _eq: $org_id } }, limit: 1) {
      id
    }
  }`;
  const data = await executeQuery<{ datasets: Array<{ id: string }> }>(client, query, {
    id: datasetId,
    org_id: orgId,
  });
  return Boolean(data.datasets[0]?.id);
}

async function getDatasetEntry(
  client: GraphQLClient,
  entryId: number,
): Promise<{ id: number; dataset_id: string } | null> {
  const query = `query ($id: Int!) {
    dataset_entries(where: { id: { _eq: $id } }, limit: 1) {
      id
      dataset_id
    }
  }`;
  const data = await executeQuery<{ dataset_entries: Array<{ id: number; dataset_id: string }> }>(
    client,
    query,
    { id: entryId },
  );
  return data.dataset_entries[0] ?? null;
}

async function bumpDatasetEntryCount(
  client: GraphQLClient,
  datasetId: string,
  amount: number,
): Promise<void> {
  const mutation = `mutation ($id: uuid!, $amount: Int!, $now: timestamptz!) {
    update_datasets(
      where: { id: { _eq: $id } }
      _inc: { entry_count: $amount }
      _set: { updated_at: $now }
    ) {
      affected_rows
    }
  }`;
  await executeQuery(client, mutation, {
    id: datasetId,
    amount,
    now: nowIso(),
  });
}

export function registerDatasetTools(server: McpServer, client: GraphQLClient, orgId: string) {
  server.tool(
    'list_datasets',
    'List all datasets for the current organization',
    {
      limit: paginationLimit,
      offset: paginationOffset,
    },
    async ({ limit, offset }) => {
      const query = `query ($org_id: String, $limit: Int!, $offset: Int!) {
        datasets(
          limit: $limit,
          offset: $offset,
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
    },
  );

  server.tool(
    'get_dataset',
    'Get a specific dataset with its entries',
    { id: z.string().uuid().describe('UUID of the dataset') },
    async ({ id }) => {
      const query = `query ($id: uuid!, $org_id: String!) {
        datasets(where: { id: { _eq: $id }, org_id: { _eq: $org_id } }, limit: 1) {
          ${DATASET_FIELDS}
        }
        dataset_entries(where: { dataset_id: { _eq: $id } }, order_by: { created_at: asc }) {
          ${DATASET_ENTRY_FIELDS}
        }
      }`;
      const data = await executeQuery<{
        datasets: Array<Record<string, unknown>>;
        dataset_entries: Array<Record<string, unknown>>;
      }>(client, query, {
        id,
        org_id: orgId,
      });
      const dataset = data.datasets[0];
      if (!dataset) {
        return errorResult('Dataset not found');
      }
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ dataset, entries: data.dataset_entries }, null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    'create_dataset',
    'Create a new dataset',
    {
      name: z.string().max(MAX_NAME_LENGTH).describe('Name of the dataset'),
      description: z.string().max(MAX_DESCRIPTION_LENGTH).optional().describe('Description'),
      status: datasetStatusSchema.optional().describe('Dataset status'),
      metadata: metadataSchema,
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
        status: args.status ?? 'active',
        metadata: args.metadata || {},
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      const data = await executeQuery<{ insert_datasets: { returning: unknown[] } }>(
        client,
        mutation,
        { object: dataset },
      );
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(data.insert_datasets.returning[0], null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    'update_dataset',
    'Update an existing dataset',
    {
      id: z.string().uuid().describe('UUID of the dataset to update'),
      name: z.string().max(MAX_NAME_LENGTH).optional().describe('New dataset name'),
      description: z.string().max(MAX_DESCRIPTION_LENGTH).optional().describe('New description'),
      status: datasetStatusSchema.optional().describe('New status'),
      metadata: metadataSchema,
    },
    async (args) => {
      const { id, ...updates } = args;
      const setFields: Record<string, unknown> = {
        ...updates,
        updated_at: nowIso(),
      };
      for (const key of Object.keys(setFields)) {
        if (setFields[key] === undefined) delete setFields[key];
      }
      const mutation = `mutation ($id: uuid!, $org_id: String!, $set: datasets_set_input!) {
        update_datasets(where: {id: {_eq: $id}, org_id: {_eq: $org_id}}, _set: $set) {
          returning { ${DATASET_FIELDS} }
        }
      }`;
      const data = await executeQuery<{ update_datasets: { returning: unknown[] } }>(
        client,
        mutation,
        { id, org_id: orgId, set: setFields },
      );
      if (!data.update_datasets.returning.length) {
        return errorResult('Dataset not found');
      }
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(data.update_datasets.returning[0], null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    'delete_dataset',
    'Delete a dataset by ID',
    { id: z.string().uuid().describe('UUID of the dataset to delete') },
    async ({ id }) => {
      const exists = await ensureDatasetExists(client, id, orgId);
      if (!exists) {
        return errorResult('Dataset not found');
      }

      const deleteEntries = `mutation ($id: uuid!) {
        delete_dataset_entries(where: { dataset_id: { _eq: $id } }) {
          affected_rows
        }
      }`;
      await executeQuery(client, deleteEntries, { id });

      const deleteDataset = `mutation ($id: uuid!, $org_id: String!) {
        delete_datasets(where: {id: {_eq: $id}, org_id: {_eq: $org_id}}) {
          returning { id name }
        }
      }`;
      const data = await executeQuery<{ delete_datasets: { returning: unknown[] } }>(
        client,
        deleteDataset,
        { id, org_id: orgId },
      );
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ deleted: data.delete_datasets.returning[0] }, null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    'add_dataset_entry',
    'Add an entry to a dataset',
    {
      dataset_id: z.string().uuid().describe('UUID of the dataset'),
      messages: z.array(datasetMessageSchema).min(1).describe('Chat messages for the entry'),
    },
    async ({ dataset_id, messages }) => {
      if (!(await ensureDatasetExists(client, dataset_id, orgId))) {
        return errorResult('Dataset not found');
      }

      const mutation = `mutation ($object: dataset_entries_insert_input!) {
        insert_dataset_entries(objects: [$object]) {
          returning { ${DATASET_ENTRY_FIELDS} }
        }
      }`;
      const entry = {
        dataset_id,
        messages,
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      const data = await executeQuery<{ insert_dataset_entries: { returning: unknown[] } }>(
        client,
        mutation,
        { object: entry },
      );
      await bumpDatasetEntryCount(client, dataset_id, 1);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(data.insert_dataset_entries.returning[0], null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    'update_dataset_entry',
    'Update a dataset entry by ID',
    {
      id: z.number().int().positive().describe('Integer ID of the dataset entry'),
      messages: z.array(datasetMessageSchema).min(1).describe('Replacement chat messages'),
    },
    async ({ id, messages }) => {
      const entry = await getDatasetEntry(client, id);
      if (!entry) {
        return errorResult('Dataset entry not found');
      }
      if (!(await ensureDatasetExists(client, entry.dataset_id, orgId))) {
        return errorResult('Dataset not found');
      }

      const mutation = `mutation ($id: Int!, $dataset_id: uuid!, $messages: jsonb!, $now: timestamptz!) {
        update_dataset_entries(
          where: { id: { _eq: $id }, dataset_id: { _eq: $dataset_id } }
          _set: { messages: $messages, updated_at: $now }
        ) {
          returning { ${DATASET_ENTRY_FIELDS} }
        }
      }`;
      const data = await executeQuery<{ update_dataset_entries: { returning: unknown[] } }>(
        client,
        mutation,
        {
          id,
          dataset_id: entry.dataset_id,
          messages,
          now: nowIso(),
        },
      );
      if (!data.update_dataset_entries.returning.length) {
        return errorResult('Dataset entry not found');
      }
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(data.update_dataset_entries.returning[0], null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    'delete_dataset_entry',
    'Remove an entry from a dataset',
    {
      id: z.number().int().positive().describe('Integer ID of the dataset entry to delete'),
    },
    async ({ id }) => {
      const entry = await getDatasetEntry(client, id);
      if (!entry) {
        return errorResult('Dataset entry not found');
      }
      if (!(await ensureDatasetExists(client, entry.dataset_id, orgId))) {
        return errorResult('Dataset not found');
      }

      const mutation = `mutation ($id: Int!) {
        delete_dataset_entries(where: {id: {_eq: $id}}) {
          returning { id dataset_id }
        }
      }`;
      const data = await executeQuery<{ delete_dataset_entries: { returning: unknown[] } }>(
        client,
        mutation,
        { id },
      );
      if (!data.delete_dataset_entries.returning.length) {
        return errorResult('Dataset entry not found');
      }
      await bumpDatasetEntryCount(client, entry.dataset_id, -1);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ deleted: data.delete_dataset_entries.returning[0] }, null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    'import_dataset_entries',
    'Bulk import entries into a dataset',
    {
      dataset_id: z.string().uuid().describe('UUID of the dataset'),
      entries: z.array(datasetEntryInputSchema).min(1).describe('Entries to import'),
    },
    async ({ dataset_id, entries }) => {
      if (!(await ensureDatasetExists(client, dataset_id, orgId))) {
        return errorResult('Dataset not found');
      }

      const objects: DatasetEntryInput[] = entries.map((entry) => ({
        messages: entry.messages,
      }));
      const mutation = `mutation ($objects: [dataset_entries_insert_input!]!) {
        insert_dataset_entries(objects: $objects) {
          affected_rows
          returning { ${DATASET_ENTRY_FIELDS} }
        }
      }`;
      const now = nowIso();
      const data = await executeQuery<{
        insert_dataset_entries: { affected_rows: number; returning: unknown[] };
      }>(client, mutation, {
        objects: objects.map((entry) => ({
          dataset_id,
          messages: entry.messages,
          created_at: now,
          updated_at: now,
        })),
      });
      await bumpDatasetEntryCount(client, dataset_id, data.insert_dataset_entries.affected_rows);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                imported: data.insert_dataset_entries.affected_rows,
                entries: data.insert_dataset_entries.returning,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
