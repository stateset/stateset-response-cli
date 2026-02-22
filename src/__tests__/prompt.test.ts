/**
 * Tests for buildSystemPrompt()
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Hoisted mocks ---

const {
  mockGetCurrentOrg,
  mockGetIntegrationFlagsFromEnv,
  mockIsIntegrationConfigured,
  mockGetStateSetDir,
  mockLoadContextFiles,
  mockLoadSystemPromptFiles,
  mockGetSkill,
} = vi.hoisted(() => ({
  mockGetCurrentOrg: vi.fn(),
  mockGetIntegrationFlagsFromEnv: vi.fn(),
  mockIsIntegrationConfigured: vi.fn(),
  mockGetStateSetDir: vi.fn(),
  mockLoadContextFiles: vi.fn(),
  mockLoadSystemPromptFiles: vi.fn(),
  mockGetSkill: vi.fn(),
}));

vi.mock('../config.js', () => ({
  getCurrentOrg: mockGetCurrentOrg,
}));

vi.mock('../integrations/config.js', () => ({
  getIntegrationFlagsFromEnv: mockGetIntegrationFlagsFromEnv,
  isIntegrationConfigured: mockIsIntegrationConfigured,
}));

vi.mock('../integrations/registry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../integrations/registry.js')>();
  return {
    ...actual,
    INTEGRATION_DEFINITIONS: actual.INTEGRATION_DEFINITIONS,
  };
});

vi.mock('../session.js', () => ({
  getStateSetDir: mockGetStateSetDir,
}));

vi.mock('../resources.js', () => ({
  loadContextFiles: mockLoadContextFiles,
  loadSystemPromptFiles: mockLoadSystemPromptFiles,
  getSkill: mockGetSkill,
}));

import { buildSystemPrompt } from '../prompt.js';

// --- Helpers ---

function setupDefaults() {
  mockGetCurrentOrg.mockReturnValue({ orgId: 'org-test', config: {} });
  mockGetIntegrationFlagsFromEnv.mockReturnValue({ allowApply: false, redact: false });
  mockIsIntegrationConfigured.mockReturnValue(false);
  mockGetStateSetDir.mockReturnValue('/home/test/.stateset');
  mockLoadContextFiles.mockReturnValue([]);
  mockLoadSystemPromptFiles.mockReturnValue({ override: null, append: [] });
  mockGetSkill.mockReturnValue(null);
}

// --- Tests ---

describe('buildSystemPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaults();
  });

  it('includes the base system prompt', () => {
    const result = buildSystemPrompt({ sessionId: 'sess-1' });
    expect(result).toContain('You are an AI assistant');
  });

  it('includes session info with org ID and session ID', () => {
    const result = buildSystemPrompt({ sessionId: 'sess-abc' });
    expect(result).toContain('## Session');
    expect(result).toContain('Org: org-test');
    expect(result).toContain('Session: sess-abc');
    expect(result).toContain('Timezone:');
  });

  it('uses "unknown" org when getCurrentOrg throws', () => {
    mockGetCurrentOrg.mockImplementation(() => {
      throw new Error('not configured');
    });

    const result = buildSystemPrompt({ sessionId: 'sess-1' });
    expect(result).toContain('Org: unknown');
  });

  it('includes integrations section with all not configured', () => {
    const result = buildSystemPrompt({ sessionId: 'sess-1' });
    expect(result).toContain('## Integrations');
    expect(result).toContain('Shopify: not configured');
    expect(result).toContain('Gorgias: not configured');
    expect(result).toContain('Recharge: not configured');
    expect(result).toContain('Klaviyo: not configured');
    expect(result).toContain('Loop Returns: not configured');
    expect(result).toContain('ShipStation: not configured');
    expect(result).toContain('ShipHero: not configured');
    expect(result).toContain('ShipFusion: not configured');
    expect(result).toContain('ShipHawk: not configured');
    expect(result).toContain('Zendesk: not configured');
  });

  it('shows integrations as configured when isIntegrationConfigured returns true', () => {
    mockIsIntegrationConfigured.mockImplementation(
      (id: string) => id === 'shopify' || id === 'gorgias' || id === 'zendesk',
    );

    const result = buildSystemPrompt({ sessionId: 'sess-1' });
    expect(result).toContain('Shopify: configured');
    expect(result).toContain('Gorgias: configured');
    expect(result).toContain('Zendesk: configured');
    // Others still not configured
    expect(result).toContain('Recharge: not configured');
  });

  it('shows writes enabled when allowApply is true', () => {
    mockGetIntegrationFlagsFromEnv.mockReturnValue({ allowApply: true, redact: false });

    const result = buildSystemPrompt({ sessionId: 'sess-1' });
    expect(result).toContain('Writes enabled: yes');
  });

  it('shows redaction enabled when redact is true', () => {
    mockGetIntegrationFlagsFromEnv.mockReturnValue({ allowApply: false, redact: true });

    const result = buildSystemPrompt({ sessionId: 'sess-1' });
    expect(result).toContain('Redaction: enabled');
  });

  it('includes events section with events directory path', () => {
    const result = buildSystemPrompt({ sessionId: 'sess-1' });
    expect(result).toContain('## Events');
    expect(result).toContain('/home/test/.stateset/events');
  });

  it('includes memory section when memory is provided', () => {
    const result = buildSystemPrompt({
      sessionId: 'sess-1',
      memory: 'Remember that the customer prefers email.',
    });
    expect(result).toContain('## Memory');
    expect(result).toContain('Remember that the customer prefers email.');
  });

  it('does not include memory section when memory is empty', () => {
    const result = buildSystemPrompt({ sessionId: 'sess-1' });
    expect(result).not.toContain('## Memory');
  });

  it('includes context files when loadContextFiles returns files', () => {
    mockLoadContextFiles.mockReturnValue([
      { path: '/foo/AGENTS.md', displayPath: './AGENTS.md', content: 'Agent instructions here' },
    ]);

    const result = buildSystemPrompt({ sessionId: 'sess-1' });
    expect(result).toContain('## Context Files');
    expect(result).toContain('./AGENTS.md');
    expect(result).toContain('Agent instructions here');
  });

  it('does not include context files section when none exist', () => {
    const result = buildSystemPrompt({ sessionId: 'sess-1' });
    expect(result).not.toContain('## Context Files');
  });

  it('includes skills section when activeSkills are provided', () => {
    mockGetSkill.mockImplementation((name: string) => ({
      name,
      path: `/skills/${name}.md`,
      displayPath: `.stateset/skills/${name}.md`,
      description: `The ${name} skill`,
      content: `${name} skill content here`,
    }));

    const result = buildSystemPrompt({
      sessionId: 'sess-1',
      activeSkills: ['greeting', 'farewell'],
    });

    expect(result).toContain('## Skills');
    expect(result).toContain('greeting');
    expect(result).toContain('greeting skill content here');
    expect(result).toContain('farewell');
    expect(result).toContain('farewell skill content here');
  });

  it('does not include skills section when activeSkills is empty', () => {
    const result = buildSystemPrompt({
      sessionId: 'sess-1',
      activeSkills: [],
    });
    expect(result).not.toContain('## Skills');
  });

  it('skips skills that getSkill returns null for', () => {
    mockGetSkill.mockReturnValue(null);

    const result = buildSystemPrompt({
      sessionId: 'sess-1',
      activeSkills: ['nonexistent'],
    });
    expect(result).not.toContain('## Skills');
  });

  it('uses override prompt when loadSystemPromptFiles returns override', () => {
    mockLoadSystemPromptFiles.mockReturnValue({
      override: {
        path: '/foo/SYSTEM.md',
        displayPath: './SYSTEM.md',
        content: 'Custom system prompt',
      },
      append: [],
    });

    const result = buildSystemPrompt({ sessionId: 'sess-1' });
    expect(result).toContain('Custom system prompt');
    // Base prompt should NOT be present
    expect(result).not.toContain('You are an AI assistant for managing');
  });

  it('appends content from append system prompt files', () => {
    mockLoadSystemPromptFiles.mockReturnValue({
      override: null,
      append: [
        {
          path: '/foo/APPEND_SYSTEM.md',
          displayPath: './APPEND_SYSTEM.md',
          content: 'Extra instructions here',
        },
      ],
    });

    const result = buildSystemPrompt({ sessionId: 'sess-1' });
    expect(result).toContain('Extra instructions here');
    // Base prompt should also be present
    expect(result).toContain('You are an AI assistant');
  });

  it('ends with a newline', () => {
    const result = buildSystemPrompt({ sessionId: 'sess-1' });
    expect(result.endsWith('\n')).toBe(true);
  });

  it('uses provided cwd instead of process.cwd()', () => {
    const result = buildSystemPrompt({ sessionId: 'sess-1', cwd: '/custom/dir' });

    // Verify loadSystemPromptFiles was called with our cwd
    expect(mockLoadSystemPromptFiles).toHaveBeenCalledWith('/custom/dir');
    expect(mockLoadContextFiles).toHaveBeenCalledWith('/custom/dir');
    // Output should still be valid
    expect(result).toContain('## Session');
  });

  it('shows not configured when isIntegrationConfigured returns false', () => {
    mockIsIntegrationConfigured.mockReturnValue(false);

    const result = buildSystemPrompt({ sessionId: 'sess-1' });
    expect(result).toContain('Shopify: not configured');
    expect(result).toContain('Gorgias: not configured');
  });
});
