/**
 * /onboard — Interactive guided onboarding wizard.
 *
 * Full CLI-first flow:
 *   1. Create or select organization + brand
 *   2. Connect integrations (Shopify, Gorgias, Gmail, etc.)
 *   3. Ingest local files into knowledge base
 *   4. Auto-generate rules from business data
 *   5. Configure workflow (skip rules, escalation, dispatch, context sources)
 *   6. Write config to .stateset/ for version control
 *   7. Validate and activate in the workflow engine
 */

import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import inquirer from 'inquirer';
import type { ChatContext, CommandResult } from './types.js';
import { configExists, getWorkflowEngineConfig } from '../config.js';
import { EngineClient, EngineClientError } from '../lib/engine-client.js';
import {
  buildBrandStudioBundle,
  normalizeBrandSlugOrThrow,
  validateBrandSlug,
  writeBrandStudioBundle,
} from '../lib/brand-studio.js';
import {
  buildDefaultAutomationConfig,
  buildDefaultManifest,
  buildConnector,
  CONNECTOR_DEFAULTS,
  type AutomationConfig,
  type BrandManifest,
  type ConnectorSpec,
  type SkipRule,
  type EscalationPattern,
  type ContextSource,
  type ToolDefinition,
  type ConnectorType,
} from '../lib/manifest-builder.js';
import { processPath } from '../lib/kb-ingest.js';
import { writePrivateTextFileSecure } from '../utils/secure-file.js';

const NOT_HANDLED: CommandResult = { handled: false };

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function statesetDir(): string {
  return path.resolve(process.cwd(), '.stateset');
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

function writeJson(filePath: string, data: unknown): void {
  ensureDir(path.dirname(filePath));
  writePrivateTextFileSecure(filePath, JSON.stringify(data, null, 2) + '\n', {
    label: 'Onboard output file',
    atomic: true,
  });
}

function writeText(filePath: string, content: string): void {
  ensureDir(path.dirname(filePath));
  writePrivateTextFileSecure(filePath, content, {
    label: 'Onboard output file',
    atomic: true,
  });
}

function printStep(step: number, total: number, label: string): void {
  console.log('');
  console.log(chalk.bold.cyan(`  Step ${step}/${total}: ${label}`));
  console.log(chalk.gray('  ' + '─'.repeat(48)));
}

function printSuccess(msg: string): void {
  console.log(chalk.green(`  ✓ ${msg}`));
}

function printInfo(msg: string): void {
  console.log(chalk.gray(`  ${msg}`));
}

/* ------------------------------------------------------------------ */
/*  Step 1: Organization & Brand                                       */
/* ------------------------------------------------------------------ */

async function stepBrand(): Promise<{
  slug: string;
  displayName: string;
  industry: string;
  website: string;
}> {
  printStep(1, 7, 'Organization & Brand Setup');

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'displayName',
      message: 'Brand / company name:',
      validate: (v: string) => (v.trim().length > 0 ? true : 'Required'),
    },
    {
      type: 'input',
      name: 'slug',
      message: 'Brand slug (lowercase, hyphens):',
      default: (a: { displayName: string }) =>
        a.displayName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/(^-|-$)/g, ''),
      validate: validateBrandSlug,
    },
    {
      type: 'list',
      name: 'industry',
      message: 'Industry:',
      choices: [
        'E-commerce / DTC',
        'SaaS / Software',
        'Healthcare / Wellness',
        'Financial Services',
        'Travel / Hospitality',
        'Education',
        'Other',
      ],
    },
    {
      type: 'input',
      name: 'website',
      message: 'Website URL (optional):',
    },
  ]);

  return {
    ...answers,
    slug: normalizeBrandSlugOrThrow(answers.slug),
  };
}

/* ------------------------------------------------------------------ */
/*  Step 2: Integrations                                               */
/* ------------------------------------------------------------------ */

