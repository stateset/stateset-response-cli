/**
 * /rules generate — Auto-populate rules from business data.
 *
 * Analyzes KB content, existing conversations, and business context
 * to suggest skip rules, escalation patterns, and response rules.
 * All suggestions are presented for human confirmation before creation.
 */

import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import inquirer from 'inquirer';
import type { ChatContext, CommandResult } from './types.js';
import type { SkipRule, EscalationPattern } from '../lib/manifest-builder.js';
import {
  brandStudioExists,
  buildBrandStudioBundle,
  loadBrandStudioBundle,
  writeBrandStudioBundle,
} from '../lib/brand-studio.js';

const NOT_HANDLED: CommandResult = { handled: false };

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function printSuccess(msg: string): void {
  console.log(chalk.green(`  ✓ ${msg}`));
}

function printInfo(msg: string): void {
  console.log(chalk.gray(`  ${msg}`));
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/* ------------------------------------------------------------------ */
/*  Analyze KB content for rule suggestions                            */
/* ------------------------------------------------------------------ */

interface RuleSuggestion {
  type: 'skip' | 'escalation' | 'response';
  name: string;
  description: string;
  rule: SkipRule | EscalationPattern | Record<string, unknown>;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

async function analyzeAndSuggest(ctx: ChatContext, _brandSlug?: string): Promise<RuleSuggestion[]> {
  const suggestions: RuleSuggestion[] = [];

  // 1. Search KB for common patterns that should trigger rules
  const kbPatterns = [
    { query: 'return policy', type: 'response' as const, name: 'Return Policy Response' },
    { query: 'shipping policy', type: 'response' as const, name: 'Shipping Policy Response' },
    { query: 'refund policy', type: 'response' as const, name: 'Refund Policy Response' },
    { query: 'business hours', type: 'skip' as const, name: 'Business Hours Skip' },
    { query: 'escalation', type: 'escalation' as const, name: 'Escalation Keywords' },
    { query: 'warranty', type: 'response' as const, name: 'Warranty Response' },
    { query: 'subscription cancel', type: 'escalation' as const, name: 'Churn Risk Escalation' },
    { query: 'allergy allergen', type: 'escalation' as const, name: 'Health Safety Escalation' },
    {
      query: 'out of stock backorder',
      type: 'response' as const,
      name: 'Inventory Status Response',
    },
    { query: 'discount coupon promo', type: 'response' as const, name: 'Discount Policy Response' },
  ];

  for (const pattern of kbPatterns) {
    try {
      const result = await ctx.agent.callTool('kb_search', {
        question: pattern.query,
        top_k: 3,
        score_threshold: 0.7,
      });
      const rawPayload =
        typeof result.payload === 'string'
          ? result.payload
          : JSON.stringify(result.payload ?? '[]');
      const payload = JSON.parse(rawPayload);
      const hits = Array.isArray(payload) ? payload : (payload.results ?? payload.data ?? []);

      if (hits.length > 0) {
        if (pattern.type === 'skip' && pattern.name.includes('Business Hours')) {
          suggestions.push({
            type: 'skip',
            name: 'Business Hours Rule',
            description: 'Found business hours info in KB — auto-skip outside hours',
            rule: {
              rule_type: 'business_hours',
              params: { timezone: 'America/New_York', start: '09:00', end: '17:00' },
            },
            confidence: 'medium',
            reason: 'KB contains business hours information',
          });
        } else if (pattern.type === 'escalation') {
          const keywords = pattern.query.split(' ');
          suggestions.push({
            type: 'escalation',
            name: pattern.name,
            description: `Escalate tickets mentioning: ${keywords.join(', ')}`,
            rule: {
              pattern: keywords.join('|'),
              category: pattern.name.toLowerCase().replace(/\s+/g, '_'),
              is_regex: true,
            },
            confidence: 'high',
            reason: `KB has content about ${pattern.query}`,
          });
        } else {
          suggestions.push({
            type: 'response',
            name: pattern.name,
            description: `Auto-respond using KB content for "${pattern.query}" queries`,
            rule: {
              rule_name: pattern.name,
              rule_type: 'auto_response',
              description: `Automatically handle queries about ${pattern.query}`,
              conditions: { intent_match: pattern.query.split(' ') },
              actions: { use_kb: true, confidence_threshold: 0.8 },
            },
            confidence: 'medium',
            reason: `Found ${hits.length} relevant KB entries`,
          });
        }
      }
    } catch {
      // KB not available, skip
    }
  }

  // 2. Always suggest standard safety rules
  suggestions.push(
    {
      type: 'escalation',
      name: 'Legal Threat Detection',
      description: 'Escalate when customer mentions lawyers, legal action, or lawsuits',
      rule: {
        pattern: 'lawyer|attorney|legal\\s+action|lawsuit|sue\\b|court',
        category: 'legal_threat',
        is_regex: true,
      },
      confidence: 'high',
      reason: 'Industry standard safety rule',
    },
    {
      type: 'escalation',
      name: 'Manager Request',
      description: 'Escalate when customer asks for a manager or supervisor',
      rule: {
        pattern: 'speak to.*(manager|supervisor)|escalate|human agent',
        category: 'manager_request',
        is_regex: true,
      },
      confidence: 'high',
      reason: 'Industry standard escalation',
    },
    {
      type: 'skip',
      name: 'Agent Already Replied',
      description: 'Skip tickets where a human agent has already responded',
      rule: { rule_type: 'agent_filter', params: {} },
      confidence: 'high',
      reason: 'Prevents AI from overriding human agent responses',
    },
    {
      type: 'skip',
      name: 'Assigned Ticket Filter',
      description: 'Skip tickets assigned to specific agents',
      rule: { rule_type: 'assignee_filter', params: {} },
      confidence: 'high',
      reason: 'Respects manual ticket assignment',
    },
  );

  return suggestions;
}

/* ------------------------------------------------------------------ */
/*  Main handler                                                       */
/* ------------------------------------------------------------------ */

async function runRulesGenerate(ctx: ChatContext, brandSlug?: string): Promise<void> {
  console.log('');
  console.log(chalk.bold('  Rules Auto-Generation'));
  console.log(chalk.gray('  ─'.repeat(24)));
  console.log('');
  printInfo('Analyzing your knowledge base and business data to suggest rules...');
  console.log('');

  const suggestions = await analyzeAndSuggest(ctx, brandSlug);

  if (suggestions.length === 0) {
    printInfo('No rule suggestions generated. Add KB content first with /kb ingest.');
    return;
  }

  // Group by type
  const skipSuggestions = suggestions.filter((s) => s.type === 'skip');
  const escalationSuggestions = suggestions.filter((s) => s.type === 'escalation');
  const responseSuggestions = suggestions.filter((s) => s.type === 'response');

  // Display suggestions
  if (skipSuggestions.length > 0) {
    console.log(chalk.bold.white('  Skip Rules:'));
    for (const s of skipSuggestions) {
      const conf =
        s.confidence === 'high'
          ? chalk.green('●')
          : s.confidence === 'medium'
            ? chalk.yellow('●')
            : chalk.gray('●');
      console.log(`  ${conf} ${chalk.white(s.name)} — ${chalk.gray(s.description)}`);
      console.log(chalk.gray(`      Reason: ${s.reason}`));
    }
    console.log('');
  }

  if (escalationSuggestions.length > 0) {
    console.log(chalk.bold.white('  Escalation Rules:'));
    for (const s of escalationSuggestions) {
      const conf =
        s.confidence === 'high'
          ? chalk.green('●')
          : s.confidence === 'medium'
            ? chalk.yellow('●')
            : chalk.gray('●');
      console.log(`  ${conf} ${chalk.white(s.name)} — ${chalk.gray(s.description)}`);
      console.log(chalk.gray(`      Reason: ${s.reason}`));
    }
    console.log('');
  }

  if (responseSuggestions.length > 0) {
    console.log(chalk.bold.white('  Response Rules:'));
    for (const s of responseSuggestions) {
      const conf =
        s.confidence === 'high'
          ? chalk.green('●')
          : s.confidence === 'medium'
            ? chalk.yellow('●')
            : chalk.gray('●');
      console.log(`  ${conf} ${chalk.white(s.name)} — ${chalk.gray(s.description)}`);
      console.log(chalk.gray(`      Reason: ${s.reason}`));
    }
    console.log('');
  }

  // Human confirmation
  const { selectedSkip } = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'selectedSkip',
      message: 'Accept skip rules:',
      choices: skipSuggestions.map((s) => ({
        name: `${s.name} — ${s.description}`,
        value: s.name,
        checked: s.confidence === 'high',
      })),
      when: () => skipSuggestions.length > 0,
    },
  ]);

  const { selectedEscalation } = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'selectedEscalation',
      message: 'Accept escalation rules:',
      choices: escalationSuggestions.map((s) => ({
        name: `${s.name} — ${s.description}`,
        value: s.name,
        checked: s.confidence === 'high',
      })),
      when: () => escalationSuggestions.length > 0,
    },
  ]);

  const { selectedResponse } = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'selectedResponse',
      message: 'Accept response rules:',
      choices: responseSuggestions.map((s) => ({
        name: `${s.name} — ${s.description}`,
        value: s.name,
        checked: s.confidence === 'high',
      })),
      when: () => responseSuggestions.length > 0,
    },
  ]);

  const accepted = [
    ...skipSuggestions.filter((s) => (selectedSkip ?? []).includes(s.name)),
    ...escalationSuggestions.filter((s) => (selectedEscalation ?? []).includes(s.name)),
    ...responseSuggestions.filter((s) => (selectedResponse ?? []).includes(s.name)),
  ];

  if (accepted.length === 0) {
    printInfo('No rules selected.');
    return;
  }

  // Create rules via agent
  let created = 0;
  for (const suggestion of accepted) {
    if (suggestion.type === 'response') {
      try {
        const ruleData = suggestion.rule as Record<string, unknown>;
        await ctx.agent.callTool('create_rule', {
          rule_name: ruleData.rule_name ?? suggestion.name,
          rule_type: ruleData.rule_type ?? 'auto_response',
          description: ruleData.description ?? suggestion.description,
          conditions: ruleData.conditions ? JSON.stringify(ruleData.conditions) : undefined,
          actions: ruleData.actions ? JSON.stringify(ruleData.actions) : undefined,
        });
        created++;
      } catch {
        console.log(chalk.yellow(`  Warning: could not create rule "${suggestion.name}"`));
      }
    }
  }

  // Write skip and escalation rules to config files
  const acceptedSkip = accepted.filter((s) => s.type === 'skip').map((s) => s.rule as SkipRule);
  const acceptedEscalation = accepted
    .filter((s) => s.type === 'escalation')
    .map((s) => s.rule as EscalationPattern);

  if (brandSlug || acceptedSkip.length > 0 || acceptedEscalation.length > 0) {
    const resolvedBrandSlug = brandSlug ?? 'default';
    const baseDir = path.resolve('.stateset', resolvedBrandSlug, 'rules');
    ensureDir(baseDir);

    let bundle = brandStudioExists(resolvedBrandSlug, process.cwd())
      ? loadBrandStudioBundle(resolvedBrandSlug, process.cwd())
      : buildBrandStudioBundle({
          brandSlug: resolvedBrandSlug,
          cwd: process.cwd(),
          displayName: resolvedBrandSlug,
        });

    if (acceptedSkip.length > 0) {
      bundle.skipRules = [...bundle.skipRules, ...acceptedSkip];
      printSuccess(`${acceptedSkip.length} skip rules → ${path.join(baseDir, 'skip-rules.json')}`);
    }

    if (acceptedEscalation.length > 0) {
      bundle.escalationPatterns = [...bundle.escalationPatterns, ...acceptedEscalation];
      printSuccess(
        `${acceptedEscalation.length} escalation patterns → ${path.join(baseDir, 'escalation-patterns.json')}`,
      );
    }

    bundle = buildBrandStudioBundle({
      brandSlug: resolvedBrandSlug,
      cwd: process.cwd(),
      displayName: bundle.manifest.display_name,
      manifest: bundle.manifest,
      automationConfig: bundle.automationConfig,
      connectors: bundle.connectors,
      skipRules: bundle.skipRules,
      escalationPatterns: bundle.escalationPatterns,
    });
    writeBrandStudioBundle(bundle);
  }

  if (created > 0) {
    printSuccess(`${created} response rules created in platform`);
  }

  console.log('');
  printInfo(`Total: ${accepted.length} rules accepted and saved`);
  printInfo('Commit .stateset/ changes to version control.');
  console.log('');
}

/* ------------------------------------------------------------------ */
/*  Exported handler                                                   */
/* ------------------------------------------------------------------ */

export async function handleRulesGenerateCommand(
  input: string,
  ctx: ChatContext,
): Promise<CommandResult> {
  const trimmed = input.trim().toLowerCase();

  if (trimmed === '/rules generate' || trimmed.startsWith('/rules generate ')) {
    const parts = input.trim().split(/\s+/).slice(2);
    await runRulesGenerate(ctx, parts[0]);
    return { handled: true };
  }

  return NOT_HANDLED;
}
