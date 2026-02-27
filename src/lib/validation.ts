/**
 * Shared Zod validation schemas for MCP tools
 * Replaces loose z.any() with strict, type-safe schemas
 */
import { isIP } from 'node:net';
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

const BLOCKED_HOSTS = new Set(['localhost', 'localhost.localdomain']);
const BLOCKED_HOST_SUFFIXES = ['.localhost', '.local', '.localdomain', '.internal'];

function isBlockedHostname(host: string): boolean {
  if (BLOCKED_HOSTS.has(host)) return true;
  return BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

function normalizeHost(host: string): string {
  const lowered = host.toLowerCase();
  const bracketMatch = /^\[(.*)\]$/.exec(lowered);
  return (bracketMatch ? bracketMatch[1] : lowered).split('%')[0];
}

function parseIPv4(host: string): number[] | null {
  const parts = host.split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => Number.parseInt(part, 10));
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return null;
  }
  return octets;
}

function isPrivateIPv4(host: string): boolean {
  const octets = parseIPv4(host);
  if (!octets) return false;
  const [a, b] = octets;

  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true;

  return false;
}

function parseMappedIPv4(host: string): string | null {
  const normalized = host.toLowerCase();
  if (!normalized.startsWith('::ffff:')) return null;
  const mapped = normalized.slice('::ffff:'.length);
  const dotted = parseIPv4(mapped);
  if (dotted) return mapped;

  const hexParts = mapped.split(':');
  if (hexParts.length === 1) {
    const [part] = hexParts;
    if (!/^[0-9a-f]{1,8}$/.test(part)) return null;
    const value = Number.parseInt(part, 16);
    if (!Number.isFinite(value) || value < 0 || value > 0xffffffff) return null;
    return `${(value >>> 24) & 0xff}.${(value >>> 16) & 0xff}.${(value >>> 8) & 0xff}.${value & 0xff}`;
  }

  if (hexParts.length === 2) {
    const [highHex, lowHex] = hexParts;
    if (!/^[0-9a-f]{1,4}$/.test(highHex) || !/^[0-9a-f]{1,4}$/.test(lowHex)) return null;
    const high = Number.parseInt(highHex, 16);
    const low = Number.parseInt(lowHex, 16);
    const value = high * 0x10000 + low;
    return `${(value >>> 24) & 0xff}.${(value >>> 16) & 0xff}.${(value >>> 8) & 0xff}.${value & 0xff}`;
  }

  return null;
}

function isPrivateIPv6(host: string): boolean {
  const normalized = host.toLowerCase().split('%')[0];
  if (normalized === '::1' || normalized === '::') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  if (/^fe[89ab]/.test(normalized)) return true;
  const mapped = parseMappedIPv4(normalized);
  if (mapped && isPrivateIPv4(mapped)) return true;
  return false;
}

function isPrivateIpHost(host: string): boolean {
  const normalized = normalizeHost(host);
  const family = isIP(normalized);
  if (family === 4) return isPrivateIPv4(normalized);
  if (family === 6) return isPrivateIPv6(normalized);
  return false;
}

/** Safe URL that blocks private/internal networks */
export const safeUrlSchema = z
  .string()
  .max(MAX_URL_LENGTH)
  .url()
  .refine(
    (url) => {
      try {
        const parsed = new URL(url);
        const host = normalizeHost(parsed.hostname);

        // Only allow http/https
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          return false;
        }

        // Block known private hosts and internal hostname suffixes.
        if (isBlockedHostname(host)) {
          return false;
        }

        // Block direct private/link-local/loopback IP targets.
        if (isPrivateIpHost(host)) {
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