async function stepIntegrations(): Promise<ConnectorSpec[]> {
  printStep(2, 7, 'Connect Integrations');

  printInfo('Select the platforms your support operations use.');
  printInfo('Credentials are stored as env var references (never plaintext).');

  const { selected } = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'selected',
      message: 'Select integrations to connect:',
      choices: [
        { name: 'Shopify (orders, customers, fulfillment)', value: 'shopify', checked: true },
        { name: 'Gorgias (helpdesk, tickets)', value: 'gorgias', checked: true },
        { name: 'Recharge (subscriptions)', value: 'recharge' },
        { name: 'Gmail (email channel)', value: 'gmail' },
        { name: 'Klaviyo (marketing, email)', value: 'klaviyo' },
        { name: 'OpenAI (LLM provider)', value: 'openai' },
        { name: 'Anthropic (LLM provider)', value: 'anthropic' },
      ],
    },
  ]);

  const connectors: ConnectorSpec[] = [];

  for (const integ of selected as string[]) {
    const defaults = CONNECTOR_DEFAULTS[integ];
    if (!defaults) continue;

    console.log('');
    console.log(chalk.bold(`  Configure ${defaults.label}:`));

    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'baseUrl',
        message: `  ${defaults.label} API URL:`,
        default: defaults.urlTemplate,
      },
      {
        type: 'input',
        name: 'secretRef',
        message: `  Secret reference (env var name or env://VAR):`,
        default: `env://${defaults.envVar}`,
        validate: (v: string) => (v.trim().length > 0 ? true : 'Required'),
      },
    ]);

    connectors.push(
      buildConnector(integ as ConnectorType, {
        baseUrl: answers.baseUrl.trim(),
        secretRef: answers.secretRef.trim(),
        apiVersion: defaults.apiVersion,
        direction: defaults.direction,
      }),
    );

    printSuccess(`${defaults.label} configured`);
  }

  return connectors;
}

/* ------------------------------------------------------------------ */
/*  Step 3: Knowledge Base Ingestion                                   */
/* ------------------------------------------------------------------ */

async function stepKnowledgeBase(
  ctx: ChatContext,
  brandSlug: string,
): Promise<{ ingested: number; chunks: number }> {
  printStep(3, 7, 'Knowledge Base Setup');

  printInfo('Ingest local files (SOPs, FAQs, policies, product docs) into your KB.');
  printInfo('Supported: .md, .txt, .json, .yaml, .csv, .html');

  const { sources } = await inquirer.prompt([
    {
      type: 'input',
      name: 'sources',
      message: 'Paths to ingest (comma-separated, or press Enter to skip):',
      default: '',
    },
  ]);

  if (!sources.trim()) {
    printInfo('Skipped. You can run /kb ingest <path> later.');
    return { ingested: 0, chunks: 0 };
  }

  const paths = sources
    .split(',')
    .map((s: string) => s.trim())
    .filter(Boolean);

  let totalChunks = 0;
  let totalFiles = 0;

  for (const p of paths) {
    const resolved = path.resolve(p);
    if (!fs.existsSync(resolved)) {
      console.log(chalk.yellow(`  Warning: ${p} not found, skipping.`));
      continue;
    }

    const { chunks, results } = processPath(resolved);
    const succeeded = results.filter((r) => r.status === 'ok').length;
    const failed = results.filter((r) => r.status === 'error').length;

    console.log(
      chalk.gray(
        `  Processing ${resolved}: ${succeeded} files, ${chunks.length} chunks${failed ? `, ${failed} errors` : ''}`,
      ),
    );

    // Upsert chunks via agent's MCP tools
    for (const chunk of chunks) {
      try {
        await ctx.agent.callTool('kb_upsert', {
          knowledge: chunk.content,
          metadata: {
            ...chunk.metadata,
            brand_slug: brandSlug,
            ingested_by: 'onboard-wizard',
          },
        });
      } catch {
        // Continue on individual chunk failures
      }
    }

    totalChunks += chunks.length;
    totalFiles += succeeded;
  }

  printSuccess(`Ingested ${totalFiles} files → ${totalChunks} KB entries`);

  // Write KB manifest for version control
  const kbDir = path.join(statesetDir(), brandSlug, 'knowledge');
  ensureDir(kbDir);
  writeJson(path.join(kbDir, 'ingest-manifest.json'), {
    brand_slug: brandSlug,
    sources: paths,
    total_files: totalFiles,
    total_chunks: totalChunks,
    ingested_at: new Date().toISOString(),
  });

  return { ingested: totalFiles, chunks: totalChunks };
}

/* ------------------------------------------------------------------ */
/*  Step 4: Rules Configuration                                        */
/* ------------------------------------------------------------------ */

