import { describe, it, expect } from 'vitest';
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
      /Invalid export filename/
    );
    expect(() => resolveExportFilePath('default', '/etc/passwd')).toThrow(
      /Invalid export filename/
    );
  });

  it('rejects empty filenames', () => {
    expect(() => resolveExportFilePath('default', '')).toThrow(/Missing export filename/);
  });
});
