import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { KlaviyoConfig } from '../../integrations/config.js';
import { klaviyoUploadImageFromFile } from '../../integrations/klaviyo.js';
import { redactPii } from '../../integrations/redact.js';
import { stringifyToolResult } from './output.js';
import {
  KlaviyoToolOptions,
  buildQuery,
  runKlaviyoRequest,
  writeNotAllowed,
  buildJsonApiPayload,
} from './klaviyo-common.js';

export function registerKlaviyoContentTools(
  server: McpServer,
  klaviyo: KlaviyoConfig,
  options: KlaviyoToolOptions,
) {
  // ── Templates ──────────────────────────────────────────────────────────

  server.tool(
    'klaviyo_list_templates',
    'List Klaviyo templates.',
    {
      limit: z.number().min(1).max(250).optional().describe('Page size (page[size])'),
      cursor: z.string().optional().describe('Cursor for pagination (page[cursor])'),
      filter: z.string().optional().describe('Filter expression'),
      sort: z.string().optional().describe('Sort expression'),
      fields: z.string().optional().describe('Fields to return (fields[template])'),
      additional_fields: z
        .string()
        .optional()
        .describe('Additional fields (additional-fields[template])'),
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
        path: '/templates',
        query: buildQuery(args, 'template'),
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_get_template',
    'Get a Klaviyo template by ID.',
    {
      template_id: z.string().describe('Klaviyo template ID'),
      fields: z.string().optional().describe('Fields to return (fields[template])'),
      additional_fields: z
        .string()
        .optional()
        .describe('Additional fields (additional-fields[template])'),
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
        'template',
      );

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'GET',
        path: `/templates/${args.template_id}`,
        query,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_create_template',
    'Create a Klaviyo template. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      attributes: z.record(z.unknown()).describe('Template attributes payload'),
      relationships: z.record(z.unknown()).optional().describe('Optional template relationships'),
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
    },
  );

  server.tool(
    'klaviyo_update_template',
    'Update a Klaviyo template. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      template_id: z.string().describe('Klaviyo template ID'),
      attributes: z.record(z.unknown()).optional().describe('Template attributes to update'),
      relationships: z.record(z.unknown()).optional().describe('Optional template relationships'),
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
    },
  );

  server.tool(
    'klaviyo_delete_template',
    'Delete a Klaviyo template. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      template_id: z.string().describe('Klaviyo template ID'),
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
        path: `/templates/${args.template_id}`,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_render_template',
    'Render a Klaviyo template. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      payload: z.record(z.unknown()).describe('Template render payload for /template-render'),
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
        path: '/template-render',
        body: args.payload as Record<string, unknown>,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_clone_template',
    'Clone a Klaviyo template. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      payload: z.record(z.unknown()).describe('Template clone payload for /template-clone'),
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
        path: '/template-clone',
        body: args.payload as Record<string, unknown>,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  // ── Forms ──────────────────────────────────────────────────────────────

  server.tool(
    'klaviyo_list_forms',
    'List Klaviyo forms (may require beta revision).',
    {
      limit: z.number().min(1).max(250).optional().describe('Page size (page[size])'),
      cursor: z.string().optional().describe('Cursor for pagination (page[cursor])'),
      filter: z.string().optional().describe('Filter expression'),
      sort: z.string().optional().describe('Sort expression'),
      fields: z.string().optional().describe('Fields to return (fields[form])'),
      additional_fields: z
        .string()
        .optional()
        .describe('Additional fields (additional-fields[form])'),
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
        path: '/forms',
        query: buildQuery(args, 'form'),
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_get_form',
    'Get a Klaviyo form by ID (may require beta revision).',
    {
      form_id: z.string().describe('Klaviyo form ID'),
      fields: z.string().optional().describe('Fields to return (fields[form])'),
      additional_fields: z
        .string()
        .optional()
        .describe('Additional fields (additional-fields[form])'),
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
        'form',
      );

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'GET',
        path: `/forms/${args.form_id}`,
        query,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_create_form',
    'Create a Klaviyo form (may require beta revision). Requires --apply or STATESET_ALLOW_APPLY.',
    {
      attributes: z.record(z.unknown()).describe('Form attributes payload'),
      relationships: z.record(z.unknown()).optional().describe('Optional form relationships'),
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
    },
  );

  server.tool(
    'klaviyo_delete_form',
    'Delete a Klaviyo form (may require beta revision). Requires --apply or STATESET_ALLOW_APPLY.',
    {
      form_id: z.string().describe('Klaviyo form ID'),
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

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'DELETE',
        path: `/forms/${args.form_id}`,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  // ── Images ─────────────────────────────────────────────────────────────

  server.tool(
    'klaviyo_list_images',
    'List Klaviyo images.',
    {
      limit: z.number().min(1).max(250).optional().describe('Page size (page[size])'),
      cursor: z.string().optional().describe('Cursor for pagination (page[cursor])'),
      filter: z.string().optional().describe('Filter expression'),
      sort: z.string().optional().describe('Sort expression'),
      fields: z.string().optional().describe('Fields to return (fields[image])'),
      additional_fields: z
        .string()
        .optional()
        .describe('Additional fields (additional-fields[image])'),
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
        path: '/images',
        query: buildQuery(args, 'image'),
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_get_image',
    'Get a Klaviyo image by ID.',
    {
      image_id: z.string().describe('Klaviyo image ID'),
      fields: z.string().optional().describe('Fields to return (fields[image])'),
      additional_fields: z
        .string()
        .optional()
        .describe('Additional fields (additional-fields[image])'),
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
        'image',
      );

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'GET',
        path: `/images/${args.image_id}`,
        query,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_upload_image_from_url',
    'Upload a Klaviyo image from a URL. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      attributes: z
        .record(z.unknown())
        .describe('Image attributes payload (include import_from_url, name, etc.)'),
      relationships: z.record(z.unknown()).optional().describe('Optional image relationships'),
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
    },
  );

  server.tool(
    'klaviyo_upload_image_from_file',
    'Upload a Klaviyo image from a local file. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      file_path: z.string().describe('Local file path to upload'),
      file_field: z.string().optional().describe('Form field name for the file (default: file)'),
      filename: z
        .string()
        .optional()
        .describe('Filename to send (defaults to basename of file path)'),
      fields: z
        .record(z.union([z.string(), z.number(), z.boolean()]))
        .optional()
        .describe('Additional form fields (name, folder, etc.)'),
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
    },
  );

  server.tool(
    'klaviyo_update_image',
    'Update a Klaviyo image. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      image_id: z.string().describe('Klaviyo image ID'),
      attributes: z.record(z.unknown()).optional().describe('Image attributes to update'),
      relationships: z.record(z.unknown()).optional().describe('Optional image relationships'),
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
    },
  );

  // ── Catalog Items ──────────────────────────────────────────────────────

  server.tool(
    'klaviyo_list_catalog_items',
    'List Klaviyo catalog items.',
    {
      limit: z.number().min(1).max(250).optional().describe('Page size (page[size])'),
      cursor: z.string().optional().describe('Cursor for pagination (page[cursor])'),
      filter: z.string().optional().describe('Filter expression'),
      sort: z.string().optional().describe('Sort expression'),
      fields: z.string().optional().describe('Fields to return (fields[catalog-item])'),
      additional_fields: z
        .string()
        .optional()
        .describe('Additional fields (additional-fields[catalog-item])'),
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
        path: '/catalog-items',
        query: buildQuery(args, 'catalog-item'),
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_get_catalog_item',
    'Get a Klaviyo catalog item by ID.',
    {
      catalog_item_id: z.string().describe('Catalog item ID'),
      fields: z.string().optional().describe('Fields to return (fields[catalog-item])'),
      additional_fields: z
        .string()
        .optional()
        .describe('Additional fields (additional-fields[catalog-item])'),
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
        'catalog-item',
      );

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'GET',
        path: `/catalog-items/${args.catalog_item_id}`,
        query,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_create_catalog_item',
    'Create a Klaviyo catalog item. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      attributes: z.record(z.unknown()).describe('Catalog item attributes payload'),
      relationships: z
        .record(z.unknown())
        .optional()
        .describe('Optional catalog item relationships'),
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
    },
  );

  server.tool(
    'klaviyo_update_catalog_item',
    'Update a Klaviyo catalog item. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      catalog_item_id: z.string().describe('Catalog item ID'),
      attributes: z.record(z.unknown()).optional().describe('Catalog item attributes to update'),
      relationships: z
        .record(z.unknown())
        .optional()
        .describe('Optional catalog item relationships'),
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
    },
  );

  server.tool(
    'klaviyo_delete_catalog_item',
    'Delete a Klaviyo catalog item. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      catalog_item_id: z.string().describe('Catalog item ID'),
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
        path: `/catalog-items/${args.catalog_item_id}`,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  // ── Catalog Variants ───────────────────────────────────────────────────

  server.tool(
    'klaviyo_list_catalog_variants',
    'List Klaviyo catalog variants.',
    {
      limit: z.number().min(1).max(250).optional().describe('Page size (page[size])'),
      cursor: z.string().optional().describe('Cursor for pagination (page[cursor])'),
      filter: z.string().optional().describe('Filter expression'),
      sort: z.string().optional().describe('Sort expression'),
      fields: z.string().optional().describe('Fields to return (fields[catalog-variant])'),
      additional_fields: z
        .string()
        .optional()
        .describe('Additional fields (additional-fields[catalog-variant])'),
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
        path: '/catalog-variants',
        query: buildQuery(args, 'catalog-variant'),
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_get_catalog_variant',
    'Get a Klaviyo catalog variant by ID.',
    {
      catalog_variant_id: z.string().describe('Catalog variant ID'),
      fields: z.string().optional().describe('Fields to return (fields[catalog-variant])'),
      additional_fields: z
        .string()
        .optional()
        .describe('Additional fields (additional-fields[catalog-variant])'),
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
        'catalog-variant',
      );

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'GET',
        path: `/catalog-variants/${args.catalog_variant_id}`,
        query,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_create_catalog_variant',
    'Create a Klaviyo catalog variant. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      attributes: z.record(z.unknown()).describe('Catalog variant attributes payload'),
      relationships: z
        .record(z.unknown())
        .optional()
        .describe('Optional catalog variant relationships'),
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
    },
  );

  server.tool(
    'klaviyo_update_catalog_variant',
    'Update a Klaviyo catalog variant. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      catalog_variant_id: z.string().describe('Catalog variant ID'),
      attributes: z.record(z.unknown()).optional().describe('Catalog variant attributes to update'),
      relationships: z
        .record(z.unknown())
        .optional()
        .describe('Optional catalog variant relationships'),
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
    },
  );

  server.tool(
    'klaviyo_delete_catalog_variant',
    'Delete a Klaviyo catalog variant. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      catalog_variant_id: z.string().describe('Catalog variant ID'),
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
        path: `/catalog-variants/${args.catalog_variant_id}`,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  // ── Catalog Categories ─────────────────────────────────────────────────

  server.tool(
    'klaviyo_list_catalog_categories',
    'List Klaviyo catalog categories.',
    {
      limit: z.number().min(1).max(250).optional().describe('Page size (page[size])'),
      cursor: z.string().optional().describe('Cursor for pagination (page[cursor])'),
      filter: z.string().optional().describe('Filter expression'),
      sort: z.string().optional().describe('Sort expression'),
      fields: z.string().optional().describe('Fields to return (fields[catalog-category])'),
      additional_fields: z
        .string()
        .optional()
        .describe('Additional fields (additional-fields[catalog-category])'),
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
        path: '/catalog-categories',
        query: buildQuery(args, 'catalog-category'),
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_get_catalog_category',
    'Get a Klaviyo catalog category by ID.',
    {
      catalog_category_id: z.string().describe('Catalog category ID'),
      fields: z.string().optional().describe('Fields to return (fields[catalog-category])'),
      additional_fields: z
        .string()
        .optional()
        .describe('Additional fields (additional-fields[catalog-category])'),
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
        'catalog-category',
      );

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'GET',
        path: `/catalog-categories/${args.catalog_category_id}`,
        query,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_create_catalog_category',
    'Create a Klaviyo catalog category. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      attributes: z.record(z.unknown()).describe('Catalog category attributes payload'),
      relationships: z
        .record(z.unknown())
        .optional()
        .describe('Optional catalog category relationships'),
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
    },
  );

  server.tool(
    'klaviyo_update_catalog_category',
    'Update a Klaviyo catalog category. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      catalog_category_id: z.string().describe('Catalog category ID'),
      attributes: z
        .record(z.unknown())
        .optional()
        .describe('Catalog category attributes to update'),
      relationships: z
        .record(z.unknown())
        .optional()
        .describe('Optional catalog category relationships'),
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
    },
  );

  server.tool(
    'klaviyo_delete_catalog_category',
    'Delete a Klaviyo catalog category. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      catalog_category_id: z.string().describe('Catalog category ID'),
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
        path: `/catalog-categories/${args.catalog_category_id}`,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  // ── Coupons ────────────────────────────────────────────────────────────

  server.tool(
    'klaviyo_list_coupons',
    'List Klaviyo coupons.',
    {
      limit: z.number().min(1).max(250).optional().describe('Page size (page[size])'),
      cursor: z.string().optional().describe('Cursor for pagination (page[cursor])'),
      filter: z.string().optional().describe('Filter expression'),
      sort: z.string().optional().describe('Sort expression'),
      fields: z.string().optional().describe('Fields to return (fields[coupon])'),
      additional_fields: z
        .string()
        .optional()
        .describe('Additional fields (additional-fields[coupon])'),
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
        path: '/coupons',
        query: buildQuery(args, 'coupon'),
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_get_coupon',
    'Get a Klaviyo coupon by ID.',
    {
      coupon_id: z.string().describe('Klaviyo coupon ID'),
      fields: z.string().optional().describe('Fields to return (fields[coupon])'),
      additional_fields: z
        .string()
        .optional()
        .describe('Additional fields (additional-fields[coupon])'),
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
        'coupon',
      );

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'GET',
        path: `/coupons/${args.coupon_id}`,
        query,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_create_coupon',
    'Create a Klaviyo coupon. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      attributes: z.record(z.unknown()).describe('Coupon attributes payload'),
      relationships: z.record(z.unknown()).optional().describe('Optional coupon relationships'),
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
    },
  );

  server.tool(
    'klaviyo_update_coupon',
    'Update a Klaviyo coupon. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      coupon_id: z.string().describe('Klaviyo coupon ID'),
      attributes: z.record(z.unknown()).optional().describe('Coupon attributes to update'),
      relationships: z.record(z.unknown()).optional().describe('Optional coupon relationships'),
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
    },
  );

  server.tool(
    'klaviyo_delete_coupon',
    'Delete a Klaviyo coupon. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      coupon_id: z.string().describe('Klaviyo coupon ID'),
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
        path: `/coupons/${args.coupon_id}`,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
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
      additional_fields: z
        .string()
        .optional()
        .describe('Additional fields (additional-fields[coupon-code])'),
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
        path: '/coupon-codes',
        query: buildQuery(args, 'coupon-code'),
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_get_coupon_code',
    'Get a Klaviyo coupon code by ID.',
    {
      coupon_code_id: z.string().describe('Klaviyo coupon code ID'),
      fields: z.string().optional().describe('Fields to return (fields[coupon-code])'),
      additional_fields: z
        .string()
        .optional()
        .describe('Additional fields (additional-fields[coupon-code])'),
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
        'coupon-code',
      );

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'GET',
        path: `/coupon-codes/${args.coupon_code_id}`,
        query,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_create_coupon_code',
    'Create a Klaviyo coupon code. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      attributes: z.record(z.unknown()).describe('Coupon code attributes payload'),
      relationships: z
        .record(z.unknown())
        .optional()
        .describe('Optional coupon code relationships'),
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
    },
  );

  server.tool(
    'klaviyo_update_coupon_code',
    'Update a Klaviyo coupon code. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      coupon_code_id: z.string().describe('Klaviyo coupon code ID'),
      attributes: z.record(z.unknown()).optional().describe('Coupon code attributes to update'),
      relationships: z
        .record(z.unknown())
        .optional()
        .describe('Optional coupon code relationships'),
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
    },
  );

  server.tool(
    'klaviyo_delete_coupon_code',
    'Delete a Klaviyo coupon code. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      coupon_code_id: z.string().describe('Klaviyo coupon code ID'),
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
        path: `/coupon-codes/${args.coupon_code_id}`,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  // ── Metrics ────────────────────────────────────────────────────────────

  server.tool(
    'klaviyo_query_metric_aggregates',
    'Query metric aggregates. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      payload: z.record(z.unknown()).describe('Metric aggregates payload for /metric-aggregates'),
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
        path: '/metric-aggregates',
        body: args.payload as Record<string, unknown>,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
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
      additional_fields: z
        .string()
        .optional()
        .describe('Additional fields (additional-fields[metric])'),
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
        path: '/metrics',
        query: buildQuery(args, 'metric'),
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_get_metric',
    'Get a Klaviyo metric by ID.',
    {
      metric_id: z.string().describe('Klaviyo metric ID'),
      fields: z.string().optional().describe('Fields to return (fields[metric])'),
      additional_fields: z
        .string()
        .optional()
        .describe('Additional fields (additional-fields[metric])'),
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
        'metric',
      );

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'GET',
        path: `/metrics/${args.metric_id}`,
        query,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  // ── Events ─────────────────────────────────────────────────────────────

  server.tool(
    'klaviyo_create_event',
    'Create a Klaviyo event. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      metric_name: z
        .string()
        .optional()
        .describe('Metric name (required if metric_id not provided)'),
      metric_id: z.string().optional().describe('Metric ID (optional alternative to metric_name)'),
      profile: z
        .record(z.unknown())
        .optional()
        .describe('Profile attributes (email, phone_number, external_id, etc.)'),
      profile_id: z
        .string()
        .optional()
        .describe('Profile ID (optional alternative to profile attributes)'),
      properties: z.record(z.unknown()).optional().describe('Event properties'),
      time: z.string().optional().describe('Event timestamp (ISO 8601)'),
      value: z.number().optional().describe('Numeric value associated with the event'),
      unique_id: z.string().optional().describe('Unique ID for idempotency'),
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
    },
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
      additional_fields: z
        .string()
        .optional()
        .describe('Additional fields (additional-fields[event])'),
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
        path: '/events',
        query: buildQuery(args, 'event'),
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'klaviyo_get_event',
    'Get a Klaviyo event by ID.',
    {
      event_id: z.string().describe('Klaviyo event ID'),
      fields: z.string().optional().describe('Fields to return (fields[event])'),
      additional_fields: z
        .string()
        .optional()
        .describe('Additional fields (additional-fields[event])'),
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
        'event',
      );

      const result = await runKlaviyoRequest(klaviyo, options, {
        method: 'GET',
        path: `/events/${args.event_id}`,
        query,
        revision: args.revision as string | undefined,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );
}