async function stepRules(brandSlug: string): Promise<{
  skipRules: SkipRule[];
  escalationPatterns: EscalationPattern[];
}> {
  printStep(4, 7, 'Rules & Escalation Configuration');

  printInfo('Configure when the AI should skip, escalate, or handle tickets.');

  // Business hours
  const { useBusinessHours } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'useBusinessHours',
      message: 'Only respond during business hours?',
      default: false,
    },
  ]);

  const skipRules: SkipRule[] = [];

  if (useBusinessHours) {
    const bh = await inquirer.prompt([
      {
        type: 'input',
        name: 'timezone',
        message: 'Timezone (IANA format):',
        default: 'America/New_York',
      },
      {
        type: 'input',
        name: 'start',
        message: 'Business hours start (HH:MM):',
        default: '09:00',
      },
      {
        type: 'input',
        name: 'end',
        message: 'Business hours end (HH:MM):',
        default: '17:00',
      },
    ]);
    skipRules.push({
      rule_type: 'business_hours',
      params: { timezone: bh.timezone, start: bh.start, end: bh.end },
    });
  }

  // Ticket age
  const { maxTicketAge } = await inquirer.prompt([
    {
      type: 'number',
      name: 'maxTicketAge',
      message: 'Skip tickets older than N hours (0 = no limit):',
      default: 0,
    },
  ]);
  if (maxTicketAge > 0) {
    skipRules.push({
      rule_type: 'ticket_age',
      params: { max_age_hours: maxTicketAge },
    });
  }

  // Skip when agent already replied
  const { skipAgentReplied } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'skipAgentReplied',
      message: 'Skip tickets where a human agent already replied?',
      default: true,
    },
  ]);
  if (skipAgentReplied) {
    skipRules.push({ rule_type: 'agent_filter', params: {} });
  }

  // Skip assigned tickets
  const { skipAssigned } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'skipAssigned',
      message: 'Skip tickets assigned to a specific agent?',
      default: true,
    },
  ]);
  if (skipAssigned) {
    skipRules.push({ rule_type: 'assignee_filter', params: {} });
  }

  // Sender filters
  const { blockedDomains } = await inquirer.prompt([
    {
      type: 'input',
      name: 'blockedDomains',
      message: 'Block emails from domains (comma-separated, or Enter to skip):',
      default: '',
    },
  ]);
  if (blockedDomains.trim()) {
    const domains = blockedDomains
      .split(',')
      .map((d: string) => d.trim())
      .filter(Boolean);
    skipRules.push({
      rule_type: 'sender_filter',
      params: { blocked_domains: domains },
    });
  }

  // Tag filters
  const { skipTags } = await inquirer.prompt([
    {
      type: 'input',
      name: 'skipTags',
      message: 'Skip tickets with these tags (comma-separated, or Enter to skip):',
      default: '',
    },
  ]);
  if (skipTags.trim()) {
    const tags = skipTags
      .split(',')
      .map((t: string) => t.trim())
      .filter(Boolean);
    skipRules.push({
      rule_type: 'tag_filter',
      params: { skip_tags: tags },
    });
  }

  // Escalation patterns
  console.log('');
  printInfo('Escalation patterns auto-route sensitive tickets to human agents.');

  const defaultPatterns: EscalationPattern[] = [
    { pattern: 'speak to a manager', category: 'manager_request', is_regex: false },
    { pattern: 'lawyer|attorney|legal action', category: 'legal_threat', is_regex: true },
    { pattern: 'BBB|better business bureau', category: 'regulatory', is_regex: true },
    { pattern: 'cancel my account', category: 'churn_risk', is_regex: false },
    { pattern: 'allergic|allergy|reaction', category: 'health_safety', is_regex: false },
  ];

  const { useDefaultEscalation } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'useDefaultEscalation',
      message: 'Use recommended escalation patterns? (manager requests, legal threats, safety)',
      default: true,
    },
  ]);

  const patterns = useDefaultEscalation ? [...defaultPatterns] : [];

  const { customPatterns } = await inquirer.prompt([
    {
      type: 'input',
      name: 'customPatterns',
      message: 'Additional escalation keywords (comma-separated, or Enter to skip):',
      default: '',
    },
  ]);
  if (customPatterns.trim()) {
    const custom = customPatterns
      .split(',')
      .map((p: string) => p.trim())
      .filter(Boolean);
    patterns.push(
      ...custom.map((p: string) => ({
        pattern: p,
        category: 'custom',
        is_regex: false,
      })),
    );
  }

  printSuccess(`${skipRules.length} skip rules, ${patterns.length} escalation patterns configured`);

  // Write rules config
  const rulesDir = path.join(statesetDir(), brandSlug, 'rules');
  ensureDir(rulesDir);
  writeJson(path.join(rulesDir, 'skip-rules.json'), skipRules);
  writeJson(path.join(rulesDir, 'escalation-patterns.json'), patterns);

  return { skipRules, escalationPatterns: patterns };
}

