/**
 * Export / Import for StateSet Response organizations.
 *
 * Exports agents, rules, skills, attributes, functions, examples, evals,
 * datasets, and agent settings to a single JSON file.
 * Imports that JSON back, creating or upserting all resources.
 */

import fs from 'node:fs';
import {
  createGraphQLClient,
  executeQuery,
  type GraphQLAuth,
} from './mcp-server/graphql-client.js';
import { getCurrentOrg } from './config.js';

// ─── Secret Redaction ────────────────────────────────────────────────────────

/**
 * Pattern for sensitive field names
 */
const SENSITIVE_KEY_PATTERN = /(secret|token|api[-_]?key|password|auth|credential|bearer)/i;

/**
 * Redact sensitive values from an object (deep)
 */
function redactSecrets(obj: unknown): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => redactSecrets(item));
  }

  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(key) && typeof value === 'string' && value.length > 0) {
        result[key] = '[REDACTED]';
      } else if (typeof value === 'object') {
        result[key] = redactSecrets(value);
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  return obj;
}

export interface ExportOptions {
  /** Include secrets in export (default: false) */
  includeSecrets?: boolean;
}

// ─── Schema ──────────────────────────────────────────────────────────────────

export interface OrgExport {
  version: string;
  exportedAt: string;
  orgId: string;
  agents: unknown[];
  rules: unknown[];
  skills: unknown[];
  attributes: unknown[];
  functions: unknown[];
  examples: unknown[];
  evals: unknown[];
  datasets: unknown[];
  agentSettings: unknown[];
}

// ─── Export ──────────────────────────────────────────────────────────────────

/** Exports all org resources (agents, rules, skills, etc.) to a JSON file. Secrets are redacted by default. */
export async function exportOrg(
  outputPath: string,
  options: ExportOptions = {},
): Promise<OrgExport> {
  const { includeSecrets = false } = options;
  const { orgId, config: orgConfig } = getCurrentOrg();
  const auth: GraphQLAuth = orgConfig.cliToken
    ? { type: 'cli_token', token: orgConfig.cliToken }
    : { type: 'admin_secret', adminSecret: orgConfig.adminSecret || '' };
  const client = createGraphQLClient(orgConfig.graphqlEndpoint, auth, orgId);

  const query = `query ($org_id: String!) {
    agents(where: { org_id: { _eq: $org_id } }, order_by: { created_at: asc }) {
      id name type role goal backstory instructions
      voice_model voice_model_id voice_model_provider
      status metadata created_at updated_at org_id
    }
    rules(where: { org_id: { _eq: $org_id } }, order_by: { created_at: asc }) {
      id name description conditions actions agent_id
      status priority metadata created_at updated_at org_id
    }
    skills(where: { org_id: { _eq: $org_id } }, order_by: { created_at: asc }) {
      id name description type content agent_id
      status metadata created_at updated_at org_id
    }
    attributes(where: { org_id: { _eq: $org_id } }, order_by: { created_at: asc }) {
      id name description type options default_value
      required metadata created_at updated_at org_id
    }
    functions(where: { org_id: { _eq: $org_id } }, order_by: { created_at: asc }) {
      id name description method url headers body
      auth_type auth_config parameters response_transform
      retry_config rate_limit timeout
      status metadata created_at updated_at org_id
    }
    examples(where: { org_id: { _eq: $org_id } }, order_by: { created_at: asc }) {
      id title description type agent_id
      status metadata created_at updated_at org_id
      example_messages(order_by: { created_at: asc }) {
        id role content metadata created_at
      }
    }
    evals(where: { org_id: { _eq: $org_id } }, order_by: { created_at: asc }) {
      id name description input expected_output actual_output
      score agent_id status metadata created_at updated_at org_id
    }
    datasets(where: { org_id: { _eq: $org_id } }, order_by: { created_at: asc }) {
      id name description entry_count status metadata created_at updated_at org_id
      dataset_entries(order_by: { created_at: asc }) {
        id content metadata created_at updated_at
      }
    }
    agent_settings(where: { org_id: { _eq: $org_id } }) {
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
      response_time_threshold sentiment_analysis_threshold
      customer_satisfaction_target resolution_rate_target
      created_at updated_at
    }
  }`;

  const data = await executeQuery<Record<string, unknown[]>>(client, query, { org_id: orgId });

  let exportData: OrgExport = {
    version: '1.0.0',
    exportedAt: new Date().toISOString(),
    orgId,
    agents: data.agents || [],
    rules: data.rules || [],
    skills: data.skills || [],
    attributes: data.attributes || [],
    functions: data.functions || [],
    examples: data.examples || [],
    evals: data.evals || [],
    datasets: data.datasets || [],
    agentSettings: data.agent_settings || [],
  };

  // Redact secrets unless explicitly included
  if (!includeSecrets) {
    exportData = redactSecrets(exportData) as OrgExport;
  }

  try {
    fs.writeFileSync(outputPath, JSON.stringify(exportData, null, 2), 'utf-8');
  } catch (e) {
    throw new Error(`Failed to write export file: ${e instanceof Error ? e.message : String(e)}`);
  }
  return exportData;
}

