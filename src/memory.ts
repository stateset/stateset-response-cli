import fs from 'node:fs';
import path from 'node:path';
import { getStateSetDir, getSessionDir } from './session.js';

function readIfExists(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const content = fs.readFileSync(filePath, 'utf-8').trim();
    return content.length ? content : null;
  } catch {
    return null;
  }
}

export function loadMemory(sessionId: string): string {
  const globalPath = path.join(getStateSetDir(), 'MEMORY.md');
  const sessionPath = path.join(getSessionDir(sessionId), 'MEMORY.md');

  const parts: string[] = [];
  const globalMemory = readIfExists(globalPath);
  const sessionMemory = readIfExists(sessionPath);

  if (globalMemory) {
    parts.push(`### Global Memory\n${globalMemory}`);
  }
  if (sessionMemory) {
    parts.push(`### Session Memory\n${sessionMemory}`);
  }

  if (parts.length === 0) {
    return '';
  }

  return parts.join('\n\n');
}