/* ------------------------------------------------------------------ */
/*  Step 5: Workflow Configuration                                     */
/* ------------------------------------------------------------------ */

async function stepWorkflow(
  brandSlug: string,
  brandName: string,
  connectors: ConnectorSpec[],
  skipRules: SkipRule[],
  escalationPatterns: EscalationPattern[],
): Promise<AutomationConfig> {
  printStep(5, 7, 'Workflow Configuration');

  printInfo('Configure how the AI agent processes and responds to tickets.');

  // Model selection
  const providerAnswer = await inquirer.prompt([
    {
      type: 'list',
      name: 'provider',
      message: 'LLM Provider:',
      choices: [
        { name: 'Anthropic (Claude)', value: 'anthropic' },
        { name: 'OpenAI (GPT)', value: 'openai' },
      ],
      default: 'anthropic',
    },
  ]);
  const provider = providerAnswer.provider as 'anthropic' | 'openai';

  const modelChoices =
    provider === 'anthropic'
      ? [
          { name: 'Claude Sonnet 4.6 (recommended)', value: 'claude-sonnet-4-6' },
          { name: 'Claude Haiku 4.5 (faster)', value: 'claude-haiku-4-5' },
          { name: 'Claude Opus 4.7 (most capable)', value: 'claude-opus-4-7' },
        ]
      : [
          { name: 'GPT-4.1 (recommended)', value: 'gpt-4.1' },
          { name: 'GPT-4.1 Mini (faster)', value: 'gpt-4.1-mini' },
          { name: 'GPT-4o', value: 'gpt-4o' },
        ];
  const modelAnswer = await inquirer.prompt([
    { type: 'list', name: 'model', message: 'Model:', choices: modelChoices },
  ]);
  const model = modelAnswer.model as string;

  // Temperature & token settings
  const styleAnswers = await inquirer.prompt([
    {
      type: 'list',
      name: 'temperature',
      message: 'Response style:',
      choices: [
        { name: 'Precise & consistent (0.2)', value: 0.2 },
        { name: 'Balanced (0.4)', value: 0.4 },
        { name: 'Creative & varied (0.7)', value: 0.7 },
      ],
      default: 0.2,
    },
    {
      type: 'number',
      name: 'maxTokens',
      message: 'Max response length (tokens):',
      default: 4096,
    },
  ]);
  const temperature = styleAnswers.temperature as number;
  const maxTokens = styleAnswers.maxTokens as number;

  // Dispatch configuration
  const dispatchQ1 = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'dispatchEnabled',
      message: 'Auto-dispatch responses to tickets?',
      default: true,
    },
  ]);
  const dispatchEnabled = dispatchQ1.dispatchEnabled as boolean;
  let dispatchChannel = 'email';
  let autoTags = 'ai-response';

  if (dispatchEnabled) {
    const dispatchQ2 = await inquirer.prompt([
      {
        type: 'list',
        name: 'dispatchChannel',
        message: 'Dispatch channel:',
        choices: ['email', 'chat', 'sms'],
        default: 'email',
      },
      {
        type: 'input',
        name: 'autoTags',
        message: 'Tags to add to AI responses (comma-separated):',
        default: 'ai-response',
      },
    ]);
    dispatchChannel = dispatchQ2.dispatchChannel as string;
    autoTags = dispatchQ2.autoTags as string;
  }

  // Review gate
  const reviewQ1 = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'reviewEnabled',
      message: 'Enable human review gate for low-confidence responses?',
      default: true,
    },
  ]);
  const reviewEnabled = reviewQ1.reviewEnabled as boolean;
  let minConfidence = 0.8;

  if (reviewEnabled) {
    const reviewQ2 = await inquirer.prompt([
      {
        type: 'number',
        name: 'minConfidence',
        message: 'Minimum confidence to auto-dispatch (0.0-1.0):',
        default: 0.8,
      },
    ]);
    minConfidence = reviewQ2.minConfidence as number;
  }

  // Build context sources based on connected integrations
  const contextSources: ContextSource[] = [];
  const connectorTypes = new Set(connectors.map((c) => c.connector_type));

  if (connectorTypes.has('gorgias')) {
    contextSources.push({
      source_type: 'gorgias_ticket',
      enabled: true,
      connector_type: 'gorgias',
      direction: 'inbound',
      params: {},
    });
  }
  if (connectorTypes.has('shopify')) {
    contextSources.push(
      {
        source_type: 'shopify_customer',
        enabled: true,
        connector_type: 'shopify',
        direction: 'outbound',
        params: {},
      },
      {
        source_type: 'shopify_orders',
        enabled: true,
        connector_type: 'shopify',
        direction: 'outbound',
        params: { max_orders: 10 },
      },
    );
  }
  if (connectorTypes.has('recharge')) {
    contextSources.push({
      source_type: 'recharge_subscriptions',
      enabled: true,
      connector_type: 'recharge',
      direction: 'outbound',
      params: { max_subscriptions: 10 },
    });
  }
  // Always add KB
  contextSources.push({
    source_type: 'knowledge_base',
    enabled: true,
    connector_type: 'qdrant',
    direction: 'outbound',
    params: { top_k: 10 },
  });

  // Build tool definitions based on connected integrations
  const toolDefs: ToolDefinition[] = [
    {
      name: 'search_knowledge_base',
      description: 'Search the knowledge base for relevant information',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Search query' } },
        required: ['query'],
      },
    },
  ];

  if (connectorTypes.has('shopify')) {
    toolDefs.push(
      {
        name: 'get_order',
        description: 'Look up order details by order number',
        parameters: {
          type: 'object',
          properties: { order_number: { type: 'string' } },
          required: ['order_number'],
        },
      },
      {
        name: 'get_customer',
        description: 'Look up customer details by email',
        parameters: {
          type: 'object',
          properties: { email: { type: 'string' } },
          required: ['email'],
        },
      },
    );
  }

  if (connectorTypes.has('recharge')) {
    toolDefs.push({
      name: 'get_subscription',
      description: 'Look up subscription details',
      parameters: {
        type: 'object',
        properties: { customer_email: { type: 'string' } },
        required: ['customer_email'],
      },
    });
  }

  // System prompt
  const { systemPrompt } = await inquirer.prompt([
    {
      type: 'editor',
      name: 'systemPrompt',
      message: 'System prompt (opens editor, or press Enter for default):',
      default: [
        `You are a helpful customer support agent for ${brandName}.`,
        'Use the provided knowledge context and customer information to give accurate, empathetic responses.',
        'Always be professional and concise.',
        '',
        'Customer: {{customer_name}}',
        'Context: {{knowledge_context}}',
      ].join('\n'),
    },
  ]);

  const config: AutomationConfig = {
    workflow_name: 'ResponseAutomationV2',
    brand_slug: brandSlug,
    provider,
    model,
    temperature,
    max_tokens: maxTokens,
    max_function_call_rounds: 5,
    system_prompt_template: systemPrompt,
    skip_rules: skipRules,
    escalation_rules: {
      enabled: escalationPatterns.length > 0,
      patterns: escalationPatterns,
      action: 'tag_and_review',
      extra_tags: ['escalated'],
      ticket_update: {},
    },
    context_sources: contextSources,
    tool_definitions: toolDefs,
    classification: {
      enabled: true,
      phases: [
        {
          name: 'intent',
          prompt: 'Classify the customer intent into one of the following categories.',
          labels: [
            'order_status',
            'return_request',
            'exchange',
            'product_question',
            'shipping',
            'billing',
            'complaint',
            'general_inquiry',
            'subscription',
            'other',
          ],
          gate_labels: ['complaint'],
        },
      ],
    },
    review_gate: {
      enabled: reviewEnabled,
      min_confidence: minConfidence,
      escalation_always_review: true,
      review_timeout_secs: 3600,
      on_timeout: 'escalate',
      max_review_rounds: 0,
    },
    advanced_message: {
      enabled: false,
      connector_key: null,
      system_instruction:
        'Review the message and refine it to make it better for the customer. This is an email response to a customer service request that we are sending to the customer. In your response just include the improved email response that we will send to the customer. Do not make it more wordy, just make it better.',
      model: 'gemini-3-pro-preview',
      temperature: 0.5,
      max_tokens: 2048,
    },
    time_sensitive_check: {
      enabled: false,
      connector_key: null,
      system_instruction:
        'You triage support tickets. Determine if the customer request is time-sensitive and needs a human within minutes to stop fulfillment, change shipping information, or prevent downstream issues. Always respond with JSON following this schema: {"time_sensitive": boolean, "reason": string, "priority": "critical|high|normal|low"}.',
      model: 'gpt-5.4',
      max_messages: 8,
      max_chars: 3500,
      forced_tool_names: [
        'cancel-order',
        'cancel_order',
        'set-shipping-address',
        'set_shipping_address',
      ],
      forced_rules: [
        {
          pattern: '\\b(revise|cancel|stop|void)\\b.{0,40}\\border\\b|\\border\\b.{0,20}\\bcancel',
          reason: 'Customer requested order cancellation',
          priority: 'critical',
          is_regex: true,
          fields: ['latest_message', 'subject'],
        },
        {
          pattern:
            '(change|update|correct|wrong|edit).{0,40}(shipping\\s*)?address|(go|ship|send)\\s+to\\s+.{0,50}address',
          reason: 'Customer requested change of address',
          priority: 'critical',
          is_regex: true,
          fields: ['latest_message', 'subject'],
        },
      ],
      tag: 'time-sensitive',
      status: 'open',
      priority: 'high',
      forced_priority: 'critical',
      assignee_team_id: null,
    },
    intelligent_auto_close: {
      enabled: false,
      connector_key: null,
      system_instruction: [
        'You are Dottie, an expert CX triage assistant for deciding whether to close a support ticket.',
        'Decision policy:',
        '- Default to keeping the ticket open unless the conversation clearly shows resolution with no follow-ups needed.',
        '- Close when the customer explicitly confirms resolution or expresses clear thanks/acknowledgment with no outstanding questions.',
        '- Close when the question is only about international shipping availability.',
        '- Keep open if there is any additional question beyond international shipping, any pending action, any ambiguity, escalation, or any hint that more help is needed.',
        'Output format: Return ONLY strict JSON on one line: {"should_close": true} or {"should_close": false}. No other text.',
      ].join('\n'),
      model: 'gpt-5.4',
      max_messages: 12,
      close_status: 'closed',
    },
    gorgias_custom_fields: {
      enabled: false,
      connector_key: null,
      system_instruction: [
        'You analyze support conversations and choose Gorgias custom field values.',
        'Return ONLY strict JSON with one top-level object.',
        'Each key must match the provided field key.',
        'Each value must be one of the allowed values for that field.',
        'Do not invent values. If the conversation does not support a value, omit that key unless the field is required.',
      ].join('\n'),
      model: 'gpt-5.4',
      temperature: 0.2,
      max_messages: 12,
      fields: [],
    },
    dispatch: {
      enabled: dispatchEnabled,
      channel: dispatchChannel,
      add_tags: autoTags
        .split(',')
        .map((t: string) => t.trim())
        .filter(Boolean),
      set_status: 'open',
      sender_id: null,
      include_citations: true,
    },
    post_actions: [],
  };

  printSuccess('Workflow configuration built');

  return config;
}

