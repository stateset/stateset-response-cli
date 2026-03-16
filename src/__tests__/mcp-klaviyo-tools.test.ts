import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockMcpServer } from './helpers/mocks.js';

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('../integrations/klaviyo.js', () => ({
  klaviyoRequest: vi.fn(),
  klaviyoUploadImageFromFile: vi.fn(),
}));

vi.mock('../integrations/redact.js', () => ({
  redactPii: vi.fn((v: unknown) => v),
}));

import { klaviyoRequest, klaviyoUploadImageFromFile } from '../integrations/klaviyo.js';
const klaviyoRequestMock = vi.mocked(klaviyoRequest);
const klaviyoUploadImageFromFileMock = vi.mocked(klaviyoUploadImageFromFile);

import { registerKlaviyoTools } from '../mcp-server/tools/klaviyo.js';
import { registerKlaviyoProfileTools } from '../mcp-server/tools/klaviyo-profiles.js';
import { registerKlaviyoListTools } from '../mcp-server/tools/klaviyo-lists.js';
import { registerKlaviyoCampaignTools } from '../mcp-server/tools/klaviyo-campaigns.js';
import { registerKlaviyoContentTools } from '../mcp-server/tools/klaviyo-content.js';

// ── Helpers ────────────────────────────────────────────────────────────────

const config = { apiKey: 'pk_test_123', baseUrl: 'https://a.klaviyo.com', revision: '2024-10-15' };
const writeEnabled = { allowApply: true, redact: false };
const readOnly = { allowApply: false, redact: false };

function parseResult(result: unknown): Record<string, unknown> {
  const content = (result as { content: Array<{ text: string }> }).content;
  return JSON.parse(content[0].text) as Record<string, unknown>;
}

function lastKlaviyoCall() {
  return klaviyoRequestMock.mock.calls[klaviyoRequestMock.mock.calls.length - 1][0];
}

// ============================================================================
// registerKlaviyoTools (composite registration from klaviyo.ts)
// ============================================================================

describe('registerKlaviyoTools (composite)', () => {
  it('registers tools from all sub-modules plus the raw request tool', () => {
    const server = createMockMcpServer();
    registerKlaviyoTools(server as never, config, writeEnabled);

    const tools = server._listTools();
    // Raw tool from klaviyo-common
    expect(tools).toContain('klaviyo_request');
    // Profile tools
    expect(tools).toContain('klaviyo_list_profiles');
    expect(tools).toContain('klaviyo_get_profile');
    // List tools
    expect(tools).toContain('klaviyo_list_lists');
    expect(tools).toContain('klaviyo_get_list');
    // Campaign tools
    expect(tools).toContain('klaviyo_list_campaigns');
    expect(tools).toContain('klaviyo_list_flows');
    // Content tools
    expect(tools).toContain('klaviyo_list_templates');
    expect(tools).toContain('klaviyo_list_events');
  });
});

// ============================================================================
// klaviyo_request (raw request tool from klaviyo-common.ts)
// ============================================================================

