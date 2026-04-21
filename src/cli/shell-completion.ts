import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Command } from 'commander';
import { STATIC_FLAG_VALUE_HINTS } from './completion-hints.js';

export type CompletionShell = 'bash' | 'zsh' | 'fish' | 'powershell';

export interface CompletionSpec {
  rootCommands: string[];
  rootFlags: string[];
  pathMap: Record<string, string[]>;
  flagMap: Record<string, string[]>;
  flagArgumentMap: Record<string, string[]>;
  flagValueMap: Record<string, string[]>;
}

export interface CompletionIoOptions {
  binName?: string;
  env?: NodeJS.ProcessEnv;
  homedir?: string;
}

interface CommanderArgumentLike {
  description?: string;
  variadic?: boolean;
}

interface CommanderOptionLike {
  long?: string;
  optional?: boolean;
  required?: boolean;
}

const SUPPORTED_SHELLS: CompletionShell[] = ['bash', 'zsh', 'fish', 'powershell'];
const EXTRA_ROOT_FLAGS_WITH_VALUES = new Set(['--profile']);

function uniqueSorted(values: readonly string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function flagValueKey(pathName: string, flag: string): string {
  return `${pathName}::${flag}`;
}

function isVisibleCommand(command: Command): boolean {
  const hidden = (command as Command & { _hidden?: boolean })._hidden === true;
  return !hidden && command.name() !== 'help';
}

function collectLongFlags(command: Command): string[] {
  const longs = command.options
    .map((option) => option.long)
    .filter((value): value is string => Boolean(value));
  return uniqueSorted([...longs, '--help', '--version']);
}

function collectFlagsWithValues(command: Command): string[] {
  const longs = (command.options as readonly CommanderOptionLike[])
    .filter((option) => option.required || option.optional)
    .map((option) => option.long)
    .filter((value): value is string => Boolean(value));
  return uniqueSorted(longs);
}

function getRegisteredArguments(command: Command): CommanderArgumentLike[] {
  const registeredArguments = (
    command as Command & { registeredArguments?: CommanderArgumentLike[] }
  ).registeredArguments;
  return registeredArguments ?? [];
}

function mergePathMapEntry(
  pathMap: Record<string, string[]>,
  key: string,
  values: readonly string[],
): void {
  pathMap[key] = uniqueSorted([...(pathMap[key] ?? []), ...values]);
}

function mergeFlagMapEntry(
  flagMap: Record<string, string[]>,
  key: string,
  values: readonly string[],
): void {
  flagMap[key] = uniqueSorted([...(flagMap[key] ?? []), ...values]);
}

function mergeFlagArgumentMapEntry(
  flagArgumentMap: Record<string, string[]>,
  key: string,
  values: readonly string[],
): void {
  flagArgumentMap[key] = uniqueSorted([...(flagArgumentMap[key] ?? []), ...values]);
}

function mergeFlagValueMapEntry(
  flagValueMap: Record<string, string[]>,
  pathName: string,
  flag: string,
  values: readonly string[],
): void {
  const key = flagValueKey(pathName, flag);
  flagValueMap[key] = uniqueSorted([...(flagValueMap[key] ?? []), ...values]);
}

function extractDescribedSubcommands(command: Command): string[] {
  const [firstArgument] = getRegisteredArguments(command);
  if (!firstArgument?.variadic || !firstArgument.description) {
    return [];
  }

  const colonIndex = firstArgument.description.indexOf(':');
  if (colonIndex === -1) {
    return [];
  }

  const descriptor = firstArgument.description.slice(colonIndex + 1);
  return uniqueSorted(
    descriptor
      .split('|')
      .map((part) => part.trim())
      .map((part) => part.replace(/\[[^\]]*]/g, '').trim())
      .map((part) => part.split(/\s+/)[0] || '')
      .filter((part) => part.length > 0)
      .filter((part) => !part.startsWith('<') && !part.startsWith('[')),
  );
}

