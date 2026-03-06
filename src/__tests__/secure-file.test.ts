import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';

const {
  mockExistsSync,
  mockLstatSync,
  mockMkdirSync,
  mockChmodSync,
  mockWriteFileSync,
  mockRenameSync,
  mockUnlinkSync,
  mockOpenSync,
  mockFstatSync,
  mockWriteSync,
  mockFchmodSync,
  mockCloseSync,
} = vi.hoisted(() => ({
  mockExistsSync: vi.fn((_path?: any) => false as any),
  mockLstatSync: vi.fn(
    (_path?: any) =>
      ({
        isSymbolicLink: () => false,
        isDirectory: () => true,
      }) as any,
  ),
  mockMkdirSync: vi.fn((_path?: any, _opts?: any) => undefined as any),
  mockChmodSync: vi.fn((_path?: any, _mode?: any) => undefined as any),
  mockWriteFileSync: vi.fn((_path?: any, _content?: any, _opts?: any) => undefined as any),
  mockRenameSync: vi.fn((_oldPath?: any, _newPath?: any) => undefined as any),
  mockUnlinkSync: vi.fn((_path?: any) => undefined as any),
  mockOpenSync: vi.fn((_path?: any, _flags?: any, _mode?: any) => 99 as any),
  mockFstatSync: vi.fn(
    (_fd?: any) =>
      ({
        isFile: () => true,
      }) as any,
  ),
  mockWriteSync: vi.fn((_fd?: any, _line?: any, _position?: any, _encoding?: any) => 0 as any),
  mockFchmodSync: vi.fn((_fd?: any, _mode?: any) => undefined as any),
  mockCloseSync: vi.fn((_fd?: any) => undefined as any),
}));

vi.mock('node:fs', () => ({
  default: {
    constants: {
      O_APPEND: 0x0008,
      O_CREAT: 0x0040,
      O_WRONLY: 0x0001,
      O_NOFOLLOW: 0x20000,
    },
    existsSync: mockExistsSync,
    lstatSync: mockLstatSync,
    mkdirSync: mockMkdirSync,
    chmodSync: mockChmodSync,
    writeFileSync: mockWriteFileSync,
    renameSync: mockRenameSync,
    unlinkSync: mockUnlinkSync,
    openSync: mockOpenSync,
    fstatSync: mockFstatSync,
    writeSync: mockWriteSync,
    fchmodSync: mockFchmodSync,
    closeSync: mockCloseSync,
  },
}));

import {
  appendLineSecure,
  ensurePrivateDirectory,
  writePrivateTextFileSecure,
} from '../utils/secure-file.js';

