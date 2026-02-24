import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockReadTextFile } = vi.hoisted(() => ({
  mockReadTextFile: vi.fn(),
}));

vi.mock('../session.js', () => ({
  getStateSetDir: () => '/tmp/test-stateset',
  getSessionDir: (id: string) => `/tmp/test-stateset/sessions/${id}`,
}));

vi.mock('../utils/file-read.js', () => ({
  readTextFile: (...args: unknown[]) => mockReadTextFile(...args),
  MAX_TEXT_FILE_SIZE_BYTES: 1_048_576,
}));

import { loadMemory } from '../memory.js';

describe('loadMemory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadTextFile.mockImplementation(() => {
      throw new Error('missing');
    });
  });

  it('returns empty string when no memory files exist', () => {
    expect(loadMemory('sess-1')).toBe('');
  });

  it('returns global memory only when only global file exists', () => {
    mockReadTextFile.mockImplementation((filePath: string) => {
      if (filePath === '/tmp/test-stateset/MEMORY.md') return 'Global notes here';
      throw new Error('missing');
    });

    const result = loadMemory('sess-1');
    expect(result).toContain('### Global Memory');
    expect(result).toContain('Global notes here');
    expect(result).not.toContain('### Session Memory');
  });

  it('returns session memory only when only session file exists', () => {
    mockReadTextFile.mockImplementation((filePath: string) => {
      if (filePath === '/tmp/test-stateset/sessions/sess-1/MEMORY.md') return 'Session notes here';
      throw new Error('missing');
    });

    const result = loadMemory('sess-1');
    expect(result).toContain('### Session Memory');
    expect(result).toContain('Session notes here');
    expect(result).not.toContain('### Global Memory');
  });

  it('returns both when both memory files exist', () => {
    mockReadTextFile.mockImplementation((filePath: string) => {
      if (filePath === '/tmp/test-stateset/MEMORY.md') return 'Global data';
      if (filePath === '/tmp/test-stateset/sessions/sess-1/MEMORY.md') return 'Session data';
      throw new Error('missing');
    });

    const result = loadMemory('sess-1');
    expect(result).toContain('### Global Memory');
    expect(result).toContain('Global data');
    expect(result).toContain('### Session Memory');
    expect(result).toContain('Session data');
  });

  it('returns empty string when files exist but are empty', () => {
    mockReadTextFile.mockReturnValue('   ');
    expect(loadMemory('sess-1')).toBe('');
  });

  it('returns empty string when read errors occur', () => {
    mockReadTextFile.mockImplementation(() => {
      throw new Error('read error');
    });
    expect(loadMemory('sess-1')).toBe('');
  });
});