/* ------------------------------------------------------------------ */
/*  Step 6: Write config-as-code                                       */
/* ------------------------------------------------------------------ */

function stepWriteConfig(
  brandSlug: string,
  manifest: BrandManifest,
  automationConfig: AutomationConfig,
  connectors: ConnectorSpec[],
): string {
  printStep(6, 7, 'Write Configuration Files');

  const bundle = buildBrandStudioBundle({
    brandSlug,
    cwd: process.cwd(),
    displayName: manifest.display_name,
    manifest,
    automationConfig,
    connectors,
    skipRules: automationConfig.skip_rules,
    escalationPatterns: automationConfig.escalation_rules.patterns,
  });
  const baseDir = writeBrandStudioBundle(bundle);

  printSuccess('manifest.json');
  printSuccess('automation-config.json');
  printSuccess('connectors.json');

  // .env.example for connector secrets
  const envLines = connectors
    .map((c) => {
      const ref = c.auth.secret_ref.replace(/^env:\/\//, '');
      return `${ref}=your-${c.connector_type}-key-here`;
    })
    .join('\n');
  if (envLines) {
    writeText(path.join(baseDir, '.env.example'), envLines + '\n');
    printSuccess('.env.example');
  }

  // gitignore for secrets
  const gitignore = ['.env', '.env.local', '*.secret', '*.key'].join('\n');
  writeText(path.join(baseDir, '.gitignore'), gitignore + '\n');
  printSuccess('.gitignore');

  printInfo(`Config written to ${baseDir}`);
  printInfo('Commit this directory to version control for config-as-code.');

  return baseDir;
}

/* ------------------------------------------------------------------ */
/*  Step 7: Deploy to workflow engine                                  */
/* ------------------------------------------------------------------ */

async function stepDeploy(
  brandSlug: string,
  manifest: BrandManifest,
  connectors: ConnectorSpec[],
): Promise<void> {
  printStep(7, 7, 'Deploy to Workflow Engine');

  const engineConfig = getWorkflowEngineConfig();
  if (!engineConfig) {
    printInfo('Workflow engine not configured. Run /engine setup to connect.');
    printInfo(
      `Your config is saved locally — deploy when ready with /engine config push ${brandSlug}.`,
    );
    return;
  }

  const { deploy } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'deploy',
      message: 'Deploy brand to workflow engine now?',
      default: true,
    },
  ]);

  if (!deploy) {
    printInfo(`Skipped. Deploy later with: /engine config push ${brandSlug}`);
    return;
  }

  if (!engineConfig.tenantId) {
    console.log(
      chalk.yellow(
        '  Workflow engine tenant ID is required to create a brand. Set WORKFLOW_ENGINE_TENANT_ID, then run /engine config push.',
      ),
    );
    return;
  }

  const client = new EngineClient(engineConfig);

  try {
    const workflowBindings =
      manifest.workflow_bindings.length > 0
        ? manifest.workflow_bindings
        : buildDefaultManifest(manifest.slug, manifest.display_name).workflow_bindings;

    // Create brand
    console.log(chalk.gray('  Creating brand...'));
    const brand = (await client.createBrand({
      tenant_id: engineConfig.tenantId,
      slug: manifest.slug,
      display_name: manifest.display_name,
      region: manifest.region,
      default_locale: manifest.default_locale,
      routing_mode: 'shadow',
      quotas: manifest.quotas,
      metadata: manifest.metadata,
      workflow_bindings: workflowBindings,
    })) as Record<string, unknown>;
    const brandId = String(brand.id ?? brand.brand_id ?? '');
    printSuccess(`Brand created: ${brandId}`);

    // Reconcile connectors
    await client.replaceConnectors(
      brandId,
      connectors as unknown as Array<Record<string, unknown>>,
    );
    printSuccess(`Connectors reconciled: ${connectors.length}`);

    // Update brand config (workflow binding)
    if (workflowBindings.length > 0) {
      await client.updateBrand(brandId, {
        workflow_bindings: workflowBindings,
      });
      printSuccess('Workflow binding configured');
    }

    // Validate
    console.log(chalk.gray('  Validating...'));
    await client.validateBrand(brandId);
    printSuccess('Validation passed');

    // Create onboarding run
    await client.createOnboardingRun(brandId, 'CLI onboarding wizard');
    printSuccess('Onboarding run created');

    // Offer to activate
    const { activate } = await inquirer.prompt([
      {
        type: 'list',
        name: 'activate',
        message: 'Activation mode:',
        choices: [
          { name: 'Shadow (recommended — runs in parallel, no customer impact)', value: 'shadow' },
          { name: 'Canary (gradual rollout, start at 10%)', value: 'canary' },
          { name: 'Live (full production — use with caution)', value: 'live' },
          { name: 'Skip activation for now', value: 'skip' },
        ],
        default: 'shadow',
      },
    ]);

    if (activate !== 'skip') {
      if (activate === 'canary') {
        await client.updateBrand(brandId, {
          routing_mode: 'canary',
          canary_percent: 10,
        });
        printSuccess('Brand activated in canary mode (10%)');
      } else if (activate === 'live') {
        await client.activateBrand(brandId);
        printSuccess('Brand activated in live mode');
      } else {
        await client.updateBrand(brandId, { routing_mode: 'shadow' });
        printSuccess('Brand activated in shadow mode');
      }
    }
  } catch (err) {
    const msg = err instanceof EngineClientError ? err.message : String(err);
    console.log(chalk.red(`  Deploy error: ${msg}`));
    printInfo(
      `Your config is saved locally. Fix the issue and run /engine config push ${brandSlug} to retry.`,
    );
  }
}