describe('klaviyo_request (raw)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    klaviyoRequestMock.mockResolvedValue({ status: 200, data: { ok: true } });
  });

  it('sends a GET request with correct path and query', async () => {
    const server = createMockMcpServer();
    registerKlaviyoTools(server as never, config, writeEnabled);

    const result = await server._callTool('klaviyo_request', {
      method: 'GET',
      endpoint: '/profiles',
      query: { 'page[size]': 10 },
    });

    expect(klaviyoRequestMock).toHaveBeenCalledTimes(1);
    const call = lastKlaviyoCall();
    expect(call.method).toBe('GET');
    expect(call.path).toBe('/profiles');
    expect(call.query).toEqual({ 'page[size]': 10 });
    expect(parseResult(result).success).toBe(true);
  });

  it('blocks non-GET requests when allowApply is false', async () => {
    const server = createMockMcpServer();
    registerKlaviyoTools(server as never, config, readOnly);

    const result = await server._callTool('klaviyo_request', {
      method: 'POST',
      endpoint: '/profiles',
      body: { data: {} },
    });

    expect(klaviyoRequestMock).not.toHaveBeenCalled();
    const payload = parseResult(result);
    expect(payload.error).toMatch(/Write operation not allowed/);
  });

  it('allows GET through even when allowApply is false', async () => {
    const server = createMockMcpServer();
    registerKlaviyoTools(server as never, config, readOnly);

    await server._callTool('klaviyo_request', {
      method: 'GET',
      endpoint: '/lists',
    });

    expect(klaviyoRequestMock).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// registerKlaviyoProfileTools
// ============================================================================

describe('registerKlaviyoProfileTools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    klaviyoRequestMock.mockResolvedValue({ status: 200, data: { profiles: [] } });
  });

  const profileTools = [
    'klaviyo_list_profiles',
    'klaviyo_get_profile',
    'klaviyo_create_or_update_profile',
    'klaviyo_update_profile',
    'klaviyo_create_profile',
    'klaviyo_merge_profiles',
    'klaviyo_list_profile_import_jobs',
    'klaviyo_get_profile_import_job',
    'klaviyo_create_profile_import_job',
    'klaviyo_get_profile_import_job_profiles',
    'klaviyo_get_profile_import_job_errors',
    'klaviyo_create_data_privacy_deletion_job',
    'klaviyo_list_push_tokens',
    'klaviyo_get_push_token',
    'klaviyo_create_push_token',
    'klaviyo_update_push_token',
    'klaviyo_delete_push_token',
  ];

  it('registers all profile tools', () => {
    const server = createMockMcpServer();
    registerKlaviyoProfileTools(server as never, config, writeEnabled);
    const tools = server._listTools();
    for (const name of profileTools) {
      expect(tools).toContain(name);
    }
  });

  // ── GET operations ─────────────────────────────────────────────────────

  it('klaviyo_list_profiles sends GET /profiles with query params', async () => {
    const server = createMockMcpServer();
    registerKlaviyoProfileTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_list_profiles', {
      limit: 25,
      filter: 'equals(email,"test@example.com")',
      sort: '-updated',
    });

    expect(klaviyoRequestMock).toHaveBeenCalledTimes(1);
    const call = lastKlaviyoCall();
    expect(call.method).toBe('GET');
    expect(call.path).toBe('/profiles');
    expect(call.query).toMatchObject({
      'page[size]': 25,
      filter: 'equals(email,"test@example.com")',
      sort: '-updated',
    });
  });

  it('klaviyo_get_profile sends GET /profiles/:id', async () => {
    const server = createMockMcpServer();
    registerKlaviyoProfileTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_get_profile', {
      profile_id: 'PROF123',
      fields: 'email,first_name',
    });

    const call = lastKlaviyoCall();
    expect(call.method).toBe('GET');
    expect(call.path).toBe('/profiles/PROF123');
    expect(call.query).toMatchObject({ 'fields[profile]': 'email,first_name' });
  });

  it('klaviyo_list_profile_import_jobs sends GET /profile-bulk-import-jobs', async () => {
    const server = createMockMcpServer();
    registerKlaviyoProfileTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_list_profile_import_jobs', {});
    const call = lastKlaviyoCall();
    expect(call.method).toBe('GET');
    expect(call.path).toBe('/profile-bulk-import-jobs');
  });

  it('klaviyo_get_profile_import_job sends GET /profile-bulk-import-jobs/:id', async () => {
    const server = createMockMcpServer();
    registerKlaviyoProfileTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_get_profile_import_job', { job_id: 'JOB-1' });
    expect(lastKlaviyoCall().path).toBe('/profile-bulk-import-jobs/JOB-1');
  });

  it('klaviyo_get_profile_import_job_profiles sends GET /profile-bulk-import-jobs/:id/profiles', async () => {
    const server = createMockMcpServer();
    registerKlaviyoProfileTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_get_profile_import_job_profiles', { job_id: 'JOB-2' });
    expect(lastKlaviyoCall().path).toBe('/profile-bulk-import-jobs/JOB-2/profiles');
  });

  it('klaviyo_get_profile_import_job_errors sends GET /profile-bulk-import-jobs/:id/errors', async () => {
    const server = createMockMcpServer();
    registerKlaviyoProfileTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_get_profile_import_job_errors', { job_id: 'JOB-3' });
    expect(lastKlaviyoCall().path).toBe('/profile-bulk-import-jobs/JOB-3/errors');
  });

  it('klaviyo_list_push_tokens sends GET /push-tokens', async () => {
    const server = createMockMcpServer();
    registerKlaviyoProfileTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_list_push_tokens', { limit: 5 });
    const call = lastKlaviyoCall();
    expect(call.method).toBe('GET');
    expect(call.path).toBe('/push-tokens');
    expect(call.query).toMatchObject({ 'page[size]': 5 });
  });

  it('klaviyo_get_push_token sends GET /push-tokens/:id', async () => {
    const server = createMockMcpServer();
    registerKlaviyoProfileTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_get_push_token', { push_token_id: 'PT-1' });
    expect(lastKlaviyoCall().path).toBe('/push-tokens/PT-1');
  });

  // ── Write operations ───────────────────────────────────────────────────

  it('klaviyo_create_or_update_profile sends POST /profile-import with body', async () => {
    const server = createMockMcpServer();
    registerKlaviyoProfileTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_create_or_update_profile', {
      attributes: { email: 'a@b.com', first_name: 'Alice' },
    });

    const call = lastKlaviyoCall();
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/profile-import');
    expect(call.body).toEqual({
      data: {
        type: 'profile',
        attributes: { email: 'a@b.com', first_name: 'Alice' },
      },
    });
  });

  it('klaviyo_create_or_update_profile merges properties into attributes', async () => {
    const server = createMockMcpServer();
    registerKlaviyoProfileTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_create_or_update_profile', {
      profile_id: 'PROF-X',
      attributes: { email: 'x@y.com' },
      properties: { source: 'api' },
    });

    const body = lastKlaviyoCall().body as Record<string, unknown>;
    const data = body.data as Record<string, unknown>;
    const attrs = data.attributes as Record<string, unknown>;
    expect(data.id).toBe('PROF-X');
    expect(attrs.properties).toEqual({ source: 'api' });
  });

  it('klaviyo_update_profile sends PATCH /profiles/:id', async () => {
    const server = createMockMcpServer();
    registerKlaviyoProfileTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_update_profile', {
      profile_id: 'PROF456',
      attributes: { last_name: 'Smith' },
    });

    const call = lastKlaviyoCall();
    expect(call.method).toBe('PATCH');
    expect(call.path).toBe('/profiles/PROF456');
  });

  it('klaviyo_create_profile sends POST /profiles with JSON:API payload', async () => {
    const server = createMockMcpServer();
    registerKlaviyoProfileTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_create_profile', {
      attributes: { email: 'new@example.com' },
    });

    const call = lastKlaviyoCall();
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/profiles');
    expect(call.body).toEqual({
      data: { type: 'profile', attributes: { email: 'new@example.com' } },
    });
  });

  it('klaviyo_merge_profiles sends POST /profile-merge', async () => {
    const server = createMockMcpServer();
    registerKlaviyoProfileTools(server as never, config, writeEnabled);

    const mergePayload = { data: { type: 'profile-merge', attributes: {} } };
    await server._callTool('klaviyo_merge_profiles', { payload: mergePayload });

    const call = lastKlaviyoCall();
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/profile-merge');
    expect(call.body).toEqual(mergePayload);
  });

  it('klaviyo_create_profile_import_job sends POST /profile-bulk-import-jobs', async () => {
    const server = createMockMcpServer();
    registerKlaviyoProfileTools(server as never, config, writeEnabled);

    const jobData = { data: { type: 'profile-bulk-import-job' } };
    await server._callTool('klaviyo_create_profile_import_job', { job: jobData });

    const call = lastKlaviyoCall();
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/profile-bulk-import-jobs');
    expect(call.body).toEqual(jobData);
  });

  it('klaviyo_create_data_privacy_deletion_job sends POST /data-privacy-deletion-jobs', async () => {
    const server = createMockMcpServer();
    registerKlaviyoProfileTools(server as never, config, writeEnabled);

    const jobData = { data: { type: 'data-privacy-deletion-job' } };
    await server._callTool('klaviyo_create_data_privacy_deletion_job', { job: jobData });

    const call = lastKlaviyoCall();
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/data-privacy-deletion-jobs');
  });

  it('klaviyo_create_push_token sends POST /push-tokens', async () => {
    const server = createMockMcpServer();
    registerKlaviyoProfileTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_create_push_token', {
      attributes: { token: 'abc123', platform: 'ios' },
    });

    const call = lastKlaviyoCall();
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/push-tokens');
    expect(call.body).toEqual({
      data: { type: 'push-token', attributes: { token: 'abc123', platform: 'ios' } },
    });
  });

  it('klaviyo_update_push_token sends PATCH /push-tokens/:id', async () => {
    const server = createMockMcpServer();
    registerKlaviyoProfileTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_update_push_token', {
      push_token_id: 'PT-2',
      attributes: { platform: 'android' },
    });

    const call = lastKlaviyoCall();
    expect(call.method).toBe('PATCH');
    expect(call.path).toBe('/push-tokens/PT-2');
    expect((call.body as Record<string, unknown>).data).toMatchObject({
      type: 'push-token',
      id: 'PT-2',
    });
  });

  it('klaviyo_delete_push_token sends DELETE /push-tokens/:id', async () => {
    const server = createMockMcpServer();
    registerKlaviyoProfileTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_delete_push_token', { push_token_id: 'PT-3' });

    const call = lastKlaviyoCall();
    expect(call.method).toBe('DELETE');
    expect(call.path).toBe('/push-tokens/PT-3');
  });

  // ── allowApply guard ───────────────────────────────────────────────────

  it.each([
    ['klaviyo_create_or_update_profile', { attributes: { email: 'x@y.com' } }],
    ['klaviyo_update_profile', { profile_id: 'P1', attributes: {} }],
    ['klaviyo_create_profile', { attributes: { email: 'z@w.com' } }],
    ['klaviyo_merge_profiles', { payload: {} }],
    ['klaviyo_create_profile_import_job', { job: {} }],
    ['klaviyo_create_data_privacy_deletion_job', { job: {} }],
    ['klaviyo_create_push_token', { attributes: { token: 't' } }],
    ['klaviyo_update_push_token', { push_token_id: 'PT', attributes: {} }],
    ['klaviyo_delete_push_token', { push_token_id: 'PT' }],
  ])('%s blocks writes when allowApply=false', async (toolName, args) => {
    const server = createMockMcpServer();
    registerKlaviyoProfileTools(server as never, config, readOnly);

    const result = await server._callTool(toolName, args);
    expect(klaviyoRequestMock).not.toHaveBeenCalled();
    const payload = parseResult(result);
    expect(payload.error).toMatch(/Write operation not allowed/);
  });

  // ── revision header passthrough ────────────────────────────────────────

  it('passes revision header to the API request', async () => {
    const server = createMockMcpServer();
    registerKlaviyoProfileTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_list_profiles', { revision: '2025-01-15' });
    expect(lastKlaviyoCall().revision).toBe('2025-01-15');
  });
});

