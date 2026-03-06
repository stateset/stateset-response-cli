import fs from 'node:fs';
import path from 'node:path';

export interface AppendLineSecureOptions {
  symlinkErrorPrefix?: string;
  nonRegularFileErrorPrefix?: string;
}

export interface EnsurePrivateDirectoryOptions {
  symlinkErrorPrefix?: string;
  nonDirectoryErrorPrefix?: string;
}

export interface WritePrivateTextFileSecureOptions {
  label?: string;
  atomic?: boolean;
}

const DEFAULT_SYMLINK_ERROR_PREFIX = 'Refusing to write through symlinked file';
const DEFAULT_NON_REGULAR_FILE_ERROR_PREFIX = 'Refusing to write to non-regular file';
const DEFAULT_DIR_SYMLINK_ERROR_PREFIX = 'Refusing to use symlinked directory';
const DEFAULT_DIR_NON_DIRECTORY_ERROR_PREFIX = 'Directory path is not a directory';
const DEFAULT_PRIVATE_FILE_LABEL = 'Output path';

export function ensurePrivateDirectory(
  dirPath: string,
  options: EnsurePrivateDirectoryOptions = {},
): void {
  const symlinkErrorPrefix = options.symlinkErrorPrefix ?? DEFAULT_DIR_SYMLINK_ERROR_PREFIX;
  const nonDirectoryErrorPrefix =
    options.nonDirectoryErrorPrefix ?? DEFAULT_DIR_NON_DIRECTORY_ERROR_PREFIX;
  const resolved = path.resolve(dirPath);
  const parent = path.dirname(resolved);

  assertNoSymlinkInExistingPath(parent, `${symlinkErrorPrefix} in path`);

  if (!fs.existsSync(resolved)) {
    fs.mkdirSync(resolved, { recursive: true, mode: 0o700 });
    return;
  }

  const stats = fs.lstatSync(resolved);
  if (stats.isSymbolicLink()) {
    throw new Error(`${symlinkErrorPrefix}: ${resolved}`);
  }
  if (!stats.isDirectory()) {
    throw new Error(`${nonDirectoryErrorPrefix}: ${resolved}`);
  }
  try {
    fs.chmodSync(resolved, 0o700);
  } catch {
    // Best-effort on non-POSIX systems.
  }
}

function assertNoSymlinkInExistingPath(value: string, errorPrefix: string): void {
  const resolved = path.resolve(value);
  const root = path.parse(resolved).root || path.sep;
  const suffix = path.relative(root, resolved);
  const segments = suffix ? suffix.split(path.sep).filter(Boolean) : [];
  let current = root;

  for (const segment of segments) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) return;
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) {
      throw new Error(`${errorPrefix}: ${current}`);
    }
  }
}

export function writePrivateTextFileSecure(
  filePath: string,
  content: string,
  options: WritePrivateTextFileSecureOptions = {},
): void {
  const label = options.label ?? DEFAULT_PRIVATE_FILE_LABEL;
  const resolved = path.resolve(filePath);
  const parent = path.dirname(resolved);
  assertNoSymlinkInExistingPath(parent, `${label} must not include symlinks`);
  ensurePrivateDirectory(parent, {
    symlinkErrorPrefix: `${label} parent directory must not be a symlink`,
    nonDirectoryErrorPrefix: `${label} parent directory is not a directory`,
  });

  if (fs.existsSync(resolved)) {
    const stats = fs.lstatSync(resolved);
    if (stats.isSymbolicLink()) {
      throw new Error(`${label} must not be a symlink: ${resolved}`);
    }
    if (typeof stats.isDirectory === 'function' && stats.isDirectory()) {
      throw new Error(`${label} must not be a directory: ${resolved}`);
    }
    if (typeof stats.isFile === 'function' && !stats.isFile()) {
      throw new Error(`${label} must be a regular file: ${resolved}`);
    }
  }

  if (options.atomic) {
    const tmpPath = `${resolved}.tmp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      fs.writeFileSync(tmpPath, content, { encoding: 'utf-8', mode: 0o600 });
      fs.renameSync(tmpPath, resolved);
    } catch (error) {
      try {
        if (fs.existsSync(tmpPath)) {
          fs.unlinkSync(tmpPath);
        }
      } catch {
        // Best-effort cleanup.
      }
      throw error;
    }
  } else {
    fs.writeFileSync(resolved, content, { encoding: 'utf-8', mode: 0o600 });
  }
  try {
    fs.chmodSync(resolved, 0o600);
  } catch {
    // Best-effort on non-POSIX systems.
  }
}

function isUnsupportedNoFollowError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === 'EINVAL' || code === 'ENOTSUP' || code === 'EOPNOTSUPP';
}

function openForAppendSecure(filePath: string, symlinkErrorPrefix: string): number {
  const constants = (fs as unknown as { constants?: Record<string, number> }).constants;
  const appendFlag = constants?.O_APPEND;
  const createFlag = constants?.O_CREAT;
  const writeOnlyFlag = constants?.O_WRONLY;
  const noFollowFlag = constants?.O_NOFOLLOW;
  const hasNumericFlags =
    typeof appendFlag === 'number' &&
    typeof createFlag === 'number' &&
    typeof writeOnlyFlag === 'number';

  if (hasNumericFlags) {
    const baseFlags = appendFlag | createFlag | writeOnlyFlag;
    if (typeof noFollowFlag === 'number') {
      try {
        return fs.openSync(filePath, baseFlags | noFollowFlag, 0o600);
      } catch (error) {
        if (!isUnsupportedNoFollowError(error)) {
          throw error;
        }
      }
    }

    if (fs.existsSync(filePath)) {
      const stat = fs.lstatSync(filePath);
      if (stat.isSymbolicLink()) {
        throw new Error(`${symlinkErrorPrefix}: ${filePath}`);
      }
    }
    return fs.openSync(filePath, baseFlags, 0o600);
  }

  if (fs.existsSync(filePath)) {
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink()) {
      throw new Error(`${symlinkErrorPrefix}: ${filePath}`);
    }
  }
  return fs.openSync(filePath, 'a', 0o600);
}

export function appendLineSecure(
  filePath: string,
  line: string,
  options: AppendLineSecureOptions = {},
): void {
  const symlinkErrorPrefix = options.symlinkErrorPrefix ?? DEFAULT_SYMLINK_ERROR_PREFIX;
  const nonRegularFileErrorPrefix =
    options.nonRegularFileErrorPrefix ?? DEFAULT_NON_REGULAR_FILE_ERROR_PREFIX;
  const resolved = path.resolve(filePath);
  const parent = path.dirname(resolved);

  assertNoSymlinkInExistingPath(parent, `${symlinkErrorPrefix} in path`);
  ensurePrivateDirectory(parent, {
    symlinkErrorPrefix: `${symlinkErrorPrefix} parent directory must not be a symlink`,
    nonDirectoryErrorPrefix: 'Append target parent directory is not a directory',
  });

  const fd = openForAppendSecure(resolved, symlinkErrorPrefix);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) {
      throw new Error(`${nonRegularFileErrorPrefix}: ${resolved}`);
    }
    fs.writeSync(fd, line, undefined, 'utf-8');
    try {
      fs.fchmodSync(fd, 0o600);
    } catch {
      // Best-effort on non-POSIX systems.
    }
  } finally {
    fs.closeSync(fd);
  }
}
