import fs from 'node:fs';
import path from 'node:path';
import type {
  AnyPayload,
  ShortcutLogger,
  TopLevelOptions,
  WatchOptions,
  DeploymentCommandOptions,
  SnapshotReadResult,
} from './types.js';
import {
  DEFAULT_STATESET_DIR,
  DEFAULT_STATESET_DIR_OPTIONS,
  DEFAULT_STATESET_BUNDLE_FILE,
  DEFAULT_STATESET_CONFIG_FILE,
} from './types.js';
import { getErrorMessage } from '../../lib/errors.js';
import {
  toLines,
  parseCommandArgs,
  parseDateInput,
  parseNonNegativeIntegerOption,
  parsePositiveIntegerOption,
  parseToggleValue,
  printPayload,
  buildTopLevelLogger,
  sleep,
  nowSuffix,
  ensureSnapshotDir,
  defaultSnapshotName,
  resolveSafeOutputJsonPath,
  resolveSnapshotPath,
  readSnapshot,
  resolveSnapshotSourceForRead,
  buildDiffSummary,
  parseDiffRefs,
  listSnapshotInfos,
  resolveStateSetDir,
  normalizeStateSetSource,
  readStateSetBundle,
  writeStateSetBundle,
  summarizeStateSetPayload,
  writeTempStateSetBundle,
  createTempStateSetPath,
  readStateSetFingerprint,
  runImportCommandWithPreview,
  formatBytes,
  formatToolResult,
  formatTable,
  exportOrg,
} from './utils.js';
import {
  createDeployment,
  deleteDeployment,
  getDeployment,
  listDeployments,
  updateDeployment,
} from '../operations-store.js';

function normalizeDeploymentMode(rawMode: string | undefined): string | undefined {
  const normalized = (rawMode || '').trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized === 'rollback' || normalized === 'deploy') return normalized;
  return undefined;
}

function normalizeDeploymentStatus(rawStatus: string | undefined): string | undefined {
  const normalized = (rawStatus || '').trim().toLowerCase();
  if (!normalized) return undefined;
  if (
    normalized === 'scheduled' ||
    normalized === 'approved' ||
    normalized === 'applied' ||
    normalized === 'failed' ||
    normalized === 'cancelled'
  ) {
    return normalized;
  }
  return undefined;
}

