import fs from 'node:fs';
import path from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import { readTextFile, MAX_TEXT_FILE_SIZE_BYTES } from './utils/file-read.js';

const DEFAULT_MAX_TEXT_CHARS = 8000;
const DEFAULT_MAX_FILE_BYTES = 5_000_000;

type ImageMimeType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

const IMAGE_MIME_TYPES: Record<string, ImageMimeType> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
};

/** The assembled message content blocks and any warnings from skipped attachments. */
export interface AttachmentResult {
  content: Anthropic.MessageParam['content'];
  warnings: string[];
}

interface AttachmentOptions {
  maxTextChars?: number;
  maxFileBytes?: number;
  cwd?: string;
}

function getImageMimeType(filePath: string): ImageMimeType | undefined {
  const ext = path.extname(filePath).replace('.', '').toLowerCase();
  return IMAGE_MIME_TYPES[ext];
}

function readAttachmentText(
  filePath: string,
  maxChars: number,
  maxBytes: number,
): { text: string; truncated: boolean } | null {
  try {
    const raw = readTextFile(filePath, { label: `attachment ${filePath}`, maxBytes });
    if (raw.length <= maxChars) return { text: raw, truncated: false };
    return { text: raw.slice(0, maxChars), truncated: true };
  } catch {
    return null;
  }
}

function readBinaryFile(filePath: string): Buffer | null {
  try {
    const stats = fs.lstatSync(filePath);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      return null;
    }
    return fs.readFileSync(filePath);
  } catch {
    return null;
  }
}

function resolveAttachmentPath(
  rawPath: string,
  resolvedCwd: string | null,
): { filePath: string; warnings: string[] } {
  const warnings: string[] = [];
  const requestedPath = path.resolve(resolvedCwd ?? process.cwd(), rawPath);

  if (!resolvedCwd) {
    return { filePath: requestedPath, warnings };
  }

  const canResolvePath = typeof fs.realpathSync === 'function';
  const cwdForCheck = canResolvePath && resolvedCwd ? safeRealpath(resolvedCwd) : resolvedCwd;
  if (!cwdForCheck) {
    warnings.push(`Attachment outside working directory: ${rawPath}`);
    return { filePath: requestedPath, warnings };
  }

  let candidatePath = requestedPath;
  if (canResolvePath) {
    const maybeReal = safeRealpath(requestedPath);
    if (!maybeReal) {
      // Reject unresolvable paths entirely — they could be dangling symlinks
      // or files outside the boundary. Never fall back to unresolved paths.
      warnings.push(`Attachment rejected (path could not be resolved): ${rawPath}`);
      return { filePath: '', warnings };
    }
    candidatePath = maybeReal;
  }

  const rel = path.relative(cwdForCheck, candidatePath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    warnings.push(`Attachment outside working directory: ${rawPath}`);
    return { filePath: '', warnings };
  }

  return { filePath: candidatePath, warnings };
}

function safeRealpath(value: string): string | null {
  try {
    return fs.realpathSync(value);
  } catch {
    return null;
  }
}

/**
 * Merges user text with file attachments into Anthropic message content blocks.
 * Images are base64-encoded as image blocks; text files are inlined in an
 * `<attachments>` section. Files outside `cwd` are rejected for safety.
 */
export function buildUserContent(
  text: string,
  attachmentPaths: string[],
  options: AttachmentOptions = {},
): AttachmentResult {
  const maxTextChars = options.maxTextChars ?? DEFAULT_MAX_TEXT_CHARS;
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const warnings: string[] = [];

  const imageBlocks: Anthropic.ImageBlockParam[] = [];
  const attachmentNotes: string[] = [];

  const resolvedCwd = options.cwd ? path.resolve(options.cwd) : null;

  for (const rawPath of attachmentPaths) {
    const trimmedPath = rawPath.trim();
    if (!trimmedPath) {
      warnings.push('Attachment path is empty');
      continue;
    }

    const { filePath, warnings: pathWarnings } = resolveAttachmentPath(trimmedPath, resolvedCwd);
    if (pathWarnings.length > 0 || !filePath) {
      warnings.push(...pathWarnings);
      continue;
    }

    if (!fs.existsSync(filePath)) {
      warnings.push(`Attachment not found: ${filePath}`);
      continue;
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch {
      warnings.push(`Attachment could not be read: ${filePath}`);
      continue;
    }

    if (stat.size > maxFileBytes) {
      warnings.push(`Attachment too large (>${maxFileBytes} bytes): ${filePath}`);
      continue;
    }

    const mimeType = getImageMimeType(filePath);
    if (mimeType) {
      const data = readBinaryFile(filePath);
      if (!data) {
        warnings.push(`Attachment could not be read: ${filePath}`);
        continue;
      }
      imageBlocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: mimeType,
          data: data.toString('base64'),
        },
      });
      continue;
    }

    const maxTextReadBytes = Math.min(maxFileBytes, MAX_TEXT_FILE_SIZE_BYTES);
    const textResult = readAttachmentText(filePath, maxTextChars, maxTextReadBytes);
    if (textResult) {
      const header = `File: ${filePath}` + (textResult.truncated ? ' (truncated)' : '');
      attachmentNotes.push(`${header}\n\n${textResult.text}`);
    } else {
      attachmentNotes.push(`File: ${filePath} (binary or unreadable)`);
    }
  }

  const attachmentSection = attachmentNotes.length
    ? `\n\n<attachments>\n${attachmentNotes.join('\n\n---\n\n')}\n</attachments>`
    : '';

  const textBlock: Anthropic.TextBlockParam = {
    type: 'text',
    text: `${text}${attachmentSection}`,
  };

  const content: Anthropic.MessageParam['content'] = [textBlock, ...imageBlocks];

  return { content, warnings };
}
