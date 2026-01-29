import { GraphQLClient } from 'graphql-request';

export type GraphQLAuth =
  | { type: 'admin_secret'; adminSecret: string }
  | { type: 'cli_token'; token: string };

const RETRYABLE_STATUS_CODES = new Set([502, 503, 504]);
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

function isTransientError(error: unknown): boolean {
  if (error instanceof TypeError) return true; // network failures
  const gqlError = error as { response?: { status?: number }; code?: string };
  if (gqlError?.response?.status && RETRYABLE_STATUS_CODES.has(gqlError.response.status)) return true;
  if (gqlError?.code === 'ECONNRESET' || gqlError?.code === 'ECONNREFUSED' || gqlError?.code === 'ETIMEDOUT') return true;
  return false;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function createGraphQLClient(
  endpoint: string,
  auth: GraphQLAuth,
  orgId?: string
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

export async function executeQuery<T = Record<string, unknown>>(
  client: GraphQLClient,
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await client.request<T>(query, variables);
    } catch (error: unknown) {
      lastError = error;
      if (attempt < MAX_RETRIES && isTransientError(error)) {
        const backoff = BASE_DELAY_MS * Math.pow(2, attempt);
        await delay(backoff);
        continue;
      }
      break;
    }
  }

  const gqlError = lastError as { response?: { errors?: Array<{ message: string }> }; message?: string };
  const message = gqlError?.response?.errors?.[0]?.message || gqlError?.message || 'Unknown GraphQL error';
  throw new Error(message);
}
