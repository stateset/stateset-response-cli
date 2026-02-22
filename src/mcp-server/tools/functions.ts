import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { GraphQLClient } from 'graphql-request';
import { z } from 'zod';
import { executeQuery } from '../graphql-client.js';
import {
  paginationLimit,
  paginationOffset,
  parametersSchema,
  authenticationSchema,
  headersSchema,
  requestTransformSchema,
  responseHandlingSchema,
  retryConfigSchema,
  rateLimitSchema,
  safeUrlSchema,
  MAX_NAME_LENGTH,
  MAX_DESCRIPTION_LENGTH,
} from '../../lib/validation.js';
import { errorResult } from './helpers.js';

const FUNCTION_FIELDS = `
  id function_name function_type activated description
  endpoint method created_at updated_at org_id agent_id
  parameters authentication headers request_transform
  response_handling retry_config timeout rate_limit
`;

export function registerFunctionTools(server: McpServer, client: GraphQLClient, orgId: string) {
  server.tool(
    'list_functions',
    'List all functions for the current organization',
    {
      limit: paginationLimit,
      offset: paginationOffset,
    },
    async ({ limit, offset }) => {
      const query = `query ($org_id: String, $limit: Int!, $offset: Int!) {
        functions(
          where: {org_id: {_eq: $org_id}},
          limit: $limit,
          offset: $offset,
          order_by: { created_at: desc }
        ) { ${FUNCTION_FIELDS} }
      }`;
      const data = await executeQuery<{ functions: unknown[] }>(client, query, {
        org_id: orgId,
        limit: limit ?? 100,
        offset: offset ?? 0,
      });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(data.functions, null, 2) }],
      };
    },
  );

  server.tool(
    'create_function',
    'Create a new function (API call definition)',
    {
      function_name: z.string().max(MAX_NAME_LENGTH).describe('Name of the function'),
      agent_id: z.string().uuid().describe('UUID of the agent this function belongs to'),
      endpoint: safeUrlSchema,
      method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).describe('HTTP method'),
      function_type: z
        .string()
        .max(50)
        .optional()
        .describe('Type of function (default: "api_call")'),
      description: z.string().max(MAX_DESCRIPTION_LENGTH).optional().describe('Description'),
      activated: z.boolean().optional().describe('Whether the function is activated'),
      parameters: parametersSchema,
      authentication: authenticationSchema,
      headers: headersSchema,
      request_transform: requestTransformSchema,
      response_handling: responseHandlingSchema,
      retry_config: retryConfigSchema,
      timeout: z
        .number()
        .int()
        .min(1000)
        .max(300000)
        .optional()
        .describe('Timeout in milliseconds (1s-5min)'),
      rate_limit: rateLimitSchema,
    },
    async (args) => {
      const mutation = `mutation ($_function: functions_insert_input!) {
        insert_functions(objects: [$_function]) {
          returning { ${FUNCTION_FIELDS} }
        }
      }`;
      const fn = {
        org_id: orgId,
        function_name: args.function_name,
        function_type: args.function_type || 'api_call',
        agent_id: args.agent_id,
        endpoint: args.endpoint,
        method: args.method,
        description: args.description || '',
        activated: args.activated !== undefined ? args.activated : true,
        parameters: args.parameters || [],
        authentication: args.authentication || { type: 'none' },
        headers: args.headers || {},
        request_transform: args.request_transform || { body: {} },
        response_handling: args.response_handling || {
          success_condition: 'status_code == 200',
          error_message_path: 'error.message',
          result_mapping: {},
        },
        retry_config: args.retry_config || {
          max_attempts: 3,
          backoff: 'exponential',
          retry_on: [502, 503, 504],
        },
        timeout: args.timeout || 30000,
        rate_limit: args.rate_limit || { requests_per_minute: 60 },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const data = await executeQuery<{ insert_functions: { returning: unknown[] } }>(
        client,
        mutation,
        { _function: fn },
      );
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(data.insert_functions.returning[0], null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    'update_function',
    'Update an existing function',
    {
      id: z.string().uuid().describe('UUID of the function to update'),
      function_name: z.string().max(MAX_NAME_LENGTH).optional().describe('New name'),
      function_type: z.string().max(50).optional().describe('New type'),
      description: z.string().max(MAX_DESCRIPTION_LENGTH).optional().describe('New description'),
      activated: z.boolean().optional().describe('Activation status'),
      endpoint: safeUrlSchema.optional(),
      method: z
        .enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
        .optional()
        .describe('New HTTP method'),
      parameters: parametersSchema,
      authentication: authenticationSchema,
      headers: headersSchema,
      timeout: z.number().int().min(1000).max(300000).optional().describe('New timeout (1s-5min)'),
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
      const mutation = `mutation ($id: uuid!, $org_id: String!, $set: functions_set_input!) {
        update_functions(where: {id: {_eq: $id}, org_id: {_eq: $org_id}}, _set: $set) {
          returning { ${FUNCTION_FIELDS} }
        }
      }`;
      const data = await executeQuery<{ update_functions: { returning: unknown[] } }>(
        client,
        mutation,
        { id, org_id: orgId, set: setFields },
      );
      if (!data.update_functions.returning.length) {
        return errorResult('Function not found');
      }
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(data.update_functions.returning[0], null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    'delete_function',
    'Delete a function by ID',
    { id: z.string().uuid().describe('UUID of the function to delete') },
    async ({ id }) => {
      const mutation = `mutation ($id: uuid!, $org_id: String!) {
        delete_functions(where: {id: {_eq: $id}, org_id: {_eq: $org_id}}) {
          returning { id function_name }
        }
      }`;
      const data = await executeQuery<{ delete_functions: { returning: unknown[] } }>(
        client,
        mutation,
        { id, org_id: orgId },
      );
      if (!data.delete_functions.returning.length) {
        return errorResult('Function not found');
      }
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ deleted: data.delete_functions.returning[0] }, null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    'import_functions',
    'Bulk import functions (upserts on primary key conflict)',
    {
      functions: z
        .array(
          z.object({
            function_name: z.string().max(MAX_NAME_LENGTH),
            agent_id: z.string().uuid(),
            endpoint: safeUrlSchema,
            method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
            function_type: z.string().max(50).optional(),
            description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
            activated: z.boolean().optional(),
            parameters: parametersSchema,
            authentication: authenticationSchema,
            headers: headersSchema,
            timeout: z.number().int().min(1000).max(300000).optional(),
          }),
        )
        .max(100)
        .describe('Array of functions to import (max 100)'),
    },
    async ({ functions }) => {
      const mutation = `mutation ($functions: [functions_insert_input!]!) {
        insert_functions(objects: $functions, on_conflict: {
          constraint: functions_pkey,
          update_columns: [function_name, function_type, activated, description, endpoint, method, updated_at]
        }) {
          returning { id function_name function_type activated }
          affected_rows
        }
      }`;
      const timestamp = new Date().toISOString();
      const prepared = functions.map((f) => ({
        ...f,
        org_id: orgId,
        function_type: f.function_type || 'api_call',
        activated: f.activated !== undefined ? f.activated : true,
        description: f.description || '',
        parameters: f.parameters || [],
        authentication: f.authentication || { type: 'none' },
        headers: f.headers || {},
        request_transform: { body: {} },
        response_handling: {
          success_condition: 'status_code == 200',
          error_message_path: 'error.message',
          result_mapping: {},
        },
        retry_config: { max_attempts: 3, backoff: 'exponential', retry_on: [502, 503, 504] },
        timeout: f.timeout || 30000,
        rate_limit: { requests_per_minute: 60 },
        created_at: timestamp,
        updated_at: timestamp,
      }));
      const data = await executeQuery<{
        insert_functions: { returning: unknown[]; affected_rows: number };
      }>(client, mutation, { functions: prepared });
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                affected_rows: data.insert_functions.affected_rows,
                functions: data.insert_functions.returning,
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