// ============================================================================
// registerKlaviyoListTools
// ============================================================================

describe('registerKlaviyoListTools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    klaviyoRequestMock.mockResolvedValue({ status: 200, data: { lists: [] } });
  });

  const listToolNames = [
    'klaviyo_list_lists',
    'klaviyo_get_list',
    'klaviyo_create_list',
    'klaviyo_update_list',
    'klaviyo_delete_list',
    'klaviyo_get_list_profiles',
    'klaviyo_get_list_profile_ids',
    'klaviyo_list_segments',
    'klaviyo_get_segment',
    'klaviyo_create_segment',
    'klaviyo_update_segment',
    'klaviyo_get_segment_profiles',
    'klaviyo_get_segment_profile_ids',
  ];

  it('registers all list/segment tools', () => {
    const server = createMockMcpServer();
    registerKlaviyoListTools(server as never, config, writeEnabled);
    const tools = server._listTools();
    for (const name of listToolNames) {
      expect(tools).toContain(name);
    }
  });

  // ── GET operations ─────────────────────────────────────────────────────

  it('klaviyo_list_lists sends GET /lists', async () => {
    const server = createMockMcpServer();
    registerKlaviyoListTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_list_lists', { limit: 50, sort: '-name' });
    const call = lastKlaviyoCall();
    expect(call.method).toBe('GET');
    expect(call.path).toBe('/lists');
    expect(call.query).toMatchObject({ 'page[size]': 50, sort: '-name' });
  });

  it('klaviyo_get_list sends GET /lists/:id', async () => {
    const server = createMockMcpServer();
    registerKlaviyoListTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_get_list', { list_id: 'LIST-1' });
    const call = lastKlaviyoCall();
    expect(call.method).toBe('GET');
    expect(call.path).toBe('/lists/LIST-1');
  });

  it('klaviyo_get_list_profiles sends GET /lists/:id/profiles', async () => {
    const server = createMockMcpServer();
    registerKlaviyoListTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_get_list_profiles', {
      list_id: 'LIST-2',
      limit: 10,
    });
    const call = lastKlaviyoCall();
    expect(call.method).toBe('GET');
    expect(call.path).toBe('/lists/LIST-2/profiles');
  });

  it('klaviyo_get_list_profile_ids sends GET /lists/:id/relationships/profiles', async () => {
    const server = createMockMcpServer();
    registerKlaviyoListTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_get_list_profile_ids', { list_id: 'LIST-3' });
    const call = lastKlaviyoCall();
    expect(call.method).toBe('GET');
    expect(call.path).toBe('/lists/LIST-3/relationships/profiles');
  });

  it('klaviyo_list_segments sends GET /segments', async () => {
    const server = createMockMcpServer();
    registerKlaviyoListTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_list_segments', {});
    expect(lastKlaviyoCall().path).toBe('/segments');
  });

  it('klaviyo_get_segment sends GET /segments/:id', async () => {
    const server = createMockMcpServer();
    registerKlaviyoListTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_get_segment', { segment_id: 'SEG-1' });
    expect(lastKlaviyoCall().path).toBe('/segments/SEG-1');
  });

  it('klaviyo_get_segment_profiles sends GET /segments/:id/profiles', async () => {
    const server = createMockMcpServer();
    registerKlaviyoListTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_get_segment_profiles', { segment_id: 'SEG-2' });
    expect(lastKlaviyoCall().path).toBe('/segments/SEG-2/profiles');
  });

  it('klaviyo_get_segment_profile_ids sends GET /segments/:id/relationships/profiles', async () => {
    const server = createMockMcpServer();
    registerKlaviyoListTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_get_segment_profile_ids', { segment_id: 'SEG-3' });
    expect(lastKlaviyoCall().path).toBe('/segments/SEG-3/relationships/profiles');
  });

  // ── Write operations ───────────────────────────────────────────────────

  it('klaviyo_create_list sends POST /lists', async () => {
    const server = createMockMcpServer();
    registerKlaviyoListTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_create_list', {
      attributes: { name: 'Newsletter' },
    });

    const call = lastKlaviyoCall();
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/lists');
    expect(call.body).toEqual({
      data: { type: 'list', attributes: { name: 'Newsletter' } },
    });
  });

  it('klaviyo_update_list sends PATCH /lists/:id', async () => {
    const server = createMockMcpServer();
    registerKlaviyoListTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_update_list', {
      list_id: 'LIST-5',
      attributes: { name: 'VIPs' },
    });

    const call = lastKlaviyoCall();
    expect(call.method).toBe('PATCH');
    expect(call.path).toBe('/lists/LIST-5');
    expect((call.body as Record<string, unknown>).data).toMatchObject({
      type: 'list',
      id: 'LIST-5',
    });
  });

  it('klaviyo_delete_list sends DELETE /lists/:id', async () => {
    const server = createMockMcpServer();
    registerKlaviyoListTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_delete_list', { list_id: 'LIST-6' });
    const call = lastKlaviyoCall();
    expect(call.method).toBe('DELETE');
    expect(call.path).toBe('/lists/LIST-6');
  });

  it('klaviyo_create_segment sends POST /segments', async () => {
    const server = createMockMcpServer();
    registerKlaviyoListTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_create_segment', {
      attributes: { name: 'Active Users' },
    });
    const call = lastKlaviyoCall();
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/segments');
  });

  it('klaviyo_update_segment sends PATCH /segments/:id', async () => {
    const server = createMockMcpServer();
    registerKlaviyoListTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_update_segment', {
      segment_id: 'SEG-4',
      attributes: { name: 'Inactive Users' },
    });
    const call = lastKlaviyoCall();
    expect(call.method).toBe('PATCH');
    expect(call.path).toBe('/segments/SEG-4');
  });

  // ── allowApply guard ───────────────────────────────────────────────────

  it.each([
    ['klaviyo_create_list', { attributes: { name: 'x' } }],
    ['klaviyo_update_list', { list_id: 'L1', attributes: {} }],
    ['klaviyo_delete_list', { list_id: 'L1' }],
    ['klaviyo_create_segment', { attributes: { name: 'x' } }],
    ['klaviyo_update_segment', { segment_id: 'S1', attributes: {} }],
  ])('%s blocks writes when allowApply=false', async (toolName, args) => {
    const server = createMockMcpServer();
    registerKlaviyoListTools(server as never, config, readOnly);

    const result = await server._callTool(toolName, args);
    expect(klaviyoRequestMock).not.toHaveBeenCalled();
    expect(parseResult(result).error).toMatch(/Write operation not allowed/);
  });
});

