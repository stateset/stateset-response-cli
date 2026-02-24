/**
 * Tests for attachments - buildUserContent
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockReadTextFile } = vi.hoisted(() => ({
  mockReadTextFile: vi.fn(),
}));

vi.mock('node:fs', () => ({
  default: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    statSync: vi.fn(),
    lstatSync: vi.fn(),
    realpathSync: vi.fn((p: string) => p),
  },
}));

vi.mock('../utils/file-read.js', () => ({
  readTextFile: (...args: unknown[]) => mockReadTextFile(...args),
  MAX_TEXT_FILE_SIZE_BYTES: 1_048_576,
}));

import fs from 'node:fs';
import path from 'node:path';
import { buildUserContent } from '../attachments.js';

const mockedFs = vi.mocked(fs);

function makeFileStats(size: number) {
  return {
    size,
    isFile: () => true,
    isSymbolicLink: () => false,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockReadTextFile.mockImplementation((filePath: string) =>
    String(mockedFs.readFileSync(filePath, 'utf-8')),
  );
  mockedFs.lstatSync.mockImplementation((p: any) => mockedFs.statSync(p as any) as any);
  mockedFs.realpathSync.mockImplementation((p: any) => String(p));
});

describe('buildUserContent', () => {
  it('returns a single text block for text-only input (no attachments)', () => {
    const result = buildUserContent('Hello world', []);

    expect(result.warnings).toHaveLength(0);
    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toEqual({
      type: 'text',
      text: 'Hello world',
    });
  });

  it('returns text + image block for a .png attachment', () => {
    const filePath = '/tmp/image.png';
    const fakeData = Buffer.from('pngdata');

    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.statSync.mockReturnValue(makeFileStats(100) as any);
    mockedFs.readFileSync.mockReturnValue(fakeData as any);

    const result = buildUserContent('Look at this', [filePath]);

    expect(result.warnings).toHaveLength(0);
    expect(result.content).toHaveLength(2);
    expect(result.content[0]).toEqual({
      type: 'text',
      text: 'Look at this',
    });
    expect(result.content[1]).toEqual({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: fakeData.toString('base64'),
      },
    });
  });

  it('uses media_type image/jpeg for .jpg attachment', () => {
    const filePath = '/tmp/photo.jpg';
    const fakeData = Buffer.from('jpgdata');

    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.statSync.mockReturnValue(makeFileStats(100) as any);
    mockedFs.readFileSync.mockReturnValue(fakeData as any);

    const result = buildUserContent('check', [filePath]);

    expect(result.warnings).toHaveLength(0);
    const imageBlock = result.content[1] as any;
    expect(imageBlock.source.media_type).toBe('image/jpeg');
  });

  it('uses media_type image/jpeg for .jpeg attachment', () => {
    const filePath = '/tmp/photo.jpeg';
    const fakeData = Buffer.from('jpegdata');

    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.statSync.mockReturnValue(makeFileStats(100) as any);
    mockedFs.readFileSync.mockReturnValue(fakeData as any);

    const result = buildUserContent('check', [filePath]);

    expect(result.warnings).toHaveLength(0);
    const imageBlock = result.content[1] as any;
    expect(imageBlock.source.media_type).toBe('image/jpeg');
  });

  it('uses media_type image/gif for .gif attachment', () => {
    const filePath = '/tmp/anim.gif';
    const fakeData = Buffer.from('gifdata');

    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.statSync.mockReturnValue(makeFileStats(100) as any);
    mockedFs.readFileSync.mockReturnValue(fakeData as any);

    const result = buildUserContent('check', [filePath]);

    expect(result.warnings).toHaveLength(0);
    const imageBlock = result.content[1] as any;
    expect(imageBlock.source.media_type).toBe('image/gif');
  });

  it('uses media_type image/webp for .webp attachment', () => {
    const filePath = '/tmp/photo.webp';
    const fakeData = Buffer.from('webpdata');

    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.statSync.mockReturnValue(makeFileStats(100) as any);
    mockedFs.readFileSync.mockReturnValue(fakeData as any);

    const result = buildUserContent('check', [filePath]);

    expect(result.warnings).toHaveLength(0);
    const imageBlock = result.content[1] as any;
    expect(imageBlock.source.media_type).toBe('image/webp');
  });

  it('appends text file content in <attachments> section', () => {
    const filePath = '/tmp/notes.txt';
    const resolved = path.resolve(filePath);
    const fileContent = 'These are my notes.';

    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.statSync.mockReturnValue(makeFileStats(50) as any);
    mockedFs.readFileSync.mockReturnValue(fileContent as any);

    const result = buildUserContent('Read this', [filePath]);

    expect(result.warnings).toHaveLength(0);
    expect(result.content).toHaveLength(1);
    const textBlock = result.content[0] as any;
    expect(textBlock.type).toBe('text');
    expect(textBlock.text).toContain('Read this');
    expect(textBlock.text).toContain('<attachments>');
    expect(textBlock.text).toContain('File: ' + resolved);
    expect(textBlock.text).toContain(fileContent);
    expect(textBlock.text).toContain('</attachments>');
  });

  it('adds warning when file is not found (does not throw)', () => {
    const filePath = '/tmp/missing.txt';
    const resolved = path.resolve(filePath);

    mockedFs.existsSync.mockReturnValue(false);

    const result = buildUserContent('Hello', [filePath]);

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('Attachment not found');
    expect(result.warnings[0]).toContain(resolved);
    expect(result.content).toHaveLength(1);
    expect((result.content[0] as any).text).toBe('Hello');
  });

  it('warns when attachment path is blank', () => {
    const result = buildUserContent('Hello', ['  ']);

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toBe('Attachment path is empty');
    expect(result.content).toHaveLength(1);
    expect((result.content[0] as any).text).toBe('Hello');
  });

  it('adds warning when file is too large', () => {
    const filePath = '/tmp/huge.txt';
    const resolved = path.resolve(filePath);
    const maxBytes = 5_000_000;

    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.statSync.mockReturnValue(makeFileStats(maxBytes + 1) as any);

    const result = buildUserContent('Hello', [filePath]);

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('too large');
    expect(result.warnings[0]).toContain(resolved);
    expect(result.content).toHaveLength(1);
    expect((result.content[0] as any).text).toBe('Hello');
  });

  it('adds warning when image attachment cannot be read', () => {
    const filePath = '/tmp/unreadable-image.png';

    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.statSync.mockReturnValue(makeFileStats(200) as any);
    mockedFs.readFileSync.mockImplementation(() => {
      throw new Error('permission denied');
    });

    const result = buildUserContent('Hello', [filePath]);

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('could not be read');
    expect(result.warnings[0]).toContain(filePath);
    expect(result.content).toHaveLength(1);
    expect((result.content[0] as any).text).toBe('Hello');
  });

  it('respects custom maxFileBytes option', () => {
    const filePath = '/tmp/medium.txt';

    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.statSync.mockReturnValue(makeFileStats(500) as any);

    const result = buildUserContent('Hello', [filePath], { maxFileBytes: 100 });

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('too large');
  });

  it('handles multiple mixed attachments', () => {
    const imagePath = '/tmp/photo.png';
    const textPath = '/tmp/notes.txt';
    const missingPath = '/tmp/gone.txt';
    const resolvedText = path.resolve(textPath);
    const resolvedMissing = path.resolve(missingPath);

    const fakeImageData = Buffer.from('imgbytes');
    const fakeTextContent = 'note content here';

    mockedFs.existsSync.mockImplementation((p: any) => {
      const s = String(p);
      if (s === resolvedMissing) return false;
      return true;
    });

    mockedFs.statSync.mockReturnValue(makeFileStats(200) as any);

    mockedFs.readFileSync.mockImplementation((p: any, encoding?: any) => {
      const s = String(p);
      if (s.endsWith('.png')) return fakeImageData as any;
      if (encoding === 'utf-8') return fakeTextContent as any;
      return fakeTextContent as any;
    });

    const result = buildUserContent('Multi', [imagePath, textPath, missingPath]);

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('not found');

    expect(result.content).toHaveLength(2);

    const textBlock = result.content[0] as any;
    expect(textBlock.type).toBe('text');
    expect(textBlock.text).toContain('Multi');
    expect(textBlock.text).toContain('<attachments>');
    expect(textBlock.text).toContain('File: ' + resolvedText);
    expect(textBlock.text).toContain(fakeTextContent);

    const imageBlock = result.content[1] as any;
    expect(imageBlock.type).toBe('image');
    expect(imageBlock.source.media_type).toBe('image/png');
    expect(imageBlock.source.data).toBe(fakeImageData.toString('base64'));
  });

  it('marks truncated text files when content exceeds maxTextChars', () => {
    const filePath = '/tmp/long.txt';
    const resolved = path.resolve(filePath);
    const longText = 'A'.repeat(200);

    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.statSync.mockReturnValue(makeFileStats(200) as any);
    mockedFs.readFileSync.mockReturnValue(longText as any);

    const result = buildUserContent('Check', [filePath], { maxTextChars: 50 });

    expect(result.warnings).toHaveLength(0);
    const textBlock = result.content[0] as any;
    expect(textBlock.text).toContain('(truncated)');
    expect(textBlock.text).toContain('File: ' + resolved);
    expect(textBlock.text).toContain('A'.repeat(50));
  });
});

describe('buildUserContent - cwd path restriction', () => {
  it('allows attachment inside the working directory when cwd is set', () => {
    const cwd = '/home/user/project';
    const filePath = '/home/user/project/file.txt';
    const fileContent = 'safe content';

    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.statSync.mockReturnValue(makeFileStats(50) as any);
    mockedFs.readFileSync.mockReturnValue(fileContent as any);

    const result = buildUserContent('Read this', [filePath], { cwd });

    expect(result.warnings).toHaveLength(0);
    const textBlock = result.content[0] as any;
    expect(textBlock.type).toBe('text');
    expect(textBlock.text).toContain(fileContent);
    expect(textBlock.text).toContain('<attachments>');
  });

  it('resolves relative attachments against the provided working directory', () => {
    const cwd = '/home/user/project';
    const filePath = 'notes.txt';
    const resolvedPath = path.resolve(cwd, filePath);
    const fileContent = 'relative content';

    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.statSync.mockReturnValue(makeFileStats(50) as any);
    mockedFs.readFileSync.mockReturnValue(fileContent as any);

    const result = buildUserContent('Read this', [filePath], { cwd });

    expect(result.warnings).toHaveLength(0);
    const textBlock = result.content[0] as any;
    expect(textBlock.type).toBe('text');
    expect(textBlock.text).toContain('Read this');
    expect(textBlock.text).toContain('File: ' + resolvedPath);
    expect(textBlock.text).toContain(fileContent);
  });

  it('rejects cwd-relative symlink that resolves outside the working directory', () => {
    const cwd = '/home/user/project';
    const filePath = 'outside-link';
    const resolvedPath = path.resolve(cwd, filePath);

    const realpathFn = vi.fn((value: string) => {
      if (value === path.resolve(cwd)) return '/mnt/storage/secure';
      if (value === resolvedPath) return '/etc/secret.txt';
      return value;
    });
    (mockedFs as unknown as { realpathSync: typeof fs.realpathSync }).realpathSync = Object.assign(
      realpathFn,
      { native: realpathFn },
    ) as unknown as typeof fs.realpathSync;

    const result = buildUserContent('Read this', [filePath], { cwd });

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('Attachment outside working directory');
    expect(result.warnings[0]).toContain(filePath);
    const textBlock = result.content[0] as any;
    expect(textBlock.text).toBe('Read this');
  });

  it('warns when attachment realpath verification fails', () => {
    const cwd = '/home/user/project';
    const filePath = 'broken-link.txt';
    const resolvedPath = path.resolve(cwd, filePath);

    const realpathFn2 = vi.fn().mockImplementation((value: string) => {
      if (value === path.resolve(cwd)) {
        return '/home/user/project';
      }
      if (value === resolvedPath) {
        throw new Error('No such file');
      }
      return value;
    });
    (mockedFs as unknown as { realpathSync: typeof fs.realpathSync }).realpathSync = Object.assign(
      realpathFn2,
      { native: realpathFn2 },
    ) as unknown as typeof fs.realpathSync;

    const result = buildUserContent('Check', [filePath], { cwd });

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('could not be verified');
    expect(result.warnings[0]).toContain(filePath);
    const textBlock = result.content[0] as any;
    expect(textBlock.text).toBe('Check');
  });

  it('rejects attachment outside the working directory when cwd is set', () => {
    const cwd = '/home/user/project';
    const filePath = '/etc/passwd';

    const result = buildUserContent('Read this', [filePath], { cwd });

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('Attachment outside working directory');
    expect(result.warnings[0]).toContain('/etc/passwd');
    // File should not be included in content
    expect(result.content).toHaveLength(1);
    const textBlock = result.content[0] as any;
    expect(textBlock.text).toBe('Read this');
  });

  it('does not restrict paths when cwd is not provided', () => {
    const filePath = '/etc/some-file.txt';
    const fileContent = 'some content';

    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.statSync.mockReturnValue(makeFileStats(50) as any);
    mockedFs.readFileSync.mockReturnValue(fileContent as any);

    const result = buildUserContent('Read this', [filePath]);

    expect(result.warnings).toHaveLength(0);
    const textBlock = result.content[0] as any;
    expect(textBlock.text).toContain(fileContent);
  });
});
