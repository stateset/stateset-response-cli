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
  skipped: number;
  failures: ImportFailure[];
  sourceOrgId: string;
}

export interface ImportFailure {
  entity: string;
  index: number;
  sourceId: string | null;
  reason: string;
}

export interface ImportOptions {
  dryRun?: boolean;
  strict?: boolean;
}

/** Imports org resources from a previously exported JSON file, upserting into the current org. */
export async function importOrg(
  inputPath: string,
  options: ImportOptions = {},
): Promise<ImportResult> {
  const normalizedOptions: ImportOptions = {
    dryRun: false,
    strict: false,
    ...options,
  };
  const maxFailureReport = 25;

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
    skipped: 0,
    failures: [],
    sourceOrgId: data.orgId,
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

  const recordFailure = (entity: string, index: number, source: unknown, error: unknown): void => {
    const sourceId =
      source && typeof source === 'object' && !Array.isArray(source) && 'id' in source
        ? typeof source.id === 'string'
          ? source.id
          : null
        : null;
    const reason = error instanceof Error ? error.message : String(error);
    result.skipped += 1;
    if (result.failures.length >= maxFailureReport) return;
    result.failures.push({ entity, index, sourceId, reason });
  };

  const runQuery = async <T>(
    fn: () => Promise<T>,
  ): Promise<{ ok: true; data: T } | { ok: false; error: unknown }> => {
    if (normalizedOptions.dryRun) {
      return { ok: true, data: undefined as unknown as T };
    }
    try {
      return { ok: true, data: await fn() };
    } catch (error) {
      return { ok: false, error };
    }
  };

  const toNumber = (value: unknown): number => {
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const asArray = <T>(label: string, value: unknown): T[] => {
    if (value == null) return [];
    if (Array.isArray(value)) {
      return value as T[];
    }
    throw new Error(`Invalid export format: "${label}" must be an array.`);
  };

  const asObject = (label: string, value: unknown): Record<string, unknown> => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    throw new Error(`Invalid export format: "${label}" must be an object.`);
  };

  // Agents
  const agents = asArray<unknown>('agents', data.agents);
  if (agents.length) {
    const objects = agents.map((a, index) => prepObj(asObject(`agents[${index}]`, a)));
    const mutation = `mutation ($objects: [agents_insert_input!]!) {
      insert_agents(objects: $objects, on_conflict: { constraint: agents_pkey, update_columns: [name, type, role, goal, backstory, instructions, voice_model, voice_model_id, voice_model_provider, status, metadata, updated_at] }) {
        affected_rows
      }
    }`;
    if (normalizedOptions.dryRun) {
      result.agents += objects.length;
    } else {
      const batch = await runQuery(async () => {
        const batchResult = await executeQuery<{ insert_agents: { affected_rows: number } }>(
          client,
          mutation,
          { objects },
        );
        return batchResult.insert_agents.affected_rows;
      });
      if (batch.ok) {
        result.agents += toNumber(batch.data);
      } else {
        for (const [i, obj] of objects.entries()) {
          const item = await runQuery(async () => {
            const itemResult = await executeQuery(
              client,
              `mutation ($object: agents_insert_input!) { insert_agents(objects: [$object]) { affected_rows } }`,
              { object: obj },
            );
            return itemResult;
          });
          if (item.ok) {
            result.agents++;
          } else {
            recordFailure('agents', i, obj, item.error);
          }
        }
      }
    }
  }

  // Rules
  const rules = asArray<unknown>('rules', data.rules);
  if (rules.length) {
    const objects = rules.map((r, index) => prepObj(asObject(`rules[${index}]`, r)));
    if (normalizedOptions.dryRun) {
      result.rules += objects.length;
    } else {
      const batch = await runQuery(async () => {
        const batchResult = await executeQuery<{ insert_rules: { affected_rows: number } }>(
          client,
          `mutation ($objects: [rules_insert_input!]!) { insert_rules(objects: $objects) { affected_rows } }`,
          { objects },
        );
        return batchResult.insert_rules.affected_rows;
      });
      if (batch.ok) {
        result.rules += toNumber(batch.data);
      } else {
        for (const [i, obj] of objects.entries()) {
          const item = await runQuery(async () => {
            const itemResult = await executeQuery(
              client,
              `mutation ($object: rules_insert_input!) { insert_rules(objects: [$object]) { affected_rows } }`,
              { object: obj },
            );
            return itemResult;
          });
          if (item.ok) {
            result.rules++;
          } else {
            recordFailure('rules', i, obj, item.error);
          }
        }
      }
    }
  }

  // Skills
  const skills = asArray<unknown>('skills', data.skills);
  if (skills.length) {
    const objects = skills.map((s, index) => prepObj(asObject(`skills[${index}]`, s)));
    if (normalizedOptions.dryRun) {
      result.skills += objects.length;
    } else {
      const batch = await runQuery(async () => {
        const batchResult = await executeQuery<{ insert_skills: { affected_rows: number } }>(
          client,
          `mutation ($objects: [skills_insert_input!]!) { insert_skills(objects: $objects) { affected_rows } }`,
          { objects },
        );
        return batchResult.insert_skills.affected_rows;
      });
      if (batch.ok) {
        result.skills += toNumber(batch.data);
      } else {
        for (const [i, obj] of objects.entries()) {
          const item = await runQuery(async () => {
            const itemResult = await executeQuery(
              client,
              `mutation ($object: skills_insert_input!) { insert_skills(objects: [$object]) { affected_rows } }`,
              { object: obj },
            );
            return itemResult;
          });
          if (item.ok) {
            result.skills++;
          } else {
            recordFailure('skills', i, obj, item.error);
          }
        }
      }
    }
  }

  // Attributes
  const attributes = asArray<unknown>('attributes', data.attributes);
  if (attributes.length) {
    const objects = attributes.map((a, index) => prepObj(asObject(`attributes[${index}]`, a)));
    if (normalizedOptions.dryRun) {
      result.attributes += objects.length;
    } else {
      const batch = await runQuery(async () => {
        const batchResult = await executeQuery<{ insert_attributes: { affected_rows: number } }>(
          client,
          `mutation ($objects: [attributes_insert_input!]!) { insert_attributes(objects: $objects) { affected_rows } }`,
          { objects },
        );
        return batchResult.insert_attributes.affected_rows;
      });
      if (batch.ok) {
        result.attributes += toNumber(batch.data);
      } else {
        for (const [i, obj] of objects.entries()) {
          const item = await runQuery(async () => {
            const itemResult = await executeQuery(
              client,
              `mutation ($object: attributes_insert_input!) { insert_attributes(objects: [$object]) { affected_rows } }`,
              { object: obj },
            );
            return itemResult;
          });
          if (item.ok) {
            result.attributes++;
          } else {
            recordFailure('attributes', i, obj, item.error);
          }
        }
      }
    }
  }

  // Functions
  const functions = asArray<unknown>('functions', data.functions);
  if (functions.length) {
    const objects = functions.map((f, index) => prepObj(asObject(`functions[${index}]`, f)));
    if (normalizedOptions.dryRun) {
      result.functions += objects.length;
    } else {
      const batch = await runQuery(async () => {
        const batchResult = await executeQuery<{ insert_functions: { affected_rows: number } }>(
          client,
          `mutation ($objects: [functions_insert_input!]!) { insert_functions(objects: $objects) { affected_rows } }`,
          { objects },
        );
        return batchResult.insert_functions.affected_rows;
      });
      if (batch.ok) {
        result.functions += toNumber(batch.data);
      } else {
        for (const [i, obj] of objects.entries()) {
          const item = await runQuery(async () => {
            const itemResult = await executeQuery(
              client,
              `mutation ($object: functions_insert_input!) { insert_functions(objects: [$object]) { affected_rows } }`,
              { object: obj },
            );
            return itemResult;
          });
          if (item.ok) {
            result.functions++;
          } else {
            recordFailure('functions', i, obj, item.error);
          }
        }
      }
    }
  }

  // Examples (with nested messages)
  const examples = asArray<unknown>('examples', data.examples);
  if (examples.length) {
    for (const [exampleIndex, ex] of examples.entries()) {
      const exObj = asObject(`examples[${exampleIndex}]`, ex);
      const messages = asArray<Record<string, unknown>>(
        `examples[${exampleIndex}].example_messages`,
        exObj.example_messages,
      );
      const cleanEx = prepObj(exObj, ['example_messages']);
      if (normalizedOptions.dryRun) {
        result.examples++;
        continue;
      }
      const exampleInsert = await runQuery(async () => {
        const payload = await executeQuery(
          client,
          `mutation ($object: examples_insert_input!) { insert_examples(objects: [$object]) { affected_rows } }`,
          { object: cleanEx },
        );
        return payload;
      });
      if (exampleInsert.ok) {
        result.examples++;
        for (const [messageIndex, msg] of messages.entries()) {
          const cleanMsg = prepObj(
            asObject(`examples[${exampleIndex}].example_messages[${messageIndex}]`, msg),
          );
          const messageInsert = await runQuery(async () => {
            const payload = await executeQuery(
              client,
              `mutation ($object: example_messages_insert_input!) { insert_example_messages(objects: [$object]) { affected_rows } }`,
              { object: cleanMsg },
            );
            return payload;
          });
          if (!messageInsert.ok) {
            recordFailure('example_messages', messageIndex, cleanMsg, messageInsert.error);
          }
        }
      } else {
        recordFailure('examples', exampleIndex, exObj, exampleInsert.error);
      }
    }
  }

  const evals = asArray<unknown>('evals', data.evals);
  if (evals.length) {
    const objects = evals.map((e, index) => prepObj(asObject(`evals[${index}]`, e)));
    if (normalizedOptions.dryRun) {
      result.evals += objects.length;
    } else {
      const batch = await runQuery(async () => {
        const batchResult = await executeQuery<{ insert_evals: { affected_rows: number } }>(
          client,
          `mutation ($objects: [evals_insert_input!]!) { insert_evals(objects: $objects) { affected_rows } }`,
          { objects },
        );
        return batchResult.insert_evals.affected_rows;
      });
      if (batch.ok) {
        result.evals += toNumber(batch.data);
      } else {
        for (const [i, obj] of objects.entries()) {
          const item = await runQuery(async () => {
            const itemResult = await executeQuery(
              client,
              `mutation ($object: evals_insert_input!) { insert_evals(objects: [$object]) { affected_rows } }`,
              { object: obj },
            );
            return itemResult;
          });
          if (item.ok) {
            result.evals++;
          } else {
            recordFailure('evals', i, obj, item.error);
          }
        }
      }
    }
  }

  const datasets = asArray<unknown>('datasets', data.datasets);
  if (datasets.length) {
    for (const [datasetIndex, ds] of datasets.entries()) {
      const dsObj = asObject(`datasets[${datasetIndex}]`, ds);
      const entries = asArray<Record<string, unknown>>(
        `datasets[${datasetIndex}].dataset_entries`,
        dsObj.dataset_entries,
      );
      const cleanDs = prepObj(dsObj, ['dataset_entries']);
      if (normalizedOptions.dryRun) {
        result.datasets++;
        result.datasetEntries += entries.length;
        continue;
      }
      const datasetInsert = await runQuery(async () => {
        const payload = await executeQuery(
          client,
          `mutation ($object: datasets_insert_input!) { insert_datasets(objects: [$object]) { affected_rows } }`,
          { object: cleanDs },
        );
        return payload;
      });
      if (datasetInsert.ok) {
        result.datasets++;
        for (const [entryIndex, entry] of entries.entries()) {
          const cleanEntry = prepObj(
            asObject(`datasets[${datasetIndex}].dataset_entries[${entryIndex}]`, entry),
          );
          const entryInsert = await runQuery(async () => {
            const payload = await executeQuery(
              client,
              `mutation ($object: dataset_entries_insert_input!) { insert_dataset_entries(objects: [$object]) { affected_rows } }`,
              { object: cleanEntry },
            );
            return payload;
          });
          if (entryInsert.ok) {
            result.datasetEntries++;
          } else {
            recordFailure('dataset_entries', entryIndex, cleanEntry, entryInsert.error);
          }
        }
      } else {
        recordFailure('datasets', datasetIndex, dsObj, datasetInsert.error);
      }
    }
  }

  // Agent Settings
  const agentSettings = asArray<unknown>('agentSettings', data.agentSettings);
  if (agentSettings.length) {
    for (const [index, s] of agentSettings.entries()) {
      const sObj = prepObj(asObject(`agentSettings[${index}]`, s));
      if (normalizedOptions.dryRun) {
        result.agentSettings++;
        continue;
      }
      const settingsInsert = await runQuery(async () => {
        const payload = await executeQuery(
          client,
          `mutation ($object: agent_settings_insert_input!) { insert_agent_settings(objects: [$object]) { affected_rows } }`,
          { object: sObj },
        );
        return payload;
      });
      if (settingsInsert.ok) {
        result.agentSettings++;
      } else {
        recordFailure('agent_settings', index, sObj, settingsInsert.error);
      }
    }
  }

  if (normalizedOptions.strict && result.failures.length > 0) {
    throw new Error(
      `Import completed with ${result.failures.length} failure(s). Use --dry-run to inspect before applying to this org.`,
    );
  }

  return result;
}
