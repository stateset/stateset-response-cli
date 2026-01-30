/**
 * Test fixtures for StateSet Response CLI
 */

// ============================================================================
// IDs
// ============================================================================

export const TEST_ORG_ID = 'test-org-123';
export const TEST_AGENT_ID = '123e4567-e89b-12d3-a456-426614174000';
export const TEST_RULE_ID = '223e4567-e89b-12d3-a456-426614174001';
export const TEST_SKILL_ID = '323e4567-e89b-12d3-a456-426614174002';
export const TEST_FUNCTION_ID = '423e4567-e89b-12d3-a456-426614174003';
export const TEST_CHANNEL_ID = '523e4567-e89b-12d3-a456-426614174004';
export const TEST_MESSAGE_ID = '623e4567-e89b-12d3-a456-426614174005';

// ============================================================================
// Sample Data
// ============================================================================

export const sampleAgent = {
  id: TEST_AGENT_ID,
  agent_name: 'Test Support Agent',
  agent_type: 'AI Agent',
  description: 'A test agent for unit testing',
  activated: true,
  org_id: TEST_ORG_ID,
  created_at: '2024-01-01T00:00:00.000Z',
  updated_at: '2024-01-01T00:00:00.000Z',
  metadata: {},
};

export const sampleRule = {
  id: TEST_RULE_ID,
  rule_name: 'Auto-respond to greetings',
  rule_type: 'auto_response',
  description: 'Automatically respond to greeting messages',
  activated: true,
  shared: false,
  agent_id: TEST_AGENT_ID,
  org_id: TEST_ORG_ID,
  conditions: {
    any: [
      { field: 'message', operator: 'contains', value: 'hello' },
      { field: 'message', operator: 'contains', value: 'hi' },
    ],
  },
  actions: [
    { type: 'send_message', params: { message: 'Hello! How can I help you?' } },
  ],
  metadata: { category: 'greeting' },
  created_at: '2024-01-01T00:00:00.000Z',
  updated_at: '2024-01-01T00:00:00.000Z',
};

export const sampleSkill = {
  id: TEST_SKILL_ID,
  skill_name: 'Order Lookup',
  skill_type: 'lookup',
  description: 'Look up order information',
  activated: true,
  shared: true,
  agent_id: TEST_AGENT_ID,
  org_id: TEST_ORG_ID,
  conditions: {
    all: [
      { field: 'intent', operator: 'eq', value: 'order_status' },
    ],
  },
  actions: [
    { type: 'call_function', params: { function_name: 'get_order' } },
  ],
  metadata: {},
  created_at: '2024-01-01T00:00:00.000Z',
  updated_at: '2024-01-01T00:00:00.000Z',
};

export const sampleFunction = {
  id: TEST_FUNCTION_ID,
  function_name: 'get_order',
  function_type: 'api_call',
  description: 'Fetch order details from the API',
  activated: true,
  agent_id: TEST_AGENT_ID,
  org_id: TEST_ORG_ID,
  endpoint: 'https://api.example.com/orders/{order_id}',
  method: 'GET',
  parameters: [
    { name: 'order_id', type: 'string', required: true, description: 'Order ID' },
  ],
  authentication: { type: 'bearer' },
  headers: { 'Accept': 'application/json' },
  request_transform: { body: {} },
  response_handling: {
    success_condition: 'status_code == 200',
    error_message_path: 'error.message',
    result_mapping: {},
  },
  retry_config: { max_attempts: 3, backoff: 'exponential', retry_on: [502, 503, 504] },
  timeout: 30000,
  rate_limit: { requests_per_minute: 60 },
  created_at: '2024-01-01T00:00:00.000Z',
  updated_at: '2024-01-01T00:00:00.000Z',
};

export const sampleChannel = {
  id: TEST_CHANNEL_ID,
  channel_name: 'Test Channel',
  channel_type: 'web',
  description: 'A test channel',
  activated: true,
  agent_id: TEST_AGENT_ID,
  org_id: TEST_ORG_ID,
  metadata: {},
  created_at: '2024-01-01T00:00:00.000Z',
  updated_at: '2024-01-01T00:00:00.000Z',
};

export const sampleMessage = {
  id: TEST_MESSAGE_ID,
  content: 'Hello, I need help with my order',
  role: 'user',
  channel_id: TEST_CHANNEL_ID,
  org_id: TEST_ORG_ID,
  metadata: { source: 'web' },
  created_at: '2024-01-01T00:00:00.000Z',
  updated_at: '2024-01-01T00:00:00.000Z',
};

// ============================================================================
// Config Fixtures
// ============================================================================

export const sampleConfig = {
  currentOrg: TEST_ORG_ID,
  organizations: {
    [TEST_ORG_ID]: {
      instanceUrl: 'https://api.stateset.com',
      graphqlEndpoint: 'https://api.stateset.com/v1/graphql',
      cliToken: 'test-cli-token-12345',
      model: 'sonnet',
    },
  },
  anthropicApiKey: 'sk-ant-test-key-12345',
};

export const sampleConfigWithAdminSecret = {
  currentOrg: TEST_ORG_ID,
  organizations: {
    [TEST_ORG_ID]: {
      instanceUrl: 'https://api.stateset.com',
      graphqlEndpoint: 'https://api.stateset.com/v1/graphql',
      adminSecret: 'test-admin-secret-12345',
      model: 'haiku',
    },
  },
};

// ============================================================================
// GraphQL Response Fixtures
// ============================================================================

export const graphqlResponses = {
  listAgents: {
    agents: [sampleAgent],
  },
  listRules: {
    rules: [sampleRule],
  },
  listSkills: {
    skills: [sampleSkill],
  },
  listFunctions: {
    functions: [sampleFunction],
  },
  createAgent: {
    insert_agents: {
      returning: [sampleAgent],
    },
  },
  updateAgent: {
    update_agents: {
      returning: [sampleAgent],
    },
  },
  deleteAgent: {
    delete_agents: {
      returning: [{ id: TEST_AGENT_ID, agent_name: 'Test Support Agent' }],
    },
  },
  notFound: {
    update_agents: {
      returning: [],
    },
  },
};

// ============================================================================
// Validation Test Data
// ============================================================================

export const validConditions = {
  any: [
    { field: 'message', operator: 'contains' as const, value: 'hello' },
  ],
};

export const validActions = [
  { type: 'send_message', params: { message: 'Hi!' } },
];

export const validMetadata = {
  category: 'test',
  priority: 1,
  enabled: true,
};

export const invalidConditions = {
  any: [
    { field: 'x'.repeat(200), operator: 'invalid_op', value: 'test' }, // field too long, invalid operator
  ],
};

export const validUrl = 'https://api.example.com/endpoint';
export const invalidUrls = [
  'http://localhost:3000/api',
  'http://127.0.0.1/api',
  'http://192.168.1.1/api',
  'http://10.0.0.1/api',
  'ftp://example.com/file',
  'not-a-url',
];
