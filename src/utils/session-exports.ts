import path from 'node:path';
import fs from 'node:fs';
import { getSessionsDir, sanitizeSessionId } from '../session.js';

export function getSessionExportPath(sessionId: string): string {
  return path.join(getSessionsDir(), sanitizeSessionId(sessionId), 'exports');
}

export function resolveExportFilePath(sessionId: string, filename: string): string {
  if (!filename) throw new Error('Missing export filename.');
  const exportDir = getSessionExportPath(sessionId);
  const resolvedDir = path.resolve(exportDir);
  const resolvedPath = path.resolve(exportDir, filename);
  if (
    !filename ||
    filename.includes(path.sep) ||
    filename.includes('/') ||
    filename.includes('\\') ||
    filename.includes('\0') ||
    resolvedPath === resolvedDir
  ) {
    throw new Error('Invalid export filename.');
  }

  const relative = path.relative(resolvedDir, resolvedPath);
  if (relative === '..' || relative.startsWith(`..${path.sep}`)) {
    throw new Error('Invalid export filename.');
  }

  if (resolvedPath === resolvedDir) {
    throw new Error('Invalid export filename.');
  }

  if (fs.existsSync(resolvedDir)) {
    try {
      const dirStat = fs.lstatSync(resolvedDir);
      if (!dirStat.isDirectory() || dirStat.isSymbolicLink()) {
        throw new Error('Invalid export filename.');
      }
    } catch (err) {
      if (err instanceof Error && (err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
    }
  }

  try {
    const fileStat = fs.lstatSync(resolvedPath);
    if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
      throw new Error('Invalid export filename.');
    }
  } catch (err) {
    if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      // File doesn't exist yet. This is valid for show/delete checks.
    } else if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOTDIR') {
      throw new Error('Invalid export filename.');
    } else {
      throw err;
    }
  }

  if (!resolvedPath.startsWith(`${resolvedDir}${path.sep}`)) {
    throw new Error('Invalid export filename.');
  }

  return resolvedPath;
}
