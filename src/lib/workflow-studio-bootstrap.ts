function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

const RESPONSE_AUTOMATION_WORKFLOW = Object.freeze({
  workflowType: 'response-automation-v2',
  legacyWorkflowType: 'response',
  templateKey: 'ResponseAutomationV2',
  templateVersion: 1,
  taskQueue: 'stateset-response-automation-v2',
  workflowName: 'ResponseAutomationV2',
});

export const WORKFLOW_STUDIO_TEMPLATES = {
  ecommerce: {
    id: 'ecommerce',
    name: 'E-commerce Support',
    description: 'Shopify orders, returns, and product Q&A with Gorgias ticket handling',
    overrides: {
      system_prompt_template:
        'You are a friendly and professional customer service agent for {{brand_name}}. You help customers with orders, returns, shipping inquiries, and product questions. Always check the order details before responding. Be concise and empathetic.',
      context_sources: [
        { source_type: 'gorgias_ticket', enabled: true, connector_type: 'gorgias' },
        { source_type: 'shopify_customer', enabled: true, connector_type: 'shopify' },
        {
          source_type: 'shopify_orders',
          enabled: true,
          connector_type: 'shopify',
          params: { max_orders: 10 },
        },
        {
          source_type: 'knowledge_base',
          enabled: true,
          connector_type: 'qdrant',
          params: { top_k: 8, min_score: 0.7 },
        },
      ],
      tool_definitions: [
        {
          name: 'get_order',
          description: 'Look up an order by ID',
          connector_type: 'shopify',
          connector_action: 'get_order',
          parameters_schema: {
            type: 'object',
            properties: { order_id: { type: 'string' } },
            required: ['order_id'],
          },
        },
        {
          name: 'get_customer',
          description: 'Look up customer by email',
          connector_type: 'shopify',
          connector_action: 'get_customer',
          parameters_schema: {
            type: 'object',
            properties: { customer_email: { type: 'string' } },
            required: ['customer_email'],
          },
        },
        {
          name: 'search_knowledge_base',
          description: 'Search help articles',
          connector_type: 'qdrant',
          connector_action: 'search',
          parameters_schema: {
            type: 'object',
            properties: {
              query: { type: 'string' },
              max_results: { type: 'number' },
            },
            required: ['query'],
          },
        },
      ],
      escalation_rules: {
        enabled: true,
        patterns: [
          { pattern: 'lawsuit|legal|attorney|court', is_regex: true, category: 'legal' },
          {
            pattern: 'cancel.*account|close.*account|delete.*data',
            is_regex: true,
            category: 'churn_risk',
          },
          {
            pattern: 'bbb|better business bureau|attorney general',
            is_regex: true,
            category: 'escalation_request',
          },
        ],
        action: 'tag_and_review',
      },
      classification: {
        enabled: true,
        phases: [
          {
            name: 'intent',
            labels: [
              'order_status',
              'return_request',
              'product_question',
              'shipping',
              'billing',
              'other',
            ],
            gate_label: 'primary_intent',
          },
        ],
      },
      review_gate: {
        enabled: true,
        min_confidence: 0.85,
        escalation_always_review: true,
      },
      dispatch: { channel: 'email', add_tags: true, set_status: null },
    },
  },
  subscription: {
    id: 'subscription',
    name: 'Subscription Support',
    description: 'Recharge/Loop subscription management, cancellation handling, and retention',
    overrides: {
      system_prompt_template:
        'You are a helpful subscription support agent for {{brand_name}}. You assist customers with subscription management, billing, skip/pause/cancel requests, and product swaps. When a customer wants to cancel, explore retention options before proceeding.',
      context_sources: [
        { source_type: 'gorgias_ticket', enabled: true, connector_type: 'gorgias' },
        { source_type: 'shopify_customer', enabled: true, connector_type: 'shopify' },
        {
          source_type: 'recharge_subscriptions',
          enabled: true,
          connector_type: 'recharge',
          params: { max_subscriptions: 5 },
        },
        {
          source_type: 'knowledge_base',
          enabled: true,
          connector_type: 'qdrant',
          params: { top_k: 5, min_score: 0.7 },
        },
      ],
      tool_definitions: [
        {
          name: 'get_subscription',
          description: 'Look up a subscription',
          connector_type: 'recharge',
          connector_action: 'get_subscription',
          parameters_schema: {
            type: 'object',
            properties: { subscription_id: { type: 'string' } },
            required: ['subscription_id'],
          },
        },
        {
          name: 'skip_charge',
          description: 'Skip next charge',
          connector_type: 'recharge',
          connector_action: 'skip_charge',
          parameters_schema: {
            type: 'object',
            properties: { subscription_id: { type: 'string' } },
            required: ['subscription_id'],
          },
        },
        {
          name: 'cancel_subscription',
          description: 'Cancel a subscription',
          connector_type: 'recharge',
          connector_action: 'cancel_subscription',
          parameters_schema: {
            type: 'object',
            properties: {
              subscription_id: { type: 'string' },
              reason: { type: 'string' },
            },
            required: ['subscription_id'],
          },
        },
        {
          name: 'search_knowledge_base',
          description: 'Search help articles',
          connector_type: 'qdrant',
          connector_action: 'search',
          parameters_schema: {
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query'],
          },
        },
      ],
      escalation_rules: {
        enabled: true,
        patterns: [
          { pattern: 'lawsuit|legal|attorney', is_regex: true, category: 'legal' },
          {
            pattern: 'charged.*wrong|unauthorized.*charge|fraud',
            is_regex: true,
            category: 'billing_dispute',
          },
        ],
        action: 'tag_and_review',
      },
      classification: {
        enabled: true,
        phases: [
          {
            name: 'intent',
            labels: [
              'cancel',
              'pause',
              'skip',
              'swap_product',
              'billing_question',
              'delivery',
              'other',
            ],
            gate_label: 'primary_intent',
          },
        ],
      },
      review_gate: {
        enabled: true,
        min_confidence: 0.8,
        escalation_always_review: true,
      },
      post_actions: [
        {
          action_type: 'snooze_workflow',
          trigger_intent: 'cancel',
          params: { delay_hours: 72, schedule_days: [3] },
        },
      ],
    },
  },
  knowledge_base: {
    id: 'knowledge_base',
    name: 'Knowledge Base Q&A',
    description: 'Answer questions using your documentation and help articles',
    overrides: {
      system_prompt_template:
        'You are a knowledgeable support assistant for {{brand_name}}. Answer questions using the provided knowledge base articles. Cite sources when available. If you are unsure, say so clearly rather than guessing.',
      context_sources: [
        { source_type: 'gorgias_ticket', enabled: true, connector_type: 'gorgias' },
        {
          source_type: 'knowledge_base',
          enabled: true,
          connector_type: 'qdrant',
          params: { top_k: 10, min_score: 0.65 },
        },
      ],
      tool_definitions: [
        {
          name: 'search_knowledge_base',
          description: 'Search help articles and documentation',
          connector_type: 'qdrant',
          connector_action: 'search',
          parameters_schema: {
            type: 'object',
            properties: {
              query: { type: 'string' },
              max_results: { type: 'number' },
            },
            required: ['query'],
          },
        },
      ],
      review_gate: {
        enabled: true,
        min_confidence: 0.9,
        escalation_always_review: true,
      },
      dispatch: { channel: 'email', add_tags: true, set_status: null },
    },
  },
} as const;

