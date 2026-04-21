/**
 * Build brand manifest and AutomationConfig structures compatible with
 * the next-temporal-rs workflow engine control plane.
 *
 * These builders produce the JSON structures that can be:
 *   1. Written to .stateset/ directory for version-controlled config
 *   2. Posted directly to the control-plane API via EngineClient
 */

/* ------------------------------------------------------------------ */
/*  Connector types                                                    */
/* ------------------------------------------------------------------ */

export type ConnectorType =
  | 'shopify'
  | 'gorgias'
  | 'recharge'
  | 'shiphero'
  | 'gmail'
  | 'outlook'
  | 'openai'
  | 'anthropic'
  | 'qdrant'
  | 'pinecone'
  | 'loop'
  | 'loop_returns'
  | 'stay'
  | 'mem0'
  | 'zendesk'
  | 'freshdesk'
  | 'intercom'
  | 'hubspot'
  | 'front'
  | 'slack'
  | 'twilio'
  | 'whatsapp'
  | 'klaviyo'
  | 'stripe'
  | 'nsr';

export type ConnectorDirection = 'inbound' | 'outbound';

export interface ConnectorSpec {
  connector_key: string;
  connector_type: ConnectorType;
  direction: ConnectorDirection;
  target: Record<string, unknown> & {
    base_url?: string;
    endpoint?: string;
    api_version?: string;
  };
  auth: {
    secret_ref: string; // env://VAR
  };
  retry_policy?: Record<string, unknown>;
  enabled: boolean;
  metadata?: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/*  Skip & Escalation Rules                                           */
/* ------------------------------------------------------------------ */

export type SkipRuleType =
  | 'business_hours'
  | 'ticket_age'
  | 'intent_filter'
  | 'sender_filter'
  | 'subject_filter'
  | 'body_filter'
  | 'channel_filter'
  | 'attachment_filter'
  | 'tag_filter'
  | 'recent_message_filter'
  | 'agent_filter'
  | 'assignee_filter';

export interface SkipRule {
  rule_type: SkipRuleType;
  params: Record<string, unknown>;
}

export type EscalationAction = 'tag_and_skip' | 'tag_and_review' | 'tag_and_continue';

export interface EscalationPattern {
  pattern: string;
  category: string;
  is_regex: boolean;
}

export interface EscalationRules {
  enabled: boolean;
  patterns: EscalationPattern[];
  action: EscalationAction;
  extra_tags: string[];
  ticket_update?: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/*  Context Sources                                                    */
/* ------------------------------------------------------------------ */

export type ContextSourceType =
  | 'gorgias_ticket'
  | 'shopify_customer'
  | 'shopify_orders'
  | 'recharge_subscriptions'
  | 'knowledge_base'
  | 'loop_subscriptions'
  | 'stay_subscriptions';

export interface ContextSource {
  source_type: ContextSourceType;
  enabled: boolean;
  connector_type: string;
  direction: ConnectorDirection;
  params: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/*  Tool Definitions                                                   */
/* ------------------------------------------------------------------ */

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
  };
}

/* ------------------------------------------------------------------ */
/*  Classification                                                     */
/* ------------------------------------------------------------------ */

export interface ClassificationPhase {
  name: string;
  prompt: string;
  labels: string[];
  gate_labels?: string[];
}

export interface ClassificationConfig {
  enabled: boolean;
  phases: ClassificationPhase[];
}

/* ------------------------------------------------------------------ */
/*  Review Gate                                                        */
/* ------------------------------------------------------------------ */

export interface ReviewGateConfig {
  enabled: boolean;
  min_confidence: number;
  escalation_always_review: boolean;
  review_timeout_secs: number | null;
  on_timeout: 'escalate' | 'skip' | 'continue';
  max_review_rounds: number;
}

/* ------------------------------------------------------------------ */
/*  Dispatch                                                           */
/* ------------------------------------------------------------------ */

export interface DispatchConfig {
  channel: string;
  add_tags: boolean | string[];
  set_status?: string | null;
  sender_id?: number | null;
  enabled?: boolean;
  include_citations?: boolean;
}

export interface AdvancedMessageConfig {
  enabled: boolean;
  connector_key: string | null;
  system_instruction: string;
  model: string;
  temperature: number;
  max_tokens: number;
}

export interface TimeSensitiveRuleConfig {
  pattern: string;
  reason: string;
  priority: string | null;
  is_regex: boolean;
  fields: string[];
}

export interface TimeSensitiveCheckConfig {
  enabled: boolean;
  connector_key: string | null;
  system_instruction: string;
  model: string;
  max_messages: number;
  max_chars: number;
  forced_tool_names: string[];
  forced_rules: TimeSensitiveRuleConfig[];
  tag: string;
  status: string;
  priority: string;
  forced_priority: string;
  assignee_team_id: number | null;
}

export interface IntelligentAutoCloseConfig {
  enabled: boolean;
  connector_key: string | null;
  system_instruction: string;
  model: string;
  max_messages: number;
  close_status: string;
}

export interface GorgiasCustomFieldConfig {
  field_id: string;
  key: string;
  label: string;
  description: string;
  allowed_values: string[];
  static_value: string | null;
  required: boolean;
}

export interface GorgiasCustomFieldsConfig {
  enabled: boolean;
  connector_key: string | null;
  system_instruction: string;
  model: string;
  temperature: number;
  max_messages: number;
  fields: GorgiasCustomFieldConfig[];
}

/* ------------------------------------------------------------------ */
/*  AutomationConfig                                                   */
/* ------------------------------------------------------------------ */

export interface AutomationConfig {
  workflow_name: string;
  brand_id?: string;
  brand_slug?: string;
  provider: 'openai' | 'anthropic';
  model: string;
  temperature: number;
  max_tokens: number;
  max_function_call_rounds: number;
  system_prompt_template: string;
  skip_rules: SkipRule[];
  escalation_rules: EscalationRules;
  context_sources: ContextSource[];
  tool_definitions: ToolDefinition[];
  classification: ClassificationConfig;
  review_gate: ReviewGateConfig;
  advanced_message: AdvancedMessageConfig;
  time_sensitive_check: TimeSensitiveCheckConfig;
  intelligent_auto_close: IntelligentAutoCloseConfig;
  gorgias_custom_fields: GorgiasCustomFieldsConfig;
  dispatch: DispatchConfig;
  post_actions: Array<{ action_type: string; params: Record<string, unknown> }>;
}

/* ------------------------------------------------------------------ */
/*  Brand Manifest                                                     */
/* ------------------------------------------------------------------ */

export type BrandStatus = 'draft' | 'validating' | 'active' | 'suspended' | 'archived';
export type RoutingMode = 'legacy' | 'shadow' | 'canary' | 'live';

export interface BrandManifest {
  slug: string;
  display_name: string;
  status: BrandStatus;
  routing_mode: RoutingMode;
  canary_percent: number;
  region: string;
  default_locale: string;
  quotas: {
    max_inflight_workflows: number;
    events_per_minute: number;
    max_payload_bytes: number;
  };
  metadata: Record<string, unknown>;
  workflow_bindings: Array<{
    workflow_type: string;
    template_key: string;
    template_version: number;
    task_queue: string;
    enabled: boolean;
    deterministic_config: AutomationConfig;
  }>;
  connectors: ConnectorSpec[];
}

/* ------------------------------------------------------------------ */
/*  Builders                                                           */
/* ------------------------------------------------------------------ */

export function buildDefaultAutomationConfig(
  opts: {
    brandSlug?: string;
    provider?: 'openai' | 'anthropic';
    model?: string;
    brandName?: string;
  } = {},
): AutomationConfig {
  return {
    workflow_name: 'ResponseAutomationV2',
    brand_slug: opts.brandSlug,
    provider: opts.provider ?? 'anthropic',
    model: opts.model ?? 'claude-sonnet-4-6',
    temperature: 0.3,
    max_tokens: 4096,
    max_function_call_rounds: 5,
    system_prompt_template: [
      `You are a helpful customer support agent for ${opts.brandName ?? '{{brand_name}}'}.`,
      'Use the provided knowledge context and customer information to give accurate, empathetic responses.',
      '',
      'Customer: {{customer_name}}',
      'Context: {{knowledge_context}}',
    ].join('\n'),
    skip_rules: [],
    escalation_rules: {
      enabled: true,
      patterns: [
        { pattern: 'speak to a manager', category: 'manager_request', is_regex: false },
        { pattern: 'lawyer|attorney|legal action|sue', category: 'legal_threat', is_regex: true },
        { pattern: 'BBB|better business bureau', category: 'regulatory', is_regex: true },
      ],
      action: 'tag_and_review',
      extra_tags: ['escalated'],
      ticket_update: {},
    },
    context_sources: [
      {
        source_type: 'gorgias_ticket',
        enabled: true,
        connector_type: 'gorgias',
        direction: 'inbound',
        params: {},
      },
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
      {
        source_type: 'knowledge_base',
        enabled: true,
        connector_type: 'qdrant',
        direction: 'outbound',
        params: { top_k: 10 },
      },
    ],
    tool_definitions: [
      {
        name: 'search_knowledge_base',
        description: 'Search the knowledge base for relevant information',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string', description: 'Search query' } },
          required: ['query'],
        },
      },
      {
        name: 'get_order',
        description: 'Look up an order by order number',
        parameters: {
          type: 'object',
          properties: { order_number: { type: 'string', description: 'Order number' } },
          required: ['order_number'],
        },
      },
    ],
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
      enabled: true,
      min_confidence: 0.8,
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
      enabled: true,
      channel: 'email',
      add_tags: true,
      set_status: 'open',
      sender_id: null,
      include_citations: true,
    },
    post_actions: [],
  };
}

