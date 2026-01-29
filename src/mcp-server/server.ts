import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createGraphQLClient, type GraphQLAuth } from './graphql-client.js';
import { getCurrentOrg } from '../config.js';
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

export function createServer(): McpServer {
  const { orgId, config: orgConfig } = getCurrentOrg();
  const auth: GraphQLAuth = orgConfig.cliToken
    ? { type: 'cli_token', token: orgConfig.cliToken }
    : { type: 'admin_secret', adminSecret: orgConfig.adminSecret || '' };
  const graphqlClient = createGraphQLClient(orgConfig.graphqlEndpoint, auth, orgId);

  const server = new McpServer(
    { name: 'stateset-response', version: '1.0.0' },
    {
      capabilities: { tools: {} },
    }
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

  return server;
}
