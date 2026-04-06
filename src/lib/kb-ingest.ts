/**
 * Bulk knowledge base ingestion from local files.
 *
 * Supports: .md, .txt, .json, .yaml, .yml, .csv, .html
 * Handles recursive directory traversal, chunking, and metadata extraction.
 */

import fs from 'node:fs';
import path from 'node:path';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface KbChunk {
  content: string;
  metadata: {
    source: string;
    filename: string;
    chunk_index: number;
    total_chunks: number;
    title?: string;
    content_type: string;
  };
}

export interface IngestResult {
  file: string;
  chunks: number;
  status: 'ok' | 'error';
  error?: string;
}

export interface IngestSummary {
  files_processed: number;
  files_succeeded: number;
  files_failed: number;
  total_chunks: number;
  results: IngestResult[];
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const SUPPORTED_EXTENSIONS = new Set([
  '.md',
  '.txt',
  '.json',
  '.yaml',
  '.yml',
  '.csv',
  '.html',
  '.htm',
  '.rst',
  '.tsv',
]);

const DEFAULT_CHUNK_SIZE = 2000; // characters
const DEFAULT_CHUNK_OVERLAP = 200;
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

/* ------------------------------------------------------------------ */
/*  File Discovery                                                     */
/* ------------------------------------------------------------------ */

export function discoverFiles(dirOrFile: string): string[] {
  const resolved = path.resolve(dirOrFile);

  if (!fs.existsSync(resolved)) {
    throw new Error(`Path does not exist: ${resolved}`);
  }

  const stat = fs.statSync(resolved);
  if (stat.isFile()) {
    const ext = path.extname(resolved).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) {
      throw new Error(
        `Unsupported file type: ${ext}. Supported: ${[...SUPPORTED_EXTENSIONS].join(', ')}`,
      );
    }
    return [resolved];
  }

  if (!stat.isDirectory()) {
    throw new Error(`Not a file or directory: ${resolved}`);
  }

  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (SUPPORTED_EXTENSIONS.has(ext)) {
          files.push(full);
        }
      }
    }
  };
  walk(resolved);
  return files.sort();
}

/* ------------------------------------------------------------------ */
/*  Content Extraction                                                 */
/* ------------------------------------------------------------------ */

function readFileContent(filePath: string): string {
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_FILE_SIZE) {
    throw new Error(`File too large (${(stat.size / 1024 / 1024).toFixed(1)}MB, max 5MB)`);
  }
  return fs.readFileSync(filePath, 'utf-8');
}

function extractTitle(content: string, ext: string): string | undefined {
  if (ext === '.md') {
    const match = content.match(/^#\s+(.+)$/m);
    return match?.[1]?.trim();
  }
  if (ext === '.html' || ext === '.htm') {
    const match = content.match(/<title[^>]*>([^<]+)<\/title>/i);
    return match?.[1]?.trim();
  }
  return undefined;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractText(content: string, ext: string): string {
  if (ext === '.html' || ext === '.htm') {
    return stripHtml(content);
  }
  if (ext === '.json') {
    try {
      const parsed = JSON.parse(content);
      return typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2);
    } catch {
      return content;
    }
  }
  if (ext === '.csv' || ext === '.tsv') {
    return content; // Keep tabular format for context
  }
  return content;
}

/* ------------------------------------------------------------------ */
/*  Chunking                                                           */
/* ------------------------------------------------------------------ */

export function chunkText(
  text: string,
  opts: { chunkSize?: number; overlap?: number } = {},
): string[] {
  const chunkSize = opts.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const overlap = opts.overlap ?? DEFAULT_CHUNK_OVERLAP;

  if (text.length <= chunkSize) {
    return [text];
  }

  // Try to split on markdown headings or double newlines first
  const sections = text.split(/(?=^#{1,3}\s|\n\n)/m).filter((s) => s.trim().length > 0);

  const chunks: string[] = [];
  let current = '';

  for (const section of sections) {
    if (current.length + section.length <= chunkSize) {
      current += section;
    } else {
      if (current.trim()) {
        chunks.push(current.trim());
      }
      // If single section is bigger than chunkSize, split by characters with overlap
      if (section.length > chunkSize) {
        let offset = 0;
        while (offset < section.length) {
          const end = Math.min(offset + chunkSize, section.length);
          chunks.push(section.slice(offset, end).trim());
          offset = end - overlap;
          if (offset >= section.length) break;
        }
        current = '';
      } else {
        current = section;
      }
    }
  }
  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks.filter((c) => c.length > 0);
}

/* ------------------------------------------------------------------ */
/*  Process a single file                                              */
/* ------------------------------------------------------------------ */

export function processFile(
  filePath: string,
  basePath: string,
  opts?: { chunkSize?: number; overlap?: number },
): KbChunk[] {
  const ext = path.extname(filePath).toLowerCase();
  const raw = readFileContent(filePath);
  const text = extractText(raw, ext);
  const title = extractTitle(raw, ext);
  const relativePath = path.relative(basePath, filePath);

  const textChunks = chunkText(text, opts);

  return textChunks.map((content, index) => ({
    content,
    metadata: {
      source: relativePath,
      filename: path.basename(filePath),
      chunk_index: index,
      total_chunks: textChunks.length,
      title,
      content_type: ext.replace('.', ''),
    },
  }));
}

/* ------------------------------------------------------------------ */
/*  Process directory/file and return chunks                           */
/* ------------------------------------------------------------------ */

export function processPath(
  inputPath: string,
  opts?: { chunkSize?: number; overlap?: number },
): { chunks: KbChunk[]; results: IngestResult[] } {
  const files = discoverFiles(inputPath);
  const basePath = fs.statSync(inputPath).isDirectory() ? inputPath : path.dirname(inputPath);

  const allChunks: KbChunk[] = [];
  const results: IngestResult[] = [];

  for (const file of files) {
    try {
      const chunks = processFile(file, basePath, opts);
      allChunks.push(...chunks);
      results.push({
        file: path.relative(basePath, file),
        chunks: chunks.length,
        status: 'ok',
      });
    } catch (err) {
      results.push({
        file: path.relative(basePath, file),
        chunks: 0,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { chunks: allChunks, results };
}
