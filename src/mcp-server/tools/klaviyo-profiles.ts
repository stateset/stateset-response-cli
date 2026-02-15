import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { KlaviyoConfig } from '../../integrations/config.js';
import { stringifyToolResult } from './output.js';
import {
  type KlaviyoToolOptions,
  buildQuery,
  runKlaviyoRequest,
  writeNotAllowed,
  buildProfileData,
  buildJsonApiPayload,
} from './klaviyo-common.js';

export function registerKlaviyoProfileTools(
  server: McpServer,
  klaviyo: KlaviyoConfig,
  options: KlaviyoToolOptions,
) {
  server.tool(
    'klaviyo_list_profiles',
    'List Klaviyo profiles. Use filters (e.g., equals(email,"foo@bar.com")).',
    {
      limit: z.number().min(1).max(250).optional().describe('Page size (page[size])'),
      cursor: z.string().optional().describe('Cursor for pagination (page[cursor])'),
      filter: z
        .string()
        .optional()
        .describe('Filter expression (e.g., equals(email,"foo@bar.com"))'),
      sort: z.string().optional().describe('Sort expression (e.g., -updated)'),
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
      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'GET',
        path: '/profiles',
        query: buildQuery(args, 'profile'),
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_create_or_update_profile',
    'Create or update a Klaviyo profile (profile-import endpoint). Requires --apply or STATESET_ALLOW_APPLY.',
    {
      profile_id: z.string().optional().describe('Optional profile ID to update'),
      attributes: z
        .record(z.unknown())
        .describe('Profile attributes (email, phone_number, first_name, last_name, etc.)'),
      properties: z
        .record(z.unknown())
        .optional()
        .describe('Optional profile properties (merged if attributes.properties is not set)'),
      fields: z.string().optional().describe('Fields to return (fields[profile])'),
      additional_fields: z
        .string()
        .optional()
        .describe('Additional fields (additional-fields[profile])'),
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

      const query = buildQuery(
        {
          fields: args.fields as string | undefined,
          additional_fields: args.additional_fields as string | undefined,
        },
        'profile',
      );

      const body = {
        data: buildProfileData({
          profile_id: args.profile_id as string | undefined,
          attributes: args.attributes as Record<string, unknown>,
          properties: args.properties as Record<string, unknown> | undefined,
        }),
      };

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'POST',
        path: '/profile-import',
        query,
        body,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_update_profile',
    'Update a Klaviyo profile by ID. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      profile_id: z.string().describe('Klaviyo profile ID'),
      attributes: z.record(z.unknown()).describe('Profile attributes to update'),
      properties: z
        .record(z.unknown())
        .optional()
        .describe('Optional profile properties (merged if attributes.properties is not set)'),
      fields: z.string().optional().describe('Fields to return (fields[profile])'),
      additional_fields: z
        .string()
        .optional()
        .describe('Additional fields (additional-fields[profile])'),
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

      const query = buildQuery(
        {
          fields: args.fields as string | undefined,
          additional_fields: args.additional_fields as string | undefined,
        },
        'profile',
      );

      const body = {
        data: buildProfileData({
          profile_id: args.profile_id as string,
          attributes: args.attributes as Record<string, unknown>,
          properties: args.properties as Record<string, unknown> | undefined,
        }),
      };

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'PATCH',
        path: `/profiles/${args.profile_id}`,
        query,
        body,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_get_profile',
    'Get a Klaviyo profile by ID.',
    {
      profile_id: z.string().describe('Klaviyo profile ID'),
      fields: z.string().optional().describe('Fields to return (fields[profile])'),
      additional_fields: z
        .string()
        .optional()
        .describe('Additional fields (additional-fields[profile])'),
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
        'profile',
      );

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'GET',
        path: `/profiles/${args.profile_id}`,
        query,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_create_profile',
    'Create a Klaviyo profile. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      attributes: z.record(z.unknown()).describe('Profile attributes payload'),
      relationships: z.record(z.unknown()).optional().describe('Optional profile relationships'),
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
        type: 'profile',
        attributes: args.attributes as Record<string, unknown>,
        relationships: args.relationships as Record<string, unknown> | undefined,
      });

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'POST',
        path: '/profiles',
        body,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_merge_profiles',
    'Merge Klaviyo profiles. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      payload: z.record(z.unknown()).describe('Merge payload for /profile-merge'),
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
        path: '/profile-merge',
        body: args.payload as Record<string, unknown>,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_list_profile_import_jobs',
    'List profile bulk import jobs.',
    {
      limit: z.number().min(1).max(250).optional().describe('Page size (page[size])'),
      cursor: z.string().optional().describe('Cursor for pagination (page[cursor])'),
      filter: z.string().optional().describe('Filter expression'),
      sort: z.string().optional().describe('Sort expression'),
      fields: z.string().optional().describe('Fields to return (fields[profile-bulk-import-job])'),
      additional_fields: z
        .string()
        .optional()
        .describe('Additional fields (additional-fields[profile-bulk-import-job])'),
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
        path: '/profile-bulk-import-jobs',
        query: buildQuery(args, 'profile-bulk-import-job'),
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_get_profile_import_job',
    'Get a profile bulk import job by ID.',
    {
      job_id: z.string().describe('Profile bulk import job ID'),
      fields: z.string().optional().describe('Fields to return (fields[profile-bulk-import-job])'),
      additional_fields: z
        .string()
        .optional()
        .describe('Additional fields (additional-fields[profile-bulk-import-job])'),
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
        'profile-bulk-import-job',
      );

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'GET',
        path: `/profile-bulk-import-jobs/${args.job_id}`,
        query,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_create_profile_import_job',
    'Create a profile bulk import job. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      job: z.record(z.unknown()).describe('Job payload for profile-bulk-import-jobs'),
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
        path: '/profile-bulk-import-jobs',
        body: args.job as Record<string, unknown>,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_get_profile_import_job_profiles',
    'List profiles for a profile bulk import job.',
    {
      job_id: z.string().describe('Profile bulk import job ID'),
      limit: z.number().min(1).max(250).optional().describe('Page size (page[size])'),
      cursor: z.string().optional().describe('Cursor for pagination (page[cursor])'),
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
      const query = buildQuery(
        {
          limit: args.limit as number | undefined,
          cursor: args.cursor as string | undefined,
          fields: args.fields as string | undefined,
          additional_fields: args.additional_fields as string | undefined,
          query: args.query as Record<string, string | number | boolean> | undefined,
        },
        'profile',
      );

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'GET',
        path: `/profile-bulk-import-jobs/${args.job_id}/profiles`,
        query,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_get_profile_import_job_errors',
    'List errors for a profile bulk import job.',
    {
      job_id: z.string().describe('Profile bulk import job ID'),
      limit: z.number().min(1).max(250).optional().describe('Page size (page[size])'),
      cursor: z.string().optional().describe('Cursor for pagination (page[cursor])'),
      fields: z.string().optional().describe('Fields to return (fields[error])'),
      additional_fields: z
        .string()
        .optional()
        .describe('Additional fields (additional-fields[error])'),
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
      const query = buildQuery(
        {
          limit: args.limit as number | undefined,
          cursor: args.cursor as string | undefined,
          fields: args.fields as string | undefined,
          additional_fields: args.additional_fields as string | undefined,
          query: args.query as Record<string, string | number | boolean> | undefined,
        },
        'error',
      );

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'GET',
        path: `/profile-bulk-import-jobs/${args.job_id}/errors`,
        query,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_create_data_privacy_deletion_job',
    'Create a data privacy deletion job. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      job: z.record(z.unknown()).describe('Job payload for data-privacy-deletion-jobs'),
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
        path: '/data-privacy-deletion-jobs',
        body: args.job as Record<string, unknown>,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_list_push_tokens',
    'List Klaviyo push tokens.',
    {
      limit: z.number().min(1).max(250).optional().describe('Page size (page[size])'),
      cursor: z.string().optional().describe('Cursor for pagination (page[cursor])'),
      filter: z.string().optional().describe('Filter expression'),
      sort: z.string().optional().describe('Sort expression'),
      fields: z.string().optional().describe('Fields to return (fields[push-token])'),
      additional_fields: z
        .string()
        .optional()
        .describe('Additional fields (additional-fields[push-token])'),
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
        path: '/push-tokens',
        query: buildQuery(args, 'push-token'),
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_get_push_token',
    'Get a Klaviyo push token by ID.',
    {
      push_token_id: z.string().describe('Klaviyo push token ID'),
      fields: z.string().optional().describe('Fields to return (fields[push-token])'),
      additional_fields: z
        .string()
        .optional()
        .describe('Additional fields (additional-fields[push-token])'),
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
        'push-token',
      );

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'GET',
        path: `/push-tokens/${args.push_token_id}`,
        query,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_create_push_token',
    'Create a Klaviyo push token. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      attributes: z.record(z.unknown()).describe('Push token attributes payload'),
      relationships: z.record(z.unknown()).optional().describe('Optional push token relationships'),
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
        type: 'push-token',
        attributes: args.attributes as Record<string, unknown>,
        relationships: args.relationships as Record<string, unknown> | undefined,
      });

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'POST',
        path: '/push-tokens',
        body,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_update_push_token',
    'Update a Klaviyo push token. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      push_token_id: z.string().describe('Klaviyo push token ID'),
      attributes: z.record(z.unknown()).optional().describe('Push token attributes to update'),
      relationships: z.record(z.unknown()).optional().describe('Optional push token relationships'),
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
        type: 'push-token',
        id: args.push_token_id as string,
        attributes: args.attributes as Record<string, unknown> | undefined,
        relationships: args.relationships as Record<string, unknown> | undefined,
      });

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'PATCH',
        path: `/push-tokens/${args.push_token_id}`,
        body,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_delete_push_token',
    'Delete a Klaviyo push token. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      push_token_id: z.string().describe('Klaviyo push token ID'),
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
        path: `/push-tokens/${args.push_token_id}`,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );
}
