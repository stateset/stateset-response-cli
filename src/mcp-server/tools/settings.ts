import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { GraphQLClient } from 'graphql-request';
import { z } from 'zod';
import { executeQuery } from '../graphql-client.js';
import { errorResult } from './helpers.js';

const AGENT_SETTINGS_FIELDS = `
  id org_id test
  model_name model_type model_provider temperature max_tokens
  agent_take_over_tag time_threshold assignee_user_id
  skip_emails skip_subjects skip_tags skip_channels
  skip_instagram_messages agent_emails active_channels
  out_of_office_keywords
  allowed_intents intent_skip_email
  health_concern_keywords agent_takeover_phrases
  escalation_team_id escalation_tag_name
  stateset_response_gorgias_email stateset_response_gorgias_user_id
  stateset_response_name name_from address_from
  fallback_agent_id language_preferences max_conversation_duration
  profanity_filter
  analytics_platform average_response_time
  customer_satisfaction_score customer_satisfaction_target
  first_contact_resolution_rate handle_time
  resolution_rate resolution_rate_target
  response_time_threshold sentiment_analysis_threshold
  backup_frequency backup_retention_period
  ccpa_compliant gdpr_compliant pci_dss_compliant
  encryption_level data_retention_period
  ip_whitelist two_factor_auth_required
  crm_system ticketing_system
  training_data_sources training_frequency training_last_updated
  created_at updated_at
`;

export function registerSettingsTools(server: McpServer, client: GraphQLClient, orgId: string) {
  // ── Agent Settings ──────────────────────────────────────────────────

  server.tool(
    'list_agent_settings',
    'List all agent settings configurations for the current organization',
    {},
    async () => {
      const query = `query ($org_id: String!) {
        agent_settings(where: { org_id: { _eq: $org_id } }) {
          ${AGENT_SETTINGS_FIELDS}
        }
      }`;
      const data = await executeQuery<{ agent_settings: unknown[] }>(client, query, {
        org_id: orgId,
      });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(data.agent_settings, null, 2) }],
      };
    },
  );

  server.tool(
    'get_agent_settings',
    'Get agent settings by ID',
    { id: z.number().describe('ID of the agent settings record') },
    async ({ id }) => {
      const query = `query ($id: Int!, $org_id: String!) {
        agent_settings(where: { id: { _eq: $id }, org_id: { _eq: $org_id } }) {
          ${AGENT_SETTINGS_FIELDS}
        }
      }`;
      const data = await executeQuery<{ agent_settings: unknown[] }>(client, query, {
        id,
        org_id: orgId,
      });
      if (!data.agent_settings.length) {
        return errorResult('Agent settings not found');
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(data.agent_settings[0], null, 2) }],
      };
    },
  );

  server.tool(
    'update_agent_settings',
    'Update agent settings configuration (model, channels, escalation, compliance, analytics, etc.)',
    {
      id: z.number().describe('ID of the agent settings record to update'),
      test: z.boolean().optional().describe('Enable test mode'),
      model_name: z.string().optional().describe('AI model name'),
      model_type: z
        .string()
        .optional()
        .describe('Model type (Instruct, Function Calling, Reasoning)'),
      model_provider: z.string().optional().describe('Model provider'),
      temperature: z.number().optional().describe('Temperature 0-1'),
      max_tokens: z.number().optional().describe('Max response tokens'),
      agent_take_over_tag: z.string().optional().describe('Tag triggering human takeover'),
      time_threshold: z.number().optional().describe('Response time threshold in ms'),
      assignee_user_id: z.string().optional().describe('Default assignee user ID'),
      skip_emails: z.array(z.string()).optional().describe('Email addresses to skip'),
      skip_subjects: z.array(z.string()).optional().describe('Subject keywords to skip'),
      skip_tags: z.array(z.string()).optional().describe('Message tags to skip'),
      skip_channels: z.array(z.string()).optional().describe('Channel names to skip'),
      skip_instagram_messages: z
        .array(z.string())
        .optional()
        .describe('Instagram patterns to skip'),
      agent_emails: z.array(z.string()).optional().describe('Agent email addresses'),
      active_channels: z.array(z.string()).optional().describe('Active channels'),
      out_of_office_keywords: z
        .array(z.string())
        .optional()
        .describe('Out-of-office detection keywords'),
      allowed_intents: z.array(z.string()).optional().describe('Allowed intent names'),
      health_concern_keywords: z
        .array(z.string())
        .optional()
        .describe('Escalation trigger keywords'),
      agent_takeover_phrases: z
        .array(z.string())
        .optional()
        .describe('Human takeover trigger phrases'),
      escalation_team_id: z.string().optional().describe('Team ID for escalation'),
      escalation_tag_name: z.string().optional().describe('Tag name for escalated tickets'),
      stateset_response_gorgias_email: z.string().optional().describe('Support email for Gorgias'),
      stateset_response_name: z.string().optional().describe('Response system display name'),
      name_from: z.string().optional().describe('From name in messages'),
      address_from: z.string().optional().describe('From address in messages'),
      fallback_agent_id: z.string().optional().describe('Fallback agent ID'),
      language_preferences: z.array(z.string()).optional().describe('Language codes'),
      max_conversation_duration: z.number().optional().describe('Max conversation duration in ms'),
      profanity_filter: z.boolean().optional().describe('Enable profanity filter'),
      response_time_threshold: z.number().optional().describe('Response SLA in ms'),
      sentiment_analysis_threshold: z.number().optional().describe('Sentiment threshold -1 to 1'),
      customer_satisfaction_target: z.number().optional().describe('Target satisfaction score 0-5'),
      resolution_rate_target: z.number().optional().describe('Target resolution rate percentage'),
    },
    async (args) => {
      const { id, ...updates } = args;
      const setFields: Record<string, unknown> = { updated_at: new Date().toISOString() };
      for (const [key, value] of Object.entries(updates)) {
        if (value !== undefined) setFields[key] = value;
      }

      const mutation = `mutation ($id: Int!, $org_id: String!, $set: agent_settings_set_input!) {
        update_agent_settings(
          where: { id: { _eq: $id }, org_id: { _eq: $org_id } },
          _set: $set
        ) {
          affected_rows
          returning { ${AGENT_SETTINGS_FIELDS} }
        }
      }`;
      const data = await executeQuery<{
        update_agent_settings: { affected_rows: number; returning: unknown[] };
      }>(client, mutation, { id, org_id: orgId, set: setFields });
      if (!data.update_agent_settings.returning.length) {
        return errorResult('Agent settings not found');
      }
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(data.update_agent_settings.returning[0], null, 2),
          },
        ],
      };
    },
  );

  // ── Channel Settings ────────────────────────────────────────────────

  server.tool(
    'get_channel_settings',
    'Get channel settings showing which communication channels are enabled for the organization',
    {},
    async () => {
      const query = `query ($org_id: String!) {
        organizations(where: { org_id: { _eq: $org_id } }, limit: 1) {
          org_id organization_name
          channel_settings {
            chat email sms
            facebook facebook_comments facebook_messenger
            instagram_comments instagram_ad_comments instagram_direct_messages
          }
        }
      }`;
      const data = await executeQuery<{ organizations: unknown[] }>(client, query, {
        org_id: orgId,
      });
      if (!data.organizations.length) {
        return errorResult('Organization not found');
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(data.organizations[0], null, 2) }],
      };
    },
  );
}
