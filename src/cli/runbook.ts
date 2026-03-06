import path from 'node:path';
import { getErrorMessage } from '../lib/errors.js';
import { resolveSafeOutputPath, writePrivateTextFile } from './utils.js';
import { asStringRecord, withAgentRunner } from './shortcuts/utils.js';

function findAgentReference(agents: unknown[], reference: string) {
  const target = reference.trim().toLowerCase();
  const records = agents.map((entry) => asStringRecord(entry));
  const exact = records.find((agent) => {
    const id = String(agent.id || '').toLowerCase();
    const name = String(agent.agent_name || agent.name || '').toLowerCase();
    return id === target || name === target;
  });
  if (exact) {
    return exact;
  }
  const matches = records.filter((agent) => {
    const id = String(agent.id || '').toLowerCase();
    const name = String(agent.agent_name || agent.name || '').toLowerCase();
    return id.includes(target) || name.includes(target);
  });
  if (matches.length === 1) {
    return matches[0];
  }
  if (matches.length === 0) {
    throw new Error(`Agent not found: ${reference}`);
  }
  throw new Error(`Agent reference is ambiguous: ${reference}`);
}

function renderListSection(
  title: string,
  rows: unknown[],
  keyField: string,
  extraField?: string,
): string {
  if (!Array.isArray(rows) || rows.length === 0) {
    return `## ${title}\n\nNone.\n`;
  }
  const lines = rows.map((entry) => {
    const row = asStringRecord(entry);
    const key = String(row[keyField] || row.name || row.id || 'item').trim();
    const extra = extraField ? String(row[extraField] || '').trim() : '';
    return extra ? `- ${key}: ${extra}` : `- ${key}`;
  });
  return `## ${title}\n\n${lines.join('\n')}\n`;
}

function buildRunbookMarkdown(payload: Record<string, unknown>): string {
  const agent = asStringRecord(payload.agent);
  const title = String(agent.agent_name || agent.name || agent.id || 'Agent').trim();
  const lines: string[] = [];
  lines.push(`# ${title}`);
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('## Overview');
  lines.push('');
  lines.push(`- ID: ${String(agent.id || '-').trim() || '-'}`);
  lines.push(`- Type: ${String(agent.agent_type || agent.type || '-').trim() || '-'}`);
  lines.push(`- Status: ${String(agent.activated ?? agent.status ?? '-').trim() || '-'}`);
  lines.push(`- Role: ${String(agent.role || '-').trim() || '-'}`);
  lines.push(`- Goal: ${String(agent.goal || '-').trim() || '-'}`);
  lines.push('');
  lines.push('## Instructions');
  lines.push('');
  lines.push(String(agent.instructions || '(none)'));
  lines.push('');
  lines.push(
    renderListSection(
      'Rules',
      Array.isArray(payload.rules) ? payload.rules : [],
      'rule_name',
      'description',
    ),
  );
  lines.push(
    renderListSection(
      'Skills',
      Array.isArray(payload.skills) ? payload.skills : [],
      'skill_name',
      'description',
    ),
  );
  lines.push(
    renderListSection(
      'Attributes',
      Array.isArray(payload.attributes) ? payload.attributes : [],
      'attribute_name',
      'description',
    ),
  );
  lines.push(
    renderListSection(
      'Functions',
      Array.isArray(payload.functions) ? payload.functions : [],
      'function_name',
      'description',
    ),
  );
  return lines.join('\n');
}

export async function exportAgentRunbook(
  agentReference: string,
  outputPath?: string,
): Promise<string> {
  if (!agentReference.trim()) {
    throw new Error('Agent reference is required for runbook export.');
  }

  const markdown = await withAgentRunner(async (runner) => {
    const list = await runner.callTool<unknown[]>('list_agents', { limit: 1000, offset: 0 });
    const target = findAgentReference(
      Array.isArray(list.payload) ? list.payload : [],
      agentReference,
    );
    const agentId = String(target.id || '').trim();
    if (!agentId) {
      throw new Error(`Agent "${agentReference}" does not have a usable ID.`);
    }
    const exported = await runner.callTool<Record<string, unknown>>('export_agent', {
      agent_id: agentId,
    });
    return buildRunbookMarkdown(asStringRecord(exported.payload));
  });

  const outFile = resolveSafeOutputPath(
    outputPath || `runbook-${agentReference.replace(/[^a-zA-Z0-9._-]+/g, '-')}.md`,
    { label: 'Runbook output', allowOutside: true },
  );
  try {
    writePrivateTextFile(path.resolve(outFile), markdown, { label: 'Runbook output' });
  } catch (error) {
    throw new Error(`Failed to write runbook: ${getErrorMessage(error)}`);
  }
  return outFile;
}
