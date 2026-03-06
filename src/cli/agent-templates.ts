import path from 'node:path';
import type { OrgExport } from '../export-import.js';
import {
  readStateSetBundle,
  resolveStateSetDir,
  summarizeStateSetPayload,
  writeStateSetBundle,
} from './shortcuts/utils.js';
import { DEFAULT_STATESET_DIR } from './shortcuts/types.js';

type AgentTemplate = {
  id: string;
  label: string;
  description: string;
  payload: Omit<OrgExport, 'version' | 'exportedAt' | 'orgId'>;
};

const TEMPLATE_LIBRARY: Record<string, AgentTemplate> = {
  'refund-agent': {
    id: 'refund-agent',
    label: 'Refund Agent',
    description: 'Handles refund eligibility, guardrails, and customer messaging.',
    payload: {
      agents: [
        {
          name: 'Refund Agent',
          type: 'customer-support',
          role: 'Refund specialist',
          goal: 'Resolve refund requests quickly without violating store policy.',
          backstory: '',
          instructions:
            'Verify order eligibility, explain policy clearly, and escalate only when policy or fraud risk is ambiguous.',
          status: 'active',
          metadata: { template: 'refund-agent' },
        },
      ],
      rules: [
        {
          name: 'Refund Eligibility',
          description:
            'Check order age, fulfillment state, and exception flags before approving a refund.',
          conditions: { any: [{ field: 'intent', operator: 'eq', value: 'refund_request' }] },
          actions: [{ type: 'lookup_policy' }, { type: 'lookup_order' }],
          metadata: { tags: ['refunds', 'eligibility'] },
          status: 'active',
        },
        {
          name: 'Refund Guardrail',
          description: 'Escalate if the customer asks for a refund outside normal policy windows.',
          conditions: { any: [{ field: 'risk', operator: 'gte', value: 1 }] },
          actions: [{ type: 'escalate' }],
          metadata: { tags: ['refunds', 'risk'] },
          status: 'active',
        },
      ],
      skills: [
        {
          name: 'Refund Policy Lookup',
          description: 'Maps refund requests to store policy and exception handling.',
          type: 'policy',
          content: 'Use order age, item state, and promo restrictions to determine refund path.',
          status: 'active',
          metadata: { tags: ['refunds'] },
        },
      ],
      attributes: [],
      functions: [],
      examples: [],
      evals: [],
      datasets: [],
      agentSettings: [
        {
          model_name: 'claude-sonnet-4',
          model_provider: 'anthropic',
          temperature: 0.2,
          max_tokens: 4096,
          customer_satisfaction_target: 4.6,
          resolution_rate_target: 92,
        },
      ],
    },
  },
  'subscription-management': {
    id: 'subscription-management',
    label: 'Subscription Management',
    description: 'Handles skip, swap, cancel, and reactivate flows for recurring customers.',
    payload: {
      agents: [
        {
          name: 'Subscription Management Agent',
          type: 'customer-support',
          role: 'Subscription specialist',
          goal: 'Retain subscribers while resolving changes accurately.',
          backstory: '',
          instructions:
            'Prefer save attempts before cancellation, explain billing impacts, and confirm the final subscription state.',
          status: 'active',
          metadata: { template: 'subscription-management' },
        },
      ],
      rules: [
        {
          name: 'Cancellation Save Attempt',
          description: 'Offer skip, delay, or product swap before cancelling a subscription.',
          conditions: { any: [{ field: 'intent', operator: 'eq', value: 'cancel_subscription' }] },
          actions: [{ type: 'offer_retention_path' }],
          metadata: { tags: ['subscription', 'retention'] },
          status: 'active',
        },
        {
          name: 'Subscription Escalation',
          description:
            'Escalate when billing state or fulfillment state conflicts with requested action.',
          conditions: { any: [{ field: 'state_conflict', operator: 'eq', value: true }] },
          actions: [{ type: 'escalate' }],
          metadata: { tags: ['subscription', 'billing'] },
          status: 'active',
        },
      ],
      skills: [
        {
          name: 'Subscription Change Matrix',
          description: 'Explains what can be skipped, swapped, delayed, or cancelled and when.',
          type: 'workflow',
          content:
            'Use subscription status, next charge date, and item availability to choose the next action.',
          status: 'active',
          metadata: { tags: ['subscription'] },
        },
      ],
      attributes: [],
      functions: [],
      examples: [],
      evals: [],
      datasets: [],
      agentSettings: [
        {
          model_name: 'claude-sonnet-4',
          model_provider: 'anthropic',
          temperature: 0.2,
          max_tokens: 4096,
          customer_satisfaction_target: 4.7,
          resolution_rate_target: 90,
        },
      ],
    },
  },
};

function buildResourceKey(row: unknown): string {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    return JSON.stringify(row);
  }
  const record = row as Record<string, unknown>;
  for (const key of ['name', 'agent_name', 'rule_name', 'skill_name', 'attribute_name']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return `${key}:${value.trim().toLowerCase()}`;
    }
  }
  return JSON.stringify(record);
}

function mergeRows(existing: unknown[], incoming: unknown[]): unknown[] {
  const merged = new Map<string, unknown>();
  for (const row of existing) {
    merged.set(buildResourceKey(row), row);
  }
  for (const row of incoming) {
    merged.set(buildResourceKey(row), row);
  }
  return Array.from(merged.values());
}

function readExistingBundle(targetDir: string): OrgExport {
  try {
    return readStateSetBundle(targetDir);
  } catch {
    return {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      orgId: 'template',
      agents: [],
      rules: [],
      skills: [],
      attributes: [],
      functions: [],
      examples: [],
      evals: [],
      datasets: [],
      agentSettings: [],
    };
  }
}

export function listAgentTemplates(): AgentTemplate[] {
  return Object.values(TEMPLATE_LIBRARY);
}

export function scaffoldAgentTemplate(
  templateId: string,
  cwd: string = process.cwd(),
): {
  path: string;
  template: AgentTemplate;
  counts: Record<string, number>;
} {
  const template = TEMPLATE_LIBRARY[templateId];
  if (!template) {
    throw new Error(
      `Unknown template "${templateId}". Available: ${Object.keys(TEMPLATE_LIBRARY).join(', ')}`,
    );
  }

  const targetDir = resolveStateSetDir(path.join(cwd, path.basename(DEFAULT_STATESET_DIR)));
  const existing = readExistingBundle(targetDir);
  const merged: OrgExport = {
    version: existing.version || '1.0.0',
    exportedAt: new Date().toISOString(),
    orgId: existing.orgId || 'template',
    agents: mergeRows(existing.agents, template.payload.agents),
    rules: mergeRows(existing.rules, template.payload.rules),
    skills: mergeRows(existing.skills, template.payload.skills),
    attributes: mergeRows(existing.attributes, template.payload.attributes),
    functions: mergeRows(existing.functions, template.payload.functions),
    examples: mergeRows(existing.examples, template.payload.examples),
    evals: mergeRows(existing.evals, template.payload.evals),
    datasets: mergeRows(existing.datasets, template.payload.datasets),
    agentSettings: mergeRows(existing.agentSettings, template.payload.agentSettings),
  };

  writeStateSetBundle(targetDir, merged);
  return {
    path: targetDir,
    template,
    counts: summarizeStateSetPayload(merged),
  };
}
