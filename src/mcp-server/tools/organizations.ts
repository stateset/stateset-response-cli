import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { GraphQLClient } from 'graphql-request';
import { z } from 'zod';
import { executeQuery } from '../graphql-client.js';

const ORG_FIELDS = `
  id org_id organization_name created_date created_by slug logo_url
`;

export function registerOrganizationTools(server: McpServer, client: GraphQLClient, orgId: string) {
  server.tool(
    'get_organization',
    'Get the current organization profile and metadata',
    {},
    async () => {
      const query = `query ($org_id: String!) {
        organizations(where: { org_id: { _eq: $org_id } }, limit: 1) {
          ${ORG_FIELDS}
        }
      }`;
      const data = await executeQuery<{ organizations: unknown[] }>(client, query, {
        org_id: orgId,
      });
      if (!data.organizations.length) {
        return {
          content: [{ type: 'text' as const, text: 'Organization not found' }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(data.organizations[0], null, 2) }],
      };
    },
  );

  server.tool(
    'get_organization_overview',
    'Get a comprehensive overview of the organization including profile, channel settings, and resource counts',
    {},
    async () => {
      const query = `query ($org_id: String!) {
        organizations(where: { org_id: { _eq: $org_id } }, limit: 1) {
          ${ORG_FIELDS}
          channel_settings {
            chat email sms
            facebook facebook_comments facebook_messenger
            instagram_comments instagram_ad_comments instagram_direct_messages
          }
        }
        agents_aggregate(where: { org_id: { _eq: $org_id } }) {
          aggregate { count }
        }
        rules_aggregate(where: { org_id: { _eq: $org_id } }) {
          aggregate { count }
        }
        skills_aggregate(where: { org_id: { _eq: $org_id } }) {
          aggregate { count }
        }
        responses_aggregate(where: { org_id: { _eq: $org_id } }) {
          aggregate { count }
        }
        channel_thread_aggregate(where: { org_id: { _eq: $org_id } }) {
          aggregate { count }
        }
        datasets_aggregate(where: { org_id: { _eq: $org_id } }) {
          aggregate { count }
        }
        functions_aggregate(where: { org_id: { _eq: $org_id } }) {
          aggregate { count }
        }
      }`;
      const data = await executeQuery<Record<string, unknown>>(client, query, { org_id: orgId });

      const orgs = data.organizations as unknown[];
      if (!orgs?.length) {
        return {
          content: [{ type: 'text' as const, text: 'Organization not found' }],
          isError: true,
        };
      }

      const agg = (key: string) =>
        (data[key] as { aggregate?: { count?: number } })?.aggregate?.count ?? 0;

      const overview = {
        organization: orgs[0],
        counts: {
          agents: agg('agents_aggregate'),
          rules: agg('rules_aggregate'),
          skills: agg('skills_aggregate'),
          responses: agg('responses_aggregate'),
          channels: agg('channel_thread_aggregate'),
          datasets: agg('datasets_aggregate'),
          functions: agg('functions_aggregate'),
        },
      };

      return { content: [{ type: 'text' as const, text: JSON.stringify(overview, null, 2) }] };
    },
  );

  server.tool(
    'update_organization',
    'Update the current organization profile',
    {
      organization_name: z.string().optional().describe('New organization name'),
      slug: z.string().optional().describe('New URL slug'),
      logo_url: z.string().optional().describe('New logo URL'),
    },
    async (args) => {
      const setFields: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(args)) {
        if (value !== undefined) setFields[key] = value;
      }
      if (Object.keys(setFields).length === 0) {
        return { content: [{ type: 'text' as const, text: 'No fields to update' }], isError: true };
      }

      const mutation = `mutation ($org_id: String!, $set: organizations_set_input!) {
        update_organizations(
          where: { org_id: { _eq: $org_id } },
          _set: $set
        ) {
          affected_rows
          returning { ${ORG_FIELDS} }
        }
      }`;
      const data = await executeQuery<{
        update_organizations: { affected_rows: number; returning: unknown[] };
      }>(client, mutation, { org_id: orgId, set: setFields });
      if (!data.update_organizations.returning.length) {
        return {
          content: [{ type: 'text' as const, text: 'Organization not found' }],
          isError: true,
        };
      }
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(data.update_organizations.returning[0], null, 2),
          },
        ],
      };
    },
  );
}
