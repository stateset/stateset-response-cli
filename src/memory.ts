import path from 'node:path';
import { getStateSetDir, getSessionDir } from './session.js';
import { readTextFile, MAX_TEXT_FILE_SIZE_BYTES } from './utils/file-read.js';

function readMemoryFile(filePath: string): string | null {
  try {
    const content = readTextFile(filePath, {
      label: 'memory file',
      maxBytes: MAX_TEXT_FILE_SIZE_BYTES,
    }).trim();
    return content.length ? content : null;
  } catch {
    return null;
  }
}

export function loadMemory(sessionId: string): string {
  const globalPath = path.join(getStateSetDir(), 'MEMORY.md');
  const sessionPath = path.join(getSessionDir(sessionId), 'MEMORY.md');

  const parts: string[] = [];
  const globalMemory = readMemoryFile(globalPath);
  const sessionMemory = readMemoryFile(sessionPath);

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
