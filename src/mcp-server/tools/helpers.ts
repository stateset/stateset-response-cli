import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { redactPii } from '../../integrations/redact.js';
import { stringifyToolResult } from './output.js';

export interface IntegrationToolOptions {
  allowApply: boolean;
  redact: boolean;
}

export function writeNotAllowed(): { content: [{ type: 'text'; text: string }] } {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          {
            error:
              'Write operation not allowed. The --apply flag or STATESET_ALLOW_APPLY must be set.',
            hint: 'Use list/get operations when writes are disabled.',
          },
          null,
          2,
        ),
      },
    ],
  };
}

export function guardWrite(options: {
  allowApply: boolean;
}): ReturnType<typeof writeNotAllowed> | null {
  if (!options.allowApply) return writeNotAllowed();
  return null;
}

export function wrapToolResult(
  payload: unknown,
  maxChars?: number,
): { content: [{ type: 'text'; text: string }] } {
  const { text } = stringifyToolResult(payload, maxChars);
  return { content: [{ type: 'text' as const, text }] };
}

export const MaxCharsSchema = z
  .number()
  .min(2000)
  .max(20000)
  .optional()
  .describe('Max characters in response (default 12000)');

export const QueryParamsSchema = z
  .record(z.union([z.string(), z.number(), z.boolean()]))
  .optional()
  .describe('Optional query params');

export const BodySchema = z.record(z.unknown()).optional().describe('Optional JSON body');

export const HttpMethodSchema = z
  .enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH'])
  .describe('HTTP method');

export const RawRequestSchema = {
  method: HttpMethodSchema,
  endpoint: z.string().describe('API endpoint path'),
  query: QueryParamsSchema,
  body: BodySchema,
  max_chars: MaxCharsSchema,
} as const;

export interface IntegrationResponse {
  status: number;
  data: unknown;
}

export interface RequestRunnerArgs {
  method: string;
  path: string;
  query?: Record<string, string | number | boolean>;
  body?: Record<string, unknown>;
  [extra: string]: unknown;
}

export function createRequestRunner<TConfig>(
  makeRequest: (config: TConfig, args: RequestRunnerArgs) => Promise<IntegrationResponse>,
) {
  return async function runRequest(
    config: TConfig,
    options: IntegrationToolOptions,
    args: RequestRunnerArgs,
  ): Promise<{ status: number; data: unknown }> {
    const response = await makeRequest(config, args);
    const data = options.redact ? redactPii(response.data) : response.data;
    return { status: response.status, data };
  };
}

export function buildQuery(
  params: Record<string, string | number | boolean | undefined>,
): Record<string, string | number | boolean> | undefined {
  const query: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query[key] = value;
  }
  return Object.keys(query).length > 0 ? query : undefined;
}

export function registerRawRequestTool<TConfig>(
  server: McpServer,
  toolName: string,
  description: string,
  runRequest: (
    config: TConfig,
    options: IntegrationToolOptions,
    args: RequestRunnerArgs,
  ) => Promise<{ status: number; data: unknown }>,
  config: TConfig,
  options: IntegrationToolOptions,
  extraSchema?: Record<string, z.ZodTypeAny>,
): void {
  server.tool(
    toolName,
    `${description} Non-GET methods require --apply or STATESET_ALLOW_APPLY.`,
    {
      ...RawRequestSchema,
      ...(extraSchema || {}),
    },
    async (args) => {
      const method = String(args.method || '').toUpperCase();
      if (method !== 'GET' && !options.allowApply) {
        return writeNotAllowed();
      }

      const result = await runRequest(config, options, {
        method,
        path: args.endpoint as string,
        query: args.query as Record<string, string | number | boolean> | undefined,
        body: args.body as Record<string, unknown> | undefined,
      });

      return wrapToolResult({ success: true, ...result }, args.max_chars as number | undefined);
    },
  );
}
