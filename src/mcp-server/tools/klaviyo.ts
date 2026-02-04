import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { KlaviyoConfig } from '../../integrations/config.js';
import { klaviyoRequest, klaviyoUploadImageFromFile } from '../../integrations/klaviyo.js';
import { redactPii } from '../../integrations/redact.js';
import { stringifyToolResult } from './output.js';

export interface KlaviyoToolOptions {
  allowApply: boolean;
  redact: boolean;
}

interface ListArgs {
  limit?: number;
  cursor?: string;
  filter?: string;
  sort?: string;
  fields?: string;
  additional_fields?: string;
  query?: Record<string, string | number | boolean>;
}

function buildQuery(args: ListArgs, resource: string): Record<string, string | number | boolean> | undefined {
  const query: Record<string, string | number | boolean> = {
    ...(args.query || {}),
  };
  if (args.limit !== undefined) query['page[size]'] = args.limit;
  if (args.cursor) query['page[cursor]'] = args.cursor;
  if (args.filter) query['filter'] = args.filter;
  if (args.sort) query['sort'] = args.sort;
  if (args.fields) query[`fields[${resource}]`] = args.fields;
  if (args.additional_fields) query[`additional-fields[${resource}]`] = args.additional_fields;

  return Object.keys(query).length > 0 ? query : undefined;
}

async function runKlaviyoRequest(
  klaviyo: KlaviyoConfig,
  options: KlaviyoToolOptions,
  args: {
    method: string;
    path: string;
    query?: Record<string, string | number | boolean>;
    body?: Record<string, unknown>;
    revision?: string;
  }
) {
  const response = await klaviyoRequest({
    klaviyo,
    method: args.method,
    path: args.path,
    query: args.query,
    body: args.body,
    revision: args.revision,
  });

  const data = options.redact ? redactPii(response.data) : response.data;
  return { status: response.status, data };
}

function writeNotAllowed() {
  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        error: 'Write operation not allowed. The --apply flag or STATESET_ALLOW_APPLY must be set.',
        hint: 'Use GET requests when writes are disabled.',
      }, null, 2),
    }],
  };
}

function buildProfileAttributes(attributes: Record<string, unknown>, properties?: Record<string, unknown>) {
  const payload = { ...attributes } as Record<string, unknown>;
  if (properties && payload.properties === undefined) {
    payload.properties = properties;
  }
  return payload;
}

function buildProfileData(args: { profile_id?: string; attributes: Record<string, unknown>; properties?: Record<string, unknown> }) {
  const data: Record<string, unknown> = {
    type: 'profile',
    attributes: buildProfileAttributes(args.attributes, args.properties),
  };
  if (args.profile_id) data.id = args.profile_id;
  return data;
}

function buildJsonApiData(args: { type: string; id?: string; attributes?: Record<string, unknown>; relationships?: Record<string, unknown> }) {
  const data: Record<string, unknown> = {
    type: args.type,
  };
  if (args.id) data.id = args.id;
  if (args.attributes && Object.keys(args.attributes).length > 0) {
    data.attributes = args.attributes;
  }
  if (args.relationships && Object.keys(args.relationships).length > 0) {
    data.relationships = args.relationships;
  }
  return data;
}

function buildJsonApiPayload(args: { type: string; id?: string; attributes?: Record<string, unknown>; relationships?: Record<string, unknown> }) {
  return { data: buildJsonApiData(args) };
}

function buildRelationshipPayload(resourceType: string, ids: string[]) {
  return {
    data: ids.map((id) => ({ type: resourceType, id })),
  };
}

