/**
 * HTTP client for the StateSet Workflow Engine (next-temporal-rs).
 *
 * Wraps fetch with Authorization header, timeout, retry on GET (2 retries),
 * and optional tenant-scoping via x-tenant-id header.
 */

import type { WorkflowEngineConfig } from '../config.js';

const DEFAULT_TIMEOUT_MS = 15_000;
const GET_MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 500;

export class EngineClientError extends Error {
  status?: number;
  code?: string;
  data?: unknown;

  constructor(message: string, opts?: { status?: number; code?: string; data?: unknown }) {
    super(message);
    this.name = 'EngineClientError';
    this.status = opts?.status;
    this.code = opts?.code;
    this.data = opts?.data;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type WorkflowAction = 'status' | 'review' | 'cancel' | 'restart' | 'terminate';
type WorkflowEndpointType = 'rav2' | 'connector' | 'snooze' | 'sandbox-agent-loop' | 'legacy';

function classifyWorkflowId(workflowId: string): WorkflowEndpointType {
  if (workflowId.startsWith('rav2-') || workflowId.startsWith('cp-response-automation-v2-')) {
    return 'rav2';
  }
  if (workflowId.startsWith('connector-')) return 'connector';
  if (workflowId.startsWith('snooze-')) return 'snooze';
  if (workflowId.startsWith('sandbox-agent-')) return 'sandbox-agent-loop';
  return 'legacy';
}

function normalizeWorkflowType(workflowType?: string): WorkflowEndpointType {
  switch (workflowType) {
    case 'response-automation-v2':
      return 'rav2';
    case 'connector':
      return 'connector';
    case 'snooze':
      return 'snooze';
    case 'sandbox-agent-loop':
      return 'sandbox-agent-loop';
    default:
      return 'legacy';
  }
}

function buildWorkflowActionPath(
  workflowId: string,
  action: WorkflowAction,
  workflowType?: string,
): string | null {
  const type = workflowType ? normalizeWorkflowType(workflowType) : classifyWorkflowId(workflowId);

  switch (type) {
    case 'rav2':
      if (action === 'status') return `/v1/workflows/response-automation-v2/${workflowId}/status`;
      if (action === 'review') return `/v1/workflows/response-automation-v2/${workflowId}/review`;
      if (action === 'cancel') return `/v1/workflows/response-automation-v2/${workflowId}/cancel`;
      if (action === 'restart') return `/v1/workflows/response-automation-v2/${workflowId}/restart`;
      if (action === 'terminate') {
        return `/v1/workflows/response-automation-v2/${workflowId}/terminate`;
      }
      return null;

    case 'connector':
      if (action === 'status') return `/v1/workflows/connector/${workflowId}/status`;
      if (action === 'cancel') return `/v1/workflows/connector/${workflowId}/cancel`;
      if (action === 'terminate') return `/v1/workflows/connector/${workflowId}/terminate`;
      return null;

    case 'snooze':
      if (action === 'status') return `/v1/workflows/snooze/${workflowId}/status`;
      if (action === 'cancel') return `/v1/workflows/snooze/${workflowId}/cancel`;
      if (action === 'terminate') return `/v1/workflows/snooze/${workflowId}/terminate`;
      return null;

    case 'sandbox-agent-loop':
      if (action === 'status') return `/v1/workflows/sandbox-agent-loop/${workflowId}/status`;
      if (action === 'cancel') return `/v1/workflows/sandbox-agent-loop/${workflowId}/cancel`;
      if (action === 'terminate') {
        return `/v1/workflows/sandbox-agent-loop/${workflowId}/terminate`;
      }
      return null;

    case 'legacy':
    default:
      if (action === 'status') return `/v1/workflows/${workflowId}/status`;
      if (action === 'review') return `/v1/workflows/${workflowId}/signal/review`;
      if (action === 'cancel') return `/v1/workflows/${workflowId}/cancel`;
      if (action === 'terminate') return `/v1/workflows/${workflowId}/terminate`;
      return null;
  }
}

export class EngineClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly tenantId?: string;

  constructor(config: WorkflowEngineConfig) {
    this.baseUrl = config.url.replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.tenantId = config.tenantId;
  }

  private async request(
    path: string,
    options: {
      method?: string;
      body?: unknown;
      timeoutMs?: number;
      headers?: Record<string, string>;
    } = {},
  ): Promise<unknown> {
    const url = `${this.baseUrl}${path}`;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
      ...options.headers,
    };
    if (this.tenantId) {
      headers['x-tenant-id'] = this.tenantId;
    }

    try {
      const res = await fetch(url, {
        method: options.method ?? 'GET',
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });

      const contentType = res.headers.get('content-type') ?? '';
      const body = contentType.includes('application/json') ? await res.json() : await res.text();

      if (!res.ok) {
        const errorMsg =
          typeof body === 'object' && body !== null
            ? ((body as Record<string, unknown>).error ??
              (body as Record<string, unknown>).message ??
              JSON.stringify(body))
            : body;
        throw new EngineClientError(String(errorMsg), {
          status: res.status,
          code:
            typeof body === 'object' && body !== null
              ? String((body as Record<string, unknown>).error ?? '')
              : undefined,
          data: body,
        });
      }

      if (
        typeof body === 'object' &&
        body !== null &&
        'data' in (body as Record<string, unknown>)
      ) {
        return (body as Record<string, unknown>).data;
      }
      return body;
    } catch (err) {
      if (err instanceof EngineClientError) throw err;
      if ((err as Error).name === 'AbortError') {
        throw new EngineClientError(`Engine request to ${path} timed out after ${timeoutMs}ms`, {
          status: 504,
          code: 'TIMEOUT',
        });
      }
      throw new EngineClientError((err as Error).message || 'Engine request failed', {
        status: 502,
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async fetchWithRetry(
    path: string,
    options: {
      method?: string;
      body?: unknown;
      timeoutMs?: number;
      headers?: Record<string, string>;
    } = {},
  ): Promise<unknown> {
    const method = options.method ?? 'GET';
    const maxRetries = method === 'GET' ? GET_MAX_RETRIES : 0;
    let lastErr: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this.request(path, options);
      } catch (err) {
        lastErr = err;
        if (
          err instanceof EngineClientError &&
          err.status !== undefined &&
          err.status >= 400 &&
          err.status < 500 &&
          err.status !== 429
        ) {
          throw err;
        }
        if (attempt < maxRetries) {
          const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
          const jitter = Math.floor(Math.random() * delay * 0.25);
          await sleep(delay + jitter);
        }
      }
    }
    throw lastErr;
  }

  async health(): Promise<unknown> {
    return this.fetchWithRetry('/health');
  }

  async healthz(): Promise<unknown> {
    return this.fetchWithRetry('/healthz');
  }

  async readyz(): Promise<unknown> {
    return this.fetchWithRetry('/readyz');
  }

  async metrics(): Promise<unknown> {
    return this.fetchWithRetry('/metrics');
  }

  async getDispatchHealthDashboard(filters?: {
    tenantId?: string;
    limit?: number;
    offset?: number;
  }): Promise<unknown> {
    const params = new URLSearchParams();
    if (filters?.tenantId) params.set('tenant_id', filters.tenantId);
    if (filters?.limit !== undefined) params.set('limit', String(filters.limit));
    if (filters?.offset !== undefined) params.set('offset', String(filters.offset));
    const qs = params.toString();
    return this.fetchWithRetry(`/v1/dispatch/health${qs ? `?${qs}` : ''}`);
  }

  async runDispatchGuard(request: {
    tenantId?: string;
    apply?: boolean;
    minimumHealthStatus?: string;
    maxActions?: number;
  }): Promise<unknown> {
    return this.request('/v1/dispatch/guard', {
      method: 'POST',
      body: {
        tenant_id: request.tenantId,
        apply: request.apply,
        minimum_health_status: request.minimumHealthStatus,
        max_actions: request.maxActions,
      },
    });
  }

  async listBrands(filters?: {
    status?: string;
    slug?: string;
    limit?: number;
    offset?: number;
  }): Promise<unknown> {
    const params = new URLSearchParams();
    if (filters?.status) params.set('status', filters.status);
    if (filters?.slug) params.set('slug', filters.slug);
    if (filters?.limit !== undefined) params.set('limit', String(filters.limit));
    if (filters?.offset !== undefined) params.set('offset', String(filters.offset));
    const qs = params.toString();
    return this.fetchWithRetry(`/v1/brands${qs ? `?${qs}` : ''}`);
  }

  async listBootstrapTemplates(): Promise<unknown> {
    return this.fetchWithRetry('/v1/bootstrap/templates');
  }

  async bootstrapBrand(payload: Record<string, unknown>): Promise<unknown> {
    return this.request('/v1/bootstrap/brands', {
      method: 'POST',
      body: payload,
    });
  }

  async getBrand(brandId: string): Promise<unknown> {
    return this.fetchWithRetry(`/v1/brands/${brandId}`);
  }

  async createBrand(payload: Record<string, unknown>, idempotencyKey?: string): Promise<unknown> {
    const headers: Record<string, string> = {};
    if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
    return this.request('/v1/brands', {
      method: 'POST',
      body: payload,
      headers,
    });
  }

  async updateBrand(brandId: string, patch: Record<string, unknown>): Promise<unknown> {
    return this.request(`/v1/brands/${brandId}`, {
      method: 'PATCH',
      body: patch,
    });
  }

  async validateBrand(brandId: string): Promise<unknown> {
    return this.request(`/v1/brands/${brandId}/validate`, { method: 'POST' });
  }

  async activateBrand(brandId: string, expectedConfigVersion?: number): Promise<unknown> {
    return this.request(`/v1/brands/${brandId}/activate`, {
      method: 'POST',
      body:
        expectedConfigVersion !== undefined
          ? { expected_config_version: expectedConfigVersion }
          : {},
    });
  }

  async getBrandConfig(brandId: string): Promise<unknown> {
    return this.fetchWithRetry(`/v1/brands/${brandId}/config`);
  }

  async getBrandBillingState(brandId: string): Promise<unknown> {
    return this.fetchWithRetry(`/v1/brands/${brandId}/billing`);
  }

  async upsertBrandBillingProfile(
    brandId: string,
    payload: Record<string, unknown>,
  ): Promise<unknown> {
    return this.request(`/v1/brands/${brandId}/billing`, {
      method: 'PUT',
      body: payload,
    });
  }

  async syncBrandBillingEvents(
    brandId: string,
    request: { limit?: number } = {},
  ): Promise<unknown> {
    return this.request(`/v1/brands/${brandId}/billing/sync`, {
      method: 'POST',
      body: { limit: request.limit },
    });
  }

  async getBrandBillingContract(brandId: string): Promise<unknown> {
    return this.fetchWithRetry(`/v1/brands/${brandId}/billing/contract`);
  }

  async upsertBrandBillingContract(
    brandId: string,
    payload: Record<string, unknown>,
  ): Promise<unknown> {
    return this.request(`/v1/brands/${brandId}/billing/contract`, {
      method: 'PUT',
      body: payload,
    });
  }

  async listBrandBillingPeriods(
    brandId: string,
    filters?: { status?: string; limit?: number; offset?: number },
  ): Promise<unknown> {
    const params = new URLSearchParams();
    if (filters?.status) params.set('status', filters.status);
    if (filters?.limit !== undefined) params.set('limit', String(filters.limit));
    if (filters?.offset !== undefined) params.set('offset', String(filters.offset));
    const qs = params.toString();
    return this.fetchWithRetry(`/v1/brands/${brandId}/billing/periods${qs ? `?${qs}` : ''}`);
  }

  async closeBrandBillingPeriod(brandId: string, periodId: string): Promise<unknown> {
    return this.request(`/v1/brands/${brandId}/billing/periods/${periodId}/close`, {
      method: 'POST',
      body: {},
    });
  }

  async listBrandRatedOutcomes(
    brandId: string,
    filters?: {
      ratingKind?: string;
      periodId?: string;
      from?: string;
      to?: string;
      limit?: number;
      offset?: number;
    },
  ): Promise<unknown> {
    const params = new URLSearchParams();
    if (filters?.ratingKind) params.set('rating_kind', filters.ratingKind);
    if (filters?.periodId) params.set('period_id', filters.periodId);
    if (filters?.from) params.set('from', filters.from);
    if (filters?.to) params.set('to', filters.to);
    if (filters?.limit !== undefined) params.set('limit', String(filters.limit));
    if (filters?.offset !== undefined) params.set('offset', String(filters.offset));
    const qs = params.toString();
    return this.fetchWithRetry(`/v1/brands/${brandId}/billing/rated-outcomes${qs ? `?${qs}` : ''}`);
  }

  async getBrandBillingReconciliation(brandId: string): Promise<unknown> {
    return this.fetchWithRetry(`/v1/brands/${brandId}/billing/reconciliation`);
  }

  async getBrandOutcomeSummary(
    brandId: string,
    filters?: {
      from?: string;
      to?: string;
      status?: string;
      outcomeType?: string;
      source?: string;
    },
  ): Promise<unknown> {
    const params = new URLSearchParams();
    if (filters?.from) params.set('from', filters.from);
    if (filters?.to) params.set('to', filters.to);
    if (filters?.status) params.set('status', filters.status);
    if (filters?.outcomeType) params.set('outcome_type', filters.outcomeType);
    if (filters?.source) params.set('source', filters.source);
    const qs = params.toString();
    return this.fetchWithRetry(`/v1/brands/${brandId}/outcomes/summary${qs ? `?${qs}` : ''}`);
  }

  async listBrandOutcomes(
    brandId: string,
    filters?: {
      from?: string;
      to?: string;
      status?: string;
      outcomeType?: string;
      source?: string;
      limit?: number;
      offset?: number;
    },
  ): Promise<unknown> {
    const params = new URLSearchParams();
    if (filters?.from) params.set('from', filters.from);
    if (filters?.to) params.set('to', filters.to);
    if (filters?.status) params.set('status', filters.status);
    if (filters?.outcomeType) params.set('outcome_type', filters.outcomeType);
    if (filters?.source) params.set('source', filters.source);
    if (filters?.limit !== undefined) params.set('limit', String(filters.limit));
    if (filters?.offset !== undefined) params.set('offset', String(filters.offset));
    const qs = params.toString();
    return this.fetchWithRetry(`/v1/brands/${brandId}/outcomes${qs ? `?${qs}` : ''}`);
  }

  async recordBrandOutcome(brandId: string, payload: Record<string, unknown>): Promise<unknown> {
    return this.request(`/v1/brands/${brandId}/outcomes`, {
      method: 'POST',
      body: payload,
    });
  }

  async listBrandConfigVersions(
    brandId: string,
    filters?: { limit?: number; offset?: number },
  ): Promise<unknown> {
    const params = new URLSearchParams();
    if (filters?.limit !== undefined) params.set('limit', String(filters.limit));
    if (filters?.offset !== undefined) params.set('offset', String(filters.offset));
    const qs = params.toString();
    return this.fetchWithRetry(`/v1/brands/${brandId}/config-versions${qs ? `?${qs}` : ''}`);
  }

  async listConnectors(brandId: string): Promise<unknown> {
    return this.fetchWithRetry(`/v1/brands/${brandId}/connectors`);
  }

  async createConnector(brandId: string, payload: Record<string, unknown>): Promise<unknown> {
    return this.request(`/v1/brands/${brandId}/connectors`, {
      method: 'POST',
      body: payload,
    });
  }

  async replaceConnectors(
    brandId: string,
    connectors: Array<Record<string, unknown>>,
  ): Promise<unknown> {
    return this.request(`/v1/brands/${brandId}/connectors`, {
      method: 'PUT',
      body: { connectors },
    });
  }

  async checkConnectorHealth(brandId: string, connectorId: string): Promise<unknown> {
    return this.request(`/v1/brands/${brandId}/connectors/${connectorId}/health`, {
      method: 'POST',
    });
  }

  async listOnboardingRuns(brandId: string): Promise<unknown> {
    return this.fetchWithRetry(`/v1/brands/${brandId}/onboarding`);
  }

  async createOnboardingRun(brandId: string, notes?: string): Promise<unknown> {
    return this.request(`/v1/brands/${brandId}/onboarding`, {
      method: 'POST',
      body: notes ? { notes } : {},
    });
  }

  async getOnboardingRun(brandId: string, runId: string): Promise<unknown> {
    return this.fetchWithRetry(`/v1/brands/${brandId}/onboarding/${runId}`);
  }

  async updateOnboardingRun(
    brandId: string,
    runId: string,
    patch: { status?: string; checks?: unknown; notes?: string },
  ): Promise<unknown> {
    return this.request(`/v1/brands/${brandId}/onboarding/${runId}`, {
      method: 'PATCH',
      body: patch,
    });
  }

  async getBrandMigrationState(brandId: string): Promise<unknown> {
    return this.fetchWithRetry(`/v1/brands/${brandId}/migration`);
  }

  async updateBrandMigrationState(
    brandId: string,
    patch: Record<string, unknown>,
  ): Promise<unknown> {
    return this.request(`/v1/brands/${brandId}/migration`, {
      method: 'PATCH',
      body: patch,
    });
  }

  async getBrandParityDashboard(
    brandId: string,
    filters?: { from?: string; to?: string },
  ): Promise<unknown> {
    const params = new URLSearchParams();
    if (filters?.from) params.set('from', filters.from);
    if (filters?.to) params.set('to', filters.to);
    const qs = params.toString();
    return this.fetchWithRetry(`/v1/brands/${brandId}/parity${qs ? `?${qs}` : ''}`);
  }

  async listWorkflowTemplates(filters?: {
    template_key?: string;
    workflow_type?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<unknown> {
    const params = new URLSearchParams();
    if (filters?.template_key) params.set('template_key', filters.template_key);
    if (filters?.workflow_type) params.set('workflow_type', filters.workflow_type);
    if (filters?.status) params.set('status', filters.status);
    if (filters?.limit !== undefined) params.set('limit', String(filters.limit));
    if (filters?.offset !== undefined) params.set('offset', String(filters.offset));
    const qs = params.toString();
    return this.fetchWithRetry(`/v1/workflow-templates${qs ? `?${qs}` : ''}`);
  }

  async getWorkflowTemplate(templateKey: string, version?: number): Promise<unknown> {
    const path =
      version !== undefined
        ? `/v1/workflow-templates/${templateKey}/${version}`
        : `/v1/workflow-templates/${templateKey}`;
    return this.fetchWithRetry(path);
  }

  async createWorkflowTemplate(payload: Record<string, unknown>): Promise<unknown> {
    return this.request('/v1/workflow-templates', {
      method: 'POST',
      body: payload,
    });
  }

  async updateWorkflowTemplate(
    templateKey: string,
    version: number,
    patch: Record<string, unknown>,
  ): Promise<unknown> {
    return this.request(`/v1/workflow-templates/${templateKey}/${version}`, {
      method: 'PATCH',
      body: patch,
    });
  }

  async listPolicySets(filters?: {
    policy_set_key?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<unknown> {
    const params = new URLSearchParams();
    if (filters?.policy_set_key) params.set('policy_set_key', filters.policy_set_key);
    if (filters?.status) params.set('status', filters.status);
    if (filters?.limit !== undefined) params.set('limit', String(filters.limit));
    if (filters?.offset !== undefined) params.set('offset', String(filters.offset));
    const qs = params.toString();
    return this.fetchWithRetry(`/v1/policy-sets${qs ? `?${qs}` : ''}`);
  }

  async getPolicySet(policySetKey: string, version?: number): Promise<unknown> {
    const path =
      version !== undefined
        ? `/v1/policy-sets/${policySetKey}/${version}`
        : `/v1/policy-sets/${policySetKey}`;
    return this.fetchWithRetry(path);
  }

  async createPolicySet(payload: Record<string, unknown>): Promise<unknown> {
    return this.request('/v1/policy-sets', {
      method: 'POST',
      body: payload,
    });
  }

  async updatePolicySet(
    policySetKey: string,
    version: number,
    patch: Record<string, unknown>,
  ): Promise<unknown> {
    return this.request(`/v1/policy-sets/${policySetKey}/${version}`, {
      method: 'PATCH',
      body: patch,
    });
  }

  async ingestEvent(
    brandSlug: string,
    payload: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<unknown> {
    return this.request(`/v1/events/${brandSlug}`, {
      method: 'POST',
      body: payload,
      headers: { 'idempotency-key': idempotencyKey },
    });
  }

  async startWorkflow(request: Record<string, unknown>, workflowId?: string): Promise<unknown> {
    return this.request('/v1/workflows/response-automation-v2/start', {
      method: 'POST',
      body: { request, workflow_id: workflowId },
    });
  }

  async startLegacyResponseWorkflow(
    request: Record<string, unknown>,
    workflowId?: string,
  ): Promise<unknown> {
    return this.request('/v1/workflows/response/start', {
      method: 'POST',
      body: { request, workflow_id: workflowId },
    });
  }

  async startSandboxAgentLoop(payload: Record<string, unknown>): Promise<unknown> {
    return this.request('/v1/workflows/sandbox-agent-loop/start', {
      method: 'POST',
      body: payload,
    });
  }

  async getWorkflowStatus(workflowId: string): Promise<unknown> {
    return this.getWorkflowStatusForType(workflowId);
  }

  async getWorkflowStatusForType(workflowId: string, workflowType?: string): Promise<unknown> {
    const path = buildWorkflowActionPath(workflowId, 'status', workflowType);
    if (!path) {
      throw new EngineClientError(
        `Workflow status is not supported for "${workflowType ?? workflowId}"`,
        { status: 400, code: 'UNSUPPORTED_WORKFLOW_ACTION' },
      );
    }
    return this.fetchWithRetry(path);
  }

  async reviewWorkflow(
    workflowId: string,
    decision: { approved: boolean; reason?: string },
    workflowType?: string,
  ): Promise<unknown> {
    const path = buildWorkflowActionPath(workflowId, 'review', workflowType);
    if (!path) {
      throw new EngineClientError(
        `Workflow review is not supported for "${workflowType ?? workflowId}"`,
        { status: 400, code: 'UNSUPPORTED_WORKFLOW_ACTION' },
      );
    }
    return this.request(path, {
      method: 'POST',
      body: decision,
    });
  }

  async cancelWorkflow(workflowId: string, workflowType?: string): Promise<unknown> {
    const path = buildWorkflowActionPath(workflowId, 'cancel', workflowType);
    if (!path) {
      throw new EngineClientError(
        `Workflow cancellation is not supported for "${workflowType ?? workflowId}"`,
        { status: 400, code: 'UNSUPPORTED_WORKFLOW_ACTION' },
      );
    }
    return this.request(path, { method: 'POST' });
  }

  async restartWorkflow(workflowId: string, workflowType?: string): Promise<unknown> {
    const path = buildWorkflowActionPath(workflowId, 'restart', workflowType);
    if (!path) {
      throw new EngineClientError(
        `Workflow restart is not supported for "${workflowType ?? workflowId}"`,
        { status: 400, code: 'UNSUPPORTED_WORKFLOW_ACTION' },
      );
    }
    return this.request(path, { method: 'POST' });
  }

  async terminateWorkflow(workflowId: string, workflowType?: string): Promise<unknown> {
    const path = buildWorkflowActionPath(workflowId, 'terminate', workflowType);
    if (!path) {
      throw new EngineClientError(
        `Workflow termination is not supported for "${workflowType ?? workflowId}"`,
        { status: 400, code: 'UNSUPPORTED_WORKFLOW_ACTION' },
      );
    }
    return this.request(path, { method: 'POST' });
  }

  async startConnectorWorkflow(
    request: Record<string, unknown>,
    workflowId?: string,
  ): Promise<unknown> {
    return this.request('/v1/workflows/connector/start', {
      method: 'POST',
      body: { request, workflow_id: workflowId },
    });
  }

  async getConnectorWorkflowStatus(workflowId: string): Promise<unknown> {
    return this.fetchWithRetry(`/v1/workflows/connector/${workflowId}/status`);
  }

  async cancelConnectorWorkflow(workflowId: string): Promise<unknown> {
    return this.request(`/v1/workflows/connector/${workflowId}/cancel`, {
      method: 'POST',
    });
  }

  async getSnoozeStatus(workflowId: string): Promise<unknown> {
    return this.fetchWithRetry(`/v1/workflows/snooze/${workflowId}/status`);
  }

  async cancelSnooze(workflowId: string): Promise<unknown> {
    return this.request(`/v1/workflows/snooze/${workflowId}/cancel`, {
      method: 'POST',
    });
  }

  async listDlq(
    brandId: string,
    filters?: { status?: string; limit?: number; offset?: number },
  ): Promise<unknown> {
    const params = new URLSearchParams();
    if (filters?.status) params.set('status', filters.status);
    if (filters?.limit !== undefined) params.set('limit', String(filters.limit));
    if (filters?.offset !== undefined) params.set('offset', String(filters.offset));
    const qs = params.toString();
    return this.fetchWithRetry(`/v1/brands/${brandId}/dispatch-dlq${qs ? `?${qs}` : ''}`);
  }

  async retryDlqItem(brandId: string, dlqId: string): Promise<unknown> {
    return this.request(`/v1/brands/${brandId}/dispatch-dlq/${dlqId}/retry`, { method: 'POST' });
  }

  async resolveDlqItem(
    brandId: string,
    dlqId: string,
    opts?: { action?: string; notes?: string },
  ): Promise<unknown> {
    return this.request(`/v1/brands/${brandId}/dispatch-dlq/${dlqId}/resolve`, {
      method: 'POST',
      body: opts ?? {},
    });
  }

  async listBrandWorkflows(
    brandId: string,
    filters?: { status?: string; limit?: number; offset?: number },
  ): Promise<unknown> {
    const params = new URLSearchParams();
    if (filters?.status) params.set('status', filters.status);
    if (filters?.limit !== undefined) params.set('limit', String(filters.limit));
    if (filters?.offset !== undefined) params.set('offset', String(filters.offset));
    const qs = params.toString();
    return this.fetchWithRetry(`/v1/brands/${brandId}/workflows${qs ? `?${qs}` : ''}`);
  }
}
