import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { getSessionExportPath, resolveExportFilePath } from '../utils/session-exports.js';

describe('resolveExportFilePath', () => {
  it('resolves export files within the session export directory', () => {
    const sessionId = 'default';
    const exportDir = getSessionExportPath(sessionId);
    const filePath = resolveExportFilePath(sessionId, 'report.md');
    const resolvedDir = path.resolve(exportDir) + path.sep;
    expect(filePath.startsWith(resolvedDir)).toBe(true);
    expect(path.basename(filePath)).toBe('report.md');
  });

  it('rejects traversal attempts', () => {
    expect(() => resolveExportFilePath('default', '../secrets.txt')).toThrow(
      /Invalid export filename/,
    );
    expect(() => resolveExportFilePath('default', '/etc/passwd')).toThrow(
      /Invalid export filename/,
    );
  });

  it('rejects empty filenames', () => {
    expect(() => resolveExportFilePath('default', '')).toThrow(/Missing export filename/);
  });

  it('rejects symlink export files', () => {
    const exportDir = getSessionExportPath('default');
    const symlinkPath = path.join(exportDir, 'secret.md');
    const lstatMock = (candidate: fs.PathLike) => {
      if (`${candidate}` === symlinkPath) {
        return {
          isSymbolicLink: () => true,
          isFile: () => false,
          isDirectory: () => false,
        } as unknown as fs.Stats;
      }
      return {
        isSymbolicLink: () => false,
        isFile: () => false,
        isDirectory: () => true,
      } as unknown as fs.Stats;
    };
    const spy = vi.spyOn(fs, 'lstatSync').mockImplementation(lstatMock);
    try {
      expect(() => resolveExportFilePath('default', 'secret.md')).toThrow(
        /Invalid export filename/,
      );
    } finally {
      spy.mockRestore();
    }
  });
});
