import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { KlaviyoConfig } from '../../integrations/config.js';
import { stringifyToolResult } from './output.js';
import {
  KlaviyoToolOptions,
  buildQuery,
  runKlaviyoRequest,
  writeNotAllowed,
  buildJsonApiPayload,
} from './klaviyo-common.js';

export function registerKlaviyoListTools(
  server: McpServer,
  klaviyo: KlaviyoConfig,
  options: KlaviyoToolOptions,
) {
  server.tool(
    'klaviyo_list_lists',
    'List Klaviyo lists.',
    {
      limit: z.number().min(1).max(250).optional().describe('Page size (page[size])'),
      cursor: z.string().optional().describe('Cursor for pagination (page[cursor])'),
      filter: z.string().optional().describe('Filter expression'),
      sort: z.string().optional().describe('Sort expression'),
      fields: z.string().optional().describe('Fields to return (fields[list])'),
      additional_fields: z
        .string()
        .optional()
        .describe('Additional fields (additional-fields[list])'),
      query: z
        .record(z.union([z.string(), z.number(), z.boolean()]))
        .optional()
        .describe('Additional query parameters'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z
        .number()
        .min(2000)
        .max(20000)
        .optional()
        .describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'GET',
        path: '/lists',
        query: buildQuery(args, 'list'),
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_get_list',
    'Get a Klaviyo list by ID.',
    {
      list_id: z.string().describe('Klaviyo list ID'),
      fields: z.string().optional().describe('Fields to return (fields[list])'),
      additional_fields: z
        .string()
        .optional()
        .describe('Additional fields (additional-fields[list])'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z
        .number()
        .min(2000)
        .max(20000)
        .optional()
        .describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      const query = buildQuery(
        {
          fields: args.fields as string | undefined,
          additional_fields: args.additional_fields as string | undefined,
        },
        'list',
      );

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'GET',
        path: `/lists/${args.list_id}`,
        query,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_create_list',
    'Create a Klaviyo list. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      attributes: z.record(z.unknown()).describe('List attributes payload'),
      relationships: z.record(z.unknown()).optional().describe('Optional list relationships'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z
        .number()
        .min(2000)
        .max(20000)
        .optional()
        .describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      if (!options.allowApply) return writeNotAllowed();

      const body = buildJsonApiPayload({
        type: 'list',
        attributes: args.attributes as Record<string, unknown>,
        relationships: args.relationships as Record<string, unknown> | undefined,
      });

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'POST',
        path: '/lists',
        body,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_update_list',
    'Update a Klaviyo list. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      list_id: z.string().describe('Klaviyo list ID'),
      attributes: z.record(z.unknown()).optional().describe('List attributes to update'),
      relationships: z.record(z.unknown()).optional().describe('Optional list relationships'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z
        .number()
        .min(2000)
        .max(20000)
        .optional()
        .describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      if (!options.allowApply) return writeNotAllowed();

      const body = buildJsonApiPayload({
        type: 'list',
        id: args.list_id as string,
        attributes: args.attributes as Record<string, unknown> | undefined,
        relationships: args.relationships as Record<string, unknown> | undefined,
      });

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'PATCH',
        path: `/lists/${args.list_id}`,
        body,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_delete_list',
    'Delete a Klaviyo list. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      list_id: z.string().describe('Klaviyo list ID'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z
        .number()
        .min(2000)
        .max(20000)
        .optional()
        .describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      if (!options.allowApply) return writeNotAllowed();

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'DELETE',
        path: `/lists/${args.list_id}`,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_get_list_profiles',
    'Get profiles for a Klaviyo list.',
    {
      list_id: z.string().describe('Klaviyo list ID'),
      limit: z.number().min(1).max(250).optional().describe('Page size (page[size])'),
      cursor: z.string().optional().describe('Cursor for pagination (page[cursor])'),
      filter: z.string().optional().describe('Filter expression'),
      sort: z.string().optional().describe('Sort expression'),
      fields: z.string().optional().describe('Fields to return (fields[profile])'),
      additional_fields: z
        .string()
        .optional()
        .describe('Additional fields (additional-fields[profile])'),
      query: z
        .record(z.union([z.string(), z.number(), z.boolean()]))
        .optional()
        .describe('Additional query parameters'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z
        .number()
        .min(2000)
        .max(20000)
        .optional()
        .describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      const query = buildQuery(args, 'profile');
      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'GET',
        path: `/lists/${args.list_id}/profiles`,
        query,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_get_list_profile_ids',
    'Get profile IDs for a Klaviyo list.',
    {
      list_id: z.string().describe('Klaviyo list ID'),
      limit: z.number().min(1).max(250).optional().describe('Page size (page[size])'),
      cursor: z.string().optional().describe('Cursor for pagination (page[cursor])'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z
        .number()
        .min(2000)
        .max(20000)
        .optional()
        .describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      const query: Record<string, string | number | boolean> = {};
      if (args.limit !== undefined) query['page[size]'] = args.limit;
      if (args.cursor) query['page[cursor]'] = args.cursor;

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'GET',
        path: `/lists/${args.list_id}/relationships/profiles`,
        query: Object.keys(query).length > 0 ? query : undefined,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_list_segments',
    'List Klaviyo segments (may require beta revision).',
    {
      limit: z.number().min(1).max(250).optional().describe('Page size (page[size])'),
      cursor: z.string().optional().describe('Cursor for pagination (page[cursor])'),
      filter: z.string().optional().describe('Filter expression'),
      sort: z.string().optional().describe('Sort expression'),
      fields: z.string().optional().describe('Fields to return (fields[segment])'),
      additional_fields: z
        .string()
        .optional()
        .describe('Additional fields (additional-fields[segment])'),
      query: z
        .record(z.union([z.string(), z.number(), z.boolean()]))
        .optional()
        .describe('Additional query parameters'),
      revision: z
        .string()
        .optional()
        .describe('Override Klaviyo revision header (beta may require .pre)'),
      max_chars: z
        .number()
        .min(2000)
        .max(20000)
        .optional()
        .describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'GET',
        path: '/segments',
        query: buildQuery(args, 'segment'),
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_get_segment',
    'Get a Klaviyo segment by ID (may require beta revision).',
    {
      segment_id: z.string().describe('Klaviyo segment ID'),
      fields: z.string().optional().describe('Fields to return (fields[segment])'),
      additional_fields: z
        .string()
        .optional()
        .describe('Additional fields (additional-fields[segment])'),
      revision: z
        .string()
        .optional()
        .describe('Override Klaviyo revision header (beta may require .pre)'),
      max_chars: z
        .number()
        .min(2000)
        .max(20000)
        .optional()
        .describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      const query = buildQuery(
        {
          fields: args.fields as string | undefined,
          additional_fields: args.additional_fields as string | undefined,
        },
        'segment',
      );

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'GET',
        path: `/segments/${args.segment_id}`,
        query,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_create_segment',
    'Create a Klaviyo segment (may require beta revision). Requires --apply or STATESET_ALLOW_APPLY.',
    {
      attributes: z.record(z.unknown()).describe('Segment attributes payload'),
      relationships: z.record(z.unknown()).optional().describe('Optional segment relationships'),
      revision: z
        .string()
        .optional()
        .describe('Override Klaviyo revision header (beta may require .pre)'),
      max_chars: z
        .number()
        .min(2000)
        .max(20000)
        .optional()
        .describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      if (!options.allowApply) return writeNotAllowed();

      const body = buildJsonApiPayload({
        type: 'segment',
        attributes: args.attributes as Record<string, unknown>,
        relationships: args.relationships as Record<string, unknown> | undefined,
      });

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'POST',
        path: '/segments',
        body,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_update_segment',
    'Update a Klaviyo segment (may require beta revision). Requires --apply or STATESET_ALLOW_APPLY.',
    {
      segment_id: z.string().describe('Klaviyo segment ID'),
      attributes: z.record(z.unknown()).optional().describe('Segment attributes to update'),
      relationships: z.record(z.unknown()).optional().describe('Optional segment relationships'),
      revision: z
        .string()
        .optional()
        .describe('Override Klaviyo revision header (beta may require .pre)'),
      max_chars: z
        .number()
        .min(2000)
        .max(20000)
        .optional()
        .describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      if (!options.allowApply) return writeNotAllowed();

      const body = buildJsonApiPayload({
        type: 'segment',
        id: args.segment_id as string,
        attributes: args.attributes as Record<string, unknown> | undefined,
        relationships: args.relationships as Record<string, unknown> | undefined,
      });

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'PATCH',
        path: `/segments/${args.segment_id}`,
        body,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_get_segment_profiles',
    'Get profiles for a Klaviyo segment (may require beta revision).',
    {
      segment_id: z.string().describe('Klaviyo segment ID'),
      limit: z.number().min(1).max(250).optional().describe('Page size (page[size])'),
      cursor: z.string().optional().describe('Cursor for pagination (page[cursor])'),
      filter: z.string().optional().describe('Filter expression'),
      sort: z.string().optional().describe('Sort expression'),
      fields: z.string().optional().describe('Fields to return (fields[profile])'),
      additional_fields: z
        .string()
        .optional()
        .describe('Additional fields (additional-fields[profile])'),
      query: z
        .record(z.union([z.string(), z.number(), z.boolean()]))
        .optional()
        .describe('Additional query parameters'),
      revision: z
        .string()
        .optional()
        .describe('Override Klaviyo revision header (beta may require .pre)'),
      max_chars: z
        .number()
        .min(2000)
        .max(20000)
        .optional()
        .describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      const query = buildQuery(args, 'profile');
      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'GET',
        path: `/segments/${args.segment_id}/profiles`,
        query,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_get_segment_profile_ids',
    'Get profile IDs for a Klaviyo segment (may require beta revision).',
    {
      segment_id: z.string().describe('Klaviyo segment ID'),
      limit: z.number().min(1).max(250).optional().describe('Page size (page[size])'),
      cursor: z.string().optional().describe('Cursor for pagination (page[cursor])'),
      revision: z
        .string()
        .optional()
        .describe('Override Klaviyo revision header (beta may require .pre)'),
      max_chars: z
        .number()
        .min(2000)
        .max(20000)
        .optional()
        .describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      const query: Record<string, string | number | boolean> = {};
      if (args.limit !== undefined) query['page[size]'] = args.limit;
      if (args.cursor) query['page[cursor]'] = args.cursor;

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'GET',
        path: `/segments/${args.segment_id}/relationships/profiles`,
        query: Object.keys(query).length > 0 ? query : undefined,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );
}