export function buildDefaultManifest(
  slug: string,
  displayName: string,
  automationConfig?: AutomationConfig,
): BrandManifest {
  const config =
    automationConfig ?? buildDefaultAutomationConfig({ brandSlug: slug, brandName: displayName });

  return {
    slug,
    display_name: displayName,
    status: 'draft',
    routing_mode: 'shadow',
    canary_percent: 0,
    region: 'us',
    default_locale: 'en-US',
    quotas: {
      max_inflight_workflows: 50,
      events_per_minute: 100,
      max_payload_bytes: 1_048_576,
    },
    metadata: {},
    workflow_bindings: [
      {
        workflow_type: 'response-automation-v2',
        template_key: 'ResponseAutomationV2',
        template_version: 1,
        task_queue: 'stateset-response-automation-v2',
        enabled: true,
        deterministic_config: config,
      },
    ],
    connectors: [],
  };
}

export function buildConnector(
  type: ConnectorType,
  opts: {
    baseUrl: string;
    secretRef: string;
    apiVersion?: string;
    direction?: ConnectorDirection;
    key?: string;
  },
): ConnectorSpec {
  if (!opts.secretRef.startsWith('env://')) {
    throw new Error('Connector secret_ref must use env://VAR for workflow engine compatibility.');
  }

  return {
    connector_key: opts.key ?? `${type}-primary`,
    connector_type: type,
    direction: opts.direction ?? 'outbound',
    target: {
      base_url: opts.baseUrl,
      api_version: opts.apiVersion,
    },
    auth: {
      secret_ref: opts.secretRef,
    },
    enabled: true,
  };
}