describe('appendLineSecure', () => {
  const originalConstants = (fs as unknown as { constants?: Record<string, number> }).constants;

  beforeEach(() => {
    vi.clearAllMocks();
    (fs as unknown as { constants?: Record<string, number> }).constants = {
      O_APPEND: 0x0008,
      O_CREAT: 0x0040,
      O_WRONLY: 0x0001,
      O_NOFOLLOW: 0x20000,
    };
    mockExistsSync.mockReturnValue(false);
    mockLstatSync.mockReturnValue({
      isSymbolicLink: () => false,
      isDirectory: () => true,
    } as any);
    mockOpenSync.mockReturnValue(99 as any);
    mockFstatSync.mockReturnValue({
      isFile: () => true,
    } as any);
  });

  afterEach(() => {
    (fs as unknown as { constants?: Record<string, number> }).constants = originalConstants;
  });

  it('uses O_NOFOLLOW when available', () => {
    const expectedFlags = 0x0008 | 0x0040 | 0x0001 | 0x20000;
    appendLineSecure('/tmp/test.log', 'line\n');
    expect(mockOpenSync).toHaveBeenCalledWith('/tmp/test.log', expectedFlags, 0o600);
    expect(mockWriteSync).toHaveBeenCalledWith(99, 'line\n', undefined, 'utf-8');
    expect(mockFchmodSync).toHaveBeenCalledWith(99, 0o600);
    expect(mockCloseSync).toHaveBeenCalledWith(99);
  });

  it('falls back when O_NOFOLLOW is unsupported', () => {
    const expectedNoFollowFlags = 0x0008 | 0x0040 | 0x0001 | 0x20000;
    const expectedBaseFlags = 0x0008 | 0x0040 | 0x0001;
    const unsupported = Object.assign(new Error('unsupported'), {
      code: 'EINVAL',
    });
    mockOpenSync.mockImplementationOnce(() => {
      throw unsupported;
    });

    appendLineSecure('/tmp/fallback.log', 'line\n');

    expect(mockOpenSync).toHaveBeenNthCalledWith(
      1,
      '/tmp/fallback.log',
      expectedNoFollowFlags,
      0o600,
    );
    expect(mockOpenSync).toHaveBeenNthCalledWith(2, '/tmp/fallback.log', expectedBaseFlags, 0o600);
    expect(mockWriteSync).toHaveBeenCalledWith(99, 'line\n', undefined, 'utf-8');
  });

  it('rejects symlink targets in fallback mode', () => {
    const unsupported = Object.assign(new Error('unsupported'), {
      code: 'EINVAL',
    });
    mockOpenSync.mockImplementationOnce(() => {
      throw unsupported;
    });
    mockExistsSync.mockImplementation((target?: any) => {
      const text = typeof target === 'string' ? target : '';
      return text === '/tmp' || text === '/tmp/symlink.log';
    });
    mockLstatSync.mockImplementation((target?: any) => {
      const text = typeof target === 'string' ? target : '';
      if (text === '/tmp') {
        return {
          isSymbolicLink: () => false,
          isDirectory: () => true,
          isFile: () => false,
        } as any;
      }
      return {
        isSymbolicLink: () => true,
        isDirectory: () => false,
        isFile: () => false,
      } as any;
    });

    expect(() =>
      appendLineSecure('/tmp/symlink.log', 'line\n', {
        symlinkErrorPrefix: 'Symlink blocked',
      }),
    ).toThrow('Symlink blocked: /tmp/symlink.log');
    expect(mockOpenSync).toHaveBeenCalledTimes(1);
  });

  it('rejects append targets with symlinked parent paths', () => {
    mockExistsSync.mockImplementation((target?: any) => {
      const text = typeof target === 'string' ? target : '';
      return text === '/tmp' || text === '/tmp/link';
    });
    mockLstatSync.mockImplementation((target?: any) => {
      const text = typeof target === 'string' ? target : '';
      if (text === '/tmp') {
        return {
          isSymbolicLink: () => false,
          isDirectory: () => true,
          isFile: () => false,
        } as any;
      }
      if (text === '/tmp/link') {
        return {
          isSymbolicLink: () => true,
          isDirectory: () => false,
          isFile: () => false,
        } as any;
      }
      return {
        isSymbolicLink: () => false,
        isDirectory: () => true,
        isFile: () => false,
      } as any;
    });

    expect(() => appendLineSecure('/tmp/link/test.log', 'line\n')).toThrow(
      'Refusing to write through symlinked file in path: /tmp/link',
    );
    expect(mockOpenSync).not.toHaveBeenCalled();
  });

  it('rejects non-regular files and closes descriptor', () => {
    mockFstatSync.mockReturnValue({
      isFile: () => false,
    } as any);

    expect(() => appendLineSecure('/tmp/not-regular.log', 'line\n')).toThrow(
      'Refusing to write to non-regular file: /tmp/not-regular.log',
    );
    expect(mockCloseSync).toHaveBeenCalledWith(99);
  });

  it('falls back to string append mode when constants are unavailable', () => {
    (fs as unknown as { constants?: Record<string, number> }).constants = undefined;
    appendLineSecure('/tmp/no-constants.log', 'line\n');
    expect(mockOpenSync).toHaveBeenCalledWith('/tmp/no-constants.log', 'a', 0o600);
  });
});

describe('ensurePrivateDirectory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
    mockLstatSync.mockReturnValue({
      isSymbolicLink: () => false,
      isDirectory: () => true,
    } as any);
  });

  it('creates missing directory with private mode', () => {
    ensurePrivateDirectory('/tmp/new-dir');
    expect(mockMkdirSync).toHaveBeenCalledWith('/tmp/new-dir', {
      recursive: true,
      mode: 0o700,
    });
  });

  it('rejects symlink directories', () => {
    mockExistsSync.mockImplementation((target?: any) => {
      const text = typeof target === 'string' ? target : '';
      return text === '/tmp' || text === '/tmp/link-dir';
    });
    mockLstatSync.mockImplementation((target?: any) => {
      const text = typeof target === 'string' ? target : '';
      if (text === '/tmp') {
        return {
          isSymbolicLink: () => false,
          isDirectory: () => true,
          isFile: () => false,
        } as any;
      }
      return {
        isSymbolicLink: () => true,
        isDirectory: () => false,
        isFile: () => false,
      } as any;
    });

    expect(() =>
      ensurePrivateDirectory('/tmp/link-dir', {
        symlinkErrorPrefix: 'Symlink directory blocked',
      }),
    ).toThrow('Symlink directory blocked: /tmp/link-dir');
  });

  it('rejects non-directory paths', () => {
    mockExistsSync.mockReturnValue(true);
    mockLstatSync.mockReturnValue({
      isSymbolicLink: () => false,
      isDirectory: () => false,
    } as any);

    expect(() =>
      ensurePrivateDirectory('/tmp/not-a-dir', {
        nonDirectoryErrorPrefix: 'Not a directory',
      }),
    ).toThrow('Not a directory: /tmp/not-a-dir');
  });

  it('rejects missing directories when a parent path is symlinked', () => {
    mockExistsSync.mockImplementation((target?: any) => {
      const text = typeof target === 'string' ? target : '';
      return text === '/tmp' || text === '/tmp/link';
    });
    mockLstatSync.mockImplementation((target?: any) => {
      const text = typeof target === 'string' ? target : '';
      if (text === '/tmp') {
        return {
          isSymbolicLink: () => false,
          isDirectory: () => true,
          isFile: () => false,
        } as any;
      }
      if (text === '/tmp/link') {
        return {
          isSymbolicLink: () => true,
          isDirectory: () => false,
          isFile: () => false,
        } as any;
      }
      return {
        isSymbolicLink: () => false,
        isDirectory: () => true,
        isFile: () => false,
      } as any;
    });

    expect(() =>
      ensurePrivateDirectory('/tmp/link/new-dir', {
        symlinkErrorPrefix: 'Symlink directory blocked',
      }),
    ).toThrow('Symlink directory blocked in path: /tmp/link');
    expect(mockMkdirSync).not.toHaveBeenCalled();
  });

  it('chmods existing directory to private mode', () => {
    mockExistsSync.mockReturnValue(true);
    ensurePrivateDirectory('/tmp/existing-dir');
    expect(mockChmodSync).toHaveBeenCalledWith('/tmp/existing-dir', 0o700);
  });
});

