import crypto from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { GraphQLClient } from 'graphql-request';
import { z } from 'zod';
import { executeQuery } from '../graphql-client.js';
import { errorResult } from './helpers.js';

const MAX_LIST_LIMIT = 200;
const DEFAULT_LIST_LIMIT = 50;
const ALLOWED_EVENTS = [
  'response.created',
  'response.rated',
  'agent.message',
  'feed.completed',
  'feed.failed',
  'escalation.created',
  'escalation.assigned',
  'escalation.resolved',
] as const;

const WEBHOOK_FIELDS = `
  id
  url
  events
  is_active
  last_triggered_at
  failure_count
  created_at
  updated_at
`;

const WEBHOOK_CREATE_FIELDS = `
  id
  url
  events
  is_active
  secret
  created_at
`;

const WEBHOOK_DELIVERY_FIELDS = `
  id
  webhook_id
  event_type
  status_code
  success
  error_message
  delivered_at
`;

function normalizeLimit(value: number | undefined, fallback = DEFAULT_LIST_LIMIT): number {
  if (!Number.isFinite(value) || !Number.isInteger(value) || (value as number) < 1) {
    return fallback;
  }
  return Math.min(value as number, MAX_LIST_LIMIT);
}

function normalizeOffset(value: number | undefined): number {
  if (!Number.isFinite(value) || !Number.isInteger(value) || (value as number) < 0) {
    return 0;
  }
  return value as number;
}

function normalizeEventList(events: string[]): string[] {
  return Array.from(
    new Set(
      events
        .map((event) => event.trim())
        .filter(Boolean)
        .filter((event) => ALLOWED_EVENTS.includes(event as (typeof ALLOWED_EVENTS)[number])),
    ),
  );
}

