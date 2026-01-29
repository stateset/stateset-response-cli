import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { GraphQLClient } from 'graphql-request';
import { z } from 'zod';
import { executeQuery } from '../graphql-client.js';

const RULE_FIELDS = `
  id rule_name rule_type activated description
  created_at updated_at org_id agent_id shared
  conditions actions metadata
`;

export function registerRuleTools(server: McpServer, client: GraphQLClient, orgId: string) {

  server.tool(
    'list_rules',
    'List all rules for the current organization',
    {
      limit: z.number().optional().describe('Max number of rules to return (default 100)'),
      offset: z.number().optional().describe('Offset for pagination (default 0)'),
    },
    async ({ limit, offset }) => {
      const query = `query ($org_id: String, $limit: Int!, $offset: Int!) {
        rules(
          where: {org_id: {_eq: $org_id}},
          limit: $limit,
          offset: $offset,
          order_by: { created_at: desc }
        ) { ${RULE_FIELDS} }
      }`;
      const data = await executeQuery<{ rules: unknown[] }>(client, query, {
        org_id: orgId,
        limit: limit ?? 100,
        offset: offset ?? 0,
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(data.rules, null, 2) }] };
    }
  );

  server.tool(
    'get_agent_rules',
    'Get all rules assigned to a specific agent',
    {
      agent_id: z.string().describe('UUID of the agent'),
      limit: z.number().optional().describe('Max number of rules to return (default 100)'),
      offset: z.number().optional().describe('Offset for pagination (default 0)'),
    },
    async ({ agent_id, limit, offset }) => {
      const query = `query ($org_id: String, $agent_id: uuid, $limit: Int!, $offset: Int!) {
        rules(
          where: {org_id: {_eq: $org_id}, agent_id: {_eq: $agent_id}},
          limit: $limit,
          offset: $offset,
          order_by: { created_at: desc }
        ) { ${RULE_FIELDS} }
      }`;
      const data = await executeQuery<{ rules: unknown[] }>(client, query, {
        org_id: orgId,
        agent_id,
        limit: limit ?? 100,
        offset: offset ?? 0,
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(data.rules, null, 2) }] };
    }
  );

  server.tool(
    'create_rule',
    'Create a new rule',
    {
      rule_name: z.string().describe('Name of the rule'),
      rule_type: z.string().describe('Type of rule'),
      description: z.string().optional().describe('Rule description'),
      agent_id: z.string().optional().describe('UUID of agent to assign rule to'),
      activated: z.boolean().optional().describe('Whether the rule is activated'),
      shared: z.boolean().optional().describe('Whether the rule is shared across agents'),
      conditions: z.any().optional().describe('Rule conditions object with "any" or "all" arrays'),
      actions: z.array(z.any()).optional().describe('Array of actions to execute'),
      metadata: z.any().optional().describe('Additional metadata'),
    },
    async (args) => {
      const mutation = `mutation ($rule: rules_insert_input!) {
        insert_rules(objects: [$rule]) {
          returning { ${RULE_FIELDS} }
        }
      }`;
      const rule = {
        org_id: orgId,
        rule_name: args.rule_name,
        rule_type: args.rule_type,
        description: args.description || '',
        agent_id: args.agent_id || null,
        activated: args.activated !== undefined ? args.activated : true,
        shared: args.shared || false,
        conditions: args.conditions || { any: [] },
        actions: args.actions || [],
        metadata: args.metadata || { category: '', compliance: '', last_reviewed: new Date().toISOString() },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const data = await executeQuery<{ insert_rules: { returning: unknown[] } }>(client, mutation, { rule });
      return { content: [{ type: 'text' as const, text: JSON.stringify(data.insert_rules.returning[0], null, 2) }] };
    }
  );

  server.tool(
    'update_rule',
    'Update an existing rule',
    {
      id: z.string().describe('UUID of the rule to update'),
      rule_name: z.string().optional().describe('New rule name'),
      rule_type: z.string().optional().describe('New rule type'),
      description: z.string().optional().describe('New description'),
      activated: z.boolean().optional().describe('Activation status'),
      shared: z.boolean().optional().describe('Shared status'),
      agent_id: z.string().optional().describe('UUID of agent to assign to'),
      conditions: z.any().optional().describe('Updated conditions'),
      actions: z.array(z.any()).optional().describe('Updated actions'),
      metadata: z.any().optional().describe('Updated metadata'),
    },
    async (args) => {
      const { id, ...updates } = args;
      const setFields: Record<string, unknown> = { ...updates, updated_at: new Date().toISOString() };
      for (const key of Object.keys(setFields)) {
        if (setFields[key] === undefined) delete setFields[key];
      }
      const mutation = `mutation ($id: uuid!, $org_id: String!, $set: rules_set_input!) {
        update_rules(where: {id: {_eq: $id}, org_id: {_eq: $org_id}}, _set: $set) {
          returning { ${RULE_FIELDS} }
        }
      }`;
      const data = await executeQuery<{ update_rules: { returning: unknown[] } }>(client, mutation, { id, org_id: orgId, set: setFields });
      if (!data.update_rules.returning.length) {
        return { content: [{ type: 'text' as const, text: 'Rule not found' }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(data.update_rules.returning[0], null, 2) }] };
    }
  );

  server.tool(
    'delete_rule',
    'Delete a rule by ID',
    { id: z.string().describe('UUID of the rule to delete') },
    async ({ id }) => {
      const mutation = `mutation ($id: uuid!, $org_id: String!) {
        delete_rules(where: {id: {_eq: $id}, org_id: {_eq: $org_id}}) {
          returning { id rule_name }
        }
      }`;
      const data = await executeQuery<{ delete_rules: { returning: unknown[] } }>(client, mutation, { id, org_id: orgId });
      if (!data.delete_rules.returning.length) {
        return { content: [{ type: 'text' as const, text: 'Rule not found' }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify({ deleted: data.delete_rules.returning[0] }, null, 2) }] };
    }
  );

  server.tool(
    'import_rules',
    'Bulk import rules (upserts on primary key conflict)',
    {
      rules: z.array(z.object({
        rule_name: z.string(),
        rule_type: z.string(),
        description: z.string().optional(),
        agent_id: z.string().optional(),
        activated: z.boolean().optional(),
        shared: z.boolean().optional(),
        conditions: z.any().optional(),
        actions: z.array(z.any()).optional(),
        metadata: z.any().optional(),
      })).describe('Array of rules to import'),
    },
    async ({ rules }) => {
      const mutation = `mutation ($rules: [rules_insert_input!]!) {
        insert_rules(objects: $rules, on_conflict: {
          constraint: rules_pkey,
          update_columns: [rule_name, rule_type, activated, description, updated_at, agent_id]
        }) {
          returning { id rule_name rule_type activated }
          affected_rows
        }
      }`;
      const timestamp = new Date().toISOString();
      const prepared = rules.map(r => ({
        ...r,
        org_id: orgId,
        activated: r.activated !== undefined ? r.activated : true,
        shared: r.shared || false,
        conditions: r.conditions || { any: [] },
        actions: r.actions || [],
        metadata: r.metadata || {},
        created_at: timestamp,
        updated_at: timestamp,
      }));
      const data = await executeQuery<{ insert_rules: { returning: unknown[]; affected_rows: number } }>(client, mutation, { rules: prepared });
      return { content: [{ type: 'text' as const, text: JSON.stringify({ affected_rows: data.insert_rules.affected_rows, rules: data.insert_rules.returning }, null, 2) }] };
    }
  );

  server.tool(
    'bulk_update_rule_status',
    'Activate or deactivate multiple rules at once',
    {
      ids: z.array(z.string()).describe('Array of rule UUIDs'),
      activated: z.boolean().describe('Whether to activate (true) or deactivate (false)'),
    },
    async ({ ids, activated }) => {
      const mutation = `mutation ($ids: [uuid!]!, $org_id: String!, $activated: Boolean!) {
        update_rules(where: {id: {_in: $ids}, org_id: {_eq: $org_id}}, _set: {activated: $activated, updated_at: "${new Date().toISOString()}"}) {
          affected_rows
        }
      }`;
      const data = await executeQuery<{ update_rules: { affected_rows: number } }>(client, mutation, { ids, org_id: orgId, activated });
      return { content: [{ type: 'text' as const, text: JSON.stringify({ affected_rows: data.update_rules.affected_rows }, null, 2) }] };
    }
  );

  server.tool(
    'bulk_assign_rules_to_agent',
    'Assign multiple rules to a specific agent',
    {
      ids: z.array(z.string()).describe('Array of rule UUIDs'),
      agent_id: z.string().describe('UUID of the agent to assign rules to'),
    },
    async ({ ids, agent_id }) => {
      const mutation = `mutation ($ids: [uuid!]!, $org_id: String!, $agent_id: uuid!) {
        update_rules(where: {id: {_in: $ids}, org_id: {_eq: $org_id}}, _set: {agent_id: $agent_id, updated_at: "${new Date().toISOString()}"}) {
          affected_rows
        }
      }`;
      const data = await executeQuery<{ update_rules: { affected_rows: number } }>(client, mutation, { ids, org_id: orgId, agent_id });
      return { content: [{ type: 'text' as const, text: JSON.stringify({ affected_rows: data.update_rules.affected_rows }, null, 2) }] };
    }
  );

  server.tool(
    'bulk_delete_rules',
    'Delete multiple rules at once',
    { ids: z.array(z.string()).describe('Array of rule UUIDs to delete') },
    async ({ ids }) => {
      const mutation = `mutation ($ids: [uuid!]!, $org_id: String!) {
        delete_rules(where: {id: {_in: $ids}, org_id: {_eq: $org_id}}) { affected_rows }
      }`;
      const data = await executeQuery<{ delete_rules: { affected_rows: number } }>(client, mutation, { ids, org_id: orgId });
      return { content: [{ type: 'text' as const, text: JSON.stringify({ deleted: data.delete_rules.affected_rows }, null, 2) }] };
    }
  );
}
