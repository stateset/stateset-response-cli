import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';

vi.mock('node:fs');
vi.mock('node:os', () => ({
  default: { homedir: () => '/mock-home' },
  homedir: () => '/mock-home',
}));

import {
  loadInputHistory,
  appendHistoryLine,
  trimHistoryFile,
  getHistoryFilePath,
} from '../cli/history.js';

const mockFs = vi.mocked(fs);

describe('history', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getHistoryFilePath', () => {
    it('returns path under ~/.stateset', () => {
      const p = getHistoryFilePath();
      expect(p).toContain('.stateset');
      expect(p).toContain('input-history');
    });
  });

  describe('loadInputHistory', () => {
    it('returns empty array when file does not exist', () => {
      mockFs.existsSync.mockReturnValue(false);
      expect(loadInputHistory()).toEqual([]);
    });

    it('reads and splits lines', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('line1\nline2\nline3\n');
      const result = loadInputHistory();
      expect(result).toEqual(['line1', 'line2', 'line3']);
    });

    it('trims to last 500 lines', () => {
      mockFs.existsSync.mockReturnValue(true);
      const lines = Array.from({ length: 600 }, (_, i) => `line${i}`);
      mockFs.readFileSync.mockReturnValue(lines.join('\n'));
      const result = loadInputHistory();
      expect(result.length).toBe(500);
      expect(result[0]).toBe('line100');
    });

    it('handles read error gracefully', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockImplementation(() => {
        throw new Error('read error');
      });
      expect(loadInputHistory()).toEqual([]);
    });
  });

  describe('appendHistoryLine', () => {
    it('appends trimmed line to file', () => {
      mockFs.existsSync.mockReturnValue(true);
      appendHistoryLine('  hello  ');
      expect(mockFs.appendFileSync).toHaveBeenCalledWith(
        expect.stringContaining('input-history'),
        'hello\n',
        'utf-8',
      );
    });

    it('skips empty lines', () => {
      appendHistoryLine('   ');
      expect(mockFs.appendFileSync).not.toHaveBeenCalled();
    });

    it('skips /exit and /quit', () => {
      appendHistoryLine('/exit');
      appendHistoryLine('/quit');
      appendHistoryLine('exit');
      appendHistoryLine('quit');
      expect(mockFs.appendFileSync).not.toHaveBeenCalled();
    });

    it('creates directory if needed', () => {
      mockFs.existsSync.mockReturnValue(false);
      appendHistoryLine('test');
      expect(mockFs.mkdirSync).toHaveBeenCalled();
    });
  });

  describe('trimHistoryFile', () => {
    it('does nothing when file does not exist', () => {
      mockFs.existsSync.mockReturnValue(false);
      trimHistoryFile();
      expect(mockFs.writeFileSync).not.toHaveBeenCalled();
    });

    it('does nothing when within limit', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('a\nb\nc\n');
      trimHistoryFile();
      expect(mockFs.writeFileSync).not.toHaveBeenCalled();
    });

    it('trims when over limit', () => {
      mockFs.existsSync.mockReturnValue(true);
      const lines = Array.from({ length: 600 }, (_, i) => `line${i}`);
      mockFs.readFileSync.mockReturnValue(lines.join('\n'));
      trimHistoryFile();
      expect(mockFs.writeFileSync).toHaveBeenCalled();
      const written = mockFs.writeFileSync.mock.calls[0][1] as string;
      expect(written.split('\n').filter(Boolean).length).toBe(500);
    });
  });
});