describe('writePrivateTextFileSecure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
    mockLstatSync.mockReturnValue({
      isSymbolicLink: () => false,
      isDirectory: () => true,
      isFile: () => true,
    } as any);
  });

  it('creates missing parent directories and writes private text', () => {
    writePrivateTextFileSecure('/tmp/new/nested/output.txt', 'hello');
    expect(mockMkdirSync).toHaveBeenCalledWith('/tmp/new/nested', {
      recursive: true,
      mode: 0o700,
    });
    expect(mockWriteFileSync).toHaveBeenCalledWith('/tmp/new/nested/output.txt', 'hello', {
      encoding: 'utf-8',
      mode: 0o600,
    });
    expect(mockChmodSync).toHaveBeenCalledWith('/tmp/new/nested/output.txt', 0o600);
  });

  it('supports atomic writes via temp file + rename', () => {
    writePrivateTextFileSecure('/tmp/atomic.txt', 'hello', { atomic: true });
    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
    const tmpPath = mockWriteFileSync.mock.calls[0][0] as string;
    expect(tmpPath).toContain('/tmp/atomic.txt.tmp-');
    expect(mockRenameSync).toHaveBeenCalledWith(tmpPath, '/tmp/atomic.txt');
    expect(mockChmodSync).toHaveBeenCalledWith('/tmp/atomic.txt', 0o600);
  });

  it('rejects output paths with symlink ancestors', () => {
    mockExistsSync.mockImplementation((target?: any) => {
      const text = typeof target === 'string' ? target : '';
      return text === '/tmp' || text === '/tmp/link';
    });
    mockLstatSync.mockImplementation((target?: any) => {
      const text = typeof target === 'string' ? target : '';
      if (text === '/tmp') {
        return {
          isSymbolicLink: () => false,
          isDirectory: () => true,
          isFile: () => false,
        } as any;
      }
      if (text === '/tmp/link') {
        return {
          isSymbolicLink: () => true,
          isDirectory: () => false,
          isFile: () => false,
        } as any;
      }
      return {
        isSymbolicLink: () => false,
        isDirectory: () => true,
        isFile: () => false,
      } as any;
    });

    expect(() => writePrivateTextFileSecure('/tmp/link/out.txt', 'x')).toThrow(
      /path must not include symlinks/,
    );
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it('rejects directory output targets', () => {
    mockExistsSync.mockImplementation((target?: any) => {
      const text = typeof target === 'string' ? target : '';
      return text === '/tmp/out-dir' || text === '/tmp';
    });
    mockLstatSync.mockImplementation((target?: any) => {
      const text = typeof target === 'string' ? target : '';
      if (text === '/tmp') {
        return {
          isSymbolicLink: () => false,
          isDirectory: () => true,
          isFile: () => false,
        } as any;
      }
      if (text === '/tmp/out-dir') {
        return {
          isSymbolicLink: () => false,
          isDirectory: () => true,
          isFile: () => false,
        } as any;
      }
      return {
        isSymbolicLink: () => false,
        isDirectory: () => true,
        isFile: () => false,
      } as any;
    });

    expect(() => writePrivateTextFileSecure('/tmp/out-dir', 'x')).toThrow(
      /must not be a directory/,
    );
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });
});
