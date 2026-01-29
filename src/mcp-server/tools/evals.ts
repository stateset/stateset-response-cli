import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { GraphQLClient } from 'graphql-request';
import { z } from 'zod';
import { executeQuery } from '../graphql-client.js';

const EVAL_FIELDS = `
  id eval_name eval_type eval_status response_id
  ticket_id description user_message preferred_output
  non_preferred_output reason_type customer_impact
  created_at org_id
`;

export function registerEvalTools(server: McpServer, client: GraphQLClient, orgId: string) {

  server.tool(
    'list_evals',
    'List all evaluations for the current organization',
    {
      limit: z.number().optional().describe('Max number of evals to return (default 100)'),
      offset: z.number().optional().describe('Offset for pagination (default 0)'),
    },
    async ({ limit, offset }) => {
      const query = `query ($org_id: String!, $limit: Int!, $offset: Int!) {
        evals(
          where: {org_id: {_eq: $org_id}},
          limit: $limit,
          offset: $offset,
          order_by: { created_at: desc }
        ) { ${EVAL_FIELDS} }
      }`;
      const data = await executeQuery<{ evals: unknown[] }>(client, query, {
        org_id: orgId,
        limit: limit ?? 100,
        offset: offset ?? 0,
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(data.evals, null, 2) }] };
    }
  );

  server.tool(
    'create_eval',
    'Create a new evaluation record',
    {
      eval_name: z.string().describe('Name of the evaluation'),
      eval_type: z.string().describe('Type of evaluation'),
      eval_status: z.string().optional().describe('Status of the evaluation'),
      response_id: z.string().optional().describe('UUID of the associated response'),
      ticket_id: z.string().optional().describe('Associated ticket ID'),
      description: z.string().optional().describe('Description'),
      user_message: z.string().optional().describe('The user message being evaluated'),
      preferred_output: z.string().optional().describe('The preferred/correct output'),
      non_preferred_output: z.string().optional().describe('The non-preferred/incorrect output'),
      reason_type: z.string().optional().describe('Reason for the evaluation'),
      customer_impact: z.string().optional().describe('Impact on the customer'),
    },
    async (args) => {
      const mutation = `mutation ($eval_object: evals_insert_input!) {
        insert_evals(objects: [$eval_object]) {
          returning { ${EVAL_FIELDS} }
        }
      }`;
      const evalObj = {
        org_id: orgId,
        eval_name: args.eval_name,
        eval_type: args.eval_type,
        eval_status: args.eval_status || 'pending',
        response_id: args.response_id || null,
        ticket_id: args.ticket_id || null,
        description: args.description || '',
        user_message: args.user_message || '',
        preferred_output: args.preferred_output || '',
        non_preferred_output: args.non_preferred_output || '',
        reason_type: args.reason_type || '',
        customer_impact: args.customer_impact || '',
        created_at: new Date().toISOString(),
      };
      const data = await executeQuery<{ insert_evals: { returning: unknown[] } }>(client, mutation, { eval_object: evalObj });
      return { content: [{ type: 'text' as const, text: JSON.stringify(data.insert_evals.returning[0], null, 2) }] };
    }
  );

  server.tool(
    'update_eval',
    'Update an existing evaluation',
    {
      id: z.string().describe('UUID of the eval to update'),
      eval_name: z.string().optional().describe('New eval name'),
      eval_type: z.string().optional().describe('New eval type'),
      eval_status: z.string().optional().describe('New status'),
      description: z.string().optional().describe('New description'),
      user_message: z.string().optional().describe('Updated user message'),
      preferred_output: z.string().optional().describe('Updated preferred output'),
      non_preferred_output: z.string().optional().describe('Updated non-preferred output'),
      reason_type: z.string().optional().describe('Updated reason type'),
      customer_impact: z.string().optional().describe('Updated customer impact'),
    },
    async (args) => {
      const { id, ...updates } = args;
      const setFields: Record<string, unknown> = { ...updates };
      for (const key of Object.keys(setFields)) {
        if (setFields[key] === undefined) delete setFields[key];
      }
      const mutation = `mutation ($id: uuid!, $org_id: String!, $set: evals_set_input!) {
        update_evals(where: {id: {_eq: $id}, org_id: {_eq: $org_id}}, _set: $set) {
          returning { ${EVAL_FIELDS} }
        }
      }`;
      const data = await executeQuery<{ update_evals: { returning: unknown[] } }>(client, mutation, { id, org_id: orgId, set: setFields });
      if (!data.update_evals.returning.length) {
        return { content: [{ type: 'text' as const, text: 'Eval not found' }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(data.update_evals.returning[0], null, 2) }] };
    }
  );

  server.tool(
    'delete_eval',
    'Delete an evaluation by ID',
    { id: z.string().describe('UUID of the eval to delete') },
    async ({ id }) => {
      const mutation = `mutation ($id: uuid!, $org_id: String!) {
        delete_evals(where: {id: {_eq: $id}, org_id: {_eq: $org_id}}) {
          returning { id eval_name }
        }
      }`;
      const data = await executeQuery<{ delete_evals: { returning: unknown[] } }>(client, mutation, { id, org_id: orgId });
      if (!data.delete_evals.returning.length) {
        return { content: [{ type: 'text' as const, text: 'Eval not found' }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify({ deleted: data.delete_evals.returning[0] }, null, 2) }] };
    }
  );

  server.tool(
    'export_evals_for_finetuning',
    'Export evaluations in fine-tuning format (OpenAI/Anthropic messages format)',
    {
      eval_ids: z.array(z.string()).optional().describe('Optional list of specific eval UUIDs to export. If empty, exports all.'),
    },
    async ({ eval_ids }) => {
      const ids = eval_ids || [];
      const varDefs = ['$org_id: String!'];
      if (ids.length > 0) varDefs.push('$evalIds: [uuid!]');
      const query = `query (${varDefs.join(', ')}) {
        evals(where: {
          org_id: {_eq: $org_id}
          ${ids.length > 0 ? 'id: {_in: $evalIds}' : ''}
          preferred_output: {_is_null: false}
          user_message: {_is_null: false}
        }) {
          id eval_name eval_type user_message preferred_output reason_type customer_impact
        }
      }`;

      const variables: Record<string, unknown> = { org_id: orgId };
      if (ids.length > 0) variables.evalIds = ids;

      const data = await executeQuery<{ evals: Array<{ id: string; eval_name: string; eval_type: string; user_message: string; preferred_output: string; reason_type: string; customer_impact: string }> }>(client, query, variables);
      const evals = data.evals || [];

      const fineTuningData = evals.map(evalData => {
        let systemPrompt = 'You are a helpful customer service AI assistant.';
        if (evalData.eval_type || evalData.reason_type) {
          systemPrompt += ` This is a ${evalData.eval_type || 'general'} conversation`;
          if (evalData.reason_type) {
            systemPrompt += ` focusing on improving ${evalData.reason_type.toLowerCase()} responses.`;
          }
        }
        return {
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: evalData.user_message },
            { role: 'assistant', content: evalData.preferred_output },
          ],
        };
      });

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ fineTuningData, count: fineTuningData.length, evalIds: evals.map(e => e.id) }, null, 2),
        }],
      };
    }
  );
}