export function registerWebhookTools(server: McpServer, client: GraphQLClient, orgId: string) {
  server.tool(
    'list_webhooks',
    'List webhook subscriptions for the current organization',
    {
      limit: z.number().int().positive().max(MAX_LIST_LIMIT).optional(),
      offset: z.number().int().min(0).optional(),
      active: z.boolean().optional().describe('Optional active-state filter'),
    },
    async ({ limit, offset, active }) => {
      const where: Record<string, unknown> = { org_id: { _eq: orgId } };
      if (active !== undefined) {
        where.is_active = { _eq: active };
      }

      const query = `query ($where: webhooks_bool_exp!, $limit: Int!, $offset: Int!) {
        webhooks(
          where: $where
          order_by: { created_at: desc }
          limit: $limit
          offset: $offset
        ) {
          ${WEBHOOK_FIELDS}
        }
      }`;
      const data = await executeQuery<{ webhooks: unknown[] }>(client, query, {
        where,
        limit: normalizeLimit(limit, 100),
        offset: normalizeOffset(offset),
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(data.webhooks, null, 2) }] };
    },
  );

  server.tool(
    'get_webhook',
    'Get a specific webhook subscription by ID',
    {
      id: z.string().uuid().describe('Webhook UUID'),
    },
    async ({ id }) => {
      const query = `query ($id: uuid!, $org_id: String!) {
        webhooks(where: { id: { _eq: $id }, org_id: { _eq: $org_id } }, limit: 1) {
          ${WEBHOOK_FIELDS}
        }
      }`;
      const data = await executeQuery<{ webhooks: unknown[] }>(client, query, {
        id,
        org_id: orgId,
      });
      if (!data.webhooks.length) {
        return errorResult('Webhook not found');
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(data.webhooks[0], null, 2) }],
      };
    },
  );

  server.tool(
    'create_webhook',
    'Create a new webhook subscription',
    {
      url: z.string().url().describe('Destination URL'),
      events: z
        .array(z.string())
        .min(1)
        .describe(`Allowed events: ${ALLOWED_EVENTS.join(', ')}`),
      is_active: z.boolean().optional().describe('Whether the webhook starts enabled'),
    },
    async ({ url, events, is_active }) => {
      const validEvents = normalizeEventList(events);
      if (validEvents.length === 0) {
        return errorResult(
          `At least one valid event required. Options: ${ALLOWED_EVENTS.join(', ')}`,
        );
      }

      const mutation = `mutation ($object: webhooks_insert_input!) {
        insert_webhooks_one(object: $object) {
          ${WEBHOOK_CREATE_FIELDS}
        }
      }`;
      const data = await executeQuery<{ insert_webhooks_one: unknown }>(client, mutation, {
        object: {
          org_id: orgId,
          url,
          events: validEvents,
          secret: `whsec_${crypto.randomBytes(24).toString('hex')}`,
          ...(is_active !== undefined ? { is_active } : {}),
        },
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(data.insert_webhooks_one, null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    'update_webhook',
    'Update an existing webhook subscription',
    {
      id: z.string().uuid().describe('Webhook UUID'),
      url: z.string().url().optional().describe('Updated destination URL'),
      events: z
        .array(z.string())
        .optional()
        .describe(`Allowed events: ${ALLOWED_EVENTS.join(', ')}`),
      is_active: z.boolean().optional().describe('Enable or disable the webhook'),
    },
    async ({ id, url, events, is_active }) => {
      const set: Record<string, unknown> = {};
      if (url !== undefined) {
        set.url = url;
      }
      if (events !== undefined) {
        const validEvents = normalizeEventList(events);
        if (validEvents.length === 0) {
          return errorResult(
            `At least one valid event required. Options: ${ALLOWED_EVENTS.join(', ')}`,
          );
        }
        set.events = validEvents;
      }
      if (is_active !== undefined) {
        set.is_active = is_active;
      }
      if (Object.keys(set).length === 0) {
        return errorResult('No webhook fields provided to update');
      }
      set.updated_at = new Date().toISOString();

      const mutation = `mutation ($id: uuid!, $org_id: String!, $set: webhooks_set_input!) {
        update_webhooks(
          where: { id: { _eq: $id }, org_id: { _eq: $org_id } }
          _set: $set
        ) {
          returning {
            ${WEBHOOK_FIELDS}
          }
        }
      }`;
      const data = await executeQuery<{ update_webhooks: { returning: unknown[] } }>(
        client,
        mutation,
        {
          id,
          org_id: orgId,
          set,
        },
      );
      if (!data.update_webhooks.returning.length) {
        return errorResult('Webhook not found');
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(data.update_webhooks.returning[0], null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    'delete_webhook',
    'Delete a webhook subscription by ID',
    {
      id: z.string().uuid().describe('Webhook UUID'),
    },
    async ({ id }) => {
      const mutation = `mutation ($id: uuid!, $org_id: String!) {
        delete_webhooks(where: { id: { _eq: $id }, org_id: { _eq: $org_id } }) {
          returning {
            ${WEBHOOK_FIELDS}
          }
        }
      }`;
      const data = await executeQuery<{ delete_webhooks: { returning: unknown[] } }>(
        client,
        mutation,
        {
          id,
          org_id: orgId,
        },
      );
      if (!data.delete_webhooks.returning.length) {
        return errorResult('Webhook not found');
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ deleted: data.delete_webhooks.returning[0] }, null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    'list_webhook_deliveries',
    'List webhook deliveries for the current organization',
    {
      webhook_id: z.string().uuid().optional().describe('Optional webhook UUID filter'),
      limit: z.number().int().positive().max(MAX_LIST_LIMIT).optional(),
      offset: z.number().int().min(0).optional(),
    },
    async ({ webhook_id, limit, offset }) => {
      const where: Record<string, unknown> = { org_id: { _eq: orgId } };
      if (webhook_id) {
        where.webhook_id = { _eq: webhook_id };
      }

      const query = `query ($where: webhook_deliveries_bool_exp!, $limit: Int!, $offset: Int!) {
        webhook_deliveries(
          where: $where
          order_by: { delivered_at: desc }
          limit: $limit
          offset: $offset
        ) {
          ${WEBHOOK_DELIVERY_FIELDS}
        }
      }`;
      const data = await executeQuery<{ webhook_deliveries: unknown[] }>(client, query, {
        where,
        limit: normalizeLimit(limit),
        offset: normalizeOffset(offset),
      });
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(data.webhook_deliveries, null, 2),
          },
        ],
      };
    },
  );
}