function populatePathMap(
  command: Command,
  pathSegments: string[] = [],
  pathMap: Record<string, string[]> = {},
  flagMap: Record<string, string[]> = {},
  flagArgumentMap: Record<string, string[]> = {},
  flagValueMap: Record<string, string[]> = {},
): Record<string, string[]> {
  const key = pathSegments.join(' ');
  const children = command.commands.filter(isVisibleCommand);
  pathMap[key] = uniqueSorted(children.map((child) => child.name()));
  flagMap[key] = collectLongFlags(command);
  flagArgumentMap[key] = collectFlagsWithValues(command);
  for (const [flag, values] of Object.entries(STATIC_FLAG_VALUE_HINTS[key] ?? {})) {
    mergeFlagValueMapEntry(flagValueMap, key, flag, values);
  }

  for (const child of children) {
    populatePathMap(
      child,
      [...pathSegments, child.name()],
      pathMap,
      flagMap,
      flagArgumentMap,
      flagValueMap,
    );
  }

  return pathMap;
}

function populateDescribedArgumentPaths(
  command: Command,
  pathSegments: string[] = [],
  pathMap: Record<string, string[]> = {},
  flagMap: Record<string, string[]> = {},
  flagArgumentMap: Record<string, string[]> = {},
  flagValueMap: Record<string, string[]> = {},
): Record<string, string[]> {
  const key = pathSegments.join(' ');
  const describedSubcommands = extractDescribedSubcommands(command);
  if (describedSubcommands.length > 0) {
    mergePathMapEntry(pathMap, key, describedSubcommands);
    for (const subcommand of describedSubcommands) {
      const leafKey = [...pathSegments, subcommand].join(' ');
      if (!(leafKey in pathMap)) {
        pathMap[leafKey] = [];
      }
      mergeFlagMapEntry(flagMap, leafKey, flagMap[key] ?? []);
      mergeFlagArgumentMapEntry(flagArgumentMap, leafKey, flagArgumentMap[key] ?? []);
      for (const flag of flagMap[key] ?? []) {
        const inherited = flagValueMap[flagValueKey(key, flag)];
        if (inherited) {
          mergeFlagValueMapEntry(flagValueMap, leafKey, flag, inherited);
        }
      }
      for (const [flag, values] of Object.entries(STATIC_FLAG_VALUE_HINTS[leafKey] ?? {})) {
        mergeFlagValueMapEntry(flagValueMap, leafKey, flag, values);
      }
    }
  }

  for (const child of command.commands.filter(isVisibleCommand)) {
    populateDescribedArgumentPaths(
      child,
      [...pathSegments, child.name()],
      pathMap,
      flagMap,
      flagArgumentMap,
      flagValueMap,
    );
  }

  return pathMap;
}

function quoteForShell(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function quoteForFishConditionArg(value: string): string {
  return `"${value.replace(/["\\]/g, '\\$&')}"`;
}

function quoteForPowerShell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function renderPathMapAssignments(spec: CompletionSpec, indent = '  '): string {
  return Object.entries(spec.pathMap)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(
      ([pathName, subcommands]) =>
        `${indent}_response_subcommands[${quoteForShell(pathName)}]=${quoteForShell(subcommands.join(' '))}`,
    )
    .join('\n');
}

function renderFlagMapAssignments(spec: CompletionSpec, indent = '  '): string {
  return Object.entries(spec.flagMap)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(
      ([pathName, flags]) =>
        `${indent}_response_flags[${quoteForShell(pathName)}]=${quoteForShell(flags.join(' '))}`,
    )
    .join('\n');
}

function renderFlagArgumentMapAssignments(spec: CompletionSpec, indent = '  '): string {
  return Object.entries(spec.flagArgumentMap)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(
      ([pathName, flags]) =>
        `${indent}_response_flags_with_values[${quoteForShell(pathName)}]=${quoteForShell(flags.join(' '))}`,
    )
    .join('\n');
}

function renderFlagValueMapAssignments(spec: CompletionSpec, indent = '  '): string {
  return Object.entries(spec.flagValueMap)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(
      ([key, values]) =>
        `${indent}_response_flag_values[${quoteForShell(key)}]=${quoteForShell(values.join(' '))}`,
    )
    .join('\n');
}

function renderPowerShellHashtable(values: Record<string, string[]>): string {
  return Object.entries(values)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(
      ([key, entries]) => `  ${quoteForPowerShell(key)} = ${quoteForPowerShell(entries.join(' '))}`,
    )
    .join('\n');
}

function sanitizeCompletionBasename(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return 'response';
  }
  return trimmed.replace(/[^a-zA-Z0-9._-]/g, '-');
}