// ─── Import ──────────────────────────────────────────────────────────────────

export interface ImportResult {
  agents: number;
  rules: number;
  skills: number;
  attributes: number;
  functions: number;
  examples: number;
  evals: number;
  datasets: number;
  datasetEntries: number;
  agentSettings: number;
}

/** Imports org resources from a previously exported JSON file, upserting into the current org. */
export async function importOrg(inputPath: string): Promise<ImportResult> {
  let raw: string;
  try {
    raw = fs.readFileSync(inputPath, 'utf-8');
  } catch (e) {
    throw new Error(`Failed to read import file: ${e instanceof Error ? e.message : String(e)}`);
  }
  let data: OrgExport;
  try {
    data = JSON.parse(raw) as OrgExport;
  } catch (e) {
    throw new Error(`Invalid JSON in import file: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (!data.version || !data.orgId) {
    throw new Error('Invalid export file — missing version or orgId fields.');
  }

  const { orgId, config: orgConfig } = getCurrentOrg();
  const auth: GraphQLAuth = orgConfig.cliToken
    ? { type: 'cli_token', token: orgConfig.cliToken }
    : { type: 'admin_secret', adminSecret: orgConfig.adminSecret || '' };
  const client = createGraphQLClient(orgConfig.graphqlEndpoint, auth, orgId);

  const result: ImportResult = {
    agents: 0,
    rules: 0,
    skills: 0,
    attributes: 0,
    functions: 0,
    examples: 0,
    evals: 0,
    datasets: 0,
    datasetEntries: 0,
    agentSettings: 0,
  };

  // Helper: strip read-only fields and remap org_id
  function prepObj(
    obj: Record<string, unknown>,
    extraOmit: string[] = [],
  ): Record<string, unknown> {
    const omit = new Set(['id', '__typename', ...extraOmit]);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (!omit.has(k)) out[k] = v;
    }
    out.org_id = orgId;
    return out;
  }

  // Agents
  if (data.agents?.length) {
    const objects = data.agents.map((a) => prepObj(a as Record<string, unknown>));
    const mutation = `mutation ($objects: [agents_insert_input!]!) {
      insert_agents(objects: $objects, on_conflict: { constraint: agents_pkey, update_columns: [name, type, role, goal, backstory, instructions, voice_model, voice_model_id, voice_model_provider, status, metadata, updated_at] }) {
        affected_rows
      }
    }`;
    try {
      const res = await executeQuery<{ insert_agents: { affected_rows: number } }>(
        client,
        mutation,
        { objects },
      );
      result.agents = res.insert_agents.affected_rows;
    } catch {
      // Fallback: insert one by one
      for (const obj of objects) {
        try {
          await executeQuery(
            client,
            `mutation ($object: agents_insert_input!) { insert_agents(objects: [$object]) { affected_rows } }`,
            { object: obj },
          );
          result.agents++;
        } catch {
          /* skip duplicates */
        }
      }
    }
  }

  // Rules
  if (data.rules?.length) {
    const objects = data.rules.map((r) => prepObj(r as Record<string, unknown>));
    try {
      const res = await executeQuery<{ insert_rules: { affected_rows: number } }>(
        client,
        `mutation ($objects: [rules_insert_input!]!) { insert_rules(objects: $objects) { affected_rows } }`,
        { objects },
      );
      result.rules = res.insert_rules.affected_rows;
    } catch {
      for (const obj of objects) {
        try {
          await executeQuery(
            client,
            `mutation ($object: rules_insert_input!) { insert_rules(objects: [$object]) { affected_rows } }`,
            { object: obj },
          );
          result.rules++;
        } catch {
          /* skip */
        }
      }
    }
  }

  // Skills
  if (data.skills?.length) {
    const objects = data.skills.map((s) => prepObj(s as Record<string, unknown>));
    try {
      const res = await executeQuery<{ insert_skills: { affected_rows: number } }>(
        client,
        `mutation ($objects: [skills_insert_input!]!) { insert_skills(objects: $objects) { affected_rows } }`,
        { objects },
      );
      result.skills = res.insert_skills.affected_rows;
    } catch {
      for (const obj of objects) {
        try {
          await executeQuery(
            client,
            `mutation ($object: skills_insert_input!) { insert_skills(objects: [$object]) { affected_rows } }`,
            { object: obj },
          );
          result.skills++;
        } catch {
          /* skip */
        }
      }
    }
  }

  // Attributes
  if (data.attributes?.length) {
    const objects = data.attributes.map((a) => prepObj(a as Record<string, unknown>));
    try {
      const res = await executeQuery<{ insert_attributes: { affected_rows: number } }>(
        client,
        `mutation ($objects: [attributes_insert_input!]!) { insert_attributes(objects: $objects) { affected_rows } }`,
        { objects },
      );
      result.attributes = res.insert_attributes.affected_rows;
    } catch {
      for (const obj of objects) {
        try {
          await executeQuery(
            client,
            `mutation ($object: attributes_insert_input!) { insert_attributes(objects: [$object]) { affected_rows } }`,
            { object: obj },
          );
          result.attributes++;
        } catch {
          /* skip */
        }
      }
    }
  }

  // Functions
  if (data.functions?.length) {
    const objects = data.functions.map((f) => prepObj(f as Record<string, unknown>));
    try {
      const res = await executeQuery<{ insert_functions: { affected_rows: number } }>(
        client,
        `mutation ($objects: [functions_insert_input!]!) { insert_functions(objects: $objects) { affected_rows } }`,
        { objects },
      );
      result.functions = res.insert_functions.affected_rows;
    } catch {
      for (const obj of objects) {
        try {
          await executeQuery(
            client,
            `mutation ($object: functions_insert_input!) { insert_functions(objects: [$object]) { affected_rows } }`,
            { object: obj },
          );
          result.functions++;
        } catch {
          /* skip */
        }
      }
    }
  }

  // Examples (with nested messages)
  if (data.examples?.length) {
    for (const ex of data.examples) {
      const exObj = ex as Record<string, unknown>;
      const messages = (exObj.example_messages || []) as Record<string, unknown>[];
      const cleanEx = prepObj(exObj, ['example_messages']);
      try {
        await executeQuery(
          client,
          `mutation ($object: examples_insert_input!) { insert_examples(objects: [$object]) { affected_rows } }`,
          { object: cleanEx },
        );
        result.examples++;
      } catch {
        /* skip */
      }

      // Insert messages for the example
      for (const msg of messages) {
        const cleanMsg = prepObj(msg);
        try {
          await executeQuery(
            client,
            `mutation ($object: example_messages_insert_input!) { insert_example_messages(objects: [$object]) { affected_rows } }`,
            { object: cleanMsg },
          );
        } catch {
          /* skip */
        }
      }
    }
  }

  // Evals
  if (data.evals?.length) {
    const objects = data.evals.map((e) => prepObj(e as Record<string, unknown>));
    try {
      const res = await executeQuery<{ insert_evals: { affected_rows: number } }>(
        client,
        `mutation ($objects: [evals_insert_input!]!) { insert_evals(objects: $objects) { affected_rows } }`,
        { objects },
      );
      result.evals = res.insert_evals.affected_rows;
    } catch {
      for (const obj of objects) {
        try {
          await executeQuery(
            client,
            `mutation ($object: evals_insert_input!) { insert_evals(objects: [$object]) { affected_rows } }`,
            { object: obj },
          );
          result.evals++;
        } catch {
          /* skip */
        }
      }
    }
  }

  // Datasets (with nested entries)
  if (data.datasets?.length) {
    for (const ds of data.datasets) {
      const dsObj = ds as Record<string, unknown>;
      const entries = (dsObj.dataset_entries || []) as Record<string, unknown>[];
      const cleanDs = prepObj(dsObj, ['dataset_entries']);
      try {
        await executeQuery(
          client,
          `mutation ($object: datasets_insert_input!) { insert_datasets(objects: [$object]) { affected_rows } }`,
          { object: cleanDs },
        );
        result.datasets++;
      } catch {
        /* skip */
      }

      for (const entry of entries) {
        const cleanEntry = prepObj(entry);
        try {
          await executeQuery(
            client,
            `mutation ($object: dataset_entries_insert_input!) { insert_dataset_entries(objects: [$object]) { affected_rows } }`,
            { object: cleanEntry },
          );
          result.datasetEntries++;
        } catch {
          /* skip */
        }
      }
    }
  }

  // Agent Settings
  if (data.agentSettings?.length) {
    for (const s of data.agentSettings) {
      const sObj = prepObj(s as Record<string, unknown>);
      try {
        await executeQuery(
          client,
          `mutation ($object: agent_settings_insert_input!) { insert_agent_settings(objects: [$object]) { affected_rows } }`,
          { object: sObj },
        );
        result.agentSettings++;
      } catch {
        /* skip */
      }
    }
  }

  return result;
}
