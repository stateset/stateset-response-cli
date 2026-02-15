/**
 * Shared Zod validation schemas for MCP tools
 * Replaces loose z.any() with strict, type-safe schemas
 */
import { z } from 'zod';

// ============================================================================
// Size Limits
// ============================================================================

export const MAX_STRING_LENGTH = 10000;
export const MAX_ARRAY_LENGTH = 100;
export const MAX_NAME_LENGTH = 200;
export const MAX_DESCRIPTION_LENGTH = 5000;
export const MAX_URL_LENGTH = 2048;

// ============================================================================
// Primitive Schemas with Limits
// ============================================================================

export const limitedString = (maxLength = MAX_STRING_LENGTH) => z.string().max(maxLength);

export const limitedArray = <T extends z.ZodTypeAny>(schema: T, maxLength = MAX_ARRAY_LENGTH) =>
  z.array(schema).max(maxLength);

export const paginationLimit = z
  .number()
  .int()
  .min(1)
  .max(1000)
  .optional()
  .describe('Max number of items to return (1-1000, default 100)');

export const paginationOffset = z
  .number()
  .int()
  .min(0)
  .max(100000)
  .optional()
  .describe('Offset for pagination (default 0)');

// ============================================================================
// Metadata Schema
// ============================================================================

/** Generic metadata object - string keys with primitive or null values */
export const metadataSchema = z
  .record(
    z.string().max(100),
    z.union([z.string().max(MAX_STRING_LENGTH), z.number(), z.boolean(), z.null()]),
  )
  .optional()
  .describe('Additional metadata key-value pairs');

// ============================================================================
// Conditions Schema (for rules/skills)
// ============================================================================

const conditionOperator = z.enum([
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'contains',
  'not_contains',
  'starts_with',
  'ends_with',
  'in',
  'not_in',
  'is_null',
  'is_not_null',
  'matches', // regex
]);

const conditionValue = z.union([
  z.string().max(1000),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.union([z.string().max(1000), z.number()])).max(50), // for in/not_in
]);

const singleCondition = z
  .object({
    field: z.string().max(100).describe('Field name to evaluate'),
    operator: conditionOperator.describe('Comparison operator'),
    value: conditionValue.describe('Value to compare against'),
  })
  .strict();

/** Rule/skill conditions with any/all logic */
export const conditionsSchema = z
  .object({
    any: z
      .array(singleCondition)
      .max(20)
      .optional()
      .describe('Match if ANY condition is true (OR)'),
    all: z
      .array(singleCondition)
      .max(20)
      .optional()
      .describe('Match if ALL conditions are true (AND)'),
  })
  .optional()
  .describe('Conditions object with "any" or "all" arrays');

// ============================================================================
// Actions Schema (for rules/skills)
// ============================================================================

const actionParams = z
  .record(
    z.string().max(100),
    z.union([
      z.string().max(MAX_STRING_LENGTH),
      z.number(),
      z.boolean(),
      z.null(),
      z.array(z.string().max(1000)).max(50),
    ]),
  )
  .optional();

const singleAction = z
  .object({
    type: z
      .string()
      .max(50)
      .describe('Action type (e.g., "send_message", "update_field", "call_function")'),
    params: actionParams.describe('Action parameters'),
    order: z.number().int().min(0).max(100).optional().describe('Execution order'),
  })
  .strict();

/** Array of actions to execute */
export const actionsSchema = z
  .array(singleAction)
  .max(20)
  .optional()
  .describe('Array of actions to execute when conditions match');

// ============================================================================
// Function Schemas
// ============================================================================

/** Function parameter definition */
const functionParameter = z
  .object({
    name: z.string().max(100).describe('Parameter name'),
    type: z.enum(['string', 'number', 'boolean', 'object', 'array']).describe('Parameter type'),
    required: z.boolean().optional().describe('Whether parameter is required'),
    description: z.string().max(500).optional().describe('Parameter description'),
    default: z
      .union([z.string(), z.number(), z.boolean(), z.null()])
      .optional()
      .describe('Default value'),
  })
  .strict();

export const parametersSchema = z
  .array(functionParameter)
  .max(50)
  .optional()
  .describe('Function parameter definitions');

/** Authentication configuration */
export const authenticationSchema = z
  .object({
    type: z.enum(['none', 'bearer', 'api_key', 'basic', 'oauth2']).describe('Authentication type'),
    token: z.string().max(2000).optional().describe('Bearer token'),
    api_key: z.string().max(500).optional().describe('API key value'),
    api_key_header: z.string().max(100).optional().describe('Header name for API key'),
    username: z.string().max(200).optional().describe('Basic auth username'),
    password: z.string().max(200).optional().describe('Basic auth password'),
    oauth2_config: z
      .object({
        client_id: z.string().max(500).optional(),
        client_secret: z.string().max(500).optional(),
        token_url: z.string().url().max(MAX_URL_LENGTH).optional(),
        scope: z.string().max(500).optional(),
      })
      .optional()
      .describe('OAuth2 configuration'),
  })
  .optional()
  .describe('Authentication configuration');

/** HTTP headers */
export const headersSchema = z
  .record(z.string().max(100), z.string().max(2000))
  .optional()
  .describe('Custom HTTP headers');