// ============================================================================
// registerKlaviyoCampaignTools
// ============================================================================

describe('registerKlaviyoCampaignTools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    klaviyoRequestMock.mockResolvedValue({ status: 200, data: { ok: true } });
  });

  const campaignToolNames = [
    // Tags
    'klaviyo_list_tags',
    'klaviyo_get_tag',
    'klaviyo_create_tag',
    'klaviyo_update_tag',
    'klaviyo_delete_tag',
    'klaviyo_list_tag_groups',
    'klaviyo_get_tag_group',
    'klaviyo_create_tag_group',
    'klaviyo_update_tag_group',
    'klaviyo_delete_tag_group',
    // Tag relationships
    'klaviyo_get_tag_flows',
    'klaviyo_add_tag_flows',
    'klaviyo_remove_tag_flows',
    'klaviyo_get_tag_campaigns',
    'klaviyo_add_tag_campaigns',
    'klaviyo_remove_tag_campaigns',
    'klaviyo_get_tag_lists',
    'klaviyo_add_tag_lists',
    'klaviyo_remove_tag_lists',
    'klaviyo_get_tag_segments',
    'klaviyo_add_tag_segments',
    'klaviyo_remove_tag_segments',
    // Subscription jobs
    'klaviyo_subscribe_profiles_job',
    'klaviyo_unsubscribe_profiles_job',
    'klaviyo_suppress_profiles_job',
    'klaviyo_unsuppress_profiles_job',
    // Campaigns
    'klaviyo_list_campaigns',
    'klaviyo_get_campaign',
    'klaviyo_create_campaign',
    'klaviyo_update_campaign',
    'klaviyo_delete_campaign',
    'klaviyo_schedule_campaign',
    'klaviyo_send_campaign_now',
    'klaviyo_cancel_campaign',
    // Flows
    'klaviyo_list_flows',
    'klaviyo_get_flow',
    'klaviyo_create_flow',
    'klaviyo_update_flow',
    'klaviyo_delete_flow',
    'klaviyo_pause_flow',
    'klaviyo_resume_flow',
    // List profile membership
    'klaviyo_add_profiles_to_list',
    'klaviyo_remove_profiles_from_list',
    // Reports
    'klaviyo_create_campaign_values_report',
    'klaviyo_create_flow_values_report',
    'klaviyo_create_flow_series_report',
    'klaviyo_create_form_values_report',
    'klaviyo_create_form_series_report',
    'klaviyo_create_segment_values_report',
    'klaviyo_create_segment_series_report',
  ];

  it('registers all campaign/flow/tag tools', () => {
    const server = createMockMcpServer();
    registerKlaviyoCampaignTools(server as never, config, writeEnabled);
    const tools = server._listTools();
    for (const name of campaignToolNames) {
      expect(tools).toContain(name);
    }
  });

  // ── GET operations ─────────────────────────────────────────────────────

  it('klaviyo_list_tags sends GET /tags', async () => {
    const server = createMockMcpServer();
    registerKlaviyoCampaignTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_list_tags', { limit: 20 });
    const call = lastKlaviyoCall();
    expect(call.method).toBe('GET');
    expect(call.path).toBe('/tags');
  });

  it('klaviyo_get_tag sends GET /tags/:id', async () => {
    const server = createMockMcpServer();
    registerKlaviyoCampaignTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_get_tag', { tag_id: 'TAG-1' });
    expect(lastKlaviyoCall().path).toBe('/tags/TAG-1');
  });

  it('klaviyo_list_tag_groups sends GET /tag-groups', async () => {
    const server = createMockMcpServer();
    registerKlaviyoCampaignTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_list_tag_groups', {});
    expect(lastKlaviyoCall().path).toBe('/tag-groups');
  });

  it('klaviyo_get_tag_group sends GET /tag-groups/:id', async () => {
    const server = createMockMcpServer();
    registerKlaviyoCampaignTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_get_tag_group', { tag_group_id: 'TG-1' });
    expect(lastKlaviyoCall().path).toBe('/tag-groups/TG-1');
  });

  it('klaviyo_get_tag_flows sends GET /tags/:id/relationships/flows', async () => {
    const server = createMockMcpServer();
    registerKlaviyoCampaignTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_get_tag_flows', { tag_id: 'TAG-2' });
    expect(lastKlaviyoCall().path).toBe('/tags/TAG-2/relationships/flows');
  });

  it('klaviyo_get_tag_campaigns sends GET /tags/:id/relationships/campaigns', async () => {
    const server = createMockMcpServer();
    registerKlaviyoCampaignTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_get_tag_campaigns', { tag_id: 'TAG-3' });
    expect(lastKlaviyoCall().path).toBe('/tags/TAG-3/relationships/campaigns');
  });

  it('klaviyo_list_campaigns sends GET /campaigns', async () => {
    const server = createMockMcpServer();
    registerKlaviyoCampaignTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_list_campaigns', { filter: 'equals(status,"draft")' });
    const call = lastKlaviyoCall();
    expect(call.method).toBe('GET');
    expect(call.path).toBe('/campaigns');
    expect(call.query).toMatchObject({ filter: 'equals(status,"draft")' });
  });

  it('klaviyo_get_campaign sends GET /campaigns/:id', async () => {
    const server = createMockMcpServer();
    registerKlaviyoCampaignTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_get_campaign', { campaign_id: 'CAMP-1' });
    expect(lastKlaviyoCall().path).toBe('/campaigns/CAMP-1');
  });

  it('klaviyo_list_flows sends GET /flows', async () => {
    const server = createMockMcpServer();
    registerKlaviyoCampaignTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_list_flows', {});
    expect(lastKlaviyoCall().path).toBe('/flows');
  });

  it('klaviyo_get_flow sends GET /flows/:id', async () => {
    const server = createMockMcpServer();
    registerKlaviyoCampaignTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_get_flow', { flow_id: 'FLOW-1' });
    expect(lastKlaviyoCall().path).toBe('/flows/FLOW-1');
  });

  // ── Write operations ───────────────────────────────────────────────────

  it('klaviyo_create_tag sends POST /tags', async () => {
    const server = createMockMcpServer();
    registerKlaviyoCampaignTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_create_tag', {
      attributes: { name: 'Promo' },
    });
    const call = lastKlaviyoCall();
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/tags');
  });

  it('klaviyo_update_tag sends PATCH /tags/:id', async () => {
    const server = createMockMcpServer();
    registerKlaviyoCampaignTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_update_tag', {
      tag_id: 'TAG-5',
      attributes: { name: 'Seasonal' },
    });
    const call = lastKlaviyoCall();
    expect(call.method).toBe('PATCH');
    expect(call.path).toBe('/tags/TAG-5');
  });

  it('klaviyo_delete_tag sends DELETE /tags/:id', async () => {
    const server = createMockMcpServer();
    registerKlaviyoCampaignTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_delete_tag', { tag_id: 'TAG-6' });
    expect(lastKlaviyoCall().method).toBe('DELETE');
    expect(lastKlaviyoCall().path).toBe('/tags/TAG-6');
  });

  it('klaviyo_add_tag_flows sends POST /tags/:id/relationships/flows', async () => {
    const server = createMockMcpServer();
    registerKlaviyoCampaignTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_add_tag_flows', {
      tag_id: 'TAG-7',
      flow_ids: ['F1', 'F2'],
    });
    const call = lastKlaviyoCall();
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/tags/TAG-7/relationships/flows');
    expect(call.body).toEqual({
      data: [
        { type: 'flow', id: 'F1' },
        { type: 'flow', id: 'F2' },
      ],
    });
  });

  it('klaviyo_remove_tag_flows sends DELETE /tags/:id/relationships/flows', async () => {
    const server = createMockMcpServer();
    registerKlaviyoCampaignTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_remove_tag_flows', {
      tag_id: 'TAG-8',
      flow_ids: ['F3'],
    });
    const call = lastKlaviyoCall();
    expect(call.method).toBe('DELETE');
    expect(call.path).toBe('/tags/TAG-8/relationships/flows');
  });

  it('klaviyo_create_campaign sends POST /campaigns', async () => {
    const server = createMockMcpServer();
    registerKlaviyoCampaignTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_create_campaign', {
      attributes: { name: 'Summer Sale' },
    });
    const call = lastKlaviyoCall();
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/campaigns');
  });

  it('klaviyo_update_campaign sends PATCH /campaigns/:id', async () => {
    const server = createMockMcpServer();
    registerKlaviyoCampaignTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_update_campaign', {
      campaign_id: 'CAMP-2',
      attributes: { name: 'Winter Sale' },
    });
    const call = lastKlaviyoCall();
    expect(call.method).toBe('PATCH');
    expect(call.path).toBe('/campaigns/CAMP-2');
  });

  it('klaviyo_delete_campaign sends DELETE /campaigns/:id', async () => {
    const server = createMockMcpServer();
    registerKlaviyoCampaignTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_delete_campaign', { campaign_id: 'CAMP-3' });
    expect(lastKlaviyoCall().method).toBe('DELETE');
    expect(lastKlaviyoCall().path).toBe('/campaigns/CAMP-3');
  });

  it('klaviyo_subscribe_profiles_job sends POST /profile-subscription-bulk-create-jobs', async () => {
    const server = createMockMcpServer();
    registerKlaviyoCampaignTools(server as never, config, writeEnabled);

    const job = { data: { type: 'profile-subscription-bulk-create-job' } };
    await server._callTool('klaviyo_subscribe_profiles_job', { job });
    const call = lastKlaviyoCall();
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/profile-subscription-bulk-create-jobs');
    expect(call.body).toEqual(job);
  });

  it('klaviyo_unsubscribe_profiles_job sends POST /profile-subscription-bulk-delete-jobs', async () => {
    const server = createMockMcpServer();
    registerKlaviyoCampaignTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_unsubscribe_profiles_job', { job: {} });
    expect(lastKlaviyoCall().path).toBe('/profile-subscription-bulk-delete-jobs');
  });

  it('klaviyo_create_flow sends POST /flows', async () => {
    const server = createMockMcpServer();
    registerKlaviyoCampaignTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_create_flow', {
      attributes: { name: 'Welcome Series' },
    });
    const call = lastKlaviyoCall();
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/flows');
  });

  it('klaviyo_delete_flow sends DELETE /flows/:id', async () => {
    const server = createMockMcpServer();
    registerKlaviyoCampaignTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_delete_flow', { flow_id: 'FLOW-2' });
    expect(lastKlaviyoCall().method).toBe('DELETE');
    expect(lastKlaviyoCall().path).toBe('/flows/FLOW-2');
  });

  // ── Idempotency / dry-run tools ────────────────────────────────────────

  it('klaviyo_schedule_campaign dry_run returns preview without calling API', async () => {
    const server = createMockMcpServer();
    registerKlaviyoCampaignTools(server as never, config, writeEnabled);

    const result = await server._callTool('klaviyo_schedule_campaign', {
      campaign_id: 'CAMP-5',
      scheduled_at: '2026-04-01T10:00:00Z',
      dry_run: true,
    });

    expect(klaviyoRequestMock).not.toHaveBeenCalled();
    const payload = parseResult(result);
    expect(payload.dry_run).toBe(true);
    expect(payload.success).toBe(true);
  });

  it('klaviyo_schedule_campaign sends PATCH with schedule attributes', async () => {
    const server = createMockMcpServer();
    registerKlaviyoCampaignTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_schedule_campaign', {
      campaign_id: 'CAMP-6',
      scheduled_at: '2026-04-01T10:00:00Z',
    });

    const call = lastKlaviyoCall();
    expect(call.method).toBe('PATCH');
    expect(call.path).toBe('/campaigns/CAMP-6');
    const body = call.body as { data: { attributes: Record<string, unknown> } };
    expect(body.data.attributes.status).toBe('scheduled');
    expect(body.data.attributes.send_time).toBe('2026-04-01T10:00:00Z');
  });

  it('klaviyo_send_campaign_now dry_run returns preview', async () => {
    const server = createMockMcpServer();
    registerKlaviyoCampaignTools(server as never, config, writeEnabled);

    const result = await server._callTool('klaviyo_send_campaign_now', {
      campaign_id: 'CAMP-7',
      dry_run: true,
    });

    expect(klaviyoRequestMock).not.toHaveBeenCalled();
    expect(parseResult(result).dry_run).toBe(true);
  });

  it('klaviyo_send_campaign_now sends PATCH with status=live', async () => {
    const server = createMockMcpServer();
    registerKlaviyoCampaignTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_send_campaign_now', { campaign_id: 'CAMP-8' });
    const call = lastKlaviyoCall();
    expect(call.method).toBe('PATCH');
    const body = call.body as { data: { attributes: Record<string, unknown> } };
    expect(body.data.attributes.status).toBe('live');
  });

  it('klaviyo_pause_flow dry_run returns preview', async () => {
    const server = createMockMcpServer();
    registerKlaviyoCampaignTools(server as never, config, writeEnabled);

    const result = await server._callTool('klaviyo_pause_flow', {
      flow_id: 'FLOW-3',
      dry_run: true,
    });

    expect(klaviyoRequestMock).not.toHaveBeenCalled();
    expect(parseResult(result).dry_run).toBe(true);
  });

  it('klaviyo_pause_flow sends PATCH with status=manual', async () => {
    const server = createMockMcpServer();
    registerKlaviyoCampaignTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_pause_flow', { flow_id: 'FLOW-4' });
    const call = lastKlaviyoCall();
    expect(call.method).toBe('PATCH');
    expect(call.path).toBe('/flows/FLOW-4');
    const body = call.body as { data: { attributes: Record<string, unknown> } };
    expect(body.data.attributes.status).toBe('manual');
  });

  it('klaviyo_resume_flow sends PATCH with status=live', async () => {
    const server = createMockMcpServer();
    registerKlaviyoCampaignTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_resume_flow', { flow_id: 'FLOW-5' });
    const call = lastKlaviyoCall();
    expect(call.method).toBe('PATCH');
    expect(call.path).toBe('/flows/FLOW-5');
    const body = call.body as { data: { attributes: Record<string, unknown> } };
    expect(body.data.attributes.status).toBe('live');
  });

  // ── List profile membership ────────────────────────────────────────────

  it('klaviyo_add_profiles_to_list sends POST /lists/:id/relationships/profiles', async () => {
    const server = createMockMcpServer();
    registerKlaviyoCampaignTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_add_profiles_to_list', {
      list_id: 'LIST-10',
      profile_ids: ['P1', 'P2'],
    });

    const call = lastKlaviyoCall();
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/lists/LIST-10/relationships/profiles');
    expect(call.body).toEqual({
      data: [
        { type: 'profile', id: 'P1' },
        { type: 'profile', id: 'P2' },
      ],
    });
  });

  it('klaviyo_remove_profiles_from_list sends DELETE /lists/:id/relationships/profiles', async () => {
    const server = createMockMcpServer();
    registerKlaviyoCampaignTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_remove_profiles_from_list', {
      list_id: 'LIST-11',
      profile_ids: ['P3'],
    });

    const call = lastKlaviyoCall();
    expect(call.method).toBe('DELETE');
    expect(call.path).toBe('/lists/LIST-11/relationships/profiles');
  });

  // ── Reports ────────────────────────────────────────────────────────────

  it('klaviyo_create_campaign_values_report sends POST /campaign-values-reports', async () => {
    const server = createMockMcpServer();
    registerKlaviyoCampaignTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_create_campaign_values_report', {
      payload: { data: { type: 'campaign-values-report' } },
    });
    const call = lastKlaviyoCall();
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/campaign-values-reports');
  });

  it('klaviyo_create_flow_values_report sends POST /flow-values-reports', async () => {
    const server = createMockMcpServer();
    registerKlaviyoCampaignTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_create_flow_values_report', { payload: {} });
    expect(lastKlaviyoCall().path).toBe('/flow-values-reports');
  });

  // ── allowApply guard ───────────────────────────────────────────────────

  it.each([
    ['klaviyo_create_tag', { attributes: { name: 'x' } }],
    ['klaviyo_update_tag', { tag_id: 'T1', attributes: {} }],
    ['klaviyo_delete_tag', { tag_id: 'T1' }],
    ['klaviyo_create_campaign', { attributes: { name: 'x' } }],
    ['klaviyo_delete_campaign', { campaign_id: 'C1' }],
    ['klaviyo_subscribe_profiles_job', { job: {} }],
    ['klaviyo_add_profiles_to_list', { list_id: 'L1', profile_ids: ['P1'] }],
    ['klaviyo_create_campaign_values_report', { payload: {} }],
    ['klaviyo_create_flow', { attributes: { name: 'x' } }],
    ['klaviyo_delete_flow', { flow_id: 'F1' }],
  ])('%s blocks writes when allowApply=false', async (toolName, args) => {
    const server = createMockMcpServer();
    registerKlaviyoCampaignTools(server as never, config, readOnly);

    const result = await server._callTool(toolName, args);
    expect(klaviyoRequestMock).not.toHaveBeenCalled();
    expect(parseResult(result).error).toMatch(/Write operation not allowed/);
  });

  it('klaviyo_schedule_campaign blocks when allowApply=false and dry_run=false', async () => {
    const server = createMockMcpServer();
    registerKlaviyoCampaignTools(server as never, config, readOnly);

    const result = await server._callTool('klaviyo_schedule_campaign', {
      campaign_id: 'C1',
      scheduled_at: '2026-04-01T10:00:00Z',
    });
    expect(klaviyoRequestMock).not.toHaveBeenCalled();
    expect(parseResult(result).error).toMatch(/Write operation not allowed/);
  });

  it('klaviyo_pause_flow blocks when allowApply=false and dry_run=false', async () => {
    const server = createMockMcpServer();
    registerKlaviyoCampaignTools(server as never, config, readOnly);

    const result = await server._callTool('klaviyo_pause_flow', {
      flow_id: 'F1',
    });
    expect(klaviyoRequestMock).not.toHaveBeenCalled();
    expect(parseResult(result).error).toMatch(/Write operation not allowed/);
  });
});

