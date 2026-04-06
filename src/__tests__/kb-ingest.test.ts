import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { chunkText, discoverFiles, processFile, processPath } from '../lib/kb-ingest.js';

describe('kb-ingest', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-ingest-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('chunkText', () => {
    it('returns single chunk for short text', () => {
      const chunks = chunkText('Hello world', { chunkSize: 2000 });
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toBe('Hello world');
    });

    it('splits long text into multiple chunks', () => {
      const text = 'A'.repeat(5000);
      const chunks = chunkText(text, { chunkSize: 2000, overlap: 200 });
      expect(chunks.length).toBeGreaterThan(1);
      // Each chunk should be <= chunkSize
      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(2000);
      }
    });

    it('splits on paragraph boundaries when possible', () => {
      const text = ['First paragraph.', '', 'Second paragraph.', '', 'Third paragraph.'].join('\n');
      const chunks = chunkText(text, { chunkSize: 2000 });
      expect(chunks).toHaveLength(1); // All fits in one chunk
    });

    it('handles empty text', () => {
      const chunks = chunkText('', { chunkSize: 2000 });
      expect(chunks).toHaveLength(0);
    });

    it('respects markdown heading boundaries', () => {
      const sections = Array.from({ length: 5 }, (_, i) => `# Section ${i}\n${'x'.repeat(500)}`);
      const text = sections.join('\n\n');
      const chunks = chunkText(text, { chunkSize: 600 });
      expect(chunks.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('discoverFiles', () => {
    it('discovers supported files in a directory', () => {
      fs.writeFileSync(path.join(tmpDir, 'doc.md'), '# Test');
      fs.writeFileSync(path.join(tmpDir, 'data.json'), '{}');
      fs.writeFileSync(path.join(tmpDir, 'binary.exe'), 'nope');

      const files = discoverFiles(tmpDir);
      expect(files).toHaveLength(2);
      expect(files.some((f) => f.endsWith('.md'))).toBe(true);
      expect(files.some((f) => f.endsWith('.json'))).toBe(true);
    });

    it('recurses into subdirectories', () => {
      const sub = path.join(tmpDir, 'sub');
      fs.mkdirSync(sub);
      fs.writeFileSync(path.join(sub, 'nested.txt'), 'hello');

      const files = discoverFiles(tmpDir);
      expect(files).toHaveLength(1);
      expect(files[0]).toContain('nested.txt');
    });

    it('skips hidden directories and node_modules', () => {
      const hidden = path.join(tmpDir, '.hidden');
      const nm = path.join(tmpDir, 'node_modules');
      fs.mkdirSync(hidden);
      fs.mkdirSync(nm);
      fs.writeFileSync(path.join(hidden, 'secret.md'), 'nope');
      fs.writeFileSync(path.join(nm, 'dep.md'), 'nope');
      fs.writeFileSync(path.join(tmpDir, 'visible.md'), 'yes');

      const files = discoverFiles(tmpDir);
      expect(files).toHaveLength(1);
      expect(files[0]).toContain('visible.md');
    });

    it('handles a single file', () => {
      const file = path.join(tmpDir, 'single.md');
      fs.writeFileSync(file, '# Single');
      const files = discoverFiles(file);
      expect(files).toEqual([file]);
    });

    it('throws for unsupported single file', () => {
      const file = path.join(tmpDir, 'binary.exe');
      fs.writeFileSync(file, 'nope');
      expect(() => discoverFiles(file)).toThrow('Unsupported file type');
    });

    it('throws for non-existent path', () => {
      expect(() => discoverFiles('/nonexistent/path')).toThrow('does not exist');
    });
  });

  describe('processFile', () => {
    it('processes a markdown file into chunks', () => {
      const file = path.join(tmpDir, 'doc.md');
      fs.writeFileSync(file, '# Title\n\nSome content here.');

      const chunks = processFile(file, tmpDir);
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0].metadata.filename).toBe('doc.md');
      expect(chunks[0].metadata.source).toBe('doc.md');
      expect(chunks[0].metadata.content_type).toBe('md');
      expect(chunks[0].metadata.title).toBe('Title');
    });

    it('processes a JSON file', () => {
      const file = path.join(tmpDir, 'data.json');
      fs.writeFileSync(file, JSON.stringify({ key: 'value' }));

      const chunks = processFile(file, tmpDir);
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0].metadata.content_type).toBe('json');
    });

    it('strips HTML tags from HTML files', () => {
      const file = path.join(tmpDir, 'page.html');
      fs.writeFileSync(file, '<html><body><p>Hello <b>World</b></p></body></html>');

      const chunks = processFile(file, tmpDir);
      expect(chunks[0].content).toContain('Hello');
      expect(chunks[0].content).toContain('World');
      expect(chunks[0].content).not.toContain('<p>');
    });

    it('extracts title from HTML', () => {
      const file = path.join(tmpDir, 'titled.html');
      fs.writeFileSync(
        file,
        '<html><head><title>My Page</title></head><body>Content</body></html>',
      );

      const chunks = processFile(file, tmpDir);
      expect(chunks[0].metadata.title).toBe('My Page');
    });
  });

  describe('processPath', () => {
    it('processes a directory of files', () => {
      fs.writeFileSync(path.join(tmpDir, 'a.md'), '# File A\nContent A');
      fs.writeFileSync(path.join(tmpDir, 'b.txt'), 'File B content');

      const { chunks, results } = processPath(tmpDir);
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.status === 'ok')).toBe(true);
      expect(chunks.length).toBeGreaterThanOrEqual(2);
    });

    it('reports errors for individual files without failing', () => {
      fs.writeFileSync(path.join(tmpDir, 'good.md'), '# Good');
      // Create a file that will fail to read (symlink to nonexistent)
      const badLink = path.join(tmpDir, 'bad.md');
      fs.symlinkSync('/nonexistent/path', badLink);

      const { results } = processPath(tmpDir);
      const good = results.find((r) => r.file === 'good.md');
      const bad = results.find((r) => r.file === 'bad.md');
      expect(good?.status).toBe('ok');
      expect(bad?.status).toBe('error');
    });
  });
});
