import fs from 'node:fs';
import path from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';

type ImageMimeType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

const IMAGE_MIME_TYPES: Record<string, ImageMimeType> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
};

export interface AttachmentResult {
  content: Anthropic.MessageParam['content'];
  warnings: string[];
}

interface AttachmentOptions {
  maxTextChars?: number;
  maxFileBytes?: number;
}

function getImageMimeType(filePath: string): ImageMimeType | undefined {
  const ext = path.extname(filePath).replace('.', '').toLowerCase();
  return IMAGE_MIME_TYPES[ext];
}

function readTextFile(filePath: string, maxChars: number): { text: string; truncated: boolean } | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    if (raw.length <= maxChars) return { text: raw, truncated: false };
    return { text: raw.slice(0, maxChars), truncated: true };
  } catch {
    return null;
  }
}

export function buildUserContent(
  text: string,
  attachmentPaths: string[],
  options: AttachmentOptions = {}
): AttachmentResult {
  const maxTextChars = options.maxTextChars ?? 8000;
  const maxFileBytes = options.maxFileBytes ?? 5_000_000;
  const warnings: string[] = [];

  const imageBlocks: Anthropic.ImageBlockParam[] = [];
  const attachmentNotes: string[] = [];

  for (const rawPath of attachmentPaths) {
    const filePath = path.resolve(rawPath);
    if (!fs.existsSync(filePath)) {
      warnings.push(`Attachment not found: ${filePath}`);
      continue;
    }

    const stat = fs.statSync(filePath);
    if (stat.size > maxFileBytes) {
      warnings.push(`Attachment too large (>${maxFileBytes} bytes): ${filePath}`);
      continue;
    }

    const mimeType = getImageMimeType(filePath);
    if (mimeType) {
      const data = fs.readFileSync(filePath).toString('base64');
      imageBlocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: mimeType,
          data,
        },
      });
      continue;
    }

    const textResult = readTextFile(filePath, maxTextChars);
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
