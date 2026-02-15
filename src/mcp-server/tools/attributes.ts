import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { GraphQLClient } from 'graphql-request';
import { z } from 'zod';
import { executeQuery } from '../graphql-client.js';
import {
  paginationLimit,
  paginationOffset,
  metadataSchema,
  attributeValueSchema,
  MAX_NAME_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_ARRAY_LENGTH,
} from '../../lib/validation.js';

const ATTRIBUTE_FIELDS = `
  id attribute_name attribute_type value max_value min_value
  category description modifiable impact agent_id
  enum_values metadata activated created_at updated_at org_id
`;

export function registerAttributeTools(server: McpServer, client: GraphQLClient, orgId: string) {
  server.tool(
    'list_attributes',
    'List all attributes for the current organization',
    {
      limit: paginationLimit,
      offset: paginationOffset,
    },
    async ({ limit, offset }) => {
      const query = `query ($org_id: String, $limit: Int!, $offset: Int!) {
        attributes(
          where: {org_id: {_eq: $org_id}},
          limit: $limit,
          offset: $offset,
          order_by: { created_at: desc }
        ) { ${ATTRIBUTE_FIELDS} }
      }`;
      const data = await executeQuery<{ attributes: unknown[] }>(client, query, {
        org_id: orgId,
        limit: limit ?? 100,
        offset: offset ?? 0,
      });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(data.attributes, null, 2) }],
      };
    },
  );

  server.tool(
    'create_attribute',
    'Create a new attribute for an agent',
    {
      attribute_name: z.string().max(MAX_NAME_LENGTH).describe('Name of the attribute'),
      attribute_type: z
        .enum(['string', 'number', 'boolean', 'enum', 'scale'])
        .describe('Attribute type'),
      agent_id: z.string().uuid().describe('UUID of the agent this attribute belongs to'),
      value: attributeValueSchema,
      max_value: z
        .number()
        .min(-1000000)
        .max(1000000)
        .optional()
        .describe('Maximum value (for numeric/scale types)'),
      min_value: z
        .number()
        .min(-1000000)
        .max(1000000)
        .optional()
        .describe('Minimum value (for numeric/scale types)'),
      category: z.string().max(100).optional().describe('Category of the attribute'),
      description: z.string().max(MAX_DESCRIPTION_LENGTH).optional().describe('Description'),
      modifiable: z.boolean().optional().describe('Whether the attribute can be modified'),
      impact: z.string().max(500).optional().describe('Impact description'),
      enum_values: z
        .array(z.string().max(100))
        .max(50)
        .optional()
        .describe('Possible values for enum type'),
      metadata: metadataSchema,
      activated: z.boolean().optional().describe('Whether the attribute is activated'),
    },
    async (args) => {
      const mutation = `mutation ($attribute: attributes_insert_input!) {
        insert_attributes(objects: [$attribute]) {
          returning { ${ATTRIBUTE_FIELDS} }
        }
      }`;
      const attribute = {
        org_id: orgId,
        attribute_name: args.attribute_name,
        attribute_type: args.attribute_type,
        agent_id: args.agent_id,
        value: args.value !== undefined ? args.value : args.attribute_type === 'scale' ? 50 : null,
        max_value: args.max_value !== undefined ? args.max_value : 100,
        min_value: args.min_value !== undefined ? args.min_value : 0,
        category: args.category || '',
        description: args.description || '',
        modifiable: args.modifiable !== undefined ? args.modifiable : true,
        impact: args.impact || '',
        enum_values: args.enum_values || [],
        metadata: args.metadata || {},
        activated: args.activated !== undefined ? args.activated : true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const data = await executeQuery<{ insert_attributes: { returning: unknown[] } }>(
        client,
        mutation,
        { attribute },
      );
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(data.insert_attributes.returning[0], null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    'update_attribute',
    'Update an existing attribute',
    {
      id: z.string().uuid().describe('UUID of the attribute to update'),
      attribute_name: z.string().max(MAX_NAME_LENGTH).optional().describe('New name'),
      attribute_type: z
        .enum(['string', 'number', 'boolean', 'enum', 'scale'])
        .optional()
        .describe('New type'),
      value: attributeValueSchema,
      max_value: z.number().min(-1000000).max(1000000).optional().describe('New max value'),
      min_value: z.number().min(-1000000).max(1000000).optional().describe('New min value'),
      category: z.string().max(100).optional().describe('New category'),
      description: z.string().max(MAX_DESCRIPTION_LENGTH).optional().describe('New description'),
      modifiable: z.boolean().optional().describe('Modifiable status'),
      impact: z.string().max(500).optional().describe('New impact'),
      activated: z.boolean().optional().describe('Activation status'),
      metadata: metadataSchema,
    },
    async (args) => {
      const { id, ...updates } = args;
      const setFields: Record<string, unknown> = {
        ...updates,
        updated_at: new Date().toISOString(),
      };
      for (const key of Object.keys(setFields)) {
        if (setFields[key] === undefined) delete setFields[key];
      }
      const mutation = `mutation ($id: uuid!, $org_id: String!, $set: attributes_set_input!) {
        update_attributes(where: {id: {_eq: $id}, org_id: {_eq: $org_id}}, _set: $set) {
          returning { ${ATTRIBUTE_FIELDS} }
        }
      }`;
      const data = await executeQuery<{ update_attributes: { returning: unknown[] } }>(
        client,
        mutation,
        { id, org_id: orgId, set: setFields },
      );
      if (!data.update_attributes.returning.length) {
        return { content: [{ type: 'text' as const, text: 'Attribute not found' }], isError: true };
      }
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(data.update_attributes.returning[0], null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    'delete_attribute',
    'Delete an attribute by ID',
    { id: z.string().uuid().describe('UUID of the attribute to delete') },
    async ({ id }) => {
      const mutation = `mutation ($id: uuid!, $org_id: String!) {
        delete_attributes(where: {id: {_eq: $id}, org_id: {_eq: $org_id}}) {
          returning { id attribute_name }
        }
      }`;
      const data = await executeQuery<{ delete_attributes: { returning: unknown[] } }>(
        client,
        mutation,
        { id, org_id: orgId },
      );
      if (!data.delete_attributes.returning.length) {
        return { content: [{ type: 'text' as const, text: 'Attribute not found' }], isError: true };
      }
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ deleted: data.delete_attributes.returning[0] }, null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    'import_attributes',
    'Bulk import attributes (upserts on primary key conflict)',
    {
      attributes: z
        .array(
          z.object({
            attribute_name: z.string().max(MAX_NAME_LENGTH),
            attribute_type: z.enum(['string', 'number', 'boolean', 'enum', 'scale']),
            agent_id: z.string().uuid(),
            value: attributeValueSchema,
            max_value: z.number().min(-1000000).max(1000000).optional(),
            min_value: z.number().min(-1000000).max(1000000).optional(),
            category: z.string().max(100).optional(),
            description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
            modifiable: z.boolean().optional(),
            impact: z.string().max(500).optional(),
            activated: z.boolean().optional(),
          }),
        )
        .max(MAX_ARRAY_LENGTH)
        .describe('Array of attributes to import (max 100)'),
    },
    async ({ attributes }) => {
      const mutation = `mutation ($attributes: [attributes_insert_input!]!) {
        insert_attributes(objects: $attributes, on_conflict: {
          constraint: attributes_pkey,
          update_columns: [attribute_name, attribute_type, value, max_value, min_value, category, description, modifiable, impact, activated, updated_at]
        }) {
          returning { id attribute_name attribute_type activated }
          affected_rows
        }
      }`;
      const timestamp = new Date().toISOString();
      const prepared = attributes.map((a) => ({
        ...a,
        org_id: orgId,
        activated: a.activated !== undefined ? a.activated : true,
        modifiable: a.modifiable !== undefined ? a.modifiable : true,
        value: a.value !== undefined ? a.value : null,
        max_value: a.max_value !== undefined ? a.max_value : 100,
        min_value: a.min_value !== undefined ? a.min_value : 0,
        category: a.category || '',
        description: a.description || '',
        impact: a.impact || '',
        metadata: {},
        enum_values: [],
        created_at: timestamp,
        updated_at: timestamp,
      }));
      const data = await executeQuery<{
        insert_attributes: { returning: unknown[]; affected_rows: number };
      }>(client, mutation, { attributes: prepared });
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                affected_rows: data.insert_attributes.affected_rows,
                attributes: data.insert_attributes.returning,
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