function isCompletionProfileHeader(line: string): boolean {
  return line.trim() === '# StateSet Response Completion';
}

function isCompletionProfileLine(line: string, binName: string, cachePath: string | null): boolean {
  if (line.includes(`${binName} completion`)) {
    return true;
  }
  if (cachePath && line.includes(cachePath)) {
    return true;
  }
  return false;
}

function updateCompletionProfile(
  content: string,
  binName: string,
  cachePath: string,
  sourceLine: string,
): { next: string; changed: boolean } {
  const lines = content.split('\n');
  const filtered: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (isCompletionProfileHeader(line)) {
      index += 1;
      continue;
    }
    if (isCompletionProfileLine(line, binName, cachePath)) {
      continue;
    }
    filtered.push(line);
  }

  const trimmed = filtered.join('\n').trimEnd();
  const block = `# StateSet Response Completion\n${sourceLine}`;
  const next = trimmed ? `${trimmed}\n\n${block}\n` : `${block}\n`;
  return { next, changed: next !== content };
}

function formatCompletionSourceLine(shell: CompletionShell, cachePath: string): string {
  if (shell === 'powershell') {
    return `. "${cachePath}"`;
  }
  return `source "${cachePath}"`;
}

export function resolveShellFromEnv(env: NodeJS.ProcessEnv = process.env): CompletionShell {
  const shellPath = env.SHELL?.trim() ?? '';
  const shellName = shellPath ? path.basename(shellPath).toLowerCase() : '';
  if (shellName === 'zsh') {
    return 'zsh';
  }
  if (shellName === 'bash') {
    return 'bash';
  }
  if (shellName === 'fish') {
    return 'fish';
  }
  if (shellName === 'pwsh' || shellName === 'powershell') {
    return 'powershell';
  }
  return process.platform === 'win32' ? 'powershell' : 'bash';
}

export function resolveCompletionShell(
  shell: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): CompletionShell {
  if (!shell) {
    return resolveShellFromEnv(env);
  }

  const normalized = shell.toLowerCase();
  if (SUPPORTED_SHELLS.includes(normalized as CompletionShell)) {
    return normalized as CompletionShell;
  }

  throw new Error(`Unknown shell: ${shell}. Use bash, zsh, fish, or powershell.`);
}

export function resolveCompletionCachePath(
  shell: CompletionShell,
  options: CompletionIoOptions = {},
): string {
  const homedir = options.homedir ?? os.homedir();
  const env = options.env ?? process.env;
  const binName = sanitizeCompletionBasename(options.binName ?? 'response');
  const stateDir = env.STATESET_STATE_DIR?.trim() || path.join(homedir, '.stateset');
  const extension =
    shell === 'powershell' ? 'ps1' : shell === 'fish' ? 'fish' : shell === 'bash' ? 'bash' : 'zsh';
  return path.join(stateDir, 'completions', `${binName}.${extension}`);
}