/** Request body transform */
export const requestTransformSchema = z
  .object({
    body: z
      .record(z.string().max(100), z.unknown())
      .optional()
      .describe('Body template with variable placeholders'),
    content_type: z.string().max(100).optional().describe('Content-Type header value'),
  })
  .optional()
  .describe('Request body transformation');

/** Response handling configuration */
export const responseHandlingSchema = z
  .object({
    success_condition: z
      .string()
      .max(500)
      .optional()
      .describe('Expression to determine success (e.g., "status_code == 200")'),
    error_message_path: z
      .string()
      .max(200)
      .optional()
      .describe('JSON path to error message in response'),
    result_mapping: z
      .record(z.string().max(100), z.string().max(500))
      .optional()
      .describe('Map response fields to output'),
  })
  .optional()
  .describe('Response handling configuration');

/** Retry configuration */
export const retryConfigSchema = z
  .object({
    max_attempts: z
      .number()
      .int()
      .min(0)
      .max(10)
      .optional()
      .describe('Maximum retry attempts (0-10)'),
    backoff: z.enum(['none', 'linear', 'exponential']).optional().describe('Backoff strategy'),
    retry_on: z
      .array(z.number().int().min(400).max(599))
      .max(10)
      .optional()
      .describe('HTTP status codes to retry on'),
    retry_delay_ms: z
      .number()
      .int()
      .min(100)
      .max(60000)
      .optional()
      .describe('Initial delay between retries in ms'),
  })
  .optional()
  .describe('Retry configuration');

/** Rate limit configuration */
export const rateLimitSchema = z
  .object({
    requests_per_minute: z
      .number()
      .int()
      .min(1)
      .max(10000)
      .optional()
      .describe('Max requests per minute'),
    requests_per_hour: z
      .number()
      .int()
      .min(1)
      .max(100000)
      .optional()
      .describe('Max requests per hour'),
    concurrent_requests: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe('Max concurrent requests'),
  })
  .optional()
  .describe('Rate limit configuration');

// ============================================================================
// URL Validation (SSRF Prevention)
// ============================================================================

const BLOCKED_HOSTS = ['localhost', '127.0.0.1', '0.0.0.0', '[::1]'];

const BLOCKED_IP_PREFIXES = [
  '10.', // Private Class A
  '172.16.',
  '172.17.',
  '172.18.',
  '172.19.', // Private Class B (partial)
  '172.20.',
  '172.21.',
  '172.22.',
  '172.23.',
  '172.24.',
  '172.25.',
  '172.26.',
  '172.27.',
  '172.28.',
  '172.29.',
  '172.30.',
  '172.31.',
  '192.168.', // Private Class C
  '169.254.', // Link-local
  'fc',
  'fd', // IPv6 private
];

/** Safe URL that blocks private/internal networks */
export const safeUrlSchema = z
  .string()
  .max(MAX_URL_LENGTH)
  .url()
  .refine(
    (url) => {
      try {
        const parsed = new URL(url);
        const host = parsed.hostname.toLowerCase();

        // Block known private hosts
        if (BLOCKED_HOSTS.includes(host)) {
          return false;
        }

        // Block private IP ranges
        if (BLOCKED_IP_PREFIXES.some((prefix) => host.startsWith(prefix))) {
          return false;
        }

        // Only allow http/https
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          return false;
        }

        return true;
      } catch {
        return false;
      }
    },
    { message: 'URL must be a public HTTP/HTTPS endpoint (no localhost or private IPs)' },
  )
  .describe('Public API endpoint URL');

// ============================================================================
// Attribute Value Schema
// ============================================================================

/** Attribute value - can be string, number, boolean, or null */
export const attributeValueSchema = z
  .union([z.string().max(MAX_STRING_LENGTH), z.number(), z.boolean(), z.null()])
  .optional()
  .describe('Attribute value');

// ============================================================================
// Example Schemas
// ============================================================================

/** Ticket content for examples */
export const ticketContentSchema = z
  .object({
    customer_message: z
      .string()
      .max(MAX_STRING_LENGTH)
      .optional()
      .describe('Original customer message'),
    sentiment: z.string().max(50).optional().describe('Detected sentiment'),
    priority: z.string().max(50).optional().describe('Ticket priority'),
    tags: z.array(z.string().max(100)).max(20).optional().describe('Associated tags'),
    category: z.string().max(100).optional().describe('Ticket category'),
    language: z.string().max(10).optional().describe('Language code'),
  })
  .optional()
  .describe('Ticket content object');

/** Response content for examples */
export const responseContentSchema = z
  .object({
    message: z.string().max(MAX_STRING_LENGTH).optional().describe('Agent response message'),
    tone: z.string().max(50).optional().describe('Response tone'),
    actions_taken: z
      .array(z.string().max(200))
      .max(20)
      .optional()
      .describe('Actions taken by agent'),
    follow_up_required: z.boolean().optional().describe('Whether follow-up is needed'),
    resolution_status: z.string().max(50).optional().describe('Resolution status'),
  })
  .optional()
  .describe('Response content object');

// ============================================================================
// Bulk Operation Schemas
// ============================================================================

/** Array of UUIDs for bulk operations */
export const bulkIdsSchema = z
  .array(z.string().uuid())
  .min(1)
  .max(MAX_ARRAY_LENGTH)
  .describe('Array of UUIDs for bulk operation');