export function registerKlaviyoTools(server: McpServer, klaviyo: KlaviyoConfig, options: KlaviyoToolOptions) {
  server.tool(
    'klaviyo_list_profiles',
    'List Klaviyo profiles. Use filters (e.g., equals(email,"foo@bar.com")).',
    {
      limit: z.number().min(1).max(250).optional().describe('Page size (page[size])'),
      cursor: z.string().optional().describe('Cursor for pagination (page[cursor])'),
      filter: z.string().optional().describe('Filter expression (e.g., equals(email,"foo@bar.com"))'),
      sort: z.string().optional().describe('Sort expression (e.g., -updated)'),
      fields: z.string().optional().describe('Fields to return (fields[profile])'),
      additional_fields: z.string().optional().describe('Additional fields (additional-fields[profile])'),
      query: z.record(z.union([z.string(), z.number(), z.boolean()])).optional().describe('Additional query parameters'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
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
    }
  );

  server.tool(
    'klaviyo_create_or_update_profile',
    'Create or update a Klaviyo profile (profile-import endpoint). Requires --apply or STATESET_ALLOW_APPLY.',
    {
      profile_id: z.string().optional().describe('Optional profile ID to update'),
      attributes: z.record(z.any()).describe('Profile attributes (email, phone_number, first_name, last_name, etc.)'),
      properties: z.record(z.any()).optional().describe('Optional profile properties (merged if attributes.properties is not set)'),
      fields: z.string().optional().describe('Fields to return (fields[profile])'),
      additional_fields: z.string().optional().describe('Additional fields (additional-fields[profile])'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      if (!options.allowApply) return writeNotAllowed();

      const query = buildQuery({
        fields: args.fields as string | undefined,
        additional_fields: args.additional_fields as string | undefined,
      }, 'profile');

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
    }
  );

  server.tool(
    'klaviyo_update_profile',
    'Update a Klaviyo profile by ID. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      profile_id: z.string().describe('Klaviyo profile ID'),
      attributes: z.record(z.any()).describe('Profile attributes to update'),
      properties: z.record(z.any()).optional().describe('Optional profile properties (merged if attributes.properties is not set)'),
      fields: z.string().optional().describe('Fields to return (fields[profile])'),
      additional_fields: z.string().optional().describe('Additional fields (additional-fields[profile])'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      if (!options.allowApply) return writeNotAllowed();

      const query = buildQuery({
        fields: args.fields as string | undefined,
        additional_fields: args.additional_fields as string | undefined,
      }, 'profile');

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
    }
  );

  server.tool(
    'klaviyo_get_profile',
    'Get a Klaviyo profile by ID.',
    {
      profile_id: z.string().describe('Klaviyo profile ID'),
      fields: z.string().optional().describe('Fields to return (fields[profile])'),
      additional_fields: z.string().optional().describe('Additional fields (additional-fields[profile])'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      const query = buildQuery({
        fields: args.fields as string | undefined,
        additional_fields: args.additional_fields as string | undefined,
      }, 'profile');

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'GET',
        path: `/profiles/${args.profile_id}`,
        query,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'klaviyo_create_profile',
    'Create a Klaviyo profile. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      attributes: z.record(z.any()).describe('Profile attributes payload'),
      relationships: z.record(z.any()).optional().describe('Optional profile relationships'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
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
    }
  );

  server.tool(
    'klaviyo_merge_profiles',
    'Merge Klaviyo profiles. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      payload: z.record(z.any()).describe('Merge payload for /profile-merge'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
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
    }
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
      additional_fields: z.string().optional().describe('Additional fields (additional-fields[profile-bulk-import-job])'),
      query: z.record(z.union([z.string(), z.number(), z.boolean()])).optional().describe('Additional query parameters'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
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
    }
  );

  server.tool(
    'klaviyo_get_profile_import_job',
    'Get a profile bulk import job by ID.',
    {
      job_id: z.string().describe('Profile bulk import job ID'),
      fields: z.string().optional().describe('Fields to return (fields[profile-bulk-import-job])'),
      additional_fields: z.string().optional().describe('Additional fields (additional-fields[profile-bulk-import-job])'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      const query = buildQuery({
        fields: args.fields as string | undefined,
        additional_fields: args.additional_fields as string | undefined,
      }, 'profile-bulk-import-job');

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'GET',
        path: `/profile-bulk-import-jobs/${args.job_id}`,
        query,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'klaviyo_create_profile_import_job',
    'Create a profile bulk import job. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      job: z.record(z.any()).describe('Job payload for profile-bulk-import-jobs'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
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
    }
  );

  server.tool(
    'klaviyo_get_profile_import_job_profiles',
    'List profiles for a profile bulk import job.',
    {
      job_id: z.string().describe('Profile bulk import job ID'),
      limit: z.number().min(1).max(250).optional().describe('Page size (page[size])'),
      cursor: z.string().optional().describe('Cursor for pagination (page[cursor])'),
      fields: z.string().optional().describe('Fields to return (fields[profile])'),
      additional_fields: z.string().optional().describe('Additional fields (additional-fields[profile])'),
      query: z.record(z.union([z.string(), z.number(), z.boolean()])).optional().describe('Additional query parameters'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      const query = buildQuery({
        limit: args.limit as number | undefined,
        cursor: args.cursor as string | undefined,
        fields: args.fields as string | undefined,
        additional_fields: args.additional_fields as string | undefined,
        query: args.query as Record<string, string | number | boolean> | undefined,
      }, 'profile');

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'GET',
        path: `/profile-bulk-import-jobs/${args.job_id}/profiles`,
        query,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'klaviyo_get_profile_import_job_errors',
    'List errors for a profile bulk import job.',
    {
      job_id: z.string().describe('Profile bulk import job ID'),
      limit: z.number().min(1).max(250).optional().describe('Page size (page[size])'),
      cursor: z.string().optional().describe('Cursor for pagination (page[cursor])'),
      fields: z.string().optional().describe('Fields to return (fields[error])'),
      additional_fields: z.string().optional().describe('Additional fields (additional-fields[error])'),
      query: z.record(z.union([z.string(), z.number(), z.boolean()])).optional().describe('Additional query parameters'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      const query = buildQuery({
        limit: args.limit as number | undefined,
        cursor: args.cursor as string | undefined,
        fields: args.fields as string | undefined,
        additional_fields: args.additional_fields as string | undefined,
        query: args.query as Record<string, string | number | boolean> | undefined,
      }, 'error');

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'GET',
        path: `/profile-bulk-import-jobs/${args.job_id}/errors`,
        query,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'klaviyo_create_data_privacy_deletion_job',
    'Create a data privacy deletion job. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      job: z.record(z.any()).describe('Job payload for data-privacy-deletion-jobs'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
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
    }
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
      additional_fields: z.string().optional().describe('Additional fields (additional-fields[push-token])'),
      query: z.record(z.union([z.string(), z.number(), z.boolean()])).optional().describe('Additional query parameters'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
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
    }
  );

  server.tool(
    'klaviyo_get_push_token',
    'Get a Klaviyo push token by ID.',
    {
      push_token_id: z.string().describe('Klaviyo push token ID'),
      fields: z.string().optional().describe('Fields to return (fields[push-token])'),
      additional_fields: z.string().optional().describe('Additional fields (additional-fields[push-token])'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      const query = buildQuery({
        fields: args.fields as string | undefined,
        additional_fields: args.additional_fields as string | undefined,
      }, 'push-token');

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'GET',
        path: `/push-tokens/${args.push_token_id}`,
        query,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'klaviyo_create_push_token',
    'Create a Klaviyo push token. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      attributes: z.record(z.any()).describe('Push token attributes payload'),
      relationships: z.record(z.any()).optional().describe('Optional push token relationships'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
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
    }
  );

  server.tool(
    'klaviyo_update_push_token',
    'Update a Klaviyo push token. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      push_token_id: z.string().describe('Klaviyo push token ID'),
      attributes: z.record(z.any()).optional().describe('Push token attributes to update'),
      relationships: z.record(z.any()).optional().describe('Optional push token relationships'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
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
    }
  );

  server.tool(
    'klaviyo_delete_push_token',
    'Delete a Klaviyo push token. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      push_token_id: z.string().describe('Klaviyo push token ID'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
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
    }
  );

  server.tool(
    'klaviyo_list_lists',
    'List Klaviyo lists.',
    {
      limit: z.number().min(1).max(250).optional().describe('Page size (page[size])'),
      cursor: z.string().optional().describe('Cursor for pagination (page[cursor])'),
      filter: z.string().optional().describe('Filter expression'),
      sort: z.string().optional().describe('Sort expression'),
      fields: z.string().optional().describe('Fields to return (fields[list])'),
      additional_fields: z.string().optional().describe('Additional fields (additional-fields[list])'),
      query: z.record(z.union([z.string(), z.number(), z.boolean()])).optional().describe('Additional query parameters'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
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
    }
  );

  server.tool(
    'klaviyo_get_list',
    'Get a Klaviyo list by ID.',
    {
      list_id: z.string().describe('Klaviyo list ID'),
      fields: z.string().optional().describe('Fields to return (fields[list])'),
      additional_fields: z.string().optional().describe('Additional fields (additional-fields[list])'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      const query = buildQuery({
        fields: args.fields as string | undefined,
        additional_fields: args.additional_fields as string | undefined,
      }, 'list');

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'GET',
        path: `/lists/${args.list_id}`,
        query,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'klaviyo_create_list',
    'Create a Klaviyo list. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      attributes: z.record(z.any()).describe('List attributes payload'),
      relationships: z.record(z.any()).optional().describe('Optional list relationships'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
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
    }
  );

  server.tool(
    'klaviyo_update_list',
    'Update a Klaviyo list. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      list_id: z.string().describe('Klaviyo list ID'),
      attributes: z.record(z.any()).optional().describe('List attributes to update'),
      relationships: z.record(z.any()).optional().describe('Optional list relationships'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
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
    }
  );

  server.tool(
    'klaviyo_delete_list',
    'Delete a Klaviyo list. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      list_id: z.string().describe('Klaviyo list ID'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
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
    }
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
      additional_fields: z.string().optional().describe('Additional fields (additional-fields[profile])'),
      query: z.record(z.union([z.string(), z.number(), z.boolean()])).optional().describe('Additional query parameters'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
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
    }
  );

  server.tool(
    'klaviyo_get_list_profile_ids',
    'Get profile IDs for a Klaviyo list.',
    {
      list_id: z.string().describe('Klaviyo list ID'),
      limit: z.number().min(1).max(250).optional().describe('Page size (page[size])'),
      cursor: z.string().optional().describe('Cursor for pagination (page[cursor])'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
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
    }
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
      additional_fields: z.string().optional().describe('Additional fields (additional-fields[segment])'),
      query: z.record(z.union([z.string(), z.number(), z.boolean()])).optional().describe('Additional query parameters'),
      revision: z.string().optional().describe('Override Klaviyo revision header (beta may require .pre)'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
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
    }
  );

  server.tool(
    'klaviyo_get_segment',
    'Get a Klaviyo segment by ID (may require beta revision).',
    {
      segment_id: z.string().describe('Klaviyo segment ID'),
      fields: z.string().optional().describe('Fields to return (fields[segment])'),
      additional_fields: z.string().optional().describe('Additional fields (additional-fields[segment])'),
      revision: z.string().optional().describe('Override Klaviyo revision header (beta may require .pre)'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      const query = buildQuery({
        fields: args.fields as string | undefined,
        additional_fields: args.additional_fields as string | undefined,
      }, 'segment');

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'GET',
        path: `/segments/${args.segment_id}`,
        query,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'klaviyo_create_segment',
    'Create a Klaviyo segment (may require beta revision). Requires --apply or STATESET_ALLOW_APPLY.',
    {
      attributes: z.record(z.any()).describe('Segment attributes payload'),
      relationships: z.record(z.any()).optional().describe('Optional segment relationships'),
      revision: z.string().optional().describe('Override Klaviyo revision header (beta may require .pre)'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
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
    }
  );

  server.tool(
    'klaviyo_update_segment',
    'Update a Klaviyo segment (may require beta revision). Requires --apply or STATESET_ALLOW_APPLY.',
    {
      segment_id: z.string().describe('Klaviyo segment ID'),
      attributes: z.record(z.any()).optional().describe('Segment attributes to update'),
      relationships: z.record(z.any()).optional().describe('Optional segment relationships'),
      revision: z.string().optional().describe('Override Klaviyo revision header (beta may require .pre)'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
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
    }
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
      additional_fields: z.string().optional().describe('Additional fields (additional-fields[profile])'),
      query: z.record(z.union([z.string(), z.number(), z.boolean()])).optional().describe('Additional query parameters'),
      revision: z.string().optional().describe('Override Klaviyo revision header (beta may require .pre)'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
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
    }
  );

  server.tool(
    'klaviyo_get_segment_profile_ids',
    'Get profile IDs for a Klaviyo segment (may require beta revision).',
    {
      segment_id: z.string().describe('Klaviyo segment ID'),
      limit: z.number().min(1).max(250).optional().describe('Page size (page[size])'),
      cursor: z.string().optional().describe('Cursor for pagination (page[cursor])'),
      revision: z.string().optional().describe('Override Klaviyo revision header (beta may require .pre)'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
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
    }
  );

  server.tool(
    'klaviyo_list_tags',
    'List Klaviyo tags.',
    {
      limit: z.number().min(1).max(250).optional().describe('Page size (page[size])'),
      cursor: z.string().optional().describe('Cursor for pagination (page[cursor])'),
      filter: z.string().optional().describe('Filter expression'),
      sort: z.string().optional().describe('Sort expression'),
      fields: z.string().optional().describe('Fields to return (fields[tag])'),
      additional_fields: z.string().optional().describe('Additional fields (additional-fields[tag])'),
      query: z.record(z.union([z.string(), z.number(), z.boolean()])).optional().describe('Additional query parameters'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
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
    }
  );

  server.tool(
    'klaviyo_get_tag',
    'Get a Klaviyo tag by ID.',
    {
      tag_id: z.string().describe('Klaviyo tag ID'),
      fields: z.string().optional().describe('Fields to return (fields[tag])'),
      additional_fields: z.string().optional().describe('Additional fields (additional-fields[tag])'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      const query = buildQuery({
        fields: args.fields as string | undefined,
        additional_fields: args.additional_fields as string | undefined,
      }, 'tag');

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'GET',
        path: `/tags/${args.tag_id}`,
        query,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'klaviyo_create_tag',
    'Create a Klaviyo tag. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      attributes: z.record(z.any()).describe('Tag attributes payload'),
      relationships: z.record(z.any()).optional().describe('Optional tag relationships'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
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
    }
  );

  server.tool(
    'klaviyo_update_tag',
    'Update a Klaviyo tag. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      tag_id: z.string().describe('Klaviyo tag ID'),
      attributes: z.record(z.any()).optional().describe('Tag attributes to update'),
      relationships: z.record(z.any()).optional().describe('Optional tag relationships'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
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
    }
  );

  server.tool(
    'klaviyo_delete_tag',
    'Delete a Klaviyo tag. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      tag_id: z.string().describe('Klaviyo tag ID'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
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
    }
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
      additional_fields: z.string().optional().describe('Additional fields (additional-fields[tag-group])'),
      query: z.record(z.union([z.string(), z.number(), z.boolean()])).optional().describe('Additional query parameters'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
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
    }
  );

  server.tool(
    'klaviyo_get_tag_group',
    'Get a Klaviyo tag group by ID.',
    {
      tag_group_id: z.string().describe('Klaviyo tag group ID'),
      fields: z.string().optional().describe('Fields to return (fields[tag-group])'),
      additional_fields: z.string().optional().describe('Additional fields (additional-fields[tag-group])'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      const query = buildQuery({
        fields: args.fields as string | undefined,
        additional_fields: args.additional_fields as string | undefined,
      }, 'tag-group');

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'GET',
        path: `/tag-groups/${args.tag_group_id}`,
        query,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'klaviyo_create_tag_group',
    'Create a Klaviyo tag group. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      attributes: z.record(z.any()).describe('Tag group attributes payload'),
      relationships: z.record(z.any()).optional().describe('Optional tag group relationships'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
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
    }
  );

  server.tool(
    'klaviyo_update_tag_group',
    'Update a Klaviyo tag group. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      tag_group_id: z.string().describe('Klaviyo tag group ID'),
      attributes: z.record(z.any()).optional().describe('Tag group attributes to update'),
      relationships: z.record(z.any()).optional().describe('Optional tag group relationships'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
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
    }
  );

  server.tool(
    'klaviyo_delete_tag_group',
    'Delete a Klaviyo tag group. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      tag_group_id: z.string().describe('Klaviyo tag group ID'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
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
    }
  );

  server.tool(
    'klaviyo_get_tag_flows',
    'Get flow IDs tagged with a Klaviyo tag.',
    {
      tag_id: z.string().describe('Klaviyo tag ID'),
      limit: z.number().min(1).max(250).optional().describe('Page size (page[size])'),
      cursor: z.string().optional().describe('Cursor for pagination (page[cursor])'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
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
    }
  );

  server.tool(
    'klaviyo_add_tag_flows',
    'Tag flows with a Klaviyo tag. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      tag_id: z.string().describe('Klaviyo tag ID'),
      flow_ids: z.array(z.string()).min(1).describe('Flow IDs to tag'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
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
    }
  );

  server.tool(
    'klaviyo_remove_tag_flows',
    'Remove flows from a Klaviyo tag. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      tag_id: z.string().describe('Klaviyo tag ID'),
      flow_ids: z.array(z.string()).min(1).describe('Flow IDs to untag'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
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
    }
  );

  server.tool(
    'klaviyo_get_tag_campaigns',
    'Get campaign IDs tagged with a Klaviyo tag.',
    {
      tag_id: z.string().describe('Klaviyo tag ID'),
      limit: z.number().min(1).max(250).optional().describe('Page size (page[size])'),
      cursor: z.string().optional().describe('Cursor for pagination (page[cursor])'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
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
    }
  );

  server.tool(
    'klaviyo_add_tag_campaigns',
    'Tag campaigns with a Klaviyo tag. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      tag_id: z.string().describe('Klaviyo tag ID'),
      campaign_ids: z.array(z.string()).min(1).describe('Campaign IDs to tag'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
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
    }
  );

  server.tool(
    'klaviyo_remove_tag_campaigns',
    'Remove campaigns from a Klaviyo tag. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      tag_id: z.string().describe('Klaviyo tag ID'),
      campaign_ids: z.array(z.string()).min(1).describe('Campaign IDs to untag'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
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
    }
  );

  server.tool(
    'klaviyo_get_tag_lists',
    'Get list IDs tagged with a Klaviyo tag.',
    {
      tag_id: z.string().describe('Klaviyo tag ID'),
      limit: z.number().min(1).max(250).optional().describe('Page size (page[size])'),
      cursor: z.string().optional().describe('Cursor for pagination (page[cursor])'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
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
    }
  );

  server.tool(
    'klaviyo_add_tag_lists',
    'Tag lists with a Klaviyo tag. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      tag_id: z.string().describe('Klaviyo tag ID'),
      list_ids: z.array(z.string()).min(1).describe('List IDs to tag'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
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
    }
  );

  server.tool(
    'klaviyo_remove_tag_lists',
    'Remove lists from a Klaviyo tag. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      tag_id: z.string().describe('Klaviyo tag ID'),
      list_ids: z.array(z.string()).min(1).describe('List IDs to untag'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
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
    }
  );

  server.tool(
    'klaviyo_get_tag_segments',
    'Get segment IDs tagged with a Klaviyo tag.',
    {
      tag_id: z.string().describe('Klaviyo tag ID'),
      limit: z.number().min(1).max(250).optional().describe('Page size (page[size])'),
      cursor: z.string().optional().describe('Cursor for pagination (page[cursor])'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
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
    }
  );

  server.tool(
    'klaviyo_add_tag_segments',
    'Tag segments with a Klaviyo tag. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      tag_id: z.string().describe('Klaviyo tag ID'),
      segment_ids: z.array(z.string()).min(1).describe('Segment IDs to tag'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
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
    }
  );

  server.tool(
    'klaviyo_remove_tag_segments',
    'Remove segments from a Klaviyo tag. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      tag_id: z.string().describe('Klaviyo tag ID'),
      segment_ids: z.array(z.string()).min(1).describe('Segment IDs to untag'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
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
    }
  );

  server.tool(
    'klaviyo_subscribe_profiles_job',
    'Create a bulk subscribe profiles job. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      job: z.record(z.any()).describe('Job payload for profile-subscription-bulk-create-jobs'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
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
    }
  );

  server.tool(
    'klaviyo_unsubscribe_profiles_job',
    'Create a bulk unsubscribe profiles job. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      job: z.record(z.any()).describe('Job payload for profile-subscription-bulk-delete-jobs'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
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
    }
  );

  server.tool(
    'klaviyo_suppress_profiles_job',
    'Create a bulk suppress profiles job. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      job: z.record(z.any()).describe('Job payload for profile-suppression-bulk-create-jobs'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
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
    }
  );

  server.tool(
    'klaviyo_unsuppress_profiles_job',
    'Create a bulk unsuppress profiles job. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      job: z.record(z.any()).describe('Job payload for profile-suppression-bulk-delete-jobs'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
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
    }
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
      additional_fields: z.string().optional().describe('Additional fields (additional-fields[campaign])'),
      query: z.record(z.union([z.string(), z.number(), z.boolean()])).optional().describe('Additional query parameters'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
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
    }
  );

  server.tool(
    'klaviyo_get_campaign',
    'Get a Klaviyo campaign by ID.',
    {
      campaign_id: z.string().describe('Klaviyo campaign ID'),
      fields: z.string().optional().describe('Fields to return (fields[campaign])'),
      additional_fields: z.string().optional().describe('Additional fields (additional-fields[campaign])'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      const query = buildQuery({
        fields: args.fields as string | undefined,
        additional_fields: args.additional_fields as string | undefined,
      }, 'campaign');

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'GET',
        path: `/campaigns/${args.campaign_id}`,
        query,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'klaviyo_create_campaign',
    'Create a Klaviyo campaign. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      attributes: z.record(z.any()).describe('Campaign attributes payload'),
      relationships: z.record(z.any()).optional().describe('Optional campaign relationships'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
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
    }
  );

  server.tool(
    'klaviyo_update_campaign',
    'Update a Klaviyo campaign. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      campaign_id: z.string().describe('Klaviyo campaign ID'),
      attributes: z.record(z.any()).optional().describe('Campaign attributes to update'),
      relationships: z.record(z.any()).optional().describe('Optional campaign relationships'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
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
    }
  );

  server.tool(
    'klaviyo_delete_campaign',
    'Delete a Klaviyo campaign. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      campaign_id: z.string().describe('Klaviyo campaign ID'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
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
    }
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
      additional_fields: z.string().optional().describe('Additional fields (additional-fields[flow])'),
      query: z.record(z.union([z.string(), z.number(), z.boolean()])).optional().describe('Additional query parameters'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
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
    }
  );

  server.tool(
    'klaviyo_get_flow',
    'Get a Klaviyo flow by ID.',
    {
      flow_id: z.string().describe('Klaviyo flow ID'),
      fields: z.string().optional().describe('Fields to return (fields[flow])'),
      additional_fields: z.string().optional().describe('Additional fields (additional-fields[flow])'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      const query = buildQuery({
        fields: args.fields as string | undefined,
        additional_fields: args.additional_fields as string | undefined,
      }, 'flow');

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'GET',
        path: `/flows/${args.flow_id}`,
        query,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'klaviyo_create_flow',
    'Create a Klaviyo flow. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      attributes: z.record(z.any()).describe('Flow attributes payload'),
      relationships: z.record(z.any()).optional().describe('Optional flow relationships'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
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
    }
  );

  server.tool(
    'klaviyo_update_flow',
    'Update a Klaviyo flow. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      flow_id: z.string().describe('Klaviyo flow ID'),
      attributes: z.record(z.any()).optional().describe('Flow attributes to update'),
      relationships: z.record(z.any()).optional().describe('Optional flow relationships'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
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
    }
  );

  server.tool(
    'klaviyo_delete_flow',
    'Delete a Klaviyo flow. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      flow_id: z.string().describe('Klaviyo flow ID'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
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
    }
  );

  server.tool(
    'klaviyo_list_templates',
    'List Klaviyo templates.',
    {
      limit: z.number().min(1).max(250).optional().describe('Page size (page[size])'),
      cursor: z.string().optional().describe('Cursor for pagination (page[cursor])'),
      filter: z.string().optional().describe('Filter expression'),
      sort: z.string().optional().describe('Sort expression'),
      fields: z.string().optional().describe('Fields to return (fields[template])'),
      additional_fields: z.string().optional().describe('Additional fields (additional-fields[template])'),
      query: z.record(z.union([z.string(), z.number(), z.boolean()])).optional().describe('Additional query parameters'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'GET',
        path: '/templates',
        query: buildQuery(args, 'template'),
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'klaviyo_get_template',
    'Get a Klaviyo template by ID.',
    {
      template_id: z.string().describe('Klaviyo template ID'),
      fields: z.string().optional().describe('Fields to return (fields[template])'),
      additional_fields: z.string().optional().describe('Additional fields (additional-fields[template])'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      const query = buildQuery({
        fields: args.fields as string | undefined,
        additional_fields: args.additional_fields as string | undefined,
      }, 'template');

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'GET',
        path: `/templates/${args.template_id}`,
        query,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'klaviyo_create_template',
    'Create a Klaviyo template. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      attributes: z.record(z.any()).describe('Template attributes payload'),
      relationships: z.record(z.any()).optional().describe('Optional template relationships'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      if (!options.allowApply) return writeNotAllowed();

      const body = buildJsonApiPayload({
        type: 'template',
        attributes: args.attributes as Record<string, unknown>,
        relationships: args.relationships as Record<string, unknown> | undefined,
      });

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'POST',
        path: '/templates',
        body,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'klaviyo_update_template',
    'Update a Klaviyo template. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      template_id: z.string().describe('Klaviyo template ID'),
      attributes: z.record(z.any()).optional().describe('Template attributes to update'),
      relationships: z.record(z.any()).optional().describe('Optional template relationships'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      if (!options.allowApply) return writeNotAllowed();

      const body = buildJsonApiPayload({
        type: 'template',
        id: args.template_id as string,
        attributes: args.attributes as Record<string, unknown> | undefined,
        relationships: args.relationships as Record<string, unknown> | undefined,
      });

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'PATCH',
        path: `/templates/${args.template_id}`,
        body,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'klaviyo_delete_template',
    'Delete a Klaviyo template. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      template_id: z.string().describe('Klaviyo template ID'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      if (!options.allowApply) return writeNotAllowed();

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'DELETE',
        path: `/templates/${args.template_id}`,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'klaviyo_render_template',
    'Render a Klaviyo template. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      payload: z.record(z.any()).describe('Template render payload for /template-render'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      if (!options.allowApply) return writeNotAllowed();

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'POST',
        path: '/template-render',
        body: args.payload as Record<string, unknown>,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'klaviyo_clone_template',
    'Clone a Klaviyo template. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      payload: z.record(z.any()).describe('Template clone payload for /template-clone'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      if (!options.allowApply) return writeNotAllowed();

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'POST',
        path: '/template-clone',
        body: args.payload as Record<string, unknown>,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'klaviyo_list_forms',
    'List Klaviyo forms (may require beta revision).',
    {
      limit: z.number().min(1).max(250).optional().describe('Page size (page[size])'),
      cursor: z.string().optional().describe('Cursor for pagination (page[cursor])'),
      filter: z.string().optional().describe('Filter expression'),
      sort: z.string().optional().describe('Sort expression'),
      fields: z.string().optional().describe('Fields to return (fields[form])'),
      additional_fields: z.string().optional().describe('Additional fields (additional-fields[form])'),
      query: z.record(z.union([z.string(), z.number(), z.boolean()])).optional().describe('Additional query parameters'),
      revision: z.string().optional().describe('Override Klaviyo revision header (beta may require .pre)'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'GET',
        path: '/forms',
        query: buildQuery(args, 'form'),
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'klaviyo_get_form',
    'Get a Klaviyo form by ID (may require beta revision).',
    {
      form_id: z.string().describe('Klaviyo form ID'),
      fields: z.string().optional().describe('Fields to return (fields[form])'),
      additional_fields: z.string().optional().describe('Additional fields (additional-fields[form])'),
      revision: z.string().optional().describe('Override Klaviyo revision header (beta may require .pre)'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      const query = buildQuery({
        fields: args.fields as string | undefined,
        additional_fields: args.additional_fields as string | undefined,
      }, 'form');

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'GET',
        path: `/forms/${args.form_id}`,
        query,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'klaviyo_create_form',
    'Create a Klaviyo form (may require beta revision). Requires --apply or STATESET_ALLOW_APPLY.',
    {
      attributes: z.record(z.any()).describe('Form attributes payload'),
      relationships: z.record(z.any()).optional().describe('Optional form relationships'),
      revision: z.string().optional().describe('Override Klaviyo revision header (beta may require .pre)'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      if (!options.allowApply) return writeNotAllowed();

      const body = buildJsonApiPayload({
        type: 'form',
        attributes: args.attributes as Record<string, unknown>,
        relationships: args.relationships as Record<string, unknown> | undefined,
      });

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'POST',
        path: '/forms',
        body,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'klaviyo_delete_form',
    'Delete a Klaviyo form (may require beta revision). Requires --apply or STATESET_ALLOW_APPLY.',
    {
      form_id: z.string().describe('Klaviyo form ID'),
      revision: z.string().optional().describe('Override Klaviyo revision header (beta may require .pre)'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      if (!options.allowApply) return writeNotAllowed();

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'DELETE',
        path: `/forms/${args.form_id}`,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'klaviyo_list_images',
    'List Klaviyo images.',
    {
      limit: z.number().min(1).max(250).optional().describe('Page size (page[size])'),
      cursor: z.string().optional().describe('Cursor for pagination (page[cursor])'),
      filter: z.string().optional().describe('Filter expression'),
      sort: z.string().optional().describe('Sort expression'),
      fields: z.string().optional().describe('Fields to return (fields[image])'),
      additional_fields: z.string().optional().describe('Additional fields (additional-fields[image])'),
      query: z.record(z.union([z.string(), z.number(), z.boolean()])).optional().describe('Additional query parameters'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'GET',
        path: '/images',
        query: buildQuery(args, 'image'),
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'klaviyo_get_image',
    'Get a Klaviyo image by ID.',
    {
      image_id: z.string().describe('Klaviyo image ID'),
      fields: z.string().optional().describe('Fields to return (fields[image])'),
      additional_fields: z.string().optional().describe('Additional fields (additional-fields[image])'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      const query = buildQuery({
        fields: args.fields as string | undefined,
        additional_fields: args.additional_fields as string | undefined,
      }, 'image');

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'GET',
        path: `/images/${args.image_id}`,
        query,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'klaviyo_upload_image_from_url',
    'Upload a Klaviyo image from a URL. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      attributes: z.record(z.any()).describe('Image attributes payload (include import_from_url, name, etc.)'),
      relationships: z.record(z.any()).optional().describe('Optional image relationships'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      if (!options.allowApply) return writeNotAllowed();

      const body = buildJsonApiPayload({
        type: 'image',
        attributes: args.attributes as Record<string, unknown>,
        relationships: args.relationships as Record<string, unknown> | undefined,
      });

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'POST',
        path: '/images',
        body,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'klaviyo_upload_image_from_file',
    'Upload a Klaviyo image from a local file. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      file_path: z.string().describe('Local file path to upload'),
      file_field: z.string().optional().describe('Form field name for the file (default: file)'),
      filename: z.string().optional().describe('Filename to send (defaults to basename of file path)'),
      fields: z.record(z.union([z.string(), z.number(), z.boolean()])).optional().describe('Additional form fields (name, folder, etc.)'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      if (!options.allowApply) return writeNotAllowed();

      const result = await klaviyoUploadImageFromFile({
        klaviyo,
        filePath: args.file_path as string,
        fileField: args.file_field as string | undefined,
        filename: args.filename as string | undefined,
        fields: args.fields as Record<string, string | number | boolean> | undefined,
        revision: args.revision as string | undefined,
      });

      const data = options.redact ? redactPii(result.data) : result.data;
      const payload = { success: true, status: result.status, data };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'klaviyo_update_image',
    'Update a Klaviyo image. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      image_id: z.string().describe('Klaviyo image ID'),
      attributes: z.record(z.any()).optional().describe('Image attributes to update'),
      relationships: z.record(z.any()).optional().describe('Optional image relationships'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      if (!options.allowApply) return writeNotAllowed();

      const body = buildJsonApiPayload({
        type: 'image',
        id: args.image_id as string,
        attributes: args.attributes as Record<string, unknown> | undefined,
        relationships: args.relationships as Record<string, unknown> | undefined,
      });

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'PATCH',
        path: `/images/${args.image_id}`,
        body,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'klaviyo_list_catalog_items',
    'List Klaviyo catalog items.',
    {
      limit: z.number().min(1).max(250).optional().describe('Page size (page[size])'),
      cursor: z.string().optional().describe('Cursor for pagination (page[cursor])'),
      filter: z.string().optional().describe('Filter expression'),
      sort: z.string().optional().describe('Sort expression'),
      fields: z.string().optional().describe('Fields to return (fields[catalog-item])'),
      additional_fields: z.string().optional().describe('Additional fields (additional-fields[catalog-item])'),
      query: z.record(z.union([z.string(), z.number(), z.boolean()])).optional().describe('Additional query parameters'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'GET',
        path: '/catalog-items',
        query: buildQuery(args, 'catalog-item'),
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'klaviyo_get_catalog_item',
    'Get a Klaviyo catalog item by ID.',
    {
      catalog_item_id: z.string().describe('Catalog item ID'),
      fields: z.string().optional().describe('Fields to return (fields[catalog-item])'),
      additional_fields: z.string().optional().describe('Additional fields (additional-fields[catalog-item])'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      const query = buildQuery({
        fields: args.fields as string | undefined,
        additional_fields: args.additional_fields as string | undefined,
      }, 'catalog-item');

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'GET',
        path: `/catalog-items/${args.catalog_item_id}`,
        query,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'klaviyo_create_catalog_item',
    'Create a Klaviyo catalog item. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      attributes: z.record(z.any()).describe('Catalog item attributes payload'),
      relationships: z.record(z.any()).optional().describe('Optional catalog item relationships'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      if (!options.allowApply) return writeNotAllowed();

      const body = buildJsonApiPayload({
        type: 'catalog-item',
        attributes: args.attributes as Record<string, unknown>,
        relationships: args.relationships as Record<string, unknown> | undefined,
      });

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'POST',
        path: '/catalog-items',
        body,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'klaviyo_update_catalog_item',
    'Update a Klaviyo catalog item. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      catalog_item_id: z.string().describe('Catalog item ID'),
      attributes: z.record(z.any()).optional().describe('Catalog item attributes to update'),
      relationships: z.record(z.any()).optional().describe('Optional catalog item relationships'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      if (!options.allowApply) return writeNotAllowed();

      const body = buildJsonApiPayload({
        type: 'catalog-item',
        id: args.catalog_item_id as string,
        attributes: args.attributes as Record<string, unknown> | undefined,
        relationships: args.relationships as Record<string, unknown> | undefined,
      });

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'PATCH',
        path: `/catalog-items/${args.catalog_item_id}`,
        body,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'klaviyo_delete_catalog_item',
    'Delete a Klaviyo catalog item. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      catalog_item_id: z.string().describe('Catalog item ID'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      if (!options.allowApply) return writeNotAllowed();

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'DELETE',
        path: `/catalog-items/${args.catalog_item_id}`,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'klaviyo_list_catalog_variants',
    'List Klaviyo catalog variants.',
    {
      limit: z.number().min(1).max(250).optional().describe('Page size (page[size])'),
      cursor: z.string().optional().describe('Cursor for pagination (page[cursor])'),
      filter: z.string().optional().describe('Filter expression'),
      sort: z.string().optional().describe('Sort expression'),
      fields: z.string().optional().describe('Fields to return (fields[catalog-variant])'),
      additional_fields: z.string().optional().describe('Additional fields (additional-fields[catalog-variant])'),
      query: z.record(z.union([z.string(), z.number(), z.boolean()])).optional().describe('Additional query parameters'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'GET',
        path: '/catalog-variants',
        query: buildQuery(args, 'catalog-variant'),
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'klaviyo_get_catalog_variant',
    'Get a Klaviyo catalog variant by ID.',
    {
      catalog_variant_id: z.string().describe('Catalog variant ID'),
      fields: z.string().optional().describe('Fields to return (fields[catalog-variant])'),
      additional_fields: z.string().optional().describe('Additional fields (additional-fields[catalog-variant])'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      const query = buildQuery({
        fields: args.fields as string | undefined,
        additional_fields: args.additional_fields as string | undefined,
      }, 'catalog-variant');

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'GET',
        path: `/catalog-variants/${args.catalog_variant_id}`,
        query,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'klaviyo_create_catalog_variant',
    'Create a Klaviyo catalog variant. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      attributes: z.record(z.any()).describe('Catalog variant attributes payload'),
      relationships: z.record(z.any()).optional().describe('Optional catalog variant relationships'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      if (!options.allowApply) return writeNotAllowed();

      const body = buildJsonApiPayload({
        type: 'catalog-variant',
        attributes: args.attributes as Record<string, unknown>,
        relationships: args.relationships as Record<string, unknown> | undefined,
      });

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'POST',
        path: '/catalog-variants',
        body,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'klaviyo_update_catalog_variant',
    'Update a Klaviyo catalog variant. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      catalog_variant_id: z.string().describe('Catalog variant ID'),
      attributes: z.record(z.any()).optional().describe('Catalog variant attributes to update'),
      relationships: z.record(z.any()).optional().describe('Optional catalog variant relationships'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      if (!options.allowApply) return writeNotAllowed();

      const body = buildJsonApiPayload({
        type: 'catalog-variant',
        id: args.catalog_variant_id as string,
        attributes: args.attributes as Record<string, unknown> | undefined,
        relationships: args.relationships as Record<string, unknown> | undefined,
      });

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'PATCH',
        path: `/catalog-variants/${args.catalog_variant_id}`,
        body,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'klaviyo_delete_catalog_variant',
    'Delete a Klaviyo catalog variant. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      catalog_variant_id: z.string().describe('Catalog variant ID'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      if (!options.allowApply) return writeNotAllowed();

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'DELETE',
        path: `/catalog-variants/${args.catalog_variant_id}`,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'klaviyo_list_catalog_categories',
    'List Klaviyo catalog categories.',
    {
      limit: z.number().min(1).max(250).optional().describe('Page size (page[size])'),
      cursor: z.string().optional().describe('Cursor for pagination (page[cursor])'),
      filter: z.string().optional().describe('Filter expression'),
      sort: z.string().optional().describe('Sort expression'),
      fields: z.string().optional().describe('Fields to return (fields[catalog-category])'),
      additional_fields: z.string().optional().describe('Additional fields (additional-fields[catalog-category])'),
      query: z.record(z.union([z.string(), z.number(), z.boolean()])).optional().describe('Additional query parameters'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'GET',
        path: '/catalog-categories',
        query: buildQuery(args, 'catalog-category'),
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'klaviyo_get_catalog_category',
    'Get a Klaviyo catalog category by ID.',
    {
      catalog_category_id: z.string().describe('Catalog category ID'),
      fields: z.string().optional().describe('Fields to return (fields[catalog-category])'),
      additional_fields: z.string().optional().describe('Additional fields (additional-fields[catalog-category])'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      const query = buildQuery({
        fields: args.fields as string | undefined,
        additional_fields: args.additional_fields as string | undefined,
      }, 'catalog-category');

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'GET',
        path: `/catalog-categories/${args.catalog_category_id}`,
        query,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'klaviyo_create_catalog_category',
    'Create a Klaviyo catalog category. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      attributes: z.record(z.any()).describe('Catalog category attributes payload'),
      relationships: z.record(z.any()).optional().describe('Optional catalog category relationships'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      if (!options.allowApply) return writeNotAllowed();

      const body = buildJsonApiPayload({
        type: 'catalog-category',
        attributes: args.attributes as Record<string, unknown>,
        relationships: args.relationships as Record<string, unknown> | undefined,
      });

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'POST',
        path: '/catalog-categories',
        body,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'klaviyo_update_catalog_category',
    'Update a Klaviyo catalog category. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      catalog_category_id: z.string().describe('Catalog category ID'),
      attributes: z.record(z.any()).optional().describe('Catalog category attributes to update'),
      relationships: z.record(z.any()).optional().describe('Optional catalog category relationships'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      if (!options.allowApply) return writeNotAllowed();

      const body = buildJsonApiPayload({
        type: 'catalog-category',
        id: args.catalog_category_id as string,
        attributes: args.attributes as Record<string, unknown> | undefined,
        relationships: args.relationships as Record<string, unknown> | undefined,
      });

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'PATCH',
        path: `/catalog-categories/${args.catalog_category_id}`,
        body,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'klaviyo_delete_catalog_category',
    'Delete a Klaviyo catalog category. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      catalog_category_id: z.string().describe('Catalog category ID'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      if (!options.allowApply) return writeNotAllowed();

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'DELETE',
        path: `/catalog-categories/${args.catalog_category_id}`,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'klaviyo_list_coupons',
    'List Klaviyo coupons.',
    {
      limit: z.number().min(1).max(250).optional().describe('Page size (page[size])'),
      cursor: z.string().optional().describe('Cursor for pagination (page[cursor])'),
      filter: z.string().optional().describe('Filter expression'),
      sort: z.string().optional().describe('Sort expression'),
      fields: z.string().optional().describe('Fields to return (fields[coupon])'),
      additional_fields: z.string().optional().describe('Additional fields (additional-fields[coupon])'),
      query: z.record(z.union([z.string(), z.number(), z.boolean()])).optional().describe('Additional query parameters'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'GET',
        path: '/coupons',
        query: buildQuery(args, 'coupon'),
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'klaviyo_get_coupon',
    'Get a Klaviyo coupon by ID.',
    {
      coupon_id: z.string().describe('Klaviyo coupon ID'),
      fields: z.string().optional().describe('Fields to return (fields[coupon])'),
      additional_fields: z.string().optional().describe('Additional fields (additional-fields[coupon])'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      const query = buildQuery({
        fields: args.fields as string | undefined,
        additional_fields: args.additional_fields as string | undefined,
      }, 'coupon');

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'GET',
        path: `/coupons/${args.coupon_id}`,
        query,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'klaviyo_create_coupon',
    'Create a Klaviyo coupon. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      attributes: z.record(z.any()).describe('Coupon attributes payload'),
      relationships: z.record(z.any()).optional().describe('Optional coupon relationships'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      if (!options.allowApply) return writeNotAllowed();

      const body = buildJsonApiPayload({
        type: 'coupon',
        attributes: args.attributes as Record<string, unknown>,
        relationships: args.relationships as Record<string, unknown> | undefined,
      });

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'POST',
        path: '/coupons',
        body,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'klaviyo_update_coupon',
    'Update a Klaviyo coupon. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      coupon_id: z.string().describe('Klaviyo coupon ID'),
      attributes: z.record(z.any()).optional().describe('Coupon attributes to update'),
      relationships: z.record(z.any()).optional().describe('Optional coupon relationships'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      if (!options.allowApply) return writeNotAllowed();

      const body = buildJsonApiPayload({
        type: 'coupon',
        id: args.coupon_id as string,
        attributes: args.attributes as Record<string, unknown> | undefined,
        relationships: args.relationships as Record<string, unknown> | undefined,
      });

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'PATCH',
        path: `/coupons/${args.coupon_id}`,
        body,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'klaviyo_delete_coupon',
    'Delete a Klaviyo coupon. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      coupon_id: z.string().describe('Klaviyo coupon ID'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      if (!options.allowApply) return writeNotAllowed();

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'DELETE',
        path: `/coupons/${args.coupon_id}`,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'klaviyo_list_coupon_codes',
    'List Klaviyo coupon codes.',
    {
      limit: z.number().min(1).max(250).optional().describe('Page size (page[size])'),
      cursor: z.string().optional().describe('Cursor for pagination (page[cursor])'),
      filter: z.string().optional().describe('Filter expression'),
      sort: z.string().optional().describe('Sort expression'),
      fields: z.string().optional().describe('Fields to return (fields[coupon-code])'),
      additional_fields: z.string().optional().describe('Additional fields (additional-fields[coupon-code])'),
      query: z.record(z.union([z.string(), z.number(), z.boolean()])).optional().describe('Additional query parameters'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'GET',
        path: '/coupon-codes',
        query: buildQuery(args, 'coupon-code'),
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'klaviyo_get_coupon_code',
    'Get a Klaviyo coupon code by ID.',
    {
      coupon_code_id: z.string().describe('Klaviyo coupon code ID'),
      fields: z.string().optional().describe('Fields to return (fields[coupon-code])'),
      additional_fields: z.string().optional().describe('Additional fields (additional-fields[coupon-code])'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      const query = buildQuery({
        fields: args.fields as string | undefined,
        additional_fields: args.additional_fields as string | undefined,
      }, 'coupon-code');

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'GET',
        path: `/coupon-codes/${args.coupon_code_id}`,
        query,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'klaviyo_create_coupon_code',
    'Create a Klaviyo coupon code. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      attributes: z.record(z.any()).describe('Coupon code attributes payload'),
      relationships: z.record(z.any()).optional().describe('Optional coupon code relationships'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      if (!options.allowApply) return writeNotAllowed();

      const body = buildJsonApiPayload({
        type: 'coupon-code',
        attributes: args.attributes as Record<string, unknown>,
        relationships: args.relationships as Record<string, unknown> | undefined,
      });

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'POST',
        path: '/coupon-codes',
        body,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'klaviyo_update_coupon_code',
    'Update a Klaviyo coupon code. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      coupon_code_id: z.string().describe('Klaviyo coupon code ID'),
      attributes: z.record(z.any()).optional().describe('Coupon code attributes to update'),
      relationships: z.record(z.any()).optional().describe('Optional coupon code relationships'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      if (!options.allowApply) return writeNotAllowed();

      const body = buildJsonApiPayload({
        type: 'coupon-code',
        id: args.coupon_code_id as string,
        attributes: args.attributes as Record<string, unknown> | undefined,
        relationships: args.relationships as Record<string, unknown> | undefined,
      });

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'PATCH',
        path: `/coupon-codes/${args.coupon_code_id}`,
        body,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'klaviyo_delete_coupon_code',
    'Delete a Klaviyo coupon code. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      coupon_code_id: z.string().describe('Klaviyo coupon code ID'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      if (!options.allowApply) return writeNotAllowed();

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'DELETE',
        path: `/coupon-codes/${args.coupon_code_id}`,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'klaviyo_add_profiles_to_list',
    'Add profiles to a Klaviyo list. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      list_id: z.string().describe('Klaviyo list ID'),
      profile_ids: z.array(z.string()).describe('Array of Klaviyo profile IDs'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
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
    }
  );

  server.tool(
    'klaviyo_remove_profiles_from_list',
    'Remove profiles from a Klaviyo list. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      list_id: z.string().describe('Klaviyo list ID'),
      profile_ids: z.array(z.string()).describe('Array of Klaviyo profile IDs'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
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
    }
  );

  server.tool(
    'klaviyo_create_campaign_values_report',
    'Create a campaign values report. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      payload: z.record(z.any()).describe('Report payload for /campaign-values-reports'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
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
    }
  );

  server.tool(
    'klaviyo_create_flow_values_report',
    'Create a flow values report. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      payload: z.record(z.any()).describe('Report payload for /flow-values-reports'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
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
    }
  );

  server.tool(
    'klaviyo_create_flow_series_report',
    'Create a flow series report. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      payload: z.record(z.any()).describe('Report payload for /flow-series-reports'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
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
    }
  );

  server.tool(
    'klaviyo_create_form_values_report',
    'Create a form values report. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      payload: z.record(z.any()).describe('Report payload for /form-values-reports'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
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
    }
  );

  server.tool(
    'klaviyo_create_form_series_report',
    'Create a form series report. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      payload: z.record(z.any()).describe('Report payload for /form-series-reports'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
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
    }
  );

  server.tool(
    'klaviyo_create_segment_values_report',
    'Create a segment values report. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      payload: z.record(z.any()).describe('Report payload for /segment-values-reports'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
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
    }
  );

  server.tool(
    'klaviyo_create_segment_series_report',
    'Create a segment series report. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      payload: z.record(z.any()).describe('Report payload for /segment-series-reports'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
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
    }
  );

  server.tool(
    'klaviyo_query_metric_aggregates',
    'Query metric aggregates. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      payload: z.record(z.any()).describe('Metric aggregates payload for /metric-aggregates'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      if (!options.allowApply) return writeNotAllowed();

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'POST',
        path: '/metric-aggregates',
        body: args.payload as Record<string, unknown>,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'klaviyo_list_metrics',
    'List Klaviyo metrics (events).',
    {
      limit: z.number().min(1).max(250).optional().describe('Page size (page[size])'),
      cursor: z.string().optional().describe('Cursor for pagination (page[cursor])'),
      filter: z.string().optional().describe('Filter expression'),
      sort: z.string().optional().describe('Sort expression'),
      fields: z.string().optional().describe('Fields to return (fields[metric])'),
      additional_fields: z.string().optional().describe('Additional fields (additional-fields[metric])'),
      query: z.record(z.union([z.string(), z.number(), z.boolean()])).optional().describe('Additional query parameters'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'GET',
        path: '/metrics',
        query: buildQuery(args, 'metric'),
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'klaviyo_get_metric',
    'Get a Klaviyo metric by ID.',
    {
      metric_id: z.string().describe('Klaviyo metric ID'),
      fields: z.string().optional().describe('Fields to return (fields[metric])'),
      additional_fields: z.string().optional().describe('Additional fields (additional-fields[metric])'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      const query = buildQuery({
        fields: args.fields as string | undefined,
        additional_fields: args.additional_fields as string | undefined,
      }, 'metric');

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'GET',
        path: `/metrics/${args.metric_id}`,
        query,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'klaviyo_create_event',
    'Create a Klaviyo event. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      metric_name: z.string().optional().describe('Metric name (required if metric_id not provided)'),
      metric_id: z.string().optional().describe('Metric ID (optional alternative to metric_name)'),
      profile: z.record(z.any()).optional().describe('Profile attributes (email, phone_number, external_id, etc.)'),
      profile_id: z.string().optional().describe('Profile ID (optional alternative to profile attributes)'),
      properties: z.record(z.any()).optional().describe('Event properties'),
      time: z.string().optional().describe('Event timestamp (ISO 8601)'),
      value: z.number().optional().describe('Numeric value associated with the event'),
      unique_id: z.string().optional().describe('Unique ID for idempotency'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      if (!options.allowApply) return writeNotAllowed();

      if (!args.metric_id && !args.metric_name) {
        throw new Error('metric_name or metric_id is required');
      }
      if (!args.profile_id && !args.profile) {
        throw new Error('profile_id or profile is required');
      }

      const profileData = args.profile_id
        ? { type: 'profile', id: args.profile_id }
        : { type: 'profile', attributes: args.profile as Record<string, unknown> };

      const metricData = args.metric_id
        ? { type: 'metric', id: args.metric_id }
        : { type: 'metric', attributes: { name: args.metric_name } };

      const attributes: Record<string, unknown> = {
        profile: { data: profileData },
        metric: { data: metricData },
      };
      if (args.properties) attributes.properties = args.properties;
      if (args.time) attributes.time = args.time;
      if (args.value !== undefined) attributes.value = args.value;
      if (args.unique_id) attributes.unique_id = args.unique_id;

      const body = {
        data: {
          type: 'event',
          attributes,
        },
      };

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'POST',
        path: '/events',
        body,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'klaviyo_list_events',
    'List Klaviyo events.',
    {
      limit: z.number().min(1).max(250).optional().describe('Page size (page[size])'),
      cursor: z.string().optional().describe('Cursor for pagination (page[cursor])'),
      filter: z.string().optional().describe('Filter expression'),
      sort: z.string().optional().describe('Sort expression'),
      fields: z.string().optional().describe('Fields to return (fields[event])'),
      additional_fields: z.string().optional().describe('Additional fields (additional-fields[event])'),
      query: z.record(z.union([z.string(), z.number(), z.boolean()])).optional().describe('Additional query parameters'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'GET',
        path: '/events',
        query: buildQuery(args, 'event'),
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'klaviyo_get_event',
    'Get a Klaviyo event by ID.',
    {
      event_id: z.string().describe('Klaviyo event ID'),
      fields: z.string().optional().describe('Fields to return (fields[event])'),
      additional_fields: z.string().optional().describe('Additional fields (additional-fields[event])'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      const query = buildQuery({
        fields: args.fields as string | undefined,
        additional_fields: args.additional_fields as string | undefined,
      }, 'event');

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'GET',
        path: `/events/${args.event_id}`,
        query,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'klaviyo_request',
    'Execute a raw Klaviyo API request. Non-GET methods require --apply or STATESET_ALLOW_APPLY.',
    {
      method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).describe('HTTP method'),
      endpoint: z.string().describe('API endpoint path (e.g., /profiles, /lists/123)'),
      query: z.record(z.union([z.string(), z.number(), z.boolean()])).optional().describe('Optional query params'),
      body: z.record(z.any()).optional().describe('Optional JSON body'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      const method = String(args.method || '').toUpperCase();
      if (method !== 'GET' && !options.allowApply) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              error: 'Write operation not allowed. The --apply flag or STATESET_ALLOW_APPLY must be set.',
              hint: 'Use GET requests when writes are disabled.',
            }, null, 2),
          }],
        };
      }

      const result = await runKlaviyoRequest(klaviyo, options, {
        method,
        path: args.endpoint as string,
        query: args.query as Record<string, string | number | boolean> | undefined,
        body: args.body as Record<string, unknown> | undefined,
        revision: args.revision as string | undefined,
      });

      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );
}
