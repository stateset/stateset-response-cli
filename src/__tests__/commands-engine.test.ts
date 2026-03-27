import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock config before importing
vi.mock('../config.js', async () => {
  const actual = (await vi.importActual('../config.js')) as Record<string, unknown>;
  return {
    ...actual,
    loadConfig: vi.fn().mockReturnValue({
      currentOrg: 'test-org',
      organizations: {
        'test-org': {
          name: 'Test',
          graphqlEndpoint: 'https://test.com/v1/graphql',
        },
      },
    }),
    saveConfig: vi.fn(),
    configExists: vi.fn().mockReturnValue(true),
    getWorkflowEngineConfig: vi.fn().mockReturnValue(null),
  };
});

vi.mock('../lib/engine-client.js', () => {
  return {
    EngineClient: vi.fn().mockImplementation(() => ({
      health: vi.fn().mockResolvedValue({ status: 'ok' }),
      listBrands: vi.fn().mockResolvedValue({
        items: [
          {
            id: '12345678-abcd',
            name: 'Acme',
            slug: 'acme',
            status: 'active',
            routing_mode: 'live',
          },
        ],
      }),
      getWorkflowStatus: vi.fn().mockResolvedValue({ status: 'completed' }),
      cancelWorkflow: vi.fn().mockResolvedValue({}),
      listDlq: vi.fn().mockResolvedValue({ items: [] }),
      createOnboardingRun: vi.fn().mockResolvedValue({ id: 'run-1' }),
      listWorkflowTemplates: vi.fn().mockResolvedValue({ items: [] }),
    })),
    EngineClientError: class extends Error {
      status?: number;
      constructor(msg: string, opts?: { status?: number }) {
        super(msg);
        this.name = 'EngineClientError';
        this.status = opts?.status;
      }
    },
  };
});

import { handleEngineCommand, handleWorkflowsCommand } from '../cli/commands-engine.js';
import { getWorkflowEngineConfig } from '../config.js';
import type { ChatContext } from '../cli/types.js';

function makeMockCtx(): ChatContext {
  return {
    agent: {
      getModel: () => 'claude-sonnet-4-6',
      getHistoryLength: () => 0,
      callTool: vi.fn(),
    },
    cwd: '/tmp',
    rl: { prompt: vi.fn() },
    sessionId: 'test',
    processing: false,
    reconnectAgent: vi.fn(),
  } as unknown as ChatContext;
}

describe('handleEngineCommand', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('returns not handled for non-engine input', async () => {
    const result = await handleEngineCommand('/help', makeMockCtx());
    expect(result.handled).toBe(false);
  });

  it('shows not-configured when engine is not set up', async () => {
    vi.mocked(getWorkflowEngineConfig).mockReturnValue(null);
    const result = await handleEngineCommand('/engine', makeMockCtx());
    expect(result.handled).toBe(true);
  });

  it('handles /engine status subcommand', async () => {
    vi.mocked(getWorkflowEngineConfig).mockReturnValue({
      url: 'http://localhost:8080',
      apiKey: 'test-key',
    });
    const result = await handleEngineCommand('/engine', makeMockCtx());
    expect(result.handled).toBe(true);
  });

  it('handles /engine health subcommand', async () => {
    vi.mocked(getWorkflowEngineConfig).mockReturnValue({
      url: 'http://localhost:8080',
      apiKey: 'test-key',
    });
    const result = await handleEngineCommand('/engine health', makeMockCtx());
    expect(result.handled).toBe(true);
  });

  it('handles /engine brands subcommand', async () => {
    vi.mocked(getWorkflowEngineConfig).mockReturnValue({
      url: 'http://localhost:8080',
      apiKey: 'test-key',
    });
    const result = await handleEngineCommand('/engine brands', makeMockCtx());
    expect(result.handled).toBe(true);
  });

  it('handles /engine onboard without brand-id', async () => {
    vi.mocked(getWorkflowEngineConfig).mockReturnValue({
      url: 'http://localhost:8080',
      apiKey: 'test-key',
    });
    const result = await handleEngineCommand('/engine onboard', makeMockCtx());
    expect(result.handled).toBe(true);
  });

  it('handles /engine templates subcommand', async () => {
    vi.mocked(getWorkflowEngineConfig).mockReturnValue({
      url: 'http://localhost:8080',
      apiKey: 'test-key',
    });
    const result = await handleEngineCommand('/engine templates', makeMockCtx());
    expect(result.handled).toBe(true);
  });

  it('handles /engine dlq without brand-id', async () => {
    vi.mocked(getWorkflowEngineConfig).mockReturnValue({
      url: 'http://localhost:8080',
      apiKey: 'test-key',
    });
    const result = await handleEngineCommand('/engine dlq', makeMockCtx());
    expect(result.handled).toBe(true);
  });

  it('falls through unknown subcommands to agent', async () => {
    vi.mocked(getWorkflowEngineConfig).mockReturnValue({
      url: 'http://localhost:8080',
      apiKey: 'test-key',
    });
    const result = await handleEngineCommand('/engine something-else', makeMockCtx());
    expect(result.handled).toBe(true);
    expect(result.sendMessage).toBeDefined();
  });
});

describe('handleWorkflowsCommand', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('returns not handled for non-workflows input', async () => {
    const result = await handleWorkflowsCommand('/help', makeMockCtx());
    expect(result.handled).toBe(false);
  });

  it('shows not-configured when engine is not set up', async () => {
    vi.mocked(getWorkflowEngineConfig).mockReturnValue(null);
    const result = await handleWorkflowsCommand('/workflows list', makeMockCtx());
    expect(result.handled).toBe(true);
  });

  it('handles /workflows status without id', async () => {
    vi.mocked(getWorkflowEngineConfig).mockReturnValue({
      url: 'http://localhost:8080',
      apiKey: 'test-key',
    });
    const result = await handleWorkflowsCommand('/workflows status', makeMockCtx());
    expect(result.handled).toBe(true);
  });

  it('handles /workflows cancel without id', async () => {
    vi.mocked(getWorkflowEngineConfig).mockReturnValue({
      url: 'http://localhost:8080',
      apiKey: 'test-key',
    });
    const result = await handleWorkflowsCommand('/workflows cancel', makeMockCtx());
    expect(result.handled).toBe(true);
  });

  it('handles /workflows retry without brand-id', async () => {
    vi.mocked(getWorkflowEngineConfig).mockReturnValue({
      url: 'http://localhost:8080',
      apiKey: 'test-key',
    });
    const result = await handleWorkflowsCommand('/workflows retry', makeMockCtx());
    expect(result.handled).toBe(true);
  });

  it('handles /wf alias', async () => {
    vi.mocked(getWorkflowEngineConfig).mockReturnValue(null);
    const result = await handleWorkflowsCommand('/wf list', makeMockCtx());
    expect(result.handled).toBe(true);
  });

  it('handles /workflows start delegates to agent', async () => {
    vi.mocked(getWorkflowEngineConfig).mockReturnValue({
      url: 'http://localhost:8080',
      apiKey: 'test-key',
    });
    const result = await handleWorkflowsCommand('/workflows start acme 12345', makeMockCtx());
    expect(result.handled).toBe(true);
    expect(result.sendMessage).toContain('acme');
  });
});
