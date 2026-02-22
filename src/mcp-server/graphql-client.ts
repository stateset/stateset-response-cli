import { GraphQLClient } from 'graphql-request';

export type GraphQLAuth =
  | { type: 'admin_secret'; adminSecret: string }
  | { type: 'cli_token'; token: string };

const RETRYABLE_STATUS_CODES = new Set([502, 503, 504]);
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const DEFAULT_TIMEOUT_MS = 30000; // 30 seconds

function isTransientError(error: unknown): boolean {
  if (error instanceof TypeError) return true; // network failures
  const gqlError = error as { response?: { status?: number }; code?: string };
  if (gqlError?.response?.status && RETRYABLE_STATUS_CODES.has(gqlError.response.status))
    return true;
  if (
    gqlError?.code === 'ECONNRESET' ||
    gqlError?.code === 'ECONNREFUSED' ||
    gqlError?.code === 'ETIMEDOUT'
  )
    return true;
  return false;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createGraphQLClient(
  endpoint: string,
  auth: GraphQLAuth,
  orgId?: string,
): GraphQLClient {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (auth.type === 'admin_secret') {
    headers['x-hasura-admin-secret'] = auth.adminSecret;
  } else if (auth.type === 'cli_token') {
    headers['Authorization'] = `Bearer ${auth.token}`;
  }

  if (orgId) {
    headers['x-stateset-org-id'] = orgId;
  }

  return new GraphQLClient(endpoint, { headers });
}

export interface ExecuteQueryOptions {
  /** Timeout in milliseconds (default: 30000) */
  timeoutMs?: number;
}

export async function executeQuery<T = Record<string, unknown>>(
  client: GraphQLClient,
  query: string,
  variables?: Record<string, unknown>,
  options?: ExecuteQueryOptions,
): Promise<T> {
  const rawTimeout = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timeoutMs = Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : DEFAULT_TIMEOUT_MS;
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Create abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const result = await client.request<T>({
          document: query,
          variables,
          signal: controller.signal,
        });
        return result;
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error: unknown) {
      lastError = error;

      // Check if it was a timeout
      const isTimeout =
        error instanceof Error &&
        (error.name === 'AbortError' || error.message.includes('timed out'));

      if (attempt < MAX_RETRIES && (isTimeout || isTransientError(error))) {
        const backoff = BASE_DELAY_MS * Math.pow(2, attempt);
        await delay(backoff);
        continue;
      }
      break;
    }
  }

  const gqlError = lastError as {
    response?: { errors?: Array<{ message: string }> };
    message?: string;
  };
  const message =
    gqlError?.response?.errors?.[0]?.message || gqlError?.message || 'Unknown GraphQL error';
  throw new Error(message);
}
