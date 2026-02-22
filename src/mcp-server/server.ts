import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { logger } from '../lib/logger.js';
import { getErrorMessage } from '../lib/errors.js';
import { createGraphQLClient, type GraphQLAuth } from './graphql-client.js';
import { getCurrentOrg } from '../config.js';
import {
  type IntegrationFlags,
  getGorgiasConfigFromEnv,
  getIntegrationFlagsFromEnv,
  getKlaviyoConfigFromEnv,
  getLoopConfigFromEnv,
  getRechargeConfigFromEnv,
  getShipFusionConfigFromEnv,
  getShipHawkConfigFromEnv,
  getShipHeroConfigFromEnv,
  getShipStationConfigFromEnv,
  getShopifyConfigFromEnv,
  getZendeskConfigFromEnv,
} from '../integrations/config.js';
import { registerAgentTools } from './tools/agents.js';
import { registerRuleTools } from './tools/rules.js';
import { registerSkillTools } from './tools/skills.js';
import { registerAttributeTools } from './tools/attributes.js';
import { registerExampleTools } from './tools/examples.js';
import { registerEvalTools } from './tools/evals.js';
import { registerDatasetTools } from './tools/datasets.js';
import { registerFunctionTools } from './tools/functions.js';
import { registerResponseTools } from './tools/responses.js';
import { registerKnowledgeBaseTools } from './tools/knowledge-base.js';
import { registerChannelTools } from './tools/channels.js';
import { registerMessageTools } from './tools/messages.js';
import { registerSettingsTools } from './tools/settings.js';
import { registerOrganizationTools } from './tools/organizations.js';
import { registerShopifyHoldsTools } from './tools/shopify-holds.js';
import { registerShopifyOrderTools } from './tools/shopify-orders.js';
import { registerShopifyRefundTools } from './tools/shopify-refunds.js';
import { registerShopifyAdvancedTools } from './tools/shopify-advanced.js';
import { registerGorgiasTools } from './tools/gorgias.js';
import { registerRechargeTools } from './tools/recharge.js';
import { registerKlaviyoTools } from './tools/klaviyo.js';
import { registerLoopTools } from './tools/loop.js';
import { registerShipStationTools } from './tools/shipstation.js';
import { registerShipHeroTools } from './tools/shiphero.js';
import { registerShipFusionTools } from './tools/shipfusion.js';
import { registerShipHawkTools } from './tools/shiphawk.js';
import { registerZendeskTools } from './tools/zendesk.js';

/* ------------------------------------------------------------------ */
/*  Declarative integration registry                                   */
/* ------------------------------------------------------------------ */

interface IntegrationEntry {
  /** Human-readable name used in warning messages. */
  name: string;
  /** Return the config object or null when the integration is not configured. May throw. */
  getConfig: () => unknown;
  /** One or more register functions to call with (server, config, flags).
   *  Each register function has its own typed config parameter (ShopifyConfig, etc.).
   *  Runtime type safety is ensured by the getConfig/register pairing. */
  register: Array<(server: McpServer, config: any, flags: IntegrationFlags) => void>;
}

const INTEGRATIONS: IntegrationEntry[] = [
  {
    name: 'Shopify',
    getConfig: getShopifyConfigFromEnv,
    register: [
      registerShopifyOrderTools,
      registerShopifyHoldsTools,
      registerShopifyRefundTools,
      registerShopifyAdvancedTools,
    ],
  },
  {
    name: 'Gorgias',
    getConfig: getGorgiasConfigFromEnv,
    register: [registerGorgiasTools],
  },
  {
    name: 'Recharge',
    getConfig: getRechargeConfigFromEnv,
    register: [registerRechargeTools],
  },
  {
    name: 'Klaviyo',
    getConfig: getKlaviyoConfigFromEnv,
    register: [registerKlaviyoTools],
  },
  {
    name: 'Loop Returns',
    getConfig: getLoopConfigFromEnv,
    register: [registerLoopTools],
  },
  {
    name: 'ShipStation',
    getConfig: getShipStationConfigFromEnv,
    register: [registerShipStationTools],
  },
  {
    name: 'ShipHero',
    getConfig: getShipHeroConfigFromEnv,
    register: [registerShipHeroTools],
  },
  {
    name: 'ShipFusion',
    getConfig: getShipFusionConfigFromEnv,
    register: [registerShipFusionTools],
  },
  {
    name: 'ShipHawk',
    getConfig: getShipHawkConfigFromEnv,
    register: [registerShipHawkTools],
  },
  {
    name: 'Zendesk',
    getConfig: getZendeskConfigFromEnv,
    register: [registerZendeskTools],
  },
];

export function createServer(): McpServer {
  const { orgId, config: orgConfig } = getCurrentOrg();
  const cliToken = orgConfig.cliToken?.trim();
  const adminSecret = orgConfig.adminSecret?.trim();
  if (!cliToken && !adminSecret) {
    throw new Error(
      `Organization "${orgId}" has missing credentials. Run "response auth login" to authenticate.`,
    );
  }

  const auth: GraphQLAuth = cliToken
    ? { type: 'cli_token', token: cliToken }
    : { type: 'admin_secret', adminSecret: adminSecret! };
  const graphqlClient = createGraphQLClient(orgConfig.graphqlEndpoint, auth, orgId);

  const server = new McpServer(
    { name: 'stateset-response', version: '1.0.0' },
    {
      capabilities: { tools: {} },
    },
  );

  registerAgentTools(server, graphqlClient, orgId);
  registerRuleTools(server, graphqlClient, orgId);
  registerSkillTools(server, graphqlClient, orgId);
  registerAttributeTools(server, graphqlClient, orgId);
  registerExampleTools(server, graphqlClient, orgId);
  registerEvalTools(server, graphqlClient, orgId);
  registerDatasetTools(server, graphqlClient, orgId);
  registerFunctionTools(server, graphqlClient, orgId);
  registerResponseTools(server, graphqlClient, orgId);
  registerKnowledgeBaseTools(server, graphqlClient, orgId);
  registerChannelTools(server, graphqlClient, orgId);
  registerMessageTools(server, graphqlClient, orgId);
  registerSettingsTools(server, graphqlClient, orgId);
  registerOrganizationTools(server, graphqlClient, orgId);

  const integrationFlags = getIntegrationFlagsFromEnv();

  for (const integration of INTEGRATIONS) {
    try {
      const config = integration.getConfig();
      if (config) {
        for (const registerFn of integration.register) {
          registerFn(server, config, integrationFlags);
        }
      }
    } catch (error) {
      logger.warn(`${integration.name} tools disabled: ${getErrorMessage(error)}`);
    }
  }

  return server;
}
