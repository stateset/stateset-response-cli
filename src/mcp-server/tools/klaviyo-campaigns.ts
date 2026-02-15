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
  buildRelationshipPayload,
} from './klaviyo-common.js';

export function registerKlaviyoCampaignTools(
  server: McpServer,
  klaviyo: KlaviyoConfig,
  options: KlaviyoToolOptions,
) {
  server.tool(
    'klaviyo_list_tags',
    'List Klaviyo tags.',
    {
      limit: z.number().min(1).max(250).optional().describe('Page size (page[size])'),
      cursor: z.string().optional().describe('Cursor for pagination (page[cursor])'),
      filter: z.string().optional().describe('Filter expression'),
      sort: z.string().optional().describe('Sort expression'),
      fields: z.string().optional().describe('Fields to return (fields[tag])'),
      additional_fields: z
        .string()
        .optional()
        .describe('Additional fields (additional-fields[tag])'),
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
        path: '/tags',
        query: buildQuery(args, 'tag'),
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_get_tag',
    'Get a Klaviyo tag by ID.',
    {
      tag_id: z.string().describe('Klaviyo tag ID'),
      fields: z.string().optional().describe('Fields to return (fields[tag])'),
      additional_fields: z
        .string()
        .optional()
        .describe('Additional fields (additional-fields[tag])'),
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
        'tag',
      );

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'GET',
        path: `/tags/${args.tag_id}`,
        query,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_create_tag',
    'Create a Klaviyo tag. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      attributes: z.record(z.unknown()).describe('Tag attributes payload'),
      relationships: z.record(z.unknown()).optional().describe('Optional tag relationships'),
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
        type: 'tag',
        attributes: args.attributes as Record<string, unknown>,
        relationships: args.relationships as Record<string, unknown> | undefined,
      });

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'POST',
        path: '/tags',
        body,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_update_tag',
    'Update a Klaviyo tag. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      tag_id: z.string().describe('Klaviyo tag ID'),
      attributes: z.record(z.unknown()).optional().describe('Tag attributes to update'),
      relationships: z.record(z.unknown()).optional().describe('Optional tag relationships'),
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
        type: 'tag',
        id: args.tag_id as string,
        attributes: args.attributes as Record<string, unknown> | undefined,
        relationships: args.relationships as Record<string, unknown> | undefined,
      });

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'PATCH',
        path: `/tags/${args.tag_id}`,
        body,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_delete_tag',
    'Delete a Klaviyo tag. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      tag_id: z.string().describe('Klaviyo tag ID'),
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
        path: `/tags/${args.tag_id}`,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_list_tag_groups',
    'List Klaviyo tag groups.',
    {
      limit: z.number().min(1).max(250).optional().describe('Page size (page[size])'),
      cursor: z.string().optional().describe('Cursor for pagination (page[cursor])'),
      filter: z.string().optional().describe('Filter expression'),
      sort: z.string().optional().describe('Sort expression'),
      fields: z.string().optional().describe('Fields to return (fields[tag-group])'),
      additional_fields: z
        .string()
        .optional()
        .describe('Additional fields (additional-fields[tag-group])'),
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
        path: '/tag-groups',
        query: buildQuery(args, 'tag-group'),
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_get_tag_group',
    'Get a Klaviyo tag group by ID.',
    {
      tag_group_id: z.string().describe('Klaviyo tag group ID'),
      fields: z.string().optional().describe('Fields to return (fields[tag-group])'),
      additional_fields: z
        .string()
        .optional()
        .describe('Additional fields (additional-fields[tag-group])'),
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
        'tag-group',
      );

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'GET',
        path: `/tag-groups/${args.tag_group_id}`,
        query,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_create_tag_group',
    'Create a Klaviyo tag group. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      attributes: z.record(z.unknown()).describe('Tag group attributes payload'),
      relationships: z.record(z.unknown()).optional().describe('Optional tag group relationships'),
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
        type: 'tag-group',
        attributes: args.attributes as Record<string, unknown>,
        relationships: args.relationships as Record<string, unknown> | undefined,
      });

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'POST',
        path: '/tag-groups',
        body,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_update_tag_group',
    'Update a Klaviyo tag group. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      tag_group_id: z.string().describe('Klaviyo tag group ID'),
      attributes: z.record(z.unknown()).optional().describe('Tag group attributes to update'),
      relationships: z.record(z.unknown()).optional().describe('Optional tag group relationships'),
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
        type: 'tag-group',
        id: args.tag_group_id as string,
        attributes: args.attributes as Record<string, unknown> | undefined,
        relationships: args.relationships as Record<string, unknown> | undefined,
      });

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'PATCH',
        path: `/tag-groups/${args.tag_group_id}`,
        body,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_delete_tag_group',
    'Delete a Klaviyo tag group. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      tag_group_id: z.string().describe('Klaviyo tag group ID'),
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
        path: `/tag-groups/${args.tag_group_id}`,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_get_tag_flows',
    'Get flow IDs tagged with a Klaviyo tag.',
    {
      tag_id: z.string().describe('Klaviyo tag ID'),
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
        path: `/tags/${args.tag_id}/relationships/flows`,
        query: Object.keys(query).length > 0 ? query : undefined,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_add_tag_flows',
    'Tag flows with a Klaviyo tag. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      tag_id: z.string().describe('Klaviyo tag ID'),
      flow_ids: z.array(z.string()).min(1).describe('Flow IDs to tag'),
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
        method: 'POST',
        path: `/tags/${args.tag_id}/relationships/flows`,
        body: buildRelationshipPayload('flow', args.flow_ids as string[]),
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_remove_tag_flows',
    'Remove flows from a Klaviyo tag. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      tag_id: z.string().describe('Klaviyo tag ID'),
      flow_ids: z.array(z.string()).min(1).describe('Flow IDs to untag'),
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
        path: `/tags/${args.tag_id}/relationships/flows`,
        body: buildRelationshipPayload('flow', args.flow_ids as string[]),
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_get_tag_campaigns',
    'Get campaign IDs tagged with a Klaviyo tag.',
    {
      tag_id: z.string().describe('Klaviyo tag ID'),
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
        path: `/tags/${args.tag_id}/relationships/campaigns`,
        query: Object.keys(query).length > 0 ? query : undefined,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_add_tag_campaigns',
    'Tag campaigns with a Klaviyo tag. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      tag_id: z.string().describe('Klaviyo tag ID'),
      campaign_ids: z.array(z.string()).min(1).describe('Campaign IDs to tag'),
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
        method: 'POST',
        path: `/tags/${args.tag_id}/relationships/campaigns`,
        body: buildRelationshipPayload('campaign', args.campaign_ids as string[]),
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_remove_tag_campaigns',
    'Remove campaigns from a Klaviyo tag. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      tag_id: z.string().describe('Klaviyo tag ID'),
      campaign_ids: z.array(z.string()).min(1).describe('Campaign IDs to untag'),
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
        path: `/tags/${args.tag_id}/relationships/campaigns`,
        body: buildRelationshipPayload('campaign', args.campaign_ids as string[]),
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_get_tag_lists',
    'Get list IDs tagged with a Klaviyo tag.',
    {
      tag_id: z.string().describe('Klaviyo tag ID'),
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
        path: `/tags/${args.tag_id}/relationships/lists`,
        query: Object.keys(query).length > 0 ? query : undefined,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_add_tag_lists',
    'Tag lists with a Klaviyo tag. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      tag_id: z.string().describe('Klaviyo tag ID'),
      list_ids: z.array(z.string()).min(1).describe('List IDs to tag'),
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
        method: 'POST',
        path: `/tags/${args.tag_id}/relationships/lists`,
        body: buildRelationshipPayload('list', args.list_ids as string[]),
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_remove_tag_lists',
    'Remove lists from a Klaviyo tag. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      tag_id: z.string().describe('Klaviyo tag ID'),
      list_ids: z.array(z.string()).min(1).describe('List IDs to untag'),
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
        path: `/tags/${args.tag_id}/relationships/lists`,
        body: buildRelationshipPayload('list', args.list_ids as string[]),
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_get_tag_segments',
    'Get segment IDs tagged with a Klaviyo tag.',
    {
      tag_id: z.string().describe('Klaviyo tag ID'),
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
        path: `/tags/${args.tag_id}/relationships/segments`,
        query: Object.keys(query).length > 0 ? query : undefined,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_add_tag_segments',
    'Tag segments with a Klaviyo tag. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      tag_id: z.string().describe('Klaviyo tag ID'),
      segment_ids: z.array(z.string()).min(1).describe('Segment IDs to tag'),
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
        method: 'POST',
        path: `/tags/${args.tag_id}/relationships/segments`,
        body: buildRelationshipPayload('segment', args.segment_ids as string[]),
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_remove_tag_segments',
    'Remove segments from a Klaviyo tag. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      tag_id: z.string().describe('Klaviyo tag ID'),
      segment_ids: z.array(z.string()).min(1).describe('Segment IDs to untag'),
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
        path: `/tags/${args.tag_id}/relationships/segments`,
        body: buildRelationshipPayload('segment', args.segment_ids as string[]),
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_subscribe_profiles_job',
    'Create a bulk subscribe profiles job. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      job: z.record(z.unknown()).describe('Job payload for profile-subscription-bulk-create-jobs'),
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
        method: 'POST',
        path: '/profile-subscription-bulk-create-jobs',
        body: args.job as Record<string, unknown>,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_unsubscribe_profiles_job',
    'Create a bulk unsubscribe profiles job. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      job: z.record(z.unknown()).describe('Job payload for profile-subscription-bulk-delete-jobs'),
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
        method: 'POST',
        path: '/profile-subscription-bulk-delete-jobs',
        body: args.job as Record<string, unknown>,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_suppress_profiles_job',
    'Create a bulk suppress profiles job. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      job: z.record(z.unknown()).describe('Job payload for profile-suppression-bulk-create-jobs'),
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
        method: 'POST',
        path: '/profile-suppression-bulk-create-jobs',
        body: args.job as Record<string, unknown>,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_unsuppress_profiles_job',
    'Create a bulk unsuppress profiles job. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      job: z.record(z.unknown()).describe('Job payload for profile-suppression-bulk-delete-jobs'),
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
        method: 'POST',
        path: '/profile-suppression-bulk-delete-jobs',
        body: args.job as Record<string, unknown>,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_list_campaigns',
    'List Klaviyo campaigns.',
    {
      limit: z.number().min(1).max(250).optional().describe('Page size (page[size])'),
      cursor: z.string().optional().describe('Cursor for pagination (page[cursor])'),
      filter: z.string().optional().describe('Filter expression'),
      sort: z.string().optional().describe('Sort expression'),
      fields: z.string().optional().describe('Fields to return (fields[campaign])'),
      additional_fields: z
        .string()
        .optional()
        .describe('Additional fields (additional-fields[campaign])'),
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
        path: '/campaigns',
        query: buildQuery(args, 'campaign'),
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_get_campaign',
    'Get a Klaviyo campaign by ID.',
    {
      campaign_id: z.string().describe('Klaviyo campaign ID'),
      fields: z.string().optional().describe('Fields to return (fields[campaign])'),
      additional_fields: z
        .string()
        .optional()
        .describe('Additional fields (additional-fields[campaign])'),
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
        'campaign',
      );

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'GET',
        path: `/campaigns/${args.campaign_id}`,
        query,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_create_campaign',
    'Create a Klaviyo campaign. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      attributes: z.record(z.unknown()).describe('Campaign attributes payload'),
      relationships: z.record(z.unknown()).optional().describe('Optional campaign relationships'),
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
        type: 'campaign',
        attributes: args.attributes as Record<string, unknown>,
        relationships: args.relationships as Record<string, unknown> | undefined,
      });

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'POST',
        path: '/campaigns',
        body,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_update_campaign',
    'Update a Klaviyo campaign. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      campaign_id: z.string().describe('Klaviyo campaign ID'),
      attributes: z.record(z.unknown()).optional().describe('Campaign attributes to update'),
      relationships: z.record(z.unknown()).optional().describe('Optional campaign relationships'),
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
        type: 'campaign',
        id: args.campaign_id as string,
        attributes: args.attributes as Record<string, unknown> | undefined,
        relationships: args.relationships as Record<string, unknown> | undefined,
      });

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'PATCH',
        path: `/campaigns/${args.campaign_id}`,
        body,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_delete_campaign',
    'Delete a Klaviyo campaign. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      campaign_id: z.string().describe('Klaviyo campaign ID'),
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
        path: `/campaigns/${args.campaign_id}`,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_list_flows',
    'List Klaviyo flows.',
    {
      limit: z.number().min(1).max(250).optional().describe('Page size (page[size])'),
      cursor: z.string().optional().describe('Cursor for pagination (page[cursor])'),
      filter: z.string().optional().describe('Filter expression'),
      sort: z.string().optional().describe('Sort expression'),
      fields: z.string().optional().describe('Fields to return (fields[flow])'),
      additional_fields: z
        .string()
        .optional()
        .describe('Additional fields (additional-fields[flow])'),
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
        path: '/flows',
        query: buildQuery(args, 'flow'),
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_get_flow',
    'Get a Klaviyo flow by ID.',
    {
      flow_id: z.string().describe('Klaviyo flow ID'),
      fields: z.string().optional().describe('Fields to return (fields[flow])'),
      additional_fields: z
        .string()
        .optional()
        .describe('Additional fields (additional-fields[flow])'),
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
        'flow',
      );

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'GET',
        path: `/flows/${args.flow_id}`,
        query,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_create_flow',
    'Create a Klaviyo flow. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      attributes: z.record(z.unknown()).describe('Flow attributes payload'),
      relationships: z.record(z.unknown()).optional().describe('Optional flow relationships'),
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
        type: 'flow',
        attributes: args.attributes as Record<string, unknown>,
        relationships: args.relationships as Record<string, unknown> | undefined,
      });

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'POST',
        path: '/flows',
        body,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_update_flow',
    'Update a Klaviyo flow. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      flow_id: z.string().describe('Klaviyo flow ID'),
      attributes: z.record(z.unknown()).optional().describe('Flow attributes to update'),
      relationships: z.record(z.unknown()).optional().describe('Optional flow relationships'),
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
        type: 'flow',
        id: args.flow_id as string,
        attributes: args.attributes as Record<string, unknown> | undefined,
        relationships: args.relationships as Record<string, unknown> | undefined,
      });

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'PATCH',
        path: `/flows/${args.flow_id}`,
        body,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_delete_flow',
    'Delete a Klaviyo flow. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      flow_id: z.string().describe('Klaviyo flow ID'),
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
        path: `/flows/${args.flow_id}`,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_add_profiles_to_list',
    'Add profiles to a Klaviyo list. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      list_id: z.string().describe('Klaviyo list ID'),
      profile_ids: z.array(z.string()).describe('Array of Klaviyo profile IDs'),
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
      if (!args.profile_ids || args.profile_ids.length === 0) {
        throw new Error('profile_ids is required');
      }

      const body = {
        data: args.profile_ids.map((id) => ({ type: 'profile', id })),
      };

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'POST',
        path: `/lists/${args.list_id}/relationships/profiles`,
        body,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_remove_profiles_from_list',
    'Remove profiles from a Klaviyo list. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      list_id: z.string().describe('Klaviyo list ID'),
      profile_ids: z.array(z.string()).describe('Array of Klaviyo profile IDs'),
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
      if (!args.profile_ids || args.profile_ids.length === 0) {
        throw new Error('profile_ids is required');
      }

      const body = {
        data: args.profile_ids.map((id) => ({ type: 'profile', id })),
      };

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'DELETE',
        path: `/lists/${args.list_id}/relationships/profiles`,
        body,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_create_campaign_values_report',
    'Create a campaign values report. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      payload: z.record(z.unknown()).describe('Report payload for /campaign-values-reports'),
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
        method: 'POST',
        path: '/campaign-values-reports',
        body: args.payload as Record<string, unknown>,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_create_flow_values_report',
    'Create a flow values report. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      payload: z.record(z.unknown()).describe('Report payload for /flow-values-reports'),
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
        method: 'POST',
        path: '/flow-values-reports',
        body: args.payload as Record<string, unknown>,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_create_flow_series_report',
    'Create a flow series report. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      payload: z.record(z.unknown()).describe('Report payload for /flow-series-reports'),
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
        method: 'POST',
        path: '/flow-series-reports',
        body: args.payload as Record<string, unknown>,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_create_form_values_report',
    'Create a form values report. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      payload: z.record(z.unknown()).describe('Report payload for /form-values-reports'),
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
        method: 'POST',
        path: '/form-values-reports',
        body: args.payload as Record<string, unknown>,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_create_form_series_report',
    'Create a form series report. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      payload: z.record(z.unknown()).describe('Report payload for /form-series-reports'),
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
        method: 'POST',
        path: '/form-series-reports',
        body: args.payload as Record<string, unknown>,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_create_segment_values_report',
    'Create a segment values report. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      payload: z.record(z.unknown()).describe('Report payload for /segment-values-reports'),
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
        method: 'POST',
        path: '/segment-values-reports',
        body: args.payload as Record<string, unknown>,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_create_segment_series_report',
    'Create a segment series report. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      payload: z.record(z.unknown()).describe('Report payload for /segment-series-reports'),
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
        method: 'POST',
        path: '/segment-series-reports',
        body: args.payload as Record<string, unknown>,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );
}