// ============================================================================
// registerKlaviyoContentTools
// ============================================================================

describe('registerKlaviyoContentTools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    klaviyoRequestMock.mockResolvedValue({ status: 200, data: { ok: true } });
    klaviyoUploadImageFromFileMock.mockResolvedValue({ status: 200, data: { image: {} } });
  });

  const contentToolNames = [
    // Templates
    'klaviyo_list_templates',
    'klaviyo_get_template',
    'klaviyo_create_template',
    'klaviyo_update_template',
    'klaviyo_delete_template',
    'klaviyo_render_template',
    'klaviyo_clone_template',
    // Forms
    'klaviyo_list_forms',
    'klaviyo_get_form',
    'klaviyo_create_form',
    'klaviyo_delete_form',
    // Images
    'klaviyo_list_images',
    'klaviyo_get_image',
    'klaviyo_upload_image_from_url',
    'klaviyo_upload_image_from_file',
    'klaviyo_update_image',
    // Catalog items
    'klaviyo_list_catalog_items',
    'klaviyo_get_catalog_item',
    'klaviyo_create_catalog_item',
    'klaviyo_update_catalog_item',
    'klaviyo_delete_catalog_item',
    // Catalog variants
    'klaviyo_list_catalog_variants',
    'klaviyo_get_catalog_variant',
    'klaviyo_create_catalog_variant',
    'klaviyo_update_catalog_variant',
    'klaviyo_delete_catalog_variant',
    // Catalog categories
    'klaviyo_list_catalog_categories',
    'klaviyo_get_catalog_category',
    'klaviyo_create_catalog_category',
    'klaviyo_update_catalog_category',
    'klaviyo_delete_catalog_category',
    // Coupons
    'klaviyo_list_coupons',
    'klaviyo_get_coupon',
    'klaviyo_create_coupon',
    'klaviyo_update_coupon',
    'klaviyo_delete_coupon',
    'klaviyo_list_coupon_codes',
    'klaviyo_get_coupon_code',
    'klaviyo_create_coupon_code',
    'klaviyo_update_coupon_code',
    'klaviyo_delete_coupon_code',
    // Metrics
    'klaviyo_query_metric_aggregates',
    'klaviyo_list_metrics',
    'klaviyo_get_metric',
    // Events
    'klaviyo_create_event',
    'klaviyo_list_events',
    'klaviyo_get_event',
  ];

  it('registers all content tools', () => {
    const server = createMockMcpServer();
    registerKlaviyoContentTools(server as never, config, writeEnabled);
    const tools = server._listTools();
    for (const name of contentToolNames) {
      expect(tools).toContain(name);
    }
  });

  // ── GET operations ─────────────────────────────────────────────────────

  it('klaviyo_list_templates sends GET /templates', async () => {
    const server = createMockMcpServer();
    registerKlaviyoContentTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_list_templates', { limit: 10 });
    const call = lastKlaviyoCall();
    expect(call.method).toBe('GET');
    expect(call.path).toBe('/templates');
  });

  it('klaviyo_get_template sends GET /templates/:id', async () => {
    const server = createMockMcpServer();
    registerKlaviyoContentTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_get_template', { template_id: 'TPL-1' });
    expect(lastKlaviyoCall().path).toBe('/templates/TPL-1');
  });

  it('klaviyo_list_forms sends GET /forms', async () => {
    const server = createMockMcpServer();
    registerKlaviyoContentTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_list_forms', {});
    expect(lastKlaviyoCall().path).toBe('/forms');
  });

  it('klaviyo_get_form sends GET /forms/:id', async () => {
    const server = createMockMcpServer();
    registerKlaviyoContentTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_get_form', { form_id: 'FORM-1' });
    expect(lastKlaviyoCall().path).toBe('/forms/FORM-1');
  });

  it('klaviyo_list_images sends GET /images', async () => {
    const server = createMockMcpServer();
    registerKlaviyoContentTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_list_images', {});
    expect(lastKlaviyoCall().path).toBe('/images');
  });

  it('klaviyo_get_image sends GET /images/:id', async () => {
    const server = createMockMcpServer();
    registerKlaviyoContentTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_get_image', { image_id: 'IMG-1' });
    expect(lastKlaviyoCall().path).toBe('/images/IMG-1');
  });

  it('klaviyo_list_catalog_items sends GET /catalog-items', async () => {
    const server = createMockMcpServer();
    registerKlaviyoContentTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_list_catalog_items', { limit: 5 });
    const call = lastKlaviyoCall();
    expect(call.method).toBe('GET');
    expect(call.path).toBe('/catalog-items');
  });

  it('klaviyo_get_catalog_item sends GET /catalog-items/:id', async () => {
    const server = createMockMcpServer();
    registerKlaviyoContentTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_get_catalog_item', { catalog_item_id: 'CI-1' });
    expect(lastKlaviyoCall().path).toBe('/catalog-items/CI-1');
  });

  it('klaviyo_list_catalog_variants sends GET /catalog-variants', async () => {
    const server = createMockMcpServer();
    registerKlaviyoContentTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_list_catalog_variants', {});
    expect(lastKlaviyoCall().path).toBe('/catalog-variants');
  });

  it('klaviyo_get_catalog_variant sends GET /catalog-variants/:id', async () => {
    const server = createMockMcpServer();
    registerKlaviyoContentTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_get_catalog_variant', { catalog_variant_id: 'CV-1' });
    expect(lastKlaviyoCall().path).toBe('/catalog-variants/CV-1');
  });

  it('klaviyo_list_catalog_categories sends GET /catalog-categories', async () => {
    const server = createMockMcpServer();
    registerKlaviyoContentTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_list_catalog_categories', {});
    expect(lastKlaviyoCall().path).toBe('/catalog-categories');
  });

  it('klaviyo_get_catalog_category sends GET /catalog-categories/:id', async () => {
    const server = createMockMcpServer();
    registerKlaviyoContentTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_get_catalog_category', { catalog_category_id: 'CC-1' });
    expect(lastKlaviyoCall().path).toBe('/catalog-categories/CC-1');
  });

  it('klaviyo_list_coupons sends GET /coupons', async () => {
    const server = createMockMcpServer();
    registerKlaviyoContentTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_list_coupons', {});
    expect(lastKlaviyoCall().path).toBe('/coupons');
  });

  it('klaviyo_get_coupon sends GET /coupons/:id', async () => {
    const server = createMockMcpServer();
    registerKlaviyoContentTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_get_coupon', { coupon_id: 'CPN-1' });
    expect(lastKlaviyoCall().path).toBe('/coupons/CPN-1');
  });

  it('klaviyo_list_coupon_codes sends GET /coupon-codes', async () => {
    const server = createMockMcpServer();
    registerKlaviyoContentTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_list_coupon_codes', {});
    expect(lastKlaviyoCall().path).toBe('/coupon-codes');
  });

  it('klaviyo_get_coupon_code sends GET /coupon-codes/:id', async () => {
    const server = createMockMcpServer();
    registerKlaviyoContentTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_get_coupon_code', { coupon_code_id: 'CC-1' });
    expect(lastKlaviyoCall().path).toBe('/coupon-codes/CC-1');
  });

  it('klaviyo_list_metrics sends GET /metrics', async () => {
    const server = createMockMcpServer();
    registerKlaviyoContentTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_list_metrics', {});
    expect(lastKlaviyoCall().path).toBe('/metrics');
  });

  it('klaviyo_get_metric sends GET /metrics/:id', async () => {
    const server = createMockMcpServer();
    registerKlaviyoContentTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_get_metric', { metric_id: 'MET-1' });
    expect(lastKlaviyoCall().path).toBe('/metrics/MET-1');
  });

  it('klaviyo_list_events sends GET /events', async () => {
    const server = createMockMcpServer();
    registerKlaviyoContentTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_list_events', { filter: 'equals(metric_id,"M1")' });
    const call = lastKlaviyoCall();
    expect(call.method).toBe('GET');
    expect(call.path).toBe('/events');
    expect(call.query).toMatchObject({ filter: 'equals(metric_id,"M1")' });
  });

  it('klaviyo_get_event sends GET /events/:id', async () => {
    const server = createMockMcpServer();
    registerKlaviyoContentTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_get_event', { event_id: 'EVT-1' });
    expect(lastKlaviyoCall().path).toBe('/events/EVT-1');
  });

  // ── Write operations ───────────────────────────────────────────────────

  it('klaviyo_create_template sends POST /templates', async () => {
    const server = createMockMcpServer();
    registerKlaviyoContentTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_create_template', {
      attributes: { name: 'Welcome', html: '<h1>Hi</h1>' },
    });
    const call = lastKlaviyoCall();
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/templates');
  });

  it('klaviyo_update_template sends PATCH /templates/:id', async () => {
    const server = createMockMcpServer();
    registerKlaviyoContentTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_update_template', {
      template_id: 'TPL-2',
      attributes: { name: 'Updated' },
    });
    const call = lastKlaviyoCall();
    expect(call.method).toBe('PATCH');
    expect(call.path).toBe('/templates/TPL-2');
  });

  it('klaviyo_delete_template sends DELETE /templates/:id', async () => {
    const server = createMockMcpServer();
    registerKlaviyoContentTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_delete_template', { template_id: 'TPL-3' });
    expect(lastKlaviyoCall().method).toBe('DELETE');
    expect(lastKlaviyoCall().path).toBe('/templates/TPL-3');
  });

  it('klaviyo_render_template sends POST /template-render', async () => {
    const server = createMockMcpServer();
    registerKlaviyoContentTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_render_template', {
      payload: { data: { type: 'template', id: 'T1' } },
    });
    const call = lastKlaviyoCall();
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/template-render');
  });

  it('klaviyo_clone_template sends POST /template-clone', async () => {
    const server = createMockMcpServer();
    registerKlaviyoContentTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_clone_template', {
      payload: { data: { type: 'template', id: 'T2' } },
    });
    expect(lastKlaviyoCall().path).toBe('/template-clone');
  });

  it('klaviyo_create_form sends POST /forms', async () => {
    const server = createMockMcpServer();
    registerKlaviyoContentTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_create_form', {
      attributes: { name: 'Signup' },
    });
    const call = lastKlaviyoCall();
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/forms');
  });

  it('klaviyo_delete_form sends DELETE /forms/:id', async () => {
    const server = createMockMcpServer();
    registerKlaviyoContentTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_delete_form', { form_id: 'FORM-2' });
    expect(lastKlaviyoCall().method).toBe('DELETE');
    expect(lastKlaviyoCall().path).toBe('/forms/FORM-2');
  });

  it('klaviyo_upload_image_from_url sends POST /images with url body', async () => {
    const server = createMockMcpServer();
    registerKlaviyoContentTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_upload_image_from_url', {
      attributes: { url: 'https://example.com/img.png' },
    });
    const call = lastKlaviyoCall();
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/images');
  });

  it('klaviyo_upload_image_from_file calls klaviyoUploadImageFromFile', async () => {
    const server = createMockMcpServer();
    registerKlaviyoContentTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_upload_image_from_file', {
      file_path: '/tmp/photo.jpg',
    });

    expect(klaviyoUploadImageFromFileMock).toHaveBeenCalledTimes(1);
    expect(klaviyoUploadImageFromFileMock.mock.calls[0][0]).toMatchObject({
      filePath: '/tmp/photo.jpg',
    });
    // klaviyoRequest should NOT have been called (uses separate upload fn)
    expect(klaviyoRequestMock).not.toHaveBeenCalled();
  });

  it('klaviyo_update_image sends PATCH /images/:id', async () => {
    const server = createMockMcpServer();
    registerKlaviyoContentTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_update_image', {
      image_id: 'IMG-2',
      attributes: { name: 'Renamed' },
    });
    const call = lastKlaviyoCall();
    expect(call.method).toBe('PATCH');
    expect(call.path).toBe('/images/IMG-2');
  });

  it('klaviyo_create_catalog_item sends POST /catalog-items', async () => {
    const server = createMockMcpServer();
    registerKlaviyoContentTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_create_catalog_item', {
      attributes: { title: 'Widget' },
    });
    const call = lastKlaviyoCall();
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/catalog-items');
  });

  it('klaviyo_delete_catalog_item sends DELETE /catalog-items/:id', async () => {
    const server = createMockMcpServer();
    registerKlaviyoContentTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_delete_catalog_item', { catalog_item_id: 'CI-2' });
    expect(lastKlaviyoCall().method).toBe('DELETE');
    expect(lastKlaviyoCall().path).toBe('/catalog-items/CI-2');
  });

  it('klaviyo_create_coupon sends POST /coupons', async () => {
    const server = createMockMcpServer();
    registerKlaviyoContentTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_create_coupon', {
      attributes: { description: '20% off' },
    });
    expect(lastKlaviyoCall().method).toBe('POST');
    expect(lastKlaviyoCall().path).toBe('/coupons');
  });

  it('klaviyo_create_coupon_code sends POST /coupon-codes', async () => {
    const server = createMockMcpServer();
    registerKlaviyoContentTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_create_coupon_code', {
      attributes: { unique_code: 'SAVE20' },
    });
    expect(lastKlaviyoCall().method).toBe('POST');
    expect(lastKlaviyoCall().path).toBe('/coupon-codes');
  });

  it('klaviyo_query_metric_aggregates sends POST /metric-aggregates', async () => {
    const server = createMockMcpServer();
    registerKlaviyoContentTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_query_metric_aggregates', {
      payload: { data: { type: 'metric-aggregate', attributes: {} } },
    });
    const call = lastKlaviyoCall();
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/metric-aggregates');
  });

  it('klaviyo_create_event sends POST /events with correct body structure', async () => {
    const server = createMockMcpServer();
    registerKlaviyoContentTools(server as never, config, writeEnabled);

    await server._callTool('klaviyo_create_event', {
      metric_name: 'Placed Order',
      profile: { email: 'buyer@example.com' },
      properties: { total: 49.99 },
      value: 49.99,
    });

    const call = lastKlaviyoCall();
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/events');
    const body = call.body as { data: { type: string; attributes: Record<string, unknown> } };
    expect(body.data.type).toBe('event');
    expect(body.data.attributes.metric).toEqual({
      data: { type: 'metric', attributes: { name: 'Placed Order' } },
    });
    expect(body.data.attributes.profile).toEqual({
      data: { type: 'profile', attributes: { email: 'buyer@example.com' } },
    });
    expect(body.data.attributes.value).toBe(49.99);
  });

  it('klaviyo_create_event throws when neither metric_name nor metric_id provided', async () => {
    const server = createMockMcpServer();
    registerKlaviyoContentTools(server as never, config, writeEnabled);

    await expect(
      server._callTool('klaviyo_create_event', {
        profile: { email: 'x@y.com' },
      }),
    ).rejects.toThrow('metric_name or metric_id is required');
  });

  it('klaviyo_create_event throws when neither profile nor profile_id provided', async () => {
    const server = createMockMcpServer();
    registerKlaviyoContentTools(server as never, config, writeEnabled);

    await expect(
      server._callTool('klaviyo_create_event', {
        metric_name: 'Test',
      }),
    ).rejects.toThrow('profile_id or profile is required');
  });

  // ── allowApply guard ───────────────────────────────────────────────────

  it.each([
    ['klaviyo_create_template', { attributes: { name: 'x' } }],
    ['klaviyo_update_template', { template_id: 'T1', attributes: {} }],
    ['klaviyo_delete_template', { template_id: 'T1' }],
    ['klaviyo_render_template', { payload: {} }],
    ['klaviyo_clone_template', { payload: {} }],
    ['klaviyo_create_form', { attributes: { name: 'x' } }],
    ['klaviyo_delete_form', { form_id: 'F1' }],
    ['klaviyo_upload_image_from_url', { attributes: { url: 'https://x.com/i.png' } }],
    ['klaviyo_upload_image_from_file', { file_path: '/tmp/f.png' }],
    ['klaviyo_update_image', { image_id: 'I1' }],
    ['klaviyo_create_catalog_item', { attributes: { title: 'x' } }],
    ['klaviyo_delete_catalog_item', { catalog_item_id: 'CI' }],
    ['klaviyo_create_coupon', { attributes: { description: 'x' } }],
    ['klaviyo_delete_coupon', { coupon_id: 'C1' }],
    ['klaviyo_create_coupon_code', { attributes: { unique_code: 'X' } }],
    ['klaviyo_delete_coupon_code', { coupon_code_id: 'CC' }],
    ['klaviyo_create_event', { metric_name: 'Test', profile: { email: 'a@b.com' } }],
  ])('%s blocks writes when allowApply=false', async (toolName, args) => {
    const server = createMockMcpServer();
    registerKlaviyoContentTools(server as never, config, readOnly);

    const result = await server._callTool(toolName, args);
    expect(klaviyoRequestMock).not.toHaveBeenCalled();
    expect(klaviyoUploadImageFromFileMock).not.toHaveBeenCalled();
    expect(parseResult(result).error).toMatch(/Write operation not allowed/);
  });

  // ── Redact mode ────────────────────────────────────────────────────────

  it('passes response through redactPii when redact=true', async () => {
    const { redactPii } = await import('../integrations/redact.js');
    const redactMock = vi.mocked(redactPii);
    redactMock.mockReturnValue({ redacted: true });

    const server = createMockMcpServer();
    registerKlaviyoContentTools(server as never, config, { allowApply: true, redact: true });

    await server._callTool('klaviyo_list_templates', {});
    expect(redactMock).toHaveBeenCalled();
  });
});
