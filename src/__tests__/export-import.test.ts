/**
 * Tests for export-import module
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mocks (must use vi.hoisted so they are available in vi.mock factories) --

const {
  mockExecuteQuery,
  mockCreateGraphQLClient,
  mockWriteFileSync,
  mockReadFileSync,
  mockExistsSync,
} = vi.hoisted(() => ({
  mockExecuteQuery: vi.fn(),
  mockCreateGraphQLClient: vi.fn().mockReturnValue({ request: vi.fn() }),
  mockWriteFileSync: vi.fn(),
  mockReadFileSync: vi.fn(),
  mockExistsSync: vi.fn(),
}));

vi.mock('../mcp-server/graphql-client.js', () => ({
  createGraphQLClient: mockCreateGraphQLClient,
  executeQuery: mockExecuteQuery,
}));

vi.mock('../config.js', () => ({
  getCurrentOrg: vi.fn(() => ({
    orgId: 'org-1',
    config: {
      name: 'Test',
      graphqlEndpoint: 'https://api.test/graphql',
      cliToken: 'token',
    },
  })),
}));

vi.mock('node:fs', () => ({
  default: {
    writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
    readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
    existsSync: (...args: unknown[]) => mockExistsSync(...args),
  },
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
}));

// --- Import module under test ------------------------------------------------

import { exportOrg, importOrg } from '../export-import.js';

// --- Helpers -----------------------------------------------------------------

function makeExportPayload(overrides: Record<string, unknown> = {}) {
  return {
    agents: [{ id: 'a1', name: 'Agent1', org_id: 'org-1' }],
    rules: [{ id: 'r1', name: 'Rule1', org_id: 'org-1' }],
    skills: [{ id: 's1', name: 'Skill1', org_id: 'org-1' }],
    attributes: [{ id: 'at1', name: 'Attr1', org_id: 'org-1' }],
    functions: [{ id: 'f1', name: 'Func1', org_id: 'org-1' }],
    examples: [{ id: 'ex1', title: 'Example1', org_id: 'org-1', example_messages: [] }],
    evals: [{ id: 'ev1', name: 'Eval1', org_id: 'org-1' }],
    datasets: [{ id: 'd1', name: 'Dataset1', org_id: 'org-1', dataset_entries: [] }],
    agent_settings: [{ id: 'as1', org_id: 'org-1', test: true }],
    ...overrides,
  };
}

function makeExportFile(overrides: Record<string, unknown> = {}) {
  return {
    version: '1.0.0',
    exportedAt: '2025-01-01T00:00:00.000Z',
    orgId: 'org-1',
    agents: [{ id: 'a1', name: 'Agent1', org_id: 'org-1' }],
    rules: [{ id: 'r1', name: 'Rule1', org_id: 'org-1' }],
    skills: [{ id: 's1', name: 'Skill1', org_id: 'org-1' }],
    attributes: [{ id: 'at1', name: 'Attr1', org_id: 'org-1' }],
    functions: [{ id: 'f1', name: 'Func1', org_id: 'org-1' }],
    examples: [{ id: 'ex1', title: 'Example1', org_id: 'org-1', example_messages: [] }],
    evals: [{ id: 'ev1', name: 'Eval1', org_id: 'org-1' }],
    datasets: [{ id: 'd1', name: 'Dataset1', org_id: 'org-1', dataset_entries: [] }],
    agentSettings: [{ id: 'as1', org_id: 'org-1', test: true }],
    ...overrides,
  };
}

// --- Tests -------------------------------------------------------------------

describe('exportOrg', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls GraphQL for all resource types and writes to file', async () => {
    const payload = makeExportPayload();
    mockExecuteQuery.mockResolvedValueOnce(payload);

    await exportOrg('/tmp/export.json');

    // Should have called createGraphQLClient
    expect(mockCreateGraphQLClient).toHaveBeenCalledWith(
      'https://api.test/graphql',
      { type: 'cli_token', token: 'token' },
      'org-1',
    );

    // Should have executed the export query
    expect(mockExecuteQuery).toHaveBeenCalledTimes(1);
    expect(mockExecuteQuery).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('agents'),
      { org_id: 'org-1' },
    );

    // Should have written the file
    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
    expect(mockWriteFileSync).toHaveBeenCalledWith('/tmp/export.json', expect.any(String), 'utf-8');

    // Verify the written JSON is valid and has the correct structure
    const writtenJson = JSON.parse(mockWriteFileSync.mock.calls[0][1] as string);
    expect(writtenJson.version).toBe('1.0.0');
    expect(writtenJson.orgId).toBe('org-1');
    expect(writtenJson.exportedAt).toBeDefined();
  });

  it('returns correct structure with arrays', async () => {
    const payload = makeExportPayload();
    mockExecuteQuery.mockResolvedValueOnce(payload);

    const result = await exportOrg('/tmp/export.json');

    expect(result.version).toBe('1.0.0');
    expect(result.orgId).toBe('org-1');
    expect(Array.isArray(result.agents)).toBe(true);
    expect(Array.isArray(result.rules)).toBe(true);
    expect(Array.isArray(result.skills)).toBe(true);
    expect(Array.isArray(result.attributes)).toBe(true);
    expect(Array.isArray(result.functions)).toBe(true);
    expect(Array.isArray(result.examples)).toBe(true);
    expect(Array.isArray(result.evals)).toBe(true);
    expect(Array.isArray(result.datasets)).toBe(true);
    expect(Array.isArray(result.agentSettings)).toBe(true);

    expect(result.agents).toHaveLength(1);
    expect(result.rules).toHaveLength(1);
    expect(result.skills).toHaveLength(1);
    expect(result.attributes).toHaveLength(1);
    expect(result.functions).toHaveLength(1);
    expect(result.examples).toHaveLength(1);
    expect(result.evals).toHaveLength(1);
    expect(result.datasets).toHaveLength(1);
    expect(result.agentSettings).toHaveLength(1);
  });

  it('handles empty query results gracefully', async () => {
    mockExecuteQuery.mockResolvedValueOnce({});

    const result = await exportOrg('/tmp/export.json');

    expect(result.agents).toEqual([]);
    expect(result.rules).toEqual([]);
    expect(result.skills).toEqual([]);
    expect(result.attributes).toEqual([]);
    expect(result.functions).toEqual([]);
    expect(result.examples).toEqual([]);
    expect(result.evals).toEqual([]);
    expect(result.datasets).toEqual([]);
    expect(result.agentSettings).toEqual([]);
  });

  it('redacts secrets by default', async () => {
    const payload = makeExportPayload({
      functions: [{ id: 'f1', name: 'Func1', api_key: 'super-secret-key', org_id: 'org-1' }],
    });
    mockExecuteQuery.mockResolvedValueOnce(payload);

    const result = await exportOrg('/tmp/export.json');

    const func = result.functions[0] as Record<string, unknown>;
    expect(func.api_key).toBe('[REDACTED]');
  });

  it('throws when writeFileSync fails', async () => {
    const payload = makeExportPayload();
    mockExecuteQuery.mockResolvedValueOnce(payload);
    mockWriteFileSync.mockImplementationOnce(() => {
      throw new Error('ENOSPC: no space left on device');
    });

    await expect(exportOrg('/tmp/export.json')).rejects.toThrow(/Failed to write export file/);
  });

  it('preserves secrets when includeSecrets is true', async () => {
    const payload = makeExportPayload({
      functions: [{ id: 'f1', name: 'Func1', api_key: 'super-secret-key', org_id: 'org-1' }],
    });
    mockExecuteQuery.mockResolvedValueOnce(payload);

    const result = await exportOrg('/tmp/export.json', { includeSecrets: true });

    const func = result.functions[0] as Record<string, unknown>;
    expect(func.api_key).toBe('super-secret-key');
  });
});

describe('importOrg', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws on invalid export file (missing version)', async () => {
    const invalidData = { orgId: 'org-1', agents: [] };
    mockReadFileSync.mockReturnValue(JSON.stringify(invalidData));

    await expect(importOrg('/tmp/import.json')).rejects.toThrow('Invalid export file');
  });

  it('throws on invalid export file (missing orgId)', async () => {
    const invalidData = { version: '1.0.0', agents: [] };
    mockReadFileSync.mockReturnValue(JSON.stringify(invalidData));

    await expect(importOrg('/tmp/import.json')).rejects.toThrow('Invalid export file');
  });

  it('throws on file that does not exist', async () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT: no such file or directory');
    });

    await expect(importOrg('/tmp/nonexistent.json')).rejects.toThrow(/Failed to read import file/);
  });

  it('throws on invalid JSON in import file', async () => {
    mockReadFileSync.mockReturnValue('not valid json {{{');

    await expect(importOrg('/tmp/bad.json')).rejects.toThrow(/Invalid JSON in import file/);
  });

  it('throws when file is unreadable (permission denied)', async () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('EACCES: permission denied');
    });

    await expect(importOrg('/tmp/locked.json')).rejects.toThrow(/Failed to read import file/);
  });

  it('calls mutations for each resource type on valid import', async () => {
    const exportFile = makeExportFile();
    mockReadFileSync.mockReturnValue(JSON.stringify(exportFile));

    mockExecuteQuery
      // agents batch
      .mockResolvedValueOnce({ insert_agents: { affected_rows: 1 } })
      // rules batch
      .mockResolvedValueOnce({ insert_rules: { affected_rows: 1 } })
      // skills batch
      .mockResolvedValueOnce({ insert_skills: { affected_rows: 1 } })
      // attributes batch
      .mockResolvedValueOnce({ insert_attributes: { affected_rows: 1 } })
      // functions batch
      .mockResolvedValueOnce({ insert_functions: { affected_rows: 1 } })
      // examples one-by-one
      .mockResolvedValueOnce({ insert_examples: { affected_rows: 1 } })
      // evals batch
      .mockResolvedValueOnce({ insert_evals: { affected_rows: 1 } })
      // datasets one-by-one
      .mockResolvedValueOnce({ insert_datasets: { affected_rows: 1 } })
      // agent_settings one-by-one
      .mockResolvedValueOnce({ insert_agent_settings: { affected_rows: 1 } });

    const result = await importOrg('/tmp/import.json');

    expect(result.agents).toBe(1);
    expect(result.rules).toBe(1);
    expect(result.skills).toBe(1);
    expect(result.attributes).toBe(1);
    expect(result.functions).toBe(1);
    expect(result.examples).toBe(1);
    expect(result.evals).toBe(1);
    expect(result.datasets).toBe(1);
    expect(result.agentSettings).toBe(1);

    // Verify createGraphQLClient was called
    expect(mockCreateGraphQLClient).toHaveBeenCalledWith(
      'https://api.test/graphql',
      { type: 'cli_token', token: 'token' },
      'org-1',
    );

    // At minimum 9 mutation calls
    expect(mockExecuteQuery.mock.calls.length).toBeGreaterThanOrEqual(9);

    // Verify agent mutation includes org_id remapping and strips id
    const agentMutationCall = mockExecuteQuery.mock.calls[0];
    expect(agentMutationCall[1]).toContain('insert_agents');
    const agentObjects = agentMutationCall[2].objects;
    expect(agentObjects[0].org_id).toBe('org-1');
    expect(agentObjects[0].id).toBeUndefined();
  });

  it('falls back to one-by-one inserts when batch mutation fails', async () => {
    const exportFile = makeExportFile();
    mockReadFileSync.mockReturnValue(JSON.stringify(exportFile));

    mockExecuteQuery
      // Agents batch fails
      .mockRejectedValueOnce(new Error('batch conflict'))
      // Agent individual insert succeeds
      .mockResolvedValueOnce({ insert_agents: { affected_rows: 1 } })
      // rules batch ok
      .mockResolvedValueOnce({ insert_rules: { affected_rows: 1 } })
      // skills batch ok
      .mockResolvedValueOnce({ insert_skills: { affected_rows: 1 } })
      // attributes batch ok
      .mockResolvedValueOnce({ insert_attributes: { affected_rows: 1 } })
      // functions batch ok
      .mockResolvedValueOnce({ insert_functions: { affected_rows: 1 } })
      // examples one-by-one
      .mockResolvedValueOnce({ insert_examples: { affected_rows: 1 } })
      // evals batch ok
      .mockResolvedValueOnce({ insert_evals: { affected_rows: 1 } })
      // datasets one-by-one
      .mockResolvedValueOnce({ insert_datasets: { affected_rows: 1 } })
      // agent_settings one-by-one
      .mockResolvedValueOnce({ insert_agent_settings: { affected_rows: 1 } });

    const result = await importOrg('/tmp/import.json');

    // Agents should have been inserted one-by-one (fallback)
    expect(result.agents).toBe(1);
    expect(result.rules).toBe(1);
  });

  it('returns zeros when import file has empty resource arrays', async () => {
    const exportFile = makeExportFile({
      agents: [],
      rules: [],
      skills: [],
      attributes: [],
      functions: [],
      examples: [],
      evals: [],
      datasets: [],
      agentSettings: [],
    });
    mockReadFileSync.mockReturnValue(JSON.stringify(exportFile));

    const result = await importOrg('/tmp/import.json');

    expect(result.agents).toBe(0);
    expect(result.rules).toBe(0);
    expect(result.skills).toBe(0);
    expect(result.attributes).toBe(0);
    expect(result.functions).toBe(0);
    expect(result.examples).toBe(0);
    expect(result.evals).toBe(0);
    expect(result.datasets).toBe(0);
    expect(result.datasetEntries).toBe(0);
    expect(result.agentSettings).toBe(0);

    // No mutations should have been called
    expect(mockExecuteQuery).not.toHaveBeenCalled();
  });

  it('imports nested example messages and dataset entries', async () => {
    const exportFile = makeExportFile({
      examples: [
        {
          id: 'ex1',
          title: 'Example1',
          org_id: 'org-1',
          example_messages: [
            { id: 'msg1', role: 'user', content: 'Hello', org_id: 'org-1' },
            { id: 'msg2', role: 'assistant', content: 'Hi there', org_id: 'org-1' },
          ],
        },
      ],
      datasets: [
        {
          id: 'd1',
          name: 'Dataset1',
          org_id: 'org-1',
          dataset_entries: [{ id: 'de1', content: 'entry1', org_id: 'org-1' }],
        },
      ],
      agents: [],
      rules: [],
      skills: [],
      attributes: [],
      functions: [],
      evals: [],
      agentSettings: [],
    });
    mockReadFileSync.mockReturnValue(JSON.stringify(exportFile));

    mockExecuteQuery
      // example insert
      .mockResolvedValueOnce({ insert_examples: { affected_rows: 1 } })
      // message 1
      .mockResolvedValueOnce({ insert_example_messages: { affected_rows: 1 } })
      // message 2
      .mockResolvedValueOnce({ insert_example_messages: { affected_rows: 1 } })
      // dataset insert
      .mockResolvedValueOnce({ insert_datasets: { affected_rows: 1 } })
      // dataset entry 1
      .mockResolvedValueOnce({ insert_dataset_entries: { affected_rows: 1 } });

    const result = await importOrg('/tmp/import.json');

    expect(result.examples).toBe(1);
    expect(result.datasets).toBe(1);
    expect(result.datasetEntries).toBe(1);

    // Verify example messages mutation was called
    const messageCalls = mockExecuteQuery.mock.calls.filter(
      (call: unknown[]) =>
        typeof call[1] === 'string' && (call[1] as string).includes('insert_example_messages'),
    );
    expect(messageCalls).toHaveLength(2);

    // Verify dataset entries mutation was called
    const entryCalls = mockExecuteQuery.mock.calls.filter(
      (call: unknown[]) =>
        typeof call[1] === 'string' && (call[1] as string).includes('insert_dataset_entries'),
    );
    expect(entryCalls).toHaveLength(1);
  });

  it('supports dry-run preview mode without executing queries', async () => {
    const exportFile = makeExportFile({
      agents: [{ id: 'a1', name: 'Agent1', org_id: 'org-1' }],
      examples: [
        {
          id: 'ex1',
          title: 'Example1',
          org_id: 'org-1',
          example_messages: [{ id: 'm1', role: 'user', content: 'hello', org_id: 'org-1' }],
        },
      ],
      datasets: [
        {
          id: 'd1',
          name: 'Dataset1',
          org_id: 'org-1',
          dataset_entries: [
            { id: 'de1', content: 'entry1', org_id: 'org-1' },
            { id: 'de2', content: 'entry2', org_id: 'org-1' },
          ],
        },
      ],
      rules: [],
      skills: [],
      attributes: [],
      functions: [],
      evals: [],
      agentSettings: [],
    });
    mockReadFileSync.mockReturnValue(JSON.stringify(exportFile));

    const result = await importOrg('/tmp/import.json', { dryRun: true });

    expect(result.sourceOrgId).toBe('org-1');
    expect(result.agents).toBe(1);
    expect(result.examples).toBe(1);
    expect(result.datasets).toBe(1);
    expect(result.datasetEntries).toBe(2);
    expect(result.rules).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.failures).toHaveLength(0);
    expect(mockExecuteQuery).not.toHaveBeenCalled();
  });

  it('returns skipped count and failure details on insert errors', async () => {
    const exportFile = makeExportFile({
      agents: [{ id: 'a1', name: 'Agent1', org_id: 'org-1' }],
      rules: [],
      skills: [],
      attributes: [],
      functions: [],
      examples: [],
      evals: [],
      datasets: [],
      agentSettings: [],
    });
    mockReadFileSync.mockReturnValue(JSON.stringify(exportFile));

    mockExecuteQuery
      // Agents batch fails
      .mockRejectedValueOnce(new Error('batch conflict'))
      // Agent item-level insert fails
      .mockRejectedValueOnce(new Error('agent already exists'));

    const result = await importOrg('/tmp/import.json');

    expect(result.agents).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({
      entity: 'agents',
      index: 0,
      sourceId: null,
      reason: 'agent already exists',
    });
  });

  it('throws on strict mode when any insert fails', async () => {
    const exportFile = makeExportFile({
      agents: [{ id: 'a1', name: 'Agent1', org_id: 'org-1' }],
      rules: [],
      skills: [],
      attributes: [],
      functions: [],
      examples: [],
      evals: [],
      datasets: [],
      agentSettings: [],
    });
    mockReadFileSync.mockReturnValue(JSON.stringify(exportFile));

    mockExecuteQuery
      .mockRejectedValueOnce(new Error('batch conflict'))
      .mockRejectedValueOnce(new Error('agent already exists'));

    await expect(importOrg('/tmp/import.json', { strict: true })).rejects.toThrow(
      'Import completed with 1 failure(s). Use --dry-run to inspect before applying to this org.',
    );
  });

  it('throws for malformed array sections', async () => {
    const exportFile = makeExportFile({
      agents: { not: 'an array' },
      rules: [],
      skills: [],
      attributes: [],
      functions: [],
      examples: [],
      evals: [],
      datasets: [],
      agentSettings: [],
    } as unknown as Record<string, unknown>);
    mockReadFileSync.mockReturnValue(JSON.stringify(exportFile));

    await expect(importOrg('/tmp/import.json')).rejects.toThrow(
      'Invalid export format: "agents" must be an array.',
    );
  });
});
