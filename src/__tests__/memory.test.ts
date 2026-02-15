import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockExistsSync, mockReadFileSync } = vi.hoisted(() => ({
  mockExistsSync: vi.fn(),
  mockReadFileSync: vi.fn(),
}));

vi.mock('node:fs', () => ({
  default: {
    existsSync: (...args: unknown[]) => mockExistsSync(...args),
    readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  },
}));

vi.mock('../session.js', () => ({
  getStateSetDir: () => '/tmp/test-stateset',
  getSessionDir: (id: string) => `/tmp/test-stateset/sessions/${id}`,
}));

import { loadMemory } from '../memory.js';

describe('loadMemory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty string when no memory files exist', () => {
    mockExistsSync.mockReturnValue(false);
    expect(loadMemory('sess-1')).toBe('');
  });

  it('returns global memory only when only global file exists', () => {
    mockExistsSync.mockImplementation(
      (p: string) => p.includes('MEMORY.md') && !p.includes('sessions'),
    );
    mockReadFileSync.mockReturnValue('Global notes here');

    const result = loadMemory('sess-1');
    expect(result).toContain('### Global Memory');
    expect(result).toContain('Global notes here');
    expect(result).not.toContain('### Session Memory');
  });

  it('returns session memory only when only session file exists', () => {
    mockExistsSync.mockImplementation((p: string) => p.includes('sessions/sess-1'));
    mockReadFileSync.mockReturnValue('Session notes here');

    const result = loadMemory('sess-1');
    expect(result).toContain('### Session Memory');
    expect(result).toContain('Session notes here');
    expect(result).not.toContain('### Global Memory');
  });

  it('returns both when both memory files exist', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation((p: string) => {
      if (String(p).includes('sessions')) return 'Session data';
      return 'Global data';
    });

    const result = loadMemory('sess-1');
    expect(result).toContain('### Global Memory');
    expect(result).toContain('Global data');
    expect(result).toContain('### Session Memory');
    expect(result).toContain('Session data');
  });

  it('returns empty string when files exist but are empty', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('   ');

    expect(loadMemory('sess-1')).toBe('');
  });

  it('returns empty string when readFileSync throws', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation(() => {
      throw new Error('read error');
    });

    expect(loadMemory('sess-1')).toBe('');
  });
});