export function getShellProfilePath(
  shell: CompletionShell,
  options: CompletionIoOptions = {},
): string {
  const homedir = options.homedir ?? os.homedir();
  const env = options.env ?? process.env;
  if (shell === 'zsh') {
    return path.join(homedir, '.zshrc');
  }
  if (shell === 'bash') {
    return path.join(homedir, '.bashrc');
  }
  if (shell === 'fish') {
    return path.join(homedir, '.config', 'fish', 'config.fish');
  }
  if (process.platform === 'win32') {
    return path.join(
      env.USERPROFILE || homedir,
      'Documents',
      'PowerShell',
      'Microsoft.PowerShell_profile.ps1',
    );
  }
  return path.join(homedir, '.config', 'powershell', 'Microsoft.PowerShell_profile.ps1');
}

export function createCompletionSpec(
  program: Command,
  extraRootFlags: string[] = [],
): CompletionSpec {
  const flagMap: Record<string, string[]> = {};
  const flagArgumentMap: Record<string, string[]> = {};
  const flagValueMap: Record<string, string[]> = {};
  const pathMap = populateDescribedArgumentPaths(
    program,
    [],
    populatePathMap(program, [], {}, flagMap, flagArgumentMap, flagValueMap),
    flagMap,
    flagArgumentMap,
    flagValueMap,
  );
  mergeFlagMapEntry(flagMap, '', extraRootFlags);
  mergeFlagArgumentMapEntry(
    flagArgumentMap,
    '',
    extraRootFlags.filter((flag) => EXTRA_ROOT_FLAGS_WITH_VALUES.has(flag)),
  );
  return {
    rootCommands: pathMap[''] ?? [],
    rootFlags: flagMap[''] ?? [],
    pathMap,
    flagMap,
    flagArgumentMap,
    flagValueMap,
  };
}

export function renderBashCompletion(spec: CompletionSpec): string {
  const assignments = renderPathMapAssignments(spec);
  const flagAssignments = renderFlagMapAssignments(spec);
  const flagArgumentAssignments = renderFlagArgumentMapAssignments(spec);
  const flagValueAssignments = renderFlagValueMapAssignments(spec);
  const rootFlags = spec.rootFlags.join(' ');

  return `# bash completion for response CLI
# Add to ~/.bashrc: eval "$(response completion bash)"
_response_completions() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  local prev="\${COMP_WORDS[COMP_CWORD-1]}"

  declare -A _response_subcommands
${assignments}
  declare -A _response_flags
${flagAssignments}
  declare -A _response_flags_with_values
${flagArgumentAssignments}
  declare -A _response_flag_values
${flagValueAssignments}

  _response_flag_takes_value() {
    local path_name="$1"
    local flag="$2"
    local value_flags="\${_response_flags_with_values[$path_name]}"
    [[ " $value_flags " == *" $flag "* ]]
  }

  local path=""
  local word=""
  local candidate=""
  local i=1
  while [ "$i" -lt "$COMP_CWORD" ]; do
    word="\${COMP_WORDS[$i]}"
    if [[ "$word" == -* ]]; then
      if _response_flag_takes_value "$path" "$word"; then
        i=$((i + 2))
      else
        i=$((i + 1))
      fi
      continue
    fi
    candidate="$word"
    if [[ -n "$path" ]]; then
      candidate="$path $word"
    fi
    if [[ -v _response_subcommands["$candidate"] ]]; then
      path="$candidate"
      i=$((i + 1))
      continue
    fi
    break
  done

  if [[ "$prev" == --* ]] && _response_flag_takes_value "$path" "$prev"; then
    local value_key="$path::$prev"
    local value_candidates="\${_response_flag_values[$value_key]}"
    if [[ -n "$value_candidates" ]]; then
      COMPREPLY=($(compgen -W "$value_candidates" -- "$cur"))
      return
    fi
    COMPREPLY=()
    return
  fi

  local candidates="\${_response_subcommands[$path]}"
  local flags="\${_response_flags[$path]}"
  if [[ -z "$path" ]]; then
    flags="${rootFlags}"
  fi
  if [[ -n "$flags" ]]; then
    candidates="$candidates $flags"
  fi
  COMPREPLY=($(compgen -W "$candidates" -- "$cur"))
}
complete -F _response_completions response`;
}

