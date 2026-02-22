import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { GraphQLClient } from 'graphql-request';
import { z } from 'zod';
import { executeQuery } from '../graphql-client.js';
import {
  paginationLimit,
  paginationOffset,
  conditionsSchema,
  actionsSchema,
  metadataSchema,
  bulkIdsSchema,
  MAX_NAME_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_ARRAY_LENGTH,
} from '../../lib/validation.js';
import { errorResult } from './helpers.js';

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
      limit: paginationLimit,
      offset: paginationOffset,
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
    },
  );

  server.tool(
    'get_agent_skills',
    'Get all skills assigned to a specific agent',
    {
      agent_id: z.string().uuid().describe('UUID of the agent'),
      limit: paginationLimit,
      offset: paginationOffset,
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
    },
  );

  server.tool(
    'create_skill',
    'Create a new skill',
    {
      skill_name: z.string().max(MAX_NAME_LENGTH).describe('Name of the skill'),
      skill_type: z.string().max(50).describe('Type of skill'),
      description: z.string().max(MAX_DESCRIPTION_LENGTH).optional().describe('Skill description'),
      agent_id: z.string().uuid().optional().describe('UUID of agent to assign skill to'),
      activated: z.boolean().optional().describe('Whether the skill is activated'),
      shared: z.boolean().optional().describe('Whether the skill is shared across agents'),
      conditions: conditionsSchema,
      actions: actionsSchema,
      metadata: metadataSchema,
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
        metadata: args.metadata || {
          category: '',
          compliance: '',
          last_reviewed: new Date().toISOString(),
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const data = await executeQuery<{ insert_skills: { returning: unknown[] } }>(
        client,
        mutation,
        { skill },
      );
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(data.insert_skills.returning[0], null, 2) },
        ],
      };
    },
  );

  server.tool(
    'update_skill',
    'Update an existing skill',
    {
      id: z.string().uuid().describe('UUID of the skill to update'),
      skill_name: z.string().max(MAX_NAME_LENGTH).optional().describe('New skill name'),
      skill_type: z.string().max(50).optional().describe('New skill type'),
      description: z.string().max(MAX_DESCRIPTION_LENGTH).optional().describe('New description'),
      activated: z.boolean().optional().describe('Activation status'),
      shared: z.boolean().optional().describe('Shared status'),
      agent_id: z.string().uuid().optional().describe('UUID of agent to assign to'),
      conditions: conditionsSchema,
      actions: actionsSchema,
      metadata: metadataSchema,
    },
    async (args) => {
      const { id, ...updates } = args;
      const setFields: Record<string, unknown> = {
        ...updates,
        updated_at: new Date().toISOString(),
      };
      for (const key of Object.keys(setFields)) {
        if (setFields[key] === undefined) delete setFields[key];
      }
      const mutation = `mutation ($id: uuid!, $org_id: String!, $set: skills_set_input!) {
        update_skills(where: {id: {_eq: $id}, org_id: {_eq: $org_id}}, _set: $set) {
          returning { ${SKILL_FIELDS} }
        }
      }`;
      const data = await executeQuery<{ update_skills: { returning: unknown[] } }>(
        client,
        mutation,
        { id, org_id: orgId, set: setFields },
      );
      if (!data.update_skills.returning.length) {
        return errorResult('Skill not found');
      }
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(data.update_skills.returning[0], null, 2) },
        ],
      };
    },
  );

  server.tool(
    'delete_skill',
    'Delete a skill by ID',
    { id: z.string().uuid().describe('UUID of the skill to delete') },
    async ({ id }) => {
      const mutation = `mutation ($id: uuid!, $org_id: String!) {
        delete_skills(where: {id: {_eq: $id}, org_id: {_eq: $org_id}}) {
          returning { id skill_name }
        }
      }`;
      const data = await executeQuery<{ delete_skills: { returning: unknown[] } }>(
        client,
        mutation,
        { id, org_id: orgId },
      );
      if (!data.delete_skills.returning.length) {
        return errorResult('Skill not found');
      }
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ deleted: data.delete_skills.returning[0] }, null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    'import_skills',
    'Bulk import skills (upserts on primary key conflict)',
    {
      skills: z
        .array(
          z.object({
            skill_name: z.string().max(MAX_NAME_LENGTH),
            skill_type: z.string().max(50),
            description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
            agent_id: z.string().uuid().optional(),
            activated: z.boolean().optional(),
            shared: z.boolean().optional(),
            conditions: conditionsSchema,
            actions: actionsSchema,
            metadata: metadataSchema,
          }),
        )
        .max(MAX_ARRAY_LENGTH)
        .describe('Array of skills to import (max 100)'),
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
      const prepared = skills.map((s) => ({
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
      const data = await executeQuery<{
        insert_skills: { returning: unknown[]; affected_rows: number };
      }>(client, mutation, { skills: prepared });
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                affected_rows: data.insert_skills.affected_rows,
                skills: data.insert_skills.returning,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    'bulk_update_skill_status',
    'Activate or deactivate multiple skills at once',
    {
      ids: bulkIdsSchema.describe('Array of skill UUIDs'),
      activated: z.boolean().describe('Whether to activate or deactivate'),
    },
    async ({ ids, activated }) => {
      const mutation = `mutation ($ids: [uuid!]!, $org_id: String!, $activated: Boolean!) {
        update_skills(where: {id: {_in: $ids}, org_id: {_eq: $org_id}}, _set: {activated: $activated, updated_at: "${new Date().toISOString()}"}) {
          affected_rows
        }
      }`;
      const data = await executeQuery<{ update_skills: { affected_rows: number } }>(
        client,
        mutation,
        { ids, org_id: orgId, activated },
      );
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ affected_rows: data.update_skills.affected_rows }, null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    'bulk_delete_skills',
    'Delete multiple skills at once',
    { ids: bulkIdsSchema.describe('Array of skill UUIDs to delete') },
    async ({ ids }) => {
      const mutation = `mutation ($ids: [uuid!]!, $org_id: String!) {
        delete_skills(where: {id: {_in: $ids}, org_id: {_eq: $org_id}}) { affected_rows }
      }`;
      const data = await executeQuery<{ delete_skills: { affected_rows: number } }>(
        client,
        mutation,
        { ids, org_id: orgId },
      );
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ deleted: data.delete_skills.affected_rows }, null, 2),
          },
        ],
      };
    },
  );
}