/* ------------------------------------------------------------------ */
/*  Main onboard command                                               */
/* ------------------------------------------------------------------ */

async function runOnboard(ctx: ChatContext): Promise<void> {
  console.log('');
  console.log(chalk.bold.white('  ╔══════════════════════════════════════════════╗'));
  console.log(chalk.bold.white('  ║   StateSet Onboarding Wizard                ║'));
  console.log(chalk.bold.white('  ║   Configure your agentic orchestration      ║'));
  console.log(chalk.bold.white('  ║   engine entirely from the CLI.             ║'));
  console.log(chalk.bold.white('  ╚══════════════════════════════════════════════╝'));
  console.log('');

  if (!configExists()) {
    console.log(chalk.red('  Not authenticated. Run "response auth login" first.'));
    return;
  }

  // Step 1: Brand
  const brand = await stepBrand();

  // Step 2: Integrations
  const connectors = await stepIntegrations();

  // Step 3: Knowledge Base
  await stepKnowledgeBase(ctx, brand.slug);

  // Step 4: Rules
  const { skipRules, escalationPatterns } = await stepRules(brand.slug);

  // Step 5: Workflow Config
  const automationConfig = await stepWorkflow(
    brand.slug,
    brand.displayName,
    connectors,
    skipRules,
    escalationPatterns,
  );

  // Build full manifest
  const manifest = buildDefaultManifest(brand.slug, brand.displayName, automationConfig);
  manifest.connectors = connectors;
  manifest.metadata = {
    industry: brand.industry,
    website: brand.website,
    onboarded_at: new Date().toISOString(),
    onboarded_via: 'cli-wizard',
  };

  // Step 6: Write config
  const configDir = stepWriteConfig(brand.slug, manifest, automationConfig, connectors);

  // Step 7: Deploy
  await stepDeploy(brand.slug, manifest, connectors);

  // Summary
  console.log('');
  console.log(chalk.bold.green('  ✓ Onboarding complete!'));
  console.log('');
  console.log(chalk.white('  Next steps:'));
  console.log(chalk.gray(`  1. cd ${configDir} && git init && git add .`));
  console.log(chalk.gray('  2. Commit your config to version control'));
  console.log(chalk.gray('  3. Run /engine health to verify engine connection'));
  console.log(chalk.gray('  4. Run /workflows start <brand> <ticket-id> to test'));
  console.log(chalk.gray('  5. Run /evals suggest to set up quality evaluation'));
  console.log(chalk.gray('  6. Run /rules generate to auto-populate rules from your data'));
  console.log('');
}