export function renderZshCompletion(spec: CompletionSpec): string {
  const assignments = renderPathMapAssignments(spec);
  const flagAssignments = renderFlagMapAssignments(spec);
  const flagArgumentAssignments = renderFlagArgumentMapAssignments(spec);
  const flagValueAssignments = renderFlagValueMapAssignments(spec);
  const rootFlags = spec.rootFlags.map((flag) => quoteForShell(flag)).join(' ');

  return `# zsh completion for response CLI
# Add to ~/.zshrc: eval "$(response completion zsh)"
_response() {
  local cur="\${words[CURRENT]}"
  local prev="\${words[CURRENT-1]}"

  typeset -A _response_subcommands
${assignments}
  typeset -A _response_flags
${flagAssignments}
  typeset -A _response_flags_with_values
${flagArgumentAssignments}
  typeset -A _response_flag_values
${flagValueAssignments}

  _response_flag_takes_value() {
    local path_name="$1"
    local flag="$2"
    local raw_value_flags="\${_response_flags_with_values[$path_name]}"
    [[ " $raw_value_flags " == *" $flag "* ]]
  }

  local path=""
  local word=""
  local candidate=""
  local i=2
  while (( i < CURRENT )); do
    word="\${words[i]}"
    if [[ "$word" == -* ]]; then
      if _response_flag_takes_value "$path" "$word"; then
        (( i += 2 ))
      else
        (( i++ ))
      fi
      continue
    fi
    candidate="$word"
    if [[ -n "$path" ]]; then
      candidate="$path $word"
    fi
    if (( \${+_response_subcommands[$candidate]} )); then
      path="$candidate"
      (( i++ ))
      continue
    fi
    break
  done

  if [[ "$prev" == --* ]] && _response_flag_takes_value "$path" "$prev"; then
    local value_key="$path::$prev"
    local raw_value_candidates="\${_response_flag_values[$value_key]}"
    if [[ -n "$raw_value_candidates" ]]; then
      compadd -- \${=raw_value_candidates}
      return
    fi
    return
  fi

  local raw="\${_response_subcommands[$path]}"
  local raw_flags="\${_response_flags[$path]}"
  local -a candidates
  if [[ -n "$raw" ]]; then
    candidates=(\${=raw})
  fi
  if [[ -z "$path" ]]; then
    candidates+=(${rootFlags})
  elif [[ -n "$raw_flags" ]]; then
    candidates+=(\${=raw_flags})
  fi
  compadd -- $candidates
}
compdef _response response`;
}

