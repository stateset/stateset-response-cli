import path from 'node:path';
import { readJsonFile } from '../utils/file-read.js';
import { writePrivateTextFileSecure } from '../utils/secure-file.js';

export interface EngineCompletionCache {
  brandRef: string;
  updatedAt: string;
  onboardingRunIds: string[];
  dlqItemIds: string[];
}

function uniqueSorted(values: readonly string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b),
  );
}

function toCacheKey(value: string): string {
  return encodeURIComponent(value.trim());
}

export function getEngineCompletionCachePath(
  brandRef: string,
  cwd: string = process.cwd(),
): string {
  return path.join(
    path.resolve(cwd),
    '.stateset',
    'cache',
    'engine',
    `${toCacheKey(brandRef)}.json`,
  );
}

export function readEngineCompletionCache(
  brandRef: string,
  cwd: string = process.cwd(),
): EngineCompletionCache | null {
  try {
    const filePath = getEngineCompletionCachePath(brandRef, cwd);
    const raw = readJsonFile(filePath, {
      label: 'engine completion cache',
      expectObject: true,
    }) as Partial<EngineCompletionCache>;
    return {
      brandRef: String(raw.brandRef ?? brandRef).trim() || brandRef,
      updatedAt: String(raw.updatedAt ?? ''),
      onboardingRunIds: uniqueSorted(raw.onboardingRunIds ?? []),
      dlqItemIds: uniqueSorted(raw.dlqItemIds ?? []),
    };
  } catch {
    return null;
  }
}

function writeEngineCompletionCache(
  brandRefs: string[],
  updater: (current: EngineCompletionCache | null, canonicalRef: string) => EngineCompletionCache,
  cwd: string = process.cwd(),
): void {
  const refs = uniqueSorted(brandRefs);
  if (refs.length === 0) {
    return;
  }

  const canonicalRef = refs[0];
  for (const ref of refs) {
    try {
      const filePath = getEngineCompletionCachePath(ref, cwd);
      const current = readEngineCompletionCache(ref, cwd);
      const next = updater(current, canonicalRef);
      writePrivateTextFileSecure(filePath, JSON.stringify(next, null, 2) + '\n', {
        label: 'engine completion cache',
        atomic: true,
      });
    } catch {
      // Best-effort cache writes should never break the command flow.
    }
  }
}

export function cacheOnboardingRunIds(
  brandRefs: string[],
  runIds: readonly string[],
  cwd: string = process.cwd(),
): void {
  const nextIds = uniqueSorted(runIds);
  writeEngineCompletionCache(
    brandRefs,
    (current, canonicalRef) => ({
      brandRef: canonicalRef,
      updatedAt: new Date().toISOString(),
      onboardingRunIds: nextIds,
      dlqItemIds: current?.dlqItemIds ?? [],
    }),
    cwd,
  );
}

export function rememberOnboardingRunId(
  brandRefs: string[],
  runId: string,
  cwd: string = process.cwd(),
): void {
  const nextRunId = runId.trim();
  if (!nextRunId) {
    return;
  }
  writeEngineCompletionCache(
    brandRefs,
    (current, canonicalRef) => ({
      brandRef: canonicalRef,
      updatedAt: new Date().toISOString(),
      onboardingRunIds: uniqueSorted([...(current?.onboardingRunIds ?? []), nextRunId]),
      dlqItemIds: current?.dlqItemIds ?? [],
    }),
    cwd,
  );
}

export function cacheDlqItemIds(
  brandRefs: string[],
  dlqIds: readonly string[],
  cwd: string = process.cwd(),
): void {
  const nextIds = uniqueSorted(dlqIds);
  writeEngineCompletionCache(
    brandRefs,
    (current, canonicalRef) => ({
      brandRef: canonicalRef,
      updatedAt: new Date().toISOString(),
      onboardingRunIds: current?.onboardingRunIds ?? [],
      dlqItemIds: nextIds,
    }),
    cwd,
  );
}

export function rememberDlqItemId(
  brandRefs: string[],
  dlqId: string,
  cwd: string = process.cwd(),
): void {
  const nextDlqId = dlqId.trim();
  if (!nextDlqId) {
    return;
  }
  writeEngineCompletionCache(
    brandRefs,
    (current, canonicalRef) => ({
      brandRef: canonicalRef,
      updatedAt: new Date().toISOString(),
      onboardingRunIds: current?.onboardingRunIds ?? [],
      dlqItemIds: uniqueSorted([...(current?.dlqItemIds ?? []), nextDlqId]),
    }),
    cwd,
  );
}
