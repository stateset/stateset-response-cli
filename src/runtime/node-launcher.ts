import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MIN_NODE_MAJOR = 18;
export const NODE_OVERRIDE_ENV = 'STATESET_NODE_PATH';
export const NODE_REEXEC_ENV = 'STATESET_NODE_REEXEC';

export interface ParsedNodeVersion {
  raw: string;
  major: number;
  minor: number;
  patch: number;
}

export interface CandidateNodeRuntime {
  path: string;
  version: ParsedNodeVersion;
}

interface DirentLike {
  name: string;
  isDirectory(): boolean;
}

interface CandidatePathOptions {
  env?: NodeJS.ProcessEnv;
  homedir?: string;
  platform?: NodeJS.Platform;
  existsSync?: (target: string) => boolean;
  readdirSync?: (target: string) => DirentLike[];
}

interface ResolveNodeLaunchOptions extends CandidatePathOptions {
  argv?: string[];
  currentVersion?: string;
  execPath?: string;
  readVersion?: (binaryPath: string) => string | null;
}

interface EnsureNodeRuntimeOptions extends ResolveNodeLaunchOptions {
  exit?: (code: number) => void;
  logError?: (message: string) => void;
  spawnSyncFn?: SpawnSyncLike;
  stdoutIsTTY?: boolean;
  stderrIsTTY?: boolean;
  writeStdout?: (chunk: string | Uint8Array) => void;
  writeStderr?: (chunk: string | Uint8Array) => void;
}

interface SpawnSyncResultLike {
  status: number | null;
  error?: Error;
  stdout?: string | Uint8Array;
  stderr?: string | Uint8Array;
}

type SpawnSyncLike = (
  command: string,
  args: string[],
  options: {
    stdio: ['inherit', 'inherit' | 'pipe', 'inherit' | 'pipe'];
    env: NodeJS.ProcessEnv;
  },
) => SpawnSyncResultLike;

export type NodeLaunchResolution =
  | { action: 'continue' }
  | {
      action: 'reexec';
      binaryPath: string;
      binaryVersion: ParsedNodeVersion;
      args: string[];
      env: NodeJS.ProcessEnv;
    }
  | { action: 'error'; code: number; message: string };

export function parseNodeVersion(raw: string): ParsedNodeVersion | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(raw.trim());
  if (!match) return null;
  return {
    raw: raw.trim(),
    major: Number.parseInt(match[1] || '0', 10),
    minor: Number.parseInt(match[2] || '0', 10),
    patch: Number.parseInt(match[3] || '0', 10),
  };
}

export function compareNodeVersions(a: ParsedNodeVersion, b: ParsedNodeVersion): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

function getNodeBinaryName(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? 'node.exe' : 'node';
}

function addCandidatePath(value: string | undefined, out: string[], seen: Set<string>): void {
  const trimmed = value?.trim();
  if (!trimmed) return;
  if (seen.has(trimmed)) return;
  seen.add(trimmed);
  out.push(trimmed);
}

export function collectCandidateNodePaths(options: CandidatePathOptions = {}): string[] {
  const env = options.env ?? process.env;
  const homedir = options.homedir ?? os.homedir();
  const platform = options.platform ?? process.platform;
  const existsSync = options.existsSync ?? fs.existsSync;
  const readdirSync =
    options.readdirSync ??
    ((target: string) => fs.readdirSync(target, { withFileTypes: true }) as DirentLike[]);
  const nodeBinary = getNodeBinaryName(platform);

  const candidates: string[] = [];
  const seen = new Set<string>();

  addCandidatePath(env[NODE_OVERRIDE_ENV], candidates, seen);
  addCandidatePath(env.npm_node_execpath, candidates, seen);

  const pathValue = env.PATH ?? env.Path ?? '';
  for (const dir of pathValue.split(path.delimiter)) {
    if (!dir.trim()) continue;
    addCandidatePath(path.join(dir, nodeBinary), candidates, seen);
  }

  const nvmDir = env.NVM_DIR?.trim() || path.join(homedir, '.nvm');
  const nvmVersionsDir = path.join(nvmDir, 'versions', 'node');
  if (existsSync(nvmVersionsDir)) {
    try {
      for (const entry of readdirSync(nvmVersionsDir)) {
        if (!entry.isDirectory()) continue;
        addCandidatePath(
          path.join(nvmVersionsDir, entry.name, 'bin', nodeBinary),
          candidates,
          seen,
        );
      }
    } catch {
      // Best-effort discovery only.
    }
  }

  const voltaHome = env.VOLTA_HOME?.trim() || path.join(homedir, '.volta');
  addCandidatePath(path.join(voltaHome, 'bin', nodeBinary), candidates, seen);
  addCandidatePath('/usr/local/bin/node', candidates, seen);
  addCandidatePath('/opt/homebrew/bin/node', candidates, seen);

  return candidates;
}

export function readNodeVersion(binaryPath: string): string | null {
  if (!fs.existsSync(binaryPath)) {
    return null;
  }

  const result = spawnSync(binaryPath, ['--version'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 1500,
    env: {
      ...process.env,
      [NODE_REEXEC_ENV]: '1',
    },
  });

  if (result.error || result.status !== 0) {
    return null;
  }

  return (result.stdout || result.stderr || '').trim() || null;
}