export type WorkflowStudioTemplateId = keyof typeof WORKFLOW_STUDIO_TEMPLATES;

export function listWorkflowStudioTemplateIds(): WorkflowStudioTemplateId[] {
  return Object.keys(WORKFLOW_STUDIO_TEMPLATES) as WorkflowStudioTemplateId[];
}

export function isWorkflowStudioTemplateId(value: string): value is WorkflowStudioTemplateId {
  return Object.prototype.hasOwnProperty.call(WORKFLOW_STUDIO_TEMPLATES, value);
}

export function findResponseAutomationBinding(
  workflowBindings: unknown,
): Record<string, unknown> | null {
  const bindings = Array.isArray(workflowBindings) ? workflowBindings.filter(isObject) : [];

  return (
    bindings.find(
      (binding) =>
        binding.workflow_type === RESPONSE_AUTOMATION_WORKFLOW.workflowType &&
        binding.enabled !== false,
    ) ??
    bindings.find(
      (binding) => binding.workflow_type === RESPONSE_AUTOMATION_WORKFLOW.workflowType,
    ) ??
    bindings.find(
      (binding) =>
        binding.workflow_type === RESPONSE_AUTOMATION_WORKFLOW.legacyWorkflowType &&
        binding.enabled !== false,
    ) ??
    bindings.find(
      (binding) => binding.workflow_type === RESPONSE_AUTOMATION_WORKFLOW.legacyWorkflowType,
    ) ??
    null
  );
}

