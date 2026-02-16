import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { logger } from '../lib/logger.js';
import { createGraphQLClient, type GraphQLAuth } from './graphql-client.js';
import { getCurrentOrg } from '../config.js';
import {
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

  try {
    const shopify = getShopifyConfigFromEnv();
    if (shopify) {
      registerShopifyOrderTools(server, shopify, integrationFlags);
      registerShopifyHoldsTools(server, shopify, integrationFlags);
      registerShopifyRefundTools(server, shopify, integrationFlags);
      registerShopifyAdvancedTools(server, shopify, integrationFlags);
    }
  } catch (error) {
    logger.warn(
      `Shopify tools disabled: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  try {
    const gorgias = getGorgiasConfigFromEnv();
    if (gorgias) {
      registerGorgiasTools(server, gorgias, integrationFlags);
    }
  } catch (error) {
    logger.warn(
      `Gorgias tools disabled: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  try {
    const recharge = getRechargeConfigFromEnv();
    if (recharge) {
      registerRechargeTools(server, recharge, integrationFlags);
    }
  } catch (error) {
    logger.warn(
      `Recharge tools disabled: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  try {
    const klaviyo = getKlaviyoConfigFromEnv();
    if (klaviyo) {
      registerKlaviyoTools(server, klaviyo, integrationFlags);
    }
  } catch (error) {
    logger.warn(
      `Klaviyo tools disabled: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  try {
    const loop = getLoopConfigFromEnv();
    if (loop) {
      registerLoopTools(server, loop, integrationFlags);
    }
  } catch (error) {
    logger.warn(
      `Loop Returns tools disabled: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  try {
    const shipstation = getShipStationConfigFromEnv();
    if (shipstation) {
      registerShipStationTools(server, shipstation, integrationFlags);
    }
  } catch (error) {
    logger.warn(
      `ShipStation tools disabled: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  try {
    const shiphero = getShipHeroConfigFromEnv();
    if (shiphero) {
      registerShipHeroTools(server, shiphero, integrationFlags);
    }
  } catch (error) {
    logger.warn(
      `ShipHero tools disabled: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  try {
    const shipfusion = getShipFusionConfigFromEnv();
    if (shipfusion) {
      registerShipFusionTools(server, shipfusion, integrationFlags);
    }
  } catch (error) {
    logger.warn(
      `ShipFusion tools disabled: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  try {
    const shiphawk = getShipHawkConfigFromEnv();
    if (shiphawk) {
      registerShipHawkTools(server, shiphawk, integrationFlags);
    }
  } catch (error) {
    logger.warn(
      `ShipHawk tools disabled: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  try {
    const zendesk = getZendeskConfigFromEnv();
    if (zendesk) {
      registerZendeskTools(server, zendesk, integrationFlags);
    }
  } catch (error) {
    logger.warn(
      `Zendesk tools disabled: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return server;
}