function resolveToggleOption(...values: Array<boolean | string | undefined>): boolean | undefined {
  for (const value of values) {
    if (typeof value === 'boolean') return value;
    const parsed = parseToggleValue(value);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

function summarizeDeploymentsForStatus(
  deployments: ReturnType<typeof listDeployments>,
): Record<string, number> {
  return deployments.reduce<Record<string, number>>((acc, entry) => {
    acc[entry.status] = (acc[entry.status] || 0) + 1;
    return acc;
  }, {});
}

export async function runSnapshotCommand(
  args: string[] = [],
  options: TopLevelOptions = {},
): Promise<void> {
  const logger = buildTopLevelLogger();
  const parsed = parseCommandArgs(args);
  const action = (parsed.positionals[0] || 'list').toLowerCase();
  const payload = parsed.positionals[1];

  if (action === 'list') {
    const snapshots = listSnapshotInfos();
    if (snapshots.length === 0) {
      logger.warning('No snapshots available.');
      return;
    }

    const filtered = payload
      ? snapshots.filter((entry) => {
          const normalized = payload.toLowerCase();
          return (
            entry.id.toLowerCase().includes(normalized) ||
            entry.file.toLowerCase().includes(normalized)
          );
        })
      : snapshots;
    if (filtered.length === 0) {
      logger.warning(`No snapshots matching "${payload}".`);
      return;
    }

    const rows = filtered.map((entry) => ({
      snapshot: entry.id,
      file: entry.file,
      size: formatBytes(entry.size),
      modified: new Date(entry.modifiedAt).toISOString(),
    }));

    if (options.json) {
      logger.output(
        JSON.stringify(
          {
            count: rows.length,
            snapshots: rows,
          },
          null,
          2,
        ),
      );
      return;
    }

    logger.output(formatTable(rows, ['snapshot', 'size', 'modified']));
    return;
  }

  if (action === 'create') {
    const customName = payload;
    const filename = defaultSnapshotName(customName);
    const explicitOut = options.out;
    const outputPath = explicitOut
      ? resolveSafeOutputJsonPath(explicitOut, filename)
      : path.join(ensureSnapshotDir(), filename);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const data = await exportOrg(outputPath, { includeSecrets: options.includeSecrets });
    if (options.json) {
      logger.output(
        JSON.stringify(
          {
            action: 'create',
            path: outputPath,
            snapshot: path.basename(outputPath),
            counts: {
              agents: data.agents.length,
              rules: data.rules.length,
              skills: data.skills.length,
              attributes: data.attributes.length,
              functions: data.functions.length,
              examples: data.examples.length,
              evals: data.evals.length,
              datasets: data.datasets.length,
              agentSettings: data.agentSettings.length,
            },
          },
          null,
          2,
        ),
      );
      return;
    }
    logger.success(`Snapshot created: ${outputPath}`);
    return;
  }

  if (action === 'show') {
    const snapshotRef = payload || 'latest';
    const snapshotPath = resolveSnapshotPath(snapshotRef);
    if (!snapshotPath) {
      logger.error(`Snapshot not found: ${snapshotRef}`);
      return;
    }
    const data = readSnapshot(snapshotPath);
    if (options.json) {
      logger.output(JSON.stringify(data, null, 2));
      return;
    }
    printPayload(
      logger,
      `Snapshot: ${path.basename(snapshotPath)}`,
      data as unknown as AnyPayload,
      false,
    );
    return;
  }

  logger.warning(`Unknown snapshot action "${action}".`);
}

export async function runDiffCommand(
  tokens: string[],
  logger: ShortcutLogger,
  options: TopLevelOptions = {},
): Promise<void> {
  const parsed = parseCommandArgs(tokens);
  const fromTo = parseDiffRefs(parsed.positionals, options.from, options.to);
  const fromRef = fromTo.from;
  const toRef = fromTo.to;

  if (!fromRef || !toRef) {
    logger.warning('Usage: /diff [from] [to] [--from ref --to ref]');
    return;
  }

  let fromSource: SnapshotReadResult | null = null;
  let toSource: SnapshotReadResult | null = null;

  try {
    fromSource = await resolveSnapshotSourceForRead(fromRef, Boolean(options.includeSecrets));
    toSource = await resolveSnapshotSourceForRead(toRef, Boolean(options.includeSecrets));
    const summary = buildDiffSummary(
      fromSource.payload,
      toSource.payload,
      fromSource.source,
      toSource.source,
    );
    const rows = summary.rows.map((row) => ({
      collection: row.collection,
      from: String(row.from),
      to: String(row.to),
      added: String(row.added),
      removed: String(row.removed),
      changed: String(row.changed),
    }));
    const totals = summary.rows.reduce(
      (acc, row) => {
        acc.added += row.added;
        acc.removed += row.removed;
        acc.changed += row.changed;
        return acc;
      },
      { added: 0, removed: 0, changed: 0 },
    );

    if (options.json || parsed.options.json === 'true') {
      logger.output(
        JSON.stringify(
          {
            from: summary.from,
            to: summary.to,
            totals,
            rows: summary.rows,
          },
          null,
          2,
        ),
      );
      return;
    }

    logger.success(`Diff: ${summary.from} -> ${summary.to}`);
    logger.output(formatTable(rows, ['collection', 'from', 'to', 'added', 'removed', 'changed']));
    logger.output('');
    logger.output(
      formatToolResult(
        `Added: ${totals.added}  Removed: ${totals.removed}  Changed: ${totals.changed}`,
      ),
    );
  } finally {
    if (fromSource?.cleanup) {
      fromSource.cleanup();
    }
    if (toSource?.cleanup) {
      toSource.cleanup();
    }
  }
}

export async function runDeploymentsCommand(
  tokens: string[],
  logger: ShortcutLogger,
  json = false,
  options: DeploymentCommandOptions = {},
): Promise<void> {
  const raw = toLines(tokens);
  const parsed = parseCommandArgs(raw);
  const action = (parsed.positionals[0] || 'list').toLowerCase();
  const firstArg = parsed.positionals[1];
  const optionsMode = normalizeDeploymentMode(options.mode);
  const parsedMode = normalizeDeploymentMode(parsed.options.mode);
  const modeFilter = optionsMode || parsedMode;
  const optionsStatus = normalizeDeploymentStatus(options.status);
  const parsedStatus = normalizeDeploymentStatus(parsed.options.status);
  const statusFilter = optionsStatus || parsedStatus;
  const rawLimit =
    parsed.options.limit ?? (options.limit === undefined ? undefined : String(options.limit));
  const rawOffset =
    parsed.options.offset ?? (options.offset === undefined ? undefined : String(options.offset));
  const parsedLimit = parsePositiveIntegerOption(rawLimit);
  if (rawLimit !== undefined && parsedLimit === undefined) {
    logger.warning('Invalid --limit value. Expected a positive integer.');
    return;
  }
  const parsedOffset = parseNonNegativeIntegerOption(rawOffset);
  if (rawOffset !== undefined && parsedOffset === undefined) {
    logger.warning('Invalid --offset value. Expected a non-negative integer.');
    return;
  }
  const limit = Math.min(parsedLimit ?? 50, 200);
  const offset = parsedOffset ?? 0;

  const invalidMode = (options.mode && !optionsMode && options.mode) || parsed.options.mode;
  if (invalidMode && !normalizeDeploymentMode(invalidMode)) {
    logger.warning(`Unknown deployment mode: ${invalidMode}. Use deploy|rollback.`);
    return;
  }
  const invalidStatus =
    (options.status && !optionsStatus && options.status) || parsed.options.status;
  if (invalidStatus && !normalizeDeploymentStatus(invalidStatus)) {
    logger.warning('Unknown deployment status. Use scheduled|approved|applied|failed|cancelled.');
    return;
  }

  if (action === 'approve') {
    const targetRef = firstArg;
    if (!targetRef) {
      logger.warning(
        'Usage: /deployments approve <deployment-id> [snapshot-ref] [--from <snapshot-ref>]',
      );
      return;
    }
    let deployment;
    try {
      deployment = getDeployment(targetRef);
    } catch (error) {
      logger.warning(getErrorMessage(error));
      return;
    }
    const sourceOverride = options.from || parsed.options.from || parsed.positionals[2];
    const dryRun = resolveToggleOption(
      options.dryRun,
      parsed.options.dryRun,
      parsed.options['dry-run'],
    );
    const strict = resolveToggleOption(options.strict, parsed.options.strict);
    const includeSecrets = resolveToggleOption(
      options.includeSecrets,
      parsed.options.includeSecrets,
      parsed.options['include-secrets'],
    );
    const yes = resolveToggleOption(options.yes, parsed.options.yes);

    await runTopLevelDeployment(
      deployment.mode,
      sourceOverride ? [sourceOverride] : [],
      {
        from: sourceOverride,
        approve: deployment.id,
        dryRun,
        strict,
        includeSecrets,
        yes,
      },
      logger,
    );
    return;
  }

  if (action === 'retry') {
    const targetRef = firstArg;
    if (!targetRef) {
      logger.warning(
        'Usage: /deployments retry <deployment-id> [snapshot-ref] [--from <snapshot-ref>]',
      );
      return;
    }
    let deployment;
    try {
      deployment = getDeployment(targetRef);
    } catch (error) {
      logger.warning(getErrorMessage(error));
      return;
    }
    if (deployment.status === 'applied') {
      logger.warning(`Deployment ${deployment.id} has already been applied and cannot be retried.`);
      return;
    }
    if (deployment.status === 'cancelled') {
      logger.warning(`Deployment ${deployment.id} is cancelled and cannot be retried.`);
      return;
    }
    if (deployment.status !== 'failed') {
      logger.warning(
        `Deployment ${deployment.id} is ${deployment.status}; only failed deployments can be retried.`,
      );
      return;
    }

    const sourceOverride = options.from || parsed.options.from || parsed.positionals[2];
    const dryRun = resolveToggleOption(
      options.dryRun,
      parsed.options.dryRun,
      parsed.options['dry-run'],
    );
    const strict = resolveToggleOption(options.strict, parsed.options.strict);
    const includeSecrets = resolveToggleOption(
      options.includeSecrets,
      parsed.options.includeSecrets,
      parsed.options['include-secrets'],
    );
    const yes = resolveToggleOption(options.yes, parsed.options.yes);

    await runTopLevelDeployment(
      deployment.mode,
      sourceOverride ? [sourceOverride] : [],
      {
        from: sourceOverride,
        approve: deployment.id,
        dryRun,
        strict,
        includeSecrets,
        yes,
      },
      logger,
    );
    return;
  }

  if (action === 'reschedule') {
    const targetRef = firstArg;
    const scheduleValue = options.schedule || parsed.options.schedule || parsed.positionals[2];
    if (!targetRef || !scheduleValue) {
      logger.warning(
        'Usage: /deployments reschedule <deployment-id> <datetime> [--schedule <datetime>]',
      );
      return;
    }
    const scheduledForMs = parseDateInput(scheduleValue);
    if (scheduledForMs === undefined) {
      logger.warning(`Invalid schedule value: ${scheduleValue}`);
      return;
    }
    const scheduledFor = new Date(scheduledForMs).toISOString();
    try {
      const deployment = getDeployment(targetRef);
      if (deployment.status === 'applied') {
        logger.warning(
          `Deployment ${deployment.id} has already been applied and cannot be rescheduled.`,
        );
        return;
      }
      if (deployment.status === 'cancelled') {
        logger.warning(`Deployment ${deployment.id} is cancelled and cannot be rescheduled.`);
        return;
      }
      const updated = updateDeployment(targetRef, {
        status: 'scheduled',
        scheduledFor,
        approvedAt: '',
        appliedAt: '',
        error: '',
      });
      logger.success(`Deployment ${updated.id} rescheduled for ${scheduledFor}.`);
    } catch (error) {
      logger.warning(getErrorMessage(error));
    }
    return;
  }

  if (action === 'list') {
    const listRef = firstArg;
    const rows = listDeployments(listRef);
    const filtered = rows.filter((entry) => {
      if (modeFilter && entry.mode !== modeFilter) return false;
      if (statusFilter && entry.status !== statusFilter) return false;
      return true;
    });

    if (filtered.length === 0) {
      logger.warning('No deployments found.');
      return;
    }

    const rowsToShow = filtered.slice(offset, offset + limit);
    if (rowsToShow.length === 0) {
      logger.warning(
        `No deployments found for --offset ${offset}. Total matches: ${filtered.length}.`,
      );
      return;
    }
    if (json) {
      logger.output(
        JSON.stringify(
          {
            count: rowsToShow.length,
            total: filtered.length,
            offset,
            limit,
            deployments: rowsToShow,
          },
          null,
          2,
        ),
      );
      return;
    }

    logger.output(
      formatTable(
        rowsToShow.map((entry) => ({
          id: entry.id,
          mode: entry.mode,
          status: entry.status,
          source: entry.source,
          scheduledFor: entry.scheduledFor || '-',
          updatedAt: entry.updatedAt,
        })),
        ['id', 'mode', 'status', 'source', 'scheduledFor', 'updatedAt'],
      ),
    );
    return;
  }

  if (action === 'get') {
    const targetRef = firstArg;
    if (!targetRef) {
      logger.warning('Usage: /deployments get <deployment-id>');
      return;
    }
    try {
      const deployment = getDeployment(targetRef);
      printPayload(
        logger,
        `Deployment ${deployment.id}`,
        deployment as unknown as AnyPayload,
        json,
      );
    } catch (error) {
      logger.warning(getErrorMessage(error));
    }
    return;
  }

  if (action === 'cancel') {
    const targetRef = firstArg;
    if (!targetRef) {
      logger.warning('Usage: /deployments cancel <deployment-id>');
      return;
    }
    try {
      const deployment = getDeployment(targetRef);
      if (deployment.status === 'applied') {
        logger.warning(
          `Deployment ${deployment.id} has already been applied and cannot be cancelled.`,
        );
        return;
      }
      if (deployment.status === 'cancelled') {
        logger.warning(`Deployment ${deployment.id} is already cancelled.`);
        return;
      }
      const updated = updateDeployment(targetRef, { status: 'cancelled' });
      logger.success(`Deployment ${updated.id} cancelled.`);
    } catch (error) {
      logger.warning(getErrorMessage(error));
    }
    return;
  }

  if (action === 'delete') {
    const targetRef = firstArg;
    if (!targetRef) {
      logger.warning('Usage: /deployments delete <deployment-id>');
      return;
    }
    try {
      const removed = deleteDeployment(targetRef);
      if (json) {
        logger.output(JSON.stringify({ removed }, null, 2));
      } else {
        logger.success(`Deployment ${removed.id} deleted.`);
      }
    } catch (error) {
      logger.warning(getErrorMessage(error));
    }
    return;
  }

  if (action === 'status') {
    const rows = listDeployments();
    const statusSummary = summarizeDeploymentsForStatus(rows);
    const modeSummary = rows.reduce<Record<string, number>>((acc, entry) => {
      acc[entry.mode] = (acc[entry.mode] || 0) + 1;
      return acc;
    }, {});
    const summary = {
      total: rows.length,
      byMode: modeSummary,
      byStatus: statusSummary,
    };
    if (json) {
      logger.output(JSON.stringify(summary, null, 2));
      return;
    }
    logger.output(formatToolResult(JSON.stringify(summary, null, 2)));
    return;
  }

  const lookupRef = parsed.positionals[0];
  try {
    const deployment = getDeployment(lookupRef);
    printPayload(logger, `Deployment ${deployment.id}`, deployment as unknown as AnyPayload, json);
  } catch {
    logger.warning(`Unknown deployments command "${action}".`);
    logger.warning('Available: list, get, status, approve, retry, reschedule, cancel, delete');
  }
}

export async function runBulkCommand(
  tokens: string[],
  logger: ShortcutLogger,
  options: TopLevelOptions = {},
): Promise<void> {
  const parsed = parseCommandArgs(tokens);
  const action = (parsed.positionals[0] || 'export').toLowerCase();
  const target = parsed.positionals[1];

  if (action === 'export') {
    const output = options.out || target || undefined;
    const outputPath = resolveSafeOutputJsonPath(output, `stateset-export-${nowSuffix()}.json`);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const data = await exportOrg(outputPath, { includeSecrets: options.includeSecrets });
    const rows = [
      ['agents', data.agents.length],
      ['rules', data.rules.length],
      ['skills', data.skills.length],
      ['attributes', data.attributes.length],
      ['functions', data.functions.length],
      ['examples', data.examples.length],
      ['evals', data.evals.length],
      ['datasets', data.datasets.length],
      ['agent settings', data.agentSettings.length],
    ] as const;
    if (options.json) {
      logger.output(
        JSON.stringify(
          {
            path: outputPath,
            counts: rows.map(([label, count]) => ({ label, count })),
          },
          null,
          2,
        ),
      );
      return;
    }
    logger.success(`Bulk export written to ${outputPath}`);
    logger.output(`Exported: ${rows.map(([label, count]) => `${count} ${label}`).join(', ')}`);
    return;
  }

  if (action === 'import') {
    if (!target) {
      logger.warning('Usage: bulk import <file|directory>');
      return;
    }
    if (!fs.existsSync(target)) {
      logger.error(`Import source not found: ${target}`);
      return;
    }
    let importSource = target;
    try {
      const stats = fs.lstatSync(target);
      if (stats.isDirectory()) {
        const candidates = fs
          .readdirSync(target, { withFileTypes: true })
          .filter((entry) => entry.isFile())
          .map((entry) => entry.name)
          .filter((name) => name.toLowerCase().endsWith('.json'));
        if (candidates.length === 0) {
          logger.error(`No .json files found in directory: ${target}`);
          return;
        }
        const prioritized = candidates.find((file) => file.startsWith('stateset-export'));
        const chosen = prioritized || candidates.sort().reverse()[0];
        importSource = path.join(target, chosen);
        logger.warning(`Bulk import using file in directory: ${importSource}`);
      } else if (!stats.isFile()) {
        logger.error(`Import source is not a file: ${target}`);
        return;
      }
    } catch (error) {
      logger.error(`Unable to inspect import source: ${getErrorMessage(error)}`);
      return;
    }
    if (!fs.existsSync(importSource) || !fs.lstatSync(importSource).isFile()) {
      logger.error(`Import source not found: ${importSource}`);
      return;
    }
    await runImportCommandWithPreview(importSource, logger, 'Bulk import', options);
    return;
  }

  logger.warning(`Unknown bulk action "${action}".`);
}

export async function runTopLevelDeployment(
  mode: 'deploy' | 'rollback',
  args: string[] = [],
  options: TopLevelOptions = {},
  logger: ShortcutLogger,
): Promise<void> {
  const source = options.from || args[0];
  const label = mode === 'deploy' ? 'Deploy' : 'Rollback';

  if (options.schedule && options.approve) {
    logger.warning(`${label} cannot use both --schedule and --approve at once.`);
    return;
  }

  if (options.schedule) {
    if (!source) {
      logger.warning(`Usage: ${label.toLowerCase()} --schedule <datetime> <snapshot-ref>`);
      return;
    }
    const scheduledForMs = parseDateInput(options.schedule);
    if (scheduledForMs === undefined) {
      logger.warning(`Invalid schedule value: ${options.schedule}`);
      return;
    }
    const scheduledForIso = new Date(scheduledForMs).toISOString();
    const scheduled = createDeployment({
      mode,
      source,
      scheduledFor: scheduledForIso,
      dryRun: options.dryRun,
      strict: options.strict,
      includeSecrets: options.includeSecrets,
      yes: options.yes,
    });
    logger.success(
      `${label} scheduled with id ${scheduled.id} for ${scheduledForIso} from ${scheduled.source}`,
    );
    return;
  }

  if (options.approve) {
    const target = getDeployment(options.approve);
    if (target.mode !== mode) {
      logger.warning(`Deployment ${options.approve} is for ${target.mode}, not ${mode}.`);
      return;
    }
    if (!target.source) {
      logger.warning(`Deployment ${options.approve} has no source path.`);
      return;
    }
    if (target.status === 'applied') {
      logger.warning(`Deployment ${target.id} already applied.`);
      return;
    }
    if (target.status === 'cancelled') {
      logger.warning(`Deployment ${target.id} is cancelled and cannot be approved.`);
      return;
    }
    const actionSource = source || target.source;
    updateDeployment(target.id, {
      source: actionSource,
      status: 'approved',
      approvedAt: new Date().toISOString(),
      dryRun: options.dryRun !== undefined ? options.dryRun : target.dryRun,
      strict: options.strict !== undefined ? options.strict : target.strict,
      includeSecrets:
        options.includeSecrets !== undefined ? options.includeSecrets : target.includeSecrets,
      yes: options.yes !== undefined ? options.yes : target.yes,
    });
    try {
      await runImportCommandWithPreview(actionSource, logger, label, {
        from: actionSource,
        dryRun: options.dryRun ?? target.dryRun,
        yes: true,
        strict: options.strict ?? target.strict,
        includeSecrets: options.includeSecrets ?? target.includeSecrets,
      });
      updateDeployment(target.id, {
        status: 'applied',
        appliedAt: new Date().toISOString(),
      });
    } catch (error) {
      updateDeployment(target.id, {
        status: 'failed',
        error: getErrorMessage(error),
      });
      throw error;
    }
    return;
  }

  if (!source) {
    if (mode === 'deploy') {
      logger.warning('Usage: deploy <snapshot-ref> [--dry-run] [--yes]');
    } else {
      logger.warning('Usage: rollback <snapshot-ref> [--dry-run] [--yes]');
    }
    return;
  }

  await runImportCommandWithPreview(source, logger, label, options);
}

export async function runTopLevelDeploy(
  args: string[] = [],
  options: TopLevelOptions = {},
): Promise<void> {
  const logger = buildTopLevelLogger();
  await runTopLevelDeployment('deploy', args, options, logger);
}

export async function runTopLevelRollback(
  args: string[] = [],
  options: TopLevelOptions = {},
): Promise<void> {
  const logger = buildTopLevelLogger();
  await runTopLevelDeployment('rollback', args, options, logger);
}

export async function runTopLevelDeployments(
  args: string[] = [],
  options: DeploymentCommandOptions = {},
): Promise<void> {
  const logger = buildTopLevelLogger();
  await runDeploymentsCommand(args, logger, Boolean(options.json), options);
}

export async function runTopLevelDiff(
  args: string[] = [],
  options: TopLevelOptions = {},
): Promise<void> {
  const logger = buildTopLevelLogger();
  await runDiffCommand(args, logger, options);
}

export async function runTopLevelPull(
  args: string[] = [],
  options: TopLevelOptions = {},
): Promise<void> {
  const logger = buildTopLevelLogger();
  const dirArg = args[0];
  const targetDir = resolveStateSetDir(dirArg);
  const tempExportPath = createTempStateSetPath('stateset-pull');
  try {
    const payload = await exportOrg(tempExportPath, { includeSecrets: options.includeSecrets });
    writeStateSetBundle(targetDir, payload);
    const counts = summarizeStateSetPayload(payload);
    const files = DEFAULT_STATESET_DIR_OPTIONS;
    if (options.json) {
      logger.output(
        JSON.stringify(
          {
            path: targetDir,
            source: path.basename(tempExportPath),
            exportedAt: payload.exportedAt,
            version: payload.version,
            orgId: payload.orgId,
            counts,
            files,
          },
          null,
          2,
        ),
      );
      return;
    }
    logger.success(`Pulled config from organization to ${targetDir}`);
    logger.output(
      `Wrote: ${counts.agents} agents, ${counts.rules} rules, ${counts.skills} skills, ${counts.attributes} attributes, ${counts.functions} functions, ${counts.examples} examples, ${counts.evals} evals, ${counts.datasets} datasets, ${counts.agentSettings} agent settings`,
    );
    logger.output(`Files: ${files.join(', ')}`);
    return;
  } finally {
    try {
      fs.unlinkSync(tempExportPath);
    } catch {
      // ignore
    }
  }
}

export async function runTopLevelPush(
  args: string[] = [],
  options: TopLevelOptions = {},
): Promise<void> {
  const logger = buildTopLevelLogger();
  const sourceArg = args[0] || options.from || DEFAULT_STATESET_DIR;

  const resolved = path.resolve(sourceArg);
  if (!fs.existsSync(resolved)) {
    logger.error(`StateSet source not found: ${resolved}`);
    return;
  }

  const stats = fs.lstatSync(resolved);
  let importPath = resolved;
  let tempImportPath: string | undefined;

  try {
    if (stats.isDirectory()) {
      const payload = readStateSetBundle(resolved);
      importPath = writeTempStateSetBundle(payload, 'stateset-push');
      tempImportPath = importPath;
      logger.output(`Prepared import file ${importPath} from ${resolved}`);
    } else if (!stats.isFile()) {
      logger.error(`StateSet source is neither file nor directory: ${resolved}`);
      return;
    }
    await runImportCommandWithPreview(importPath, logger, 'Push', options);
  } finally {
    if (tempImportPath) {
      try {
        fs.unlinkSync(tempImportPath);
      } catch {
        // ignore
      }
    }
  }
}

export async function runTopLevelValidate(
  args: string[] = [],
  options: TopLevelOptions = {},
): Promise<void> {
  const logger = buildTopLevelLogger();
  const sourceArg = args[0] || options.from;
  const source = normalizeStateSetSource(sourceArg);
  if (!fs.existsSync(source)) {
    logger.error(`StateSet source not found: ${source}`);
    return;
  }

  const warnings: string[] = [];
  const stats = fs.lstatSync(source);

  if (!stats.isFile() && !stats.isDirectory()) {
    throw new Error(`StateSet source must be a file or directory: ${source}`);
  }
  const payload = readStateSetBundle(source);

  if (stats.isDirectory()) {
    const configPath = path.join(source, DEFAULT_STATESET_CONFIG_FILE);
    const hasManifest = fs.existsSync(configPath);
    const hasBundle = fs.existsSync(path.join(source, DEFAULT_STATESET_BUNDLE_FILE));
    const filesPresent = DEFAULT_STATESET_DIR_OPTIONS.filter((file) =>
      fs.existsSync(path.join(source, file)),
    );
    if (filesPresent.length === 0 && !hasManifest && !hasBundle) {
      warnings.push(`No .stateset payload files found in ${source}.`);
    }
    if (options.strict && !hasManifest && !hasBundle && filesPresent.length === 0) {
      warnings.push(
        'Strict mode requires snapshot.json, config.json, or at least one resource file.',
      );
    }
    if (!hasManifest && !hasBundle) {
      warnings.push('No generated metadata file found (config.json or snapshot.json).');
    }
    if (!hasBundle && filesPresent.length < DEFAULT_STATESET_DIR_OPTIONS.length) {
      const missing = DEFAULT_STATESET_DIR_OPTIONS.filter(
        (file) => !fs.existsSync(path.join(source, file)),
      );
      warnings.push(
        `Missing resource files: ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ` (+${missing.length - 3} more)` : ''}`,
      );
    }
  }

  const counts = summarizeStateSetPayload(payload);
  if (options.json) {
    logger.output(
      JSON.stringify(
        {
          source,
          type: stats.isDirectory() ? 'directory' : 'file',
          valid: warnings.length === 0,
          strict: options.strict,
          counts,
          warnings,
        },
        null,
        2,
      ),
    );
    if (options.strict && warnings.length > 0) {
      throw new Error(`Validation failed: ${warnings.length} issue(s).`);
    }
    return;
  }

  if (warnings.length > 0) {
    for (const warning of warnings) {
      logger.warning(warning);
    }
    if (options.strict) {
      logger.error(`Validation failed with ${warnings.length} issue(s).`);
      throw new Error('Validation failed.');
    }
  } else {
    logger.success(`Validation passed for ${source}.`);
  }

  const rows = [
    ['agents', String(counts.agents)],
    ['rules', String(counts.rules)],
    ['skills', String(counts.skills)],
    ['attributes', String(counts.attributes)],
    ['functions', String(counts.functions)],
    ['examples', String(counts.examples)],
    ['evals', String(counts.evals)],
    ['datasets', String(counts.datasets)],
    ['agent settings', String(counts.agentSettings)],
  ] as const;
  logger.output(
    formatTable(
      rows.map(([name, value]) => ({ resource: name, count: value })),
      ['resource', 'count'],
    ),
  );
}

export async function runTopLevelBulk(
  args: string[] = [],
  options: TopLevelOptions = {},
): Promise<void> {
  const logger = buildTopLevelLogger();
  await runBulkCommand(args, logger, options);
}

export async function runTopLevelWatch(
  args: string[] = [],
  options: WatchOptions = {},
): Promise<void> {
  const logger = buildTopLevelLogger();
  const sourceArg = args[0] || options.from || DEFAULT_STATESET_DIR;
  const sourceDir = normalizeStateSetSource(sourceArg);

  if (!fs.existsSync(sourceDir)) {
    logger.error(`StateSet source not found: ${sourceDir}`);
    return;
  }

  const stats = fs.lstatSync(sourceDir);
  if (!stats.isDirectory()) {
    logger.error(`StateSet watch requires a directory: ${sourceDir}`);
    return;
  }

  const intervalSeconds = options.interval ? parsePositiveIntegerOption(options.interval) : 5;
  if (options.interval && intervalSeconds === undefined) {
    logger.warning('Invalid --interval value. Expected a positive integer in seconds.');
    return;
  }

  const once = options.once === true;
  const intervalMs = (intervalSeconds ?? 5) * 1000;

  const watchLabel = `watch ${sourceDir}`;
  logger.success(
    `Starting ${watchLabel} every ${intervalSeconds}s (${once ? 'once' : 'continuous'} mode)`,
  );

  if (options.json) {
    logger.output(
      JSON.stringify(
        {
          event: 'watch.start',
          source: sourceDir,
          intervalSeconds,
          once,
        },
        null,
        2,
      ),
    );
  }

  const pushOptions: TopLevelOptions = {
    from: sourceDir,
    dryRun: options.dryRun,
    yes: true,
    strict: options.strict,
    includeSecrets: options.includeSecrets,
  };

  let previousFingerprint = '';
  let firstIteration = true;

  while (true) {
    let currentFingerprint = '';
    try {
      currentFingerprint = readStateSetFingerprint(sourceDir);
    } catch (error) {
      logger.warning(`Failed to read state-set fingerprint: ${getErrorMessage(error)}`);
      if (once) {
        return;
      }
      await sleep(intervalMs);
      continue;
    }

    const changed = firstIteration || currentFingerprint !== previousFingerprint;
    firstIteration = false;
    previousFingerprint = currentFingerprint;

    if (!changed) {
      if (once) {
        if (options.dryRun) {
          logger.output(formatToolResult('No changes detected.'));
        }
      }
      if (once) {
        return;
      }
      await sleep(intervalMs);
      continue;
    }

    const timestamp = new Date().toISOString();
    if (options.json) {
      logger.output(
        JSON.stringify(
          {
            event: 'watch.change',
            source: sourceDir,
            timestamp,
            changed: true,
          },
          null,
          2,
        ),
      );
    } else {
      logger.output(formatToolResult(`Detected change in ${sourceDir} at ${timestamp}`));
    }

    try {
      await runTopLevelPush([], pushOptions);
    } catch (error) {
      logger.error(`Watch sync failed: ${getErrorMessage(error)}`);
    }

    if (once) {
      return;
    }

    await sleep(intervalMs);
  }
}
