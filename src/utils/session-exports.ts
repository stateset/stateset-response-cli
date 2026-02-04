import path from 'node:path';
import { getSessionsDir, sanitizeSessionId } from '../session.js';

export function getSessionExportPath(sessionId: string): string {
  return path.join(getSessionsDir(), sanitizeSessionId(sessionId), 'exports');
}

export function resolveExportFilePath(sessionId: string, filename: string): string {
  if (!filename) throw new Error('Missing export filename.');
  const exportDir = getSessionExportPath(sessionId);
  const resolvedDir = path.resolve(exportDir);
  const resolvedPath = path.resolve(exportDir, filename);
  if (resolvedPath === resolvedDir || !resolvedPath.startsWith(resolvedDir + path.sep)) {
    throw new Error('Invalid export filename.');
  }
  return resolvedPath;
}
