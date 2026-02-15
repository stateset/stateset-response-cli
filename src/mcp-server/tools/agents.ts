import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { GraphQLClient } from 'graphql-request';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { executeQuery } from '../graphql-client.js';

const AGENT_FIELDS = `
  id agent_name agent_type description activated
  voice_model voice_model_id voice_model_provider
  role goal instructions skills attributes metadata
  created_at updated_at org_id
`;

export function registerAgentTools(server: McpServer, client: GraphQLClient, orgId: string) {
  server.tool(
    'list_agents',
    'List all agents for the current organization',
    {
      limit: z.number().optional().describe('Max number of agents to return (default 100)'),
      offset: z.number().optional().describe('Offset for pagination (default 0)'),
    },
    async ({ limit, offset }) => {
      const query = `query ($org_id: String!, $limit: Int!, $offset: Int!) {
        agents(
          where: {org_id: {_eq: $org_id}},
          limit: $limit,
          offset: $offset,
          order_by: { created_at: desc }
        ) { ${AGENT_FIELDS} }
      }`;
      const data = await executeQuery<{ agents: unknown[] }>(client, query, {
        org_id: orgId,
        limit: limit ?? 100,
        offset: offset ?? 0,
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(data.agents, null, 2) }] };
    },
  );

  server.tool(
    'get_agent',
    'Get a specific agent by ID',
    { agent_id: z.string().describe('UUID of the agent') },
    async ({ agent_id }) => {
      const query = `query ($agent_id: uuid!, $org_id: String!) {
        agents(where: {id: {_eq: $agent_id}, org_id: {_eq: $org_id}}) { ${AGENT_FIELDS} }
      }`;
      const data = await executeQuery<{ agents: unknown[] }>(client, query, {
        agent_id,
        org_id: orgId,
      });
      if (!data.agents.length) {
        return { content: [{ type: 'text' as const, text: 'Agent not found' }], isError: true };
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(data.agents[0], null, 2) }],
      };
    },
  );

  server.tool(
    'create_agent',
    'Create a new agent',
    {
      agent_name: z.string().describe('Name of the agent'),
      agent_type: z.string().describe('Type of agent (e.g. "AI Agent", "Reasoning Agent")'),
      description: z.string().optional().describe('Agent description'),
      activated: z.boolean().optional().describe('Whether the agent is activated'),
      voice_model: z.string().optional().describe('Voice model name'),
      voice_model_id: z.string().optional().describe('Voice model ID'),
      voice_model_provider: z.string().optional().describe('Voice model provider'),
      role: z.string().optional().describe('Agent role'),
      goal: z.string().optional().describe('Agent goal'),
      instructions: z.string().optional().describe('Agent instructions'),
    },
    async (args) => {
      const mutation = `mutation ($agent: agents_insert_input!) {
        insert_agents(objects: [$agent]) {
          returning { ${AGENT_FIELDS} }
        }
      }`;
      const agent = {
        id: uuidv4(),
        org_id: orgId,
        agent_name: args.agent_name,
        agent_type: args.agent_type,
        description: args.description || '',
        activated: args.activated !== undefined ? args.activated : true,
        voice_model: args.voice_model || null,
        voice_model_id: args.voice_model_id || null,
        voice_model_provider: args.voice_model_provider || null,
        role: args.role || '',
        goal: args.goal || '',
        instructions: args.instructions || '',
        skills: [],
        attributes: {},
        metadata: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const data = await executeQuery<{ insert_agents: { returning: unknown[] } }>(
        client,
        mutation,
        { agent },
      );
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(data.insert_agents.returning[0], null, 2) },
        ],
      };
    },
  );

  server.tool(
    'update_agent',
    'Update an existing agent',
    {
      id: z.string().describe('UUID of the agent to update'),
      agent_name: z.string().optional().describe('New agent name'),
      agent_type: z.string().optional().describe('New agent type'),
      description: z.string().optional().describe('New description'),
      activated: z.boolean().optional().describe('Activation status'),
      role: z.string().optional().describe('Agent role'),
      goal: z.string().optional().describe('Agent goal'),
      instructions: z.string().optional().describe('Agent instructions'),
      voice_model: z.string().optional().describe('Voice model name'),
      voice_model_id: z.string().optional().describe('Voice model ID'),
      voice_model_provider: z.string().optional().describe('Voice model provider'),
    },
    async (args) => {
      const { id, ...updates } = args;
      const setFields: Record<string, unknown> = {
        ...updates,
        updated_at: new Date().toISOString(),
      };
      // Remove undefined fields
      for (const key of Object.keys(setFields)) {
        if (setFields[key] === undefined) delete setFields[key];
      }
      const mutation = `mutation ($id: uuid!, $org_id: String!, $set: agents_set_input!) {
        update_agents(where: {id: {_eq: $id}, org_id: {_eq: $org_id}}, _set: $set) {
          returning { ${AGENT_FIELDS} }
        }
      }`;
      const data = await executeQuery<{ update_agents: { returning: unknown[] } }>(
        client,
        mutation,
        { id, org_id: orgId, set: setFields },
      );
      if (!data.update_agents.returning.length) {
        return { content: [{ type: 'text' as const, text: 'Agent not found' }], isError: true };
      }
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(data.update_agents.returning[0], null, 2) },
        ],
      };
    },
  );

  server.tool(
    'delete_agent',
    'Delete an agent by ID',
    { id: z.string().describe('UUID of the agent to delete') },
    async ({ id }) => {
      const mutation = `mutation ($id: uuid!, $org_id: String!) {
        delete_agents(where: {id: {_eq: $id}, org_id: {_eq: $org_id}}) {
          returning { id agent_name }
        }
      }`;
      const data = await executeQuery<{ delete_agents: { returning: unknown[] } }>(
        client,
        mutation,
        { id, org_id: orgId },
      );
      if (!data.delete_agents.returning.length) {
        return { content: [{ type: 'text' as const, text: 'Agent not found' }], isError: true };
      }
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ deleted: data.delete_agents.returning[0] }, null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    'bootstrap_agent',
    'Get complete agent configuration including rules, attributes, and agent info',
    { agent_id: z.string().describe('UUID of the agent') },
    async ({ agent_id }) => {
      const rulesQuery = `query ($org_id: String, $agent_id: uuid) {
        rules(where: {org_id: {_eq: $org_id}, agent_id: {_eq: $agent_id}}) {
          id rule_name rule_type activated description created_at updated_at org_id agent_id shared
        }
      }`;
      const attrsQuery = `query ($org_id: String, $agent_id: uuid) {
        attributes(where: {org_id: {_eq: $org_id}, agent_id: {_eq: $agent_id}}) {
          id attribute_name attribute_type activated description created_at updated_at org_id agent_id
        }
      }`;
      const agentQuery = `query ($agent_id: uuid!, $org_id: String!) {
        agents(where: {id: {_eq: $agent_id}, org_id: {_eq: $org_id}}) { ${AGENT_FIELDS} }
      }`;

      const [rulesData, attrsData, agentData] = await Promise.all([
        executeQuery<{ rules: unknown[] }>(client, rulesQuery, { org_id: orgId, agent_id }),
        executeQuery<{ attributes: unknown[] }>(client, attrsQuery, { org_id: orgId, agent_id }),
        executeQuery<{ agents: unknown[] }>(client, agentQuery, { agent_id, org_id: orgId }),
      ]);

      const result = {
        agent_info: agentData.agents[0] || null,
        rules: rulesData.rules || [],
        attributes: attrsData.attributes || [],
      };
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'export_agent',
    'Export a complete agent configuration (agent + rules + skills + attributes + functions) as a single JSON blob for backup or transfer',
    { agent_id: z.string().describe('UUID of the agent to export') },
    async ({ agent_id }) => {
      const agentQuery = `query ($agent_id: uuid!, $org_id: String!) {
        agents(where: {id: {_eq: $agent_id}, org_id: {_eq: $org_id}}) { ${AGENT_FIELDS} }
      }`;
      const rulesQuery = `query ($org_id: String, $agent_id: uuid) {
        rules(where: {org_id: {_eq: $org_id}, agent_id: {_eq: $agent_id}}) {
          id rule_name rule_type activated description created_at updated_at org_id agent_id shared
        }
      }`;
      const skillsQuery = `query ($org_id: String, $agent_id: uuid) {
        skills(where: {org_id: {_eq: $org_id}, agent_id: {_eq: $agent_id}}) {
          id skill_name skill_type activated description created_at updated_at org_id agent_id shared conditions actions metadata
        }
      }`;
      const attrsQuery = `query ($org_id: String, $agent_id: uuid) {
        attributes(where: {org_id: {_eq: $org_id}, agent_id: {_eq: $agent_id}}) {
          id attribute_name attribute_type activated description created_at updated_at org_id agent_id
        }
      }`;
      const functionsQuery = `query ($org_id: String, $agent_id: uuid) {
        functions(where: {org_id: {_eq: $org_id}, agent_id: {_eq: $agent_id}}) {
          id function_name function_type activated description endpoint method
          created_at updated_at org_id agent_id parameters authentication headers
          request_transform response_handling retry_config timeout rate_limit
        }
      }`;

      const vars = { org_id: orgId, agent_id };

      const [agentData, rulesData, skillsData, attrsData, functionsData] = await Promise.all([
        executeQuery<{ agents: unknown[] }>(client, agentQuery, { agent_id, org_id: orgId }),
        executeQuery<{ rules: unknown[] }>(client, rulesQuery, vars),
        executeQuery<{ skills: unknown[] }>(client, skillsQuery, vars),
        executeQuery<{ attributes: unknown[] }>(client, attrsQuery, vars),
        executeQuery<{ functions: unknown[] }>(client, functionsQuery, vars),
      ]);

      if (!agentData.agents.length) {
        return { content: [{ type: 'text' as const, text: 'Agent not found' }], isError: true };
      }

      const exportData = {
        exported_at: new Date().toISOString(),
        agent: agentData.agents[0],
        rules: rulesData.rules || [],
        skills: skillsData.skills || [],
        attributes: attrsData.attributes || [],
        functions: functionsData.functions || [],
      };
      return { content: [{ type: 'text' as const, text: JSON.stringify(exportData, null, 2) }] };
    },
  );
}