export function renderFishCompletion(spec: CompletionSpec): string {
  const knownPaths = Object.keys(spec.pathMap)
    .filter((pathName) => pathName.length > 0)
    .sort((a, b) => a.localeCompare(b))
    .map((pathName) => quoteForShell(pathName))
    .join(' ');

  const pathLines = Object.entries(spec.pathMap)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .filter(([, subcommands]) => subcommands.length > 0)
    .map(
      ([pathName, subcommands]) =>
        `complete -c response -n '__response_path_is ${quoteForFishConditionArg(pathName)}' -a ${quoteForShell(subcommands.join(' '))}`,
    )
    .join('\n');
  const rootCommands = spec.rootCommands.join(' ');
  const valueFlagKeys = uniqueSorted(
    Object.entries(spec.flagArgumentMap).flatMap(([pathName, flags]) =>
      flags.map((flag) => flagValueKey(pathName, flag)),
    ),
  );
  const fishValueFlagCases =
    valueFlagKeys.length > 0
      ? `  switch "$key"\n    case ${valueFlagKeys.map(quoteForShell).join(' ')}\n      return 0\n  end`
      : '';
  const flagLines = Object.entries(spec.flagMap)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .flatMap(([pathName, flags]) => {
      const condition = `__response_path_is ${quoteForFishConditionArg(pathName)}`;
      const valueFlags = new Set(spec.flagArgumentMap[pathName] ?? []);
      const hintedFlags = Object.keys(spec.flagValueMap)
        .filter((key) => key.startsWith(`${pathName}::`))
        .map((key) => key.slice(key.lastIndexOf('::') + 2));
      const resolvedFlags = uniqueSorted([
        ...flags.filter((flag) => flag.startsWith('--')),
        ...hintedFlags,
      ]);
      return resolvedFlags.map((flag) => {
        const values = spec.flagValueMap[flagValueKey(pathName, flag)] ?? [];
        if (values.length > 0) {
          return `complete -c response -n '${condition}' -l ${flag.slice(2)} -r -xa ${quoteForShell(values.join(' '))}`;
        }
        if (valueFlags.has(flag)) {
          return `complete -c response -n '${condition}' -l ${flag.slice(2)} -r`;
        }
        return `complete -c response -n '${condition}' -l ${flag.slice(2)}`;
      });
    })
    .join('\n');

  return `# fish completion for response CLI
# Save to ~/.config/fish/completions/response.fish
function __response_flag_takes_value
  set -l key "$argv[1]::$argv[2]"
${fishValueFlagCases}
  return 1
end

function __response_path
  set -l words (commandline -opc)
  if test (count $words) -eq 0
    return
  end
  set -e words[1]
  set -l path ""
  set -l index 1
  while test $index -le (count $words)
    set -l word $words[$index]
    if string match -qr '^-' -- "$word"
      if __response_flag_takes_value "$path" "$word"
        set index (math $index + 2)
      else
        set index (math $index + 1)
      end
      continue
    end
    set -l candidate "$word"
    if test -n "$path"
      set candidate "$path $word"
    end
    switch "$candidate"
      case ${knownPaths}
        set path "$candidate"
      case '*'
        break
    end
    set index (math $index + 1)
  end
  echo "$path"
end

function __response_path_is
  test (__response_path) = "$argv[1]"
end

complete -c response -n '__response_path_is ""' -a ${quoteForShell(rootCommands)}
${pathLines}
${flagLines}`;
}

