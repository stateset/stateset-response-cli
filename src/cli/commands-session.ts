import chalk from 'chalk';
import inquirer from 'inquirer';
import fs from 'node:fs';
import path from 'node:path';
import {
  sanitizeSessionId,
  getSessionsDir,
  getSessionDir,
  getStateSetDir,
  cleanupSessions,
  getSessionStorageStats,
} from '../session.js';
import { loadMemory } from '../memory.js';
import { formatSuccess, formatWarning, formatError, formatTable } from '../utils/display.js';
import type { ChatContext } from './types.js';
import {
  formatTimestamp,
  normalizeTag,
  ensureDirExists,
  hasCommand,
  resolveSafeOutputPath,
} from './utils.js';
import {
  readSessionMeta,
  writeSessionMeta,
  listSessionSummaries,
  readSessionEntries,
  formatContentForExport,
  getSessionMetaSummary,
} from './session-meta.js';

const MAX_SEARCH_LIMIT = 100;
const MAX_SEARCH_ENTRIES = 5_000;
const MAX_REGEX_PATTERN_LENGTH = 160;
const MAX_REGEX_CONTENT_LENGTH = 12_000;
const MAX_SEARCH_RUNTIME_MS = 2_000;
function isUnsafeRegexPattern(pattern: string): string | null {
  if (pattern.length > MAX_REGEX_PATTERN_LENGTH) {
    return `Regex pattern exceeds ${MAX_REGEX_PATTERN_LENGTH} characters`;
  }
  if (
    pattern.includes('(?=') ||
    pattern.includes('(?!') ||
    pattern.includes('(?<=') ||
    pattern.includes('(?<!')
  ) {
    return 'Regex lookaround assertions are disabled for safety.';
  }
  if (/\([^)]*[+*][^)]*\)[+*]/.test(pattern)) {
    return 'Regex has nested repetition and may cause expensive evaluation.';
  }
  return null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export async function handleSessionCommand(input: string, ctx: ChatContext): Promise<boolean> {
  // /session stats — show session storage statistics
  if (hasCommand(input, '/session stats')) {
    const stats = getSessionStorageStats();
    console.log(formatSuccess('Session Storage Stats'));
    const rows = [
      { key: 'Total sessions', value: String(stats.totalSessions) },
      { key: 'Total size', value: formatBytes(stats.totalBytes) },
      { key: 'Empty sessions', value: String(stats.emptySessions) },
      { key: 'Archived', value: String(stats.archivedCount) },
      {
        key: 'Oldest',
        value: stats.oldestMs ? new Date(stats.oldestMs).toLocaleDateString() : '-',
      },
      {
        key: 'Newest',
        value: stats.newestMs ? new Date(stats.newestMs).toLocaleDateString() : '-',
      },
    ];
    console.log(formatTable(rows, ['key', 'value']));
    console.log('');
    ctx.rl.prompt();
    return true;
  }

  // /session cleanup — remove empty sessions older than N days
  if (hasCommand(input, '/session cleanup')) {
    const tokens = input.split(/\s+/).slice(2);
    const dryRun = tokens.includes('--dry-run');
    let maxAgeDays = 30;
    for (const token of tokens) {
      if (token.startsWith('days=')) {
        const val = Number(token.slice('days='.length));
        if (Number.isFinite(val) && val > 0) maxAgeDays = Math.floor(val);
      }
    }

    const result = cleanupSessions({ maxAgeDays, dryRun });
    if (result.removed.length === 0) {
      console.log(formatSuccess('No sessions to clean up.'));
    } else {
      const verb = dryRun ? 'Would remove' : 'Removed';
      console.log(
        formatSuccess(
          `${verb} ${result.removed.length} session(s), freeing ${formatBytes(result.freedBytes)}.`,
        ),
      );
      for (const id of result.removed) {
        console.log(chalk.gray(`  - ${id}`));
      }
    }
    if (result.errors.length > 0) {
      for (const err of result.errors) {
        console.log(formatError(err));
      }
    }
    console.log('');
    ctx.rl.prompt();
    return true;
  }

  // /session — show current session info
  if (hasCommand(input, '/session')) {
    const memory = loadMemory(ctx.sessionId);
    const meta = readSessionMeta(ctx.sessionStore.getSessionDir());
    const tags = Array.isArray(meta.tags) ? meta.tags : [];
    console.log(formatSuccess(`Session: ${ctx.sessionId}`));
    console.log(chalk.gray(`  Path: ${ctx.sessionStore.getSessionDir()}`));
    console.log(chalk.gray(`  Messages: ${ctx.agent.getHistoryLength()}`));
    console.log(chalk.gray(`  Tags: ${tags.length ? tags.join(', ') : '-'}`));
    console.log(chalk.gray(`  Archived: ${meta.archived ? 'yes' : 'no'}`));
    console.log(chalk.gray(`  Memory: ${memory ? 'loaded' : 'none'}`));
    console.log('');
    ctx.rl.prompt();
    return true;
  }

  // /sessions — list sessions
  if (hasCommand(input, '/sessions')) {
    const tokens = input.split(/\s+/).slice(1);
    const includeArchived = tokens.includes('all') || tokens.includes('archived');
    const tagFilterToken = tokens.find((t) => t.startsWith('tag='));
    const tagFilter = tagFilterToken ? normalizeTag(tagFilterToken.slice('tag='.length)) : null;
    let sessions = listSessionSummaries({ includeArchived });
    if (tagFilter) {
      sessions = sessions.filter((session) =>
        session.tags.map((t) => normalizeTag(t) || '').includes(tagFilter),
      );
    }
    if (sessions.length === 0) {
      console.log(formatSuccess('No sessions found.'));
    } else {
      console.log(formatSuccess('Available sessions:'));
      const rows = sessions.map((session) => ({
        id: session.id,
        messages: String(session.messageCount),
        updated: formatTimestamp(session.updatedAtMs),
        tags: session.tags.length ? session.tags.join(', ') : '-',
        archived: session.archived ? 'yes' : '',
        current: session.id === ctx.sessionId ? 'yes' : '',
      }));
      console.log(formatTable(rows, ['id', 'messages', 'updated', 'tags', 'archived', 'current']));
    }
    console.log('');
    ctx.rl.prompt();
    return true;
  }

  // /new — create or switch to a new session
  if (hasCommand(input, '/new')) {
    const provided = input.slice(4).trim();
    let nextId = provided;
    if (!nextId) {
      const defaultId = `session-${new Date()
        .toISOString()
        .replace(/[-:.TZ]/g, '')
        .slice(0, 14)}`;
      ctx.rl.pause();
      const answer = await inquirer.prompt([
        {
          type: 'input',
          name: 'sessionName',
          message: 'New session name:',
          default: defaultId,
        },
      ]);
      ctx.rl.resume();
      nextId = String(answer.sessionName || '').trim();
    }

    if (!nextId) {
      console.log(formatWarning('Session name is required.'));
      console.log('');
      ctx.rl.prompt();
      return true;
    }

    const sanitized = sanitizeSessionId(nextId);
    const sessionDir = path.join(getSessionsDir(), sanitized);
    if (fs.existsSync(sessionDir)) {
      ctx.rl.pause();
      const { proceed } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'proceed',
          message: `Session "${sanitized}" exists. Switch to it?`,
          default: false,
        },
      ]);
      ctx.rl.resume();
      if (!proceed) {
        console.log(formatWarning('Session switch cancelled.'));
        console.log('');
        ctx.rl.prompt();
        return true;
      }
    }

    ctx.switchSession(sanitized);
    console.log('');
    ctx.rl.prompt();
    return true;
  }

  // /resume — interactive session picker
  if (hasCommand(input, '/resume')) {
    const sessions = listSessionSummaries({ includeArchived: true });
    if (sessions.length === 0) {
      console.log(formatSuccess('No sessions found.'));
      console.log('');
      ctx.rl.prompt();
      return true;
    }

    ctx.rl.pause();
    const choices: Array<
      { name: string; value: string } | InstanceType<typeof inquirer.Separator>
    > = sessions.map((session) => ({
      name: `${session.id} (${session.messageCount} msgs, updated ${formatTimestamp(session.updatedAtMs)})${session.archived ? ' [archived]' : ''}${session.id === ctx.sessionId ? ' [current]' : ''}`,
      value: session.id,
    }));
    choices.push(new inquirer.Separator());
    choices.push({ name: 'Enter custom session id', value: '__custom__' });

    const { selected } = await inquirer.prompt([
      { type: 'list', name: 'selected', message: 'Resume session:', choices },
    ]);
    ctx.rl.resume();

    if (selected === '__custom__') {
      ctx.rl.pause();
      const { customId } = await inquirer.prompt([
        { type: 'input', name: 'customId', message: 'Session id:' },
      ]);
      ctx.rl.resume();
      if (!customId || !String(customId).trim()) {
        console.log(formatWarning('Session id is required.'));
        console.log('');
        ctx.rl.prompt();
        return true;
      }
      ctx.switchSession(String(customId));
      console.log('');
      ctx.rl.prompt();
      return true;
    }

    if (selected === ctx.sessionId) {
      console.log(formatSuccess(`Already on session: ${ctx.sessionId}`));
    } else {
      ctx.switchSession(String(selected));
    }
    console.log('');
    ctx.rl.prompt();
    return true;
  }

  // /rename — rename current session
  if (hasCommand(input, '/rename')) {
    const newId = input.slice('/rename'.length).trim();
    if (!newId) {
      console.log(formatWarning('Usage: /rename <new-session-id>'));
      console.log('');
      ctx.rl.prompt();
      return true;
    }

    const sanitized = sanitizeSessionId(newId);
    if (sanitized === ctx.sessionId) {
      console.log(formatSuccess('Session name is unchanged.'));
      console.log('');
      ctx.rl.prompt();
      return true;
    }

    const currentDir = ctx.sessionStore.getSessionDir();
    const targetDir = path.join(getSessionsDir(), sanitized);
    if (fs.existsSync(targetDir)) {
      console.log(formatWarning(`Session "${sanitized}" already exists.`));
      console.log('');
      ctx.rl.prompt();
      return true;
    }

    try {
      fs.renameSync(currentDir, targetDir);
      ctx.switchSession(sanitized);
    } catch (err) {
      console.error(formatError(err instanceof Error ? err.message : String(err)));
    }

    console.log('');
    ctx.rl.prompt();
    return true;
  }

  // /delete — delete a session
  if (hasCommand(input, '/delete')) {
    const arg = input.slice('/delete'.length).trim();
    const target = sanitizeSessionId(arg || ctx.sessionId);
    const targetDir = path.join(getSessionsDir(), target);
    if (!fs.existsSync(targetDir)) {
      console.log(formatWarning(`Session "${target}" not found.`));
      console.log('');
      ctx.rl.prompt();
      return true;
    }

    ctx.rl.pause();
    const { confirmDelete } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmDelete',
        message: `Delete session "${target}"?`,
        default: false,
      },
    ]);
    ctx.rl.resume();
    if (!confirmDelete) {
      console.log(formatWarning('Delete cancelled.'));
      console.log('');
      ctx.rl.prompt();
      return true;
    }

    try {
      fs.rmSync(targetDir, { recursive: true, force: true });
      if (target === ctx.sessionId) {
        ctx.switchSession('default');
      } else {
        console.log(formatSuccess(`Deleted session "${target}".`));
      }
    } catch (err) {
      console.error(formatError(err instanceof Error ? err.message : String(err)));
    }

    console.log('');
    ctx.rl.prompt();
    return true;
  }

  // /archive — archive a session
  if (hasCommand(input, '/archive')) {
    const target = sanitizeSessionId(input.slice('/archive'.length).trim() || ctx.sessionId);
    const targetDir = path.join(getSessionsDir(), target);
    if (!fs.existsSync(targetDir)) {
      console.log(formatWarning(`Session "${target}" not found.`));
      console.log('');
      ctx.rl.prompt();
      return true;
    }
    const meta = readSessionMeta(targetDir);
    meta.archived = true;
    writeSessionMeta(targetDir, meta);
    console.log(formatSuccess(`Archived session "${target}".`));
    console.log('');
    ctx.rl.prompt();
    return true;
  }

  // /unarchive — unarchive a session
  if (hasCommand(input, '/unarchive')) {
    const target = sanitizeSessionId(input.slice('/unarchive'.length).trim() || ctx.sessionId);
    const targetDir = path.join(getSessionsDir(), target);
    if (!fs.existsSync(targetDir)) {
      console.log(formatWarning(`Session "${target}" not found.`));
      console.log('');
      ctx.rl.prompt();
      return true;
    }
    const meta = readSessionMeta(targetDir);
    meta.archived = false;
    writeSessionMeta(targetDir, meta);
    console.log(formatSuccess(`Unarchived session "${target}".`));
    console.log('');
    ctx.rl.prompt();
    return true;
  }

  // /tag — manage session tags
  if (hasCommand(input, '/tag')) {
    const tokens = input.split(/\s+/).slice(1);
    const action = tokens[0];
    if (!action) {
      console.log(formatWarning('Usage: /tag <list|add|remove> [tag] [session]'));
      console.log('');
      ctx.rl.prompt();
      return true;
    }

    if (action === 'list') {
      const target = sanitizeSessionId(tokens[1] || ctx.sessionId);
      const targetDir = path.join(getSessionsDir(), target);
      if (!fs.existsSync(targetDir)) {
        console.log(formatWarning(`Session "${target}" not found.`));
        console.log('');
        ctx.rl.prompt();
        return true;
      }
      const meta = readSessionMeta(targetDir);
      const tags = Array.isArray(meta.tags) ? meta.tags : [];
      console.log(formatSuccess(`Tags for "${target}": ${tags.length ? tags.join(', ') : '-'}`));
      console.log('');
      ctx.rl.prompt();
      return true;
    }

    if (action === 'add' || action === 'remove') {
      const rawTag = tokens[1];
      const target = sanitizeSessionId(tokens[2] || ctx.sessionId);
      if (!rawTag) {
        console.log(formatWarning(`Usage: /tag ${action} <tag> [session]`));
        console.log('');
        ctx.rl.prompt();
        return true;
      }
      const tag = normalizeTag(rawTag);
      if (!tag) {
        console.log(formatWarning('Tag cannot be empty.'));
        console.log('');
        ctx.rl.prompt();
        return true;
      }
      const targetDir = path.join(getSessionsDir(), target);
      if (!fs.existsSync(targetDir)) {
        console.log(formatWarning(`Session "${target}" not found.`));
        console.log('');
        ctx.rl.prompt();
        return true;
      }
      const meta = readSessionMeta(targetDir);
      const tags = new Set((meta.tags || []).map((t) => normalizeTag(t) || '').filter(Boolean));
      if (action === 'add') {
        tags.add(tag);
      } else {
        tags.delete(tag);
      }
      meta.tags = Array.from(tags.values()).sort();
      writeSessionMeta(targetDir, meta);
      console.log(
        formatSuccess(`Tags for "${target}": ${meta.tags.length ? meta.tags.join(', ') : '-'}`),
      );
      console.log('');
      ctx.rl.prompt();
      return true;
    }

    console.log(formatWarning('Usage: /tag <list|add|remove> [tag] [session]'));
    console.log('');
    ctx.rl.prompt();
    return true;
  }

  // /search — search across sessions
  if (hasCommand(input, '/search')) {
    const tokens = input.split(/\s+/).slice(1);
    const includeArchived = tokens.includes('all') || tokens.includes('archived');
    let roleFilter: 'user' | 'assistant' | null = null;
    let since: string | null = null;
    let until: string | null = null;
    let regexPattern: string | null = null;
    let regexFlags = '';
    let limit = 25;
    let term = '';
    const termParts: string[] = [];
    for (const token of tokens) {
      if (token === 'all' || token === 'archived') continue;
      if (token.startsWith('role=')) {
        const val = token.slice('role='.length).toLowerCase();
        if (val === 'user' || val === 'assistant') {
          roleFilter = val;
        } else {
          console.log(formatWarning('Invalid role filter. Use role=user or role=assistant.'));
          console.log('');
          ctx.rl.prompt();
          return true;
        }
        continue;
      }
      if (token.startsWith('since=')) {
        since = token.slice('since='.length);
        continue;
      }
      if (token.startsWith('until=')) {
        until = token.slice('until='.length);
        continue;
      }
      if (token.startsWith('regex=')) {
        const raw = token.slice('regex='.length);
        if (!raw) {
          console.log(formatWarning('Invalid regex: pattern is required for regex=.'));
          console.log('');
          ctx.rl.prompt();
          return true;
        }
        const match = raw.match(/^\/(.+)\/([gimsuy]*)$/);
        if (match) {
          regexPattern = match[1];
          regexFlags = match[2] || '';
        } else {
          regexPattern = raw;
          regexFlags = '';
        }
        continue;
      }
      if (token.startsWith('regexi=')) {
        if (token.length <= 'regexi='.length) {
          console.log(formatWarning('Invalid regex: pattern is required for regexi=.'));
          console.log('');
          ctx.rl.prompt();
          return true;
        }
        regexPattern = token.slice('regexi='.length);
        regexFlags = 'i';
        continue;
      }
      if (token.startsWith('limit=')) {
        const val = Number(token.slice('limit='.length));
        if (!Number.isFinite(val) || val <= 0) {
          console.log(formatWarning('Invalid limit. Use a positive number.'));
          console.log('');
          ctx.rl.prompt();
          return true;
        }
        if (val > MAX_SEARCH_LIMIT) {
          console.log(
            formatWarning(`Requested limit ${Math.floor(val)} exceeds ${MAX_SEARCH_LIMIT}.`),
          );
        }
        limit = Math.min(MAX_SEARCH_LIMIT, Math.floor(val));
        continue;
      }
      termParts.push(token);
    }
    term = termParts.join(' ').trim();
    if (!term && !regexPattern) {
      console.log(
        formatWarning(
          'Usage: /search <text> [all] [role=user|assistant] [since=YYYY-MM-DD] [until=YYYY-MM-DD] [regex=/pattern/i]',
        ),
      );
      console.log('');
      ctx.rl.prompt();
      return true;
    }

    let sinceMs: number | null = null;
    if (since) {
      const parsed = Date.parse(since);
      if (Number.isFinite(parsed)) {
        sinceMs = parsed;
      } else {
        console.log(formatWarning('Invalid since date. Use YYYY-MM-DD.'));
        console.log('');
        ctx.rl.prompt();
        return true;
      }
    }
    let untilMs: number | null = null;
    if (until) {
      const parsed = Date.parse(until);
      if (Number.isFinite(parsed)) {
        untilMs = parsed;
      } else {
        console.log(formatWarning('Invalid until date. Use YYYY-MM-DD.'));
        console.log('');
        ctx.rl.prompt();
        return true;
      }
    }
    if (sinceMs !== null && untilMs !== null && sinceMs > untilMs) {
      console.log(
        formatWarning('Invalid date range. `since` must be earlier than or equal to `until`.'),
      );
      console.log('');
      ctx.rl.prompt();
      return true;
    }

    const sessions = listSessionSummaries({ includeArchived });
    if (sessions.length === 0) {
      console.log(formatSuccess('No sessions found.'));
      console.log('');
      ctx.rl.prompt();
      return true;
    }

    const results: Array<{ session: string; role: string; excerpt: string; ts?: string }> = [];
    const lowerTerm = term.toLowerCase();
    let regex: RegExp | null = null;
    if (regexPattern) {
      const regexError = isUnsafeRegexPattern(regexPattern);
      if (regexError) {
        console.log(formatWarning(`Invalid regex: ${regexError}`));
        console.log('');
        ctx.rl.prompt();
        return true;
      }
      try {
        regex = new RegExp(regexPattern, regexFlags);
      } catch {
        console.log(formatWarning('Invalid regex pattern.'));
        console.log('');
        ctx.rl.prompt();
        return true;
      }
    }
    let scannedEntries = 0;
    let scanLimitReached = false;
    let outputLimitReached = false;
    let scanTimedOut = false;
    const scanDeadline = Date.now() + MAX_SEARCH_RUNTIME_MS;
    searchLoop: for (const session of sessions) {
      const entries = readSessionEntries(session.id);
      for (const entry of entries) {
        if (Date.now() > scanDeadline) {
          scanTimedOut = true;
          break searchLoop;
        }
        scannedEntries += 1;
        if (scannedEntries > MAX_SEARCH_ENTRIES) {
          scanLimitReached = true;
          break;
        }
        if (roleFilter && entry.role !== roleFilter) continue;
        if (sinceMs && entry.ts) {
          const entryMs = Date.parse(entry.ts);
          if (Number.isFinite(entryMs) && entryMs < sinceMs) continue;
        }
        if (untilMs && entry.ts) {
          const entryMs = Date.parse(entry.ts);
          if (Number.isFinite(entryMs) && entryMs > untilMs) continue;
        }
        const content = formatContentForExport(entry.content)?.slice(0, MAX_REGEX_CONTENT_LENGTH);
        if (!content) continue;
        let idx = -1;
        let match: RegExpMatchArray | null = null;
        if (regex) {
          const searchableRegex =
            regex.global || regex.sticky
              ? new RegExp(regex.source, regex.flags.replace(/[gy]/g, ''))
              : regex;
          match = searchableRegex.exec(content);
          if (!match || match.index === undefined) continue;
          idx = match.index;
        } else {
          idx = content.toLowerCase().indexOf(lowerTerm);
          if (idx === -1) continue;
        }
        const start = Math.max(0, idx - 40);
        const matchLen = regex ? (match?.[0]?.length ?? 0) : term.length;
        const end = Math.min(content.length, idx + matchLen + 40);
        const excerpt = content.slice(start, end).replace(/\s+/g, ' ');
        results.push({
          session: session.id,
          role: entry.role,
          excerpt: (start > 0 ? '...' : '') + excerpt + (end < content.length ? '...' : ''),
          ts: entry.ts,
        });
        if (results.length >= limit) {
          outputLimitReached = true;
          break;
        }
      }
      if (scanLimitReached) {
        break;
      }
      if (results.length >= limit) break;
    }

    if (scanLimitReached) {
      console.log(formatWarning(`Search stopped after ${MAX_SEARCH_ENTRIES} scanned entries.`));
      console.log(formatWarning('Use narrower filters to inspect additional matches.'));
    } else if (scanTimedOut) {
      console.log(formatWarning(`Search timed out after ${MAX_SEARCH_RUNTIME_MS}ms.`));
      console.log(formatWarning('Use narrower filters to avoid large scans.'));
    } else if (outputLimitReached) {
      console.log(formatWarning(`Result limit reached after ${results.length} matches.`));
      console.log(
        formatWarning(`Increase limit (max ${MAX_SEARCH_LIMIT}) to view more if available.`),
      );
    }

    if (results.length === 0) {
      if (scanLimitReached) {
        console.log(formatWarning('No matches found in scanned entries.'));
      } else {
        console.log(formatSuccess('No matches found.'));
      }
    } else {
      const label = regexPattern ? `/${regexPattern}/${regexFlags || ''}` : `"${term}"`;
      console.log(formatSuccess(`Matches for ${label} (showing ${results.length}):`));
      const rows = results.map((result) => ({
        session: result.session,
        role: result.role,
        time: result.ts ? new Date(result.ts).toLocaleString() : '',
        excerpt: result.excerpt,
      }));
      console.log(formatTable(rows, ['session', 'role', 'time', 'excerpt']));
    }
    console.log('');
    ctx.rl.prompt();
    return true;
  }

  // /session-meta — detailed session metadata
  if (hasCommand(input, '/session-meta')) {
    const tokens = input.split(/\s+/).slice(1);
    let target = ctx.sessionId;
    let format: 'text' | 'json' | 'md' = 'text';
    let outPath: string | null = null;
    const allowUnsafePath = tokens.includes('--unsafe-path');
    const args = tokens.filter((token) => !token.startsWith('--'));

    for (const token of args) {
      if (!token) continue;
      if (token === 'json') {
        format = 'json';
        continue;
      }
      if (token === 'md' || token === 'markdown') {
        format = 'md';
        continue;
      }
      if (token.startsWith('out=')) {
        outPath = token.slice('out='.length);
        continue;
      }
      if (!token.includes('=')) {
        target = sanitizeSessionId(token);
      }
    }

    if (!fs.existsSync(getSessionDir(target))) {
      console.log(formatWarning(`Session "${target}" not found.`));
      console.log('');
      ctx.rl.prompt();
      return true;
    }

    const meta = getSessionMetaSummary(target);
    const payload = {
      id: meta.id,
      dir: meta.dir,
      updated: meta.updatedAtMs ? new Date(meta.updatedAtMs).toISOString() : null,
      messages: meta.messages,
      tags: meta.tags,
      archived: meta.archived,
      memory: meta.memory,
      exports: meta.exports,
      audit_entries: meta.auditEntries,
    };

    let outputText = '';
    if (format === 'json') {
      outputText = JSON.stringify(payload, null, 2);
    } else if (format === 'md') {
      const lines = [
        `# Session Meta: ${meta.id}`,
        '',
        `- Path: ${meta.dir}`,
        `- Updated: ${payload.updated || 'unknown'}`,
        `- Messages: ${meta.messages}`,
        `- Tags: ${meta.tags.length ? meta.tags.join(', ') : '-'}`,
        `- Archived: ${meta.archived ? 'yes' : 'no'}`,
        `- Memory (global): ${meta.memory.global ? 'yes' : 'no'}`,
        `- Memory (session): ${meta.memory.session ? 'yes' : 'no'}`,
        `- Exports: ${meta.exports}`,
        `- Audit entries: ${meta.auditEntries}`,
        '',
      ];
      outputText = lines.join('\n');
    } else {
      console.log(formatSuccess(`Session meta: ${meta.id}`));
      const rows = [
        { key: 'Path', value: meta.dir },
        { key: 'Updated', value: payload.updated || 'unknown' },
        { key: 'Messages', value: String(meta.messages) },
        { key: 'Tags', value: meta.tags.length ? meta.tags.join(', ') : '-' },
        { key: 'Archived', value: meta.archived ? 'yes' : 'no' },
        { key: 'Memory (global)', value: meta.memory.global ? 'yes' : 'no' },
        { key: 'Memory (session)', value: meta.memory.session ? 'yes' : 'no' },
        { key: 'Exports', value: String(meta.exports) },
        { key: 'Audit entries', value: String(meta.auditEntries) },
      ];
      console.log(formatTable(rows, ['key', 'value']));
      console.log('');
      ctx.rl.prompt();
      return true;
    }

    if (outPath) {
      try {
        const resolved = resolveSafeOutputPath(outPath, {
          label: 'Session meta output',
          allowOutside: allowUnsafePath,
          allowedRoots: [ctx.cwd, getStateSetDir()],
        });
        ensureDirExists(resolved);
        fs.writeFileSync(resolved, outputText, 'utf-8');
        console.log(formatSuccess(`Session meta saved to ${resolved}`));
      } catch (err) {
        console.error(formatError(err instanceof Error ? err.message : String(err)));
      }
    } else {
      console.log(formatSuccess(`Session meta (${format}):`));
      console.log(chalk.gray(outputText));
    }

    console.log('');
    ctx.rl.prompt();
    return true;
  }

  return false;
}