export function chooseCompatibleNodeBinary(
  candidates: string[],
  currentExecPath: string,
  readVersion: (binaryPath: string) => string | null = readNodeVersion,
): CandidateNodeRuntime | null {
  const normalizedCurrent = path.resolve(currentExecPath);
  const seen = new Set<string>();
  const compatible: CandidateNodeRuntime[] = [];

  for (const candidate of candidates) {
    const normalizedCandidate = path.resolve(candidate);
    if (normalizedCandidate === normalizedCurrent) continue;
    if (seen.has(normalizedCandidate)) continue;
    seen.add(normalizedCandidate);

    const parsed = parseNodeVersion(readVersion(candidate) || '');
    if (!parsed || parsed.major < MIN_NODE_MAJOR) continue;

    compatible.push({
      path: candidate,
      version: parsed,
    });
  }

  compatible.sort((left, right) => compareNodeVersions(right.version, left.version));
  return compatible[0] || null;
}

export function formatUnsupportedNodeMessage(currentVersion: string, detail?: string): string {
  const lines = [
    `Error: Node.js ${MIN_NODE_MAJOR}+ is required. Detected ${currentVersion}.`,
    detail ? `  ${detail}` : '  No compatible Node runtime was found automatically for this shell.',
    '  Try one of:',
    `  - install or switch to Node.js ${MIN_NODE_MAJOR}+`,
    `  - run "nvm use ${MIN_NODE_MAJOR}" (or newer)`,
    `  - set ${NODE_OVERRIDE_ENV}=/path/to/node${MIN_NODE_MAJOR}+`,
  ];
  return lines.join('\n');
}

export function resolveNodeLaunch(
  entryFile: string,
  options: ResolveNodeLaunchOptions = {},
): NodeLaunchResolution {
  const env = options.env ?? process.env;
  const currentVersion = options.currentVersion ?? process.versions.node;
  const parsedCurrent = parseNodeVersion(currentVersion);
  if (parsedCurrent && parsedCurrent.major >= MIN_NODE_MAJOR) {
    return { action: 'continue' };
  }

  if (env[NODE_REEXEC_ENV] === '1') {
    return {
      action: 'error',
      code: 1,
      message: formatUnsupportedNodeMessage(
        currentVersion,
        'Tried to relaunch with a compatible runtime, but the process is still using an unsupported Node version.',
      ),
    };
  }

  const compatible = chooseCompatibleNodeBinary(
    collectCandidateNodePaths(options),
    options.execPath ?? process.execPath,
    options.readVersion,
  );
  if (!compatible) {
    return {
      action: 'error',
      code: 1,
      message: formatUnsupportedNodeMessage(currentVersion),
    };
  }

  return {
    action: 'reexec',
    binaryPath: compatible.path,
    binaryVersion: compatible.version,
    args: [entryFile, ...(options.argv ?? process.argv).slice(2)],
    env: {
      ...env,
      [NODE_REEXEC_ENV]: '1',
    },
  };
}

export async function ensureSupportedNodeRuntime(
  entryUrl: string,
  options: EnsureNodeRuntimeOptions = {},
): Promise<void> {
  const resolution = resolveNodeLaunch(fileURLToPath(entryUrl), options);
  if (resolution.action === 'continue') {
    return;
  }

  const exit = options.exit ?? ((code: number) => process.exit(code));
  const logError = options.logError ?? ((message: string) => console.error(message));

  if (resolution.action === 'error') {
    logError(resolution.message);
    exit(resolution.code);
    return;
  }

  const spawnSyncFn = options.spawnSyncFn ?? spawnSync;
  const writeStdout =
    options.writeStdout ??
    ((chunk: string | Uint8Array) => {
      if (typeof chunk === 'string') {
        fs.writeSync(process.stdout.fd, chunk);
      } else {
        fs.writeSync(process.stdout.fd, chunk);
      }
    });
  const writeStderr =
    options.writeStderr ??
    ((chunk: string | Uint8Array) => {
      if (typeof chunk === 'string') {
        fs.writeSync(process.stderr.fd, chunk);
      } else {
        fs.writeSync(process.stderr.fd, chunk);
      }
    });
  const stdio: ['inherit', 'inherit' | 'pipe', 'inherit' | 'pipe'] = [
    'inherit',
    (options.stdoutIsTTY ?? Boolean(process.stdout.isTTY)) ? 'inherit' : 'pipe',
    (options.stderrIsTTY ?? Boolean(process.stderr.isTTY)) ? 'inherit' : 'pipe',
  ];
  const result = spawnSyncFn(resolution.binaryPath, resolution.args, {
    stdio,
    env: resolution.env,
  });

  if (stdio[1] === 'pipe' && result.stdout) {
    writeStdout(result.stdout);
  }
  if (stdio[2] === 'pipe' && result.stderr) {
    writeStderr(result.stderr);
  }

  if (result.error) {
    logError(
      formatUnsupportedNodeMessage(
        options.currentVersion ?? process.versions.node,
        `Failed to relaunch with ${resolution.binaryPath} (${resolution.binaryVersion.raw}): ${result.error.message}`,
      ),
    );
    exit(1);
    return;
  }

  exit(typeof result.status === 'number' ? result.status : 1);
}
