import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { GraphQLClient } from 'graphql-request';
import { z } from 'zod';
import { executeQuery } from '../graphql-client.js';

const SKILL_FIELDS = `
  id skill_name skill_type activated description
  created_at updated_at org_id agent_id shared
  conditions actions metadata
`;

export function registerSkillTools(server: McpServer, client: GraphQLClient, orgId: string) {

  server.tool(
    'list_skills',
    'List all skills for the current organization',
    {
      limit: z.number().optional().describe('Max number of skills to return (default 100)'),
      offset: z.number().optional().describe('Offset for pagination (default 0)'),
    },
    async ({ limit, offset }) => {
      const query = `query ($org_id: String, $limit: Int!, $offset: Int!) {
        skills(
          where: {org_id: {_eq: $org_id}},
          limit: $limit,
          offset: $offset,
          order_by: { created_at: desc }
        ) { ${SKILL_FIELDS} }
      }`;
      const data = await executeQuery<{ skills: unknown[] }>(client, query, {
        org_id: orgId,
        limit: limit ?? 100,
        offset: offset ?? 0,
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(data.skills, null, 2) }] };
    }
  );

  server.tool(
    'get_agent_skills',
    'Get all skills assigned to a specific agent',
    {
      agent_id: z.string().describe('UUID of the agent'),
      limit: z.number().optional().describe('Max number of skills to return (default 100)'),
      offset: z.number().optional().describe('Offset for pagination (default 0)'),
    },
    async ({ agent_id, limit, offset }) => {
      const query = `query ($org_id: String, $agent_id: uuid, $limit: Int!, $offset: Int!) {
        skills(
          where: {org_id: {_eq: $org_id}, agent_id: {_eq: $agent_id}},
          limit: $limit,
          offset: $offset,
          order_by: { created_at: desc }
        ) { ${SKILL_FIELDS} }
      }`;
      const data = await executeQuery<{ skills: unknown[] }>(client, query, {
        org_id: orgId,
        agent_id,
        limit: limit ?? 100,
        offset: offset ?? 0,
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(data.skills, null, 2) }] };
    }
  );

  server.tool(
    'create_skill',
    'Create a new skill',
    {
      skill_name: z.string().describe('Name of the skill'),
      skill_type: z.string().describe('Type of skill'),
      description: z.string().optional().describe('Skill description'),
      agent_id: z.string().optional().describe('UUID of agent to assign skill to'),
      activated: z.boolean().optional().describe('Whether the skill is activated'),
      shared: z.boolean().optional().describe('Whether the skill is shared across agents'),
      conditions: z.any().optional().describe('Skill conditions object with "any" or "all" arrays'),
      actions: z.array(z.any()).optional().describe('Array of actions'),
      metadata: z.any().optional().describe('Additional metadata'),
    },
    async (args) => {
      const mutation = `mutation ($skill: skills_insert_input!) {
        insert_skills(objects: [$skill]) {
          returning { ${SKILL_FIELDS} }
        }
      }`;
      const skill = {
        org_id: orgId,
        skill_name: args.skill_name,
        skill_type: args.skill_type,
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
      const data = await executeQuery<{ insert_skills: { returning: unknown[] } }>(client, mutation, { skill });
      return { content: [{ type: 'text' as const, text: JSON.stringify(data.insert_skills.returning[0], null, 2) }] };
    }
  );

  server.tool(
    'update_skill',
    'Update an existing skill',
    {
      id: z.string().describe('UUID of the skill to update'),
      skill_name: z.string().optional().describe('New skill name'),
      skill_type: z.string().optional().describe('New skill type'),
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
      const mutation = `mutation ($id: uuid!, $org_id: String!, $set: skills_set_input!) {
        update_skills(where: {id: {_eq: $id}, org_id: {_eq: $org_id}}, _set: $set) {
          returning { ${SKILL_FIELDS} }
        }
      }`;
      const data = await executeQuery<{ update_skills: { returning: unknown[] } }>(client, mutation, { id, org_id: orgId, set: setFields });
      if (!data.update_skills.returning.length) {
        return { content: [{ type: 'text' as const, text: 'Skill not found' }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(data.update_skills.returning[0], null, 2) }] };
    }
  );

  server.tool(
    'delete_skill',
    'Delete a skill by ID',
    { id: z.string().describe('UUID of the skill to delete') },
    async ({ id }) => {
      const mutation = `mutation ($id: uuid!, $org_id: String!) {
        delete_skills(where: {id: {_eq: $id}, org_id: {_eq: $org_id}}) {
          returning { id skill_name }
        }
      }`;
      const data = await executeQuery<{ delete_skills: { returning: unknown[] } }>(client, mutation, { id, org_id: orgId });
      if (!data.delete_skills.returning.length) {
        return { content: [{ type: 'text' as const, text: 'Skill not found' }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify({ deleted: data.delete_skills.returning[0] }, null, 2) }] };
    }
  );

  server.tool(
    'import_skills',
    'Bulk import skills (upserts on primary key conflict)',
    {
      skills: z.array(z.object({
        skill_name: z.string(),
        skill_type: z.string(),
        description: z.string().optional(),
        agent_id: z.string().optional(),
        activated: z.boolean().optional(),
        shared: z.boolean().optional(),
        conditions: z.any().optional(),
        actions: z.array(z.any()).optional(),
        metadata: z.any().optional(),
      })).describe('Array of skills to import'),
    },
    async ({ skills }) => {
      const mutation = `mutation ($skills: [skills_insert_input!]!) {
        insert_skills(objects: $skills, on_conflict: {
          constraint: skills_pkey,
          update_columns: [skill_name, skill_type, activated, description, updated_at, agent_id]
        }) {
          returning { id skill_name skill_type activated }
          affected_rows
        }
      }`;
      const timestamp = new Date().toISOString();
      const prepared = skills.map(s => ({
        ...s,
        org_id: orgId,
        activated: s.activated !== undefined ? s.activated : true,
        shared: s.shared || false,
        conditions: s.conditions || { any: [] },
        actions: s.actions || [],
        metadata: s.metadata || {},
        created_at: timestamp,
        updated_at: timestamp,
      }));
      const data = await executeQuery<{ insert_skills: { returning: unknown[]; affected_rows: number } }>(client, mutation, { skills: prepared });
      return { content: [{ type: 'text' as const, text: JSON.stringify({ affected_rows: data.insert_skills.affected_rows, skills: data.insert_skills.returning }, null, 2) }] };
    }
  );

  server.tool(
    'bulk_update_skill_status',
    'Activate or deactivate multiple skills at once',
    {
      ids: z.array(z.string()).describe('Array of skill UUIDs'),
      activated: z.boolean().describe('Whether to activate or deactivate'),
    },
    async ({ ids, activated }) => {
      const mutation = `mutation ($ids: [uuid!]!, $org_id: String!, $activated: Boolean!) {
        update_skills(where: {id: {_in: $ids}, org_id: {_eq: $org_id}}, _set: {activated: $activated, updated_at: "${new Date().toISOString()}"}) {
          affected_rows
        }
      }`;
      const data = await executeQuery<{ update_skills: { affected_rows: number } }>(client, mutation, { ids, org_id: orgId, activated });
      return { content: [{ type: 'text' as const, text: JSON.stringify({ affected_rows: data.update_skills.affected_rows }, null, 2) }] };
    }
  );

  server.tool(
    'bulk_delete_skills',
    'Delete multiple skills at once',
    { ids: z.array(z.string()).describe('Array of skill UUIDs to delete') },
    async ({ ids }) => {
      const mutation = `mutation ($ids: [uuid!]!, $org_id: String!) {
        delete_skills(where: {id: {_in: $ids}, org_id: {_eq: $org_id}}) { affected_rows }
      }`;
      const data = await executeQuery<{ delete_skills: { affected_rows: number } }>(client, mutation, { ids, org_id: orgId });
      return { content: [{ type: 'text' as const, text: JSON.stringify({ deleted: data.delete_skills.affected_rows }, null, 2) }] };
    }
  );
}