export function createDefaultWorkflowStudioAutomationConfig(
  opts: { brandId?: string; brandSlug?: string } = {},
): Record<string, unknown> {
  return {
    brand_id: opts.brandId ?? '',
    brand_slug: opts.brandSlug ?? '',
    workflow_name: RESPONSE_AUTOMATION_WORKFLOW.workflowName,
    provider: 'openai',
    model: 'gpt-4o',
    temperature: 0.3,
    max_tokens: 2048,
    max_function_call_rounds: 5,
    system_prompt_template: 'You are a helpful customer service agent for {{brand_name}}.',
    context_sources: [],
    tool_definitions: [],
    escalation_rules: {
      enabled: false,
      patterns: [],
      action: 'tag_and_review',
      extra_tags: [],
      ticket_update: {},
    },
    skip_rules: [],
    classification: {
      enabled: false,
      phases: [],
    },
    review_gate: {
      enabled: false,
      min_confidence: 0.85,
      escalation_always_review: true,
      review_timeout_secs: null,
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
      channel: 'email',
      add_tags: true,
      set_status: null,
      sender_id: null,
    },
    post_actions: [],
  };
}

export function createWorkflowStudioAutomationConfigFromTemplate(
  templateId: WorkflowStudioTemplateId | undefined,
  opts: { brandId?: string; brandSlug?: string } = {},
): Record<string, unknown> {
  const base = createDefaultWorkflowStudioAutomationConfig(opts);
  if (!templateId) {
    return base;
  }

  const template = WORKFLOW_STUDIO_TEMPLATES[templateId];
  return {
    ...base,
    ...template.overrides,
    brand_id: opts.brandId ?? '',
    brand_slug: opts.brandSlug ?? '',
  };
}

export function buildResponseAutomationBinding(
  opts: {
    brandId?: string;
    brandSlug?: string;
    deterministicConfig?: Record<string, unknown>;
    existingBinding?: Record<string, unknown>;
  } = {},
): Record<string, unknown> {
  const baseConfig = createDefaultWorkflowStudioAutomationConfig({
    brandId: opts.brandId,
    brandSlug: opts.brandSlug,
  });
  const deterministicConfig = isObject(opts.deterministicConfig) ? opts.deterministicConfig : {};
  const existingBinding = isObject(opts.existingBinding) ? opts.existingBinding : {};

  return {
    workflow_type: RESPONSE_AUTOMATION_WORKFLOW.workflowType,
    template_key: String(existingBinding.template_key ?? RESPONSE_AUTOMATION_WORKFLOW.templateKey),
    template_version: Number.isInteger(existingBinding.template_version)
      ? Number(existingBinding.template_version)
      : RESPONSE_AUTOMATION_WORKFLOW.templateVersion,
    task_queue: String(existingBinding.task_queue ?? RESPONSE_AUTOMATION_WORKFLOW.taskQueue),
    enabled: existingBinding.enabled !== false,
    deterministic_config: {
      ...baseConfig,
      ...deterministicConfig,
      brand_id: deterministicConfig.brand_id ?? opts.brandId ?? baseConfig.brand_id,
      brand_slug: deterministicConfig.brand_slug ?? opts.brandSlug ?? baseConfig.brand_slug,
      workflow_name: deterministicConfig.workflow_name ?? RESPONSE_AUTOMATION_WORKFLOW.workflowName,
    },
  };
}

export function buildBootstrapBinding(): Record<string, unknown> {
  return {
    workflow_type: RESPONSE_AUTOMATION_WORKFLOW.legacyWorkflowType,
    template_key: RESPONSE_AUTOMATION_WORKFLOW.templateKey,
    template_version: RESPONSE_AUTOMATION_WORKFLOW.templateVersion,
    task_queue: RESPONSE_AUTOMATION_WORKFLOW.taskQueue,
    enabled: true,
    deterministic_config: {
      workflow_name: RESPONSE_AUTOMATION_WORKFLOW.workflowName,
    },
  };
}