/** Standard connectors with well-known defaults. */
export const CONNECTOR_DEFAULTS: Record<
  string,
  {
    label: string;
    urlTemplate: string;
    envVar: string;
    apiVersion?: string;
    direction?: ConnectorDirection;
  }
> = {
  shopify: {
    label: 'Shopify',
    urlTemplate: 'https://{store}.myshopify.com',
    envVar: 'SHOPIFY_ACCESS_TOKEN',
    apiVersion: '2024-01',
    direction: 'outbound',
  },
  gorgias: {
    label: 'Gorgias',
    urlTemplate: 'https://{account}.gorgias.com',
    envVar: 'GORGIAS_API_KEY',
    direction: 'inbound',
  },
  recharge: {
    label: 'Recharge',
    urlTemplate: 'https://api.rechargeapps.com',
    envVar: 'RECHARGE_API_TOKEN',
    direction: 'outbound',
  },
  gmail: {
    label: 'Gmail',
    urlTemplate: 'https://gmail.googleapis.com',
    envVar: 'GMAIL_OAUTH_TOKEN',
    direction: 'inbound',
  },
  klaviyo: {
    label: 'Klaviyo',
    urlTemplate: 'https://a.klaviyo.com',
    envVar: 'KLAVIYO_API_KEY',
    direction: 'outbound',
  },
  openai: {
    label: 'OpenAI',
    urlTemplate: 'https://api.openai.com',
    envVar: 'OPENAI_API_KEY',
    direction: 'outbound',
  },
  anthropic: {
    label: 'Anthropic',
    urlTemplate: 'https://api.anthropic.com',
    envVar: 'ANTHROPIC_API_KEY',
    direction: 'outbound',
  },
};