/* ------------------------------------------------------------------ */
/*  Quick init: create .stateset/ directory structure                   */
/* ------------------------------------------------------------------ */

async function runInit(brandSlug?: string): Promise<void> {
  console.log('');

  if (!brandSlug) {
    const { slug } = await inquirer.prompt([
      {
        type: 'input',
        name: 'slug',
        message: 'Brand slug:',
        validate: validateBrandSlug,
      },
    ]);
    brandSlug = normalizeBrandSlugOrThrow(slug);
  } else {
    brandSlug = normalizeBrandSlugOrThrow(brandSlug);
  }

  const baseDir = path.join(statesetDir(), brandSlug!);
  if (fs.existsSync(baseDir)) {
    console.log(chalk.yellow(`  Directory already exists: ${baseDir}`));
    return;
  }

  const dirs = ['', 'rules', 'knowledge', 'workflows', 'connectors', 'evals'];
  for (const sub of dirs) {
    ensureDir(path.join(baseDir, sub));
  }

  // Scaffold files
  const defaultConfig = buildDefaultAutomationConfig({ brandSlug, brandName: brandSlug });
  const defaultManifest = buildDefaultManifest(brandSlug!, brandSlug!);
  const bundle = buildBrandStudioBundle({
    brandSlug: brandSlug!,
    cwd: process.cwd(),
    displayName: brandSlug!,
    manifest: defaultManifest,
    automationConfig: defaultConfig,
    connectors: [],
    skipRules: defaultConfig.skip_rules,
    escalationPatterns: defaultConfig.escalation_rules.patterns,
  });
  writeBrandStudioBundle(bundle);

  const gitignore = ['.env', '.env.local', '*.secret', '*.key'].join('\n');
  writeText(path.join(baseDir, '.gitignore'), gitignore + '\n');

  printSuccess(`Initialized .stateset/${brandSlug}/`);
  printInfo(`Edit the config files, then run /engine config push ${brandSlug} to deploy.`);
  console.log('');
}

/* ------------------------------------------------------------------ */
/*  Exported handler                                                   */
/* ------------------------------------------------------------------ */

export async function handleOnboardCommand(
  input: string,
  ctx: ChatContext,
): Promise<CommandResult> {
  const trimmed = input.trim().toLowerCase();

  if (trimmed === '/onboard' || trimmed.startsWith('/onboard ')) {
    const parts = input.trim().split(/\s+/).slice(1);
    const subcommand = parts[0]?.toLowerCase() ?? '';

    if (subcommand === 'init') {
      await runInit(parts[1]);
      return { handled: true };
    }

    await runOnboard(ctx);
    return { handled: true };
  }

  return NOT_HANDLED;
}