export function renderPowerShellCompletion(spec: CompletionSpec): string {
  const subcommands = renderPowerShellHashtable(spec.pathMap);
  const flags = renderPowerShellHashtable(spec.flagMap);
  const flagsWithValues = renderPowerShellHashtable(spec.flagArgumentMap);
  const flagValues = renderPowerShellHashtable(spec.flagValueMap);

  return `# PowerShell completion for response CLI
$script:ResponseSubcommands = @{
${subcommands}
}

$script:ResponseFlags = @{
${flags}
}

$script:ResponseFlagsWithValues = @{
${flagsWithValues}
}

$script:ResponseFlagValues = @{
${flagValues}
}

function Test-ResponseFlagTakesValue {
  param([string]$Path, [string]$Flag)

  if (-not $script:ResponseFlagsWithValues.ContainsKey($Path) -or -not $script:ResponseFlagsWithValues[$Path]) {
    return $false
  }

  return @($script:ResponseFlagsWithValues[$Path] -split ' ') -contains $Flag
}

function Get-ResponsePath {
  param([string[]]$Words)

  $path = ''
  for ($i = 0; $i -lt $Words.Count; $i++) {
    $word = $Words[$i]
    if ($word -like '-*') {
      if (Test-ResponseFlagTakesValue -Path $path -Flag $word) {
        $i += 1
      }
      continue
    }

    $candidate = if ([string]::IsNullOrEmpty($path)) { $word } else { "$path $word" }
    if ($script:ResponseSubcommands.ContainsKey($candidate)) {
      $path = $candidate
      continue
    }

    break
  }

  return $path
}

Register-ArgumentCompleter -Native -CommandName response -ScriptBlock {
  param($wordToComplete, $commandAst, $cursorPosition)

  $elements = @($commandAst.CommandElements | ForEach-Object { $_.Extent.Text })
  if ($elements.Count -eq 0) {
    return
  }

  $words = @()
  if ($elements.Count -gt 1) {
    $words = $elements[1..($elements.Count - 1)]
  }

  $pathWords = @()
  if ($words.Count -gt 0) {
    $limit = $words.Count
    if ($wordToComplete -ne '' -and $limit -gt 0) {
      $limit -= 1
    }
    if ($limit -gt 0) {
      $pathWords = $words[0..($limit - 1)]
    }
  }

  $path = Get-ResponsePath -Words $pathWords
  $previous = ''
  if ($wordToComplete -ne '') {
    if ($words.Count -ge 1) {
      $previous = $words[$words.Count - 1]
    }
  } elseif ($words.Count -ge 1) {
    $previous = $words[$words.Count - 1]
  }

  $candidates = @()
  if ($previous -like '--*' -and (Test-ResponseFlagTakesValue -Path $path -Flag $previous)) {
    $valueKey = if ([string]::IsNullOrEmpty($path)) { "::$previous" } else { "$path::$previous" }
    if ($script:ResponseFlagValues.ContainsKey($valueKey) -and $script:ResponseFlagValues[$valueKey]) {
      $candidates += $script:ResponseFlagValues[$valueKey] -split ' '
    }
  } else {
    if ($script:ResponseSubcommands.ContainsKey($path) -and $script:ResponseSubcommands[$path]) {
      $candidates += $script:ResponseSubcommands[$path] -split ' '
    }
    if ($script:ResponseFlags.ContainsKey($path) -and $script:ResponseFlags[$path]) {
      $candidates += $script:ResponseFlags[$path] -split ' '
    }
  }

  $seen = @{}
  foreach ($candidate in $candidates) {
    if ([string]::IsNullOrWhiteSpace($candidate)) {
      continue
    }
    if ($candidate -notlike "$wordToComplete*") {
      continue
    }
    if ($seen.ContainsKey($candidate)) {
      continue
    }
    $seen[$candidate] = $true
    [System.Management.Automation.CompletionResult]::new($candidate, $candidate, 'ParameterValue', $candidate)
  }
}`;
}

export async function writeCompletionScript(
  shell: CompletionShell,
  program: Command,
  extraRootFlags: string[] = [],
  options: CompletionIoOptions = {},
): Promise<string> {
  const cachePath = resolveCompletionCachePath(shell, options);
  const script = renderCompletionScript(shell, program, extraRootFlags);
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await fs.writeFile(cachePath, script, 'utf8');
  return cachePath;
}

export async function installCompletion(
  shell: CompletionShell,
  program: Command,
  extraRootFlags: string[] = [],
  options: CompletionIoOptions = {},
): Promise<{ cachePath: string; profilePath: string }> {
  const binName = sanitizeCompletionBasename(options.binName ?? 'response');
  const cachePath = await writeCompletionScript(shell, program, extraRootFlags, options);
  const profilePath = getShellProfilePath(shell, options);
  const existing = await fs.readFile(profilePath, 'utf8').catch(() => '');
  const sourceLine = formatCompletionSourceLine(shell, cachePath);
  const { next, changed } = updateCompletionProfile(existing, binName, cachePath, sourceLine);

  if (changed) {
    await fs.mkdir(path.dirname(profilePath), { recursive: true });
    await fs.writeFile(profilePath, next, 'utf8');
  }

  return { cachePath, profilePath };
}

export function renderCompletionScript(
  shell: string,
  program: Command,
  extraRootFlags: string[] = [],
): string {
  const spec = createCompletionSpec(program, extraRootFlags);
  switch (resolveCompletionShell(shell)) {
    case 'bash':
      return renderBashCompletion(spec);
    case 'zsh':
      return renderZshCompletion(spec);
    case 'fish':
      return renderFishCompletion(spec);
    case 'powershell':
      return renderPowerShellCompletion(spec);
  }
}
