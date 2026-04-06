import { Command } from 'commander';
import { STATIC_FLAG_VALUE_HINTS } from './completion-hints.js';

export interface CompletionSpec {
  rootCommands: string[];
  rootFlags: string[];
  pathMap: Record<string, string[]>;
  flagMap: Record<string, string[]>;
  flagValueMap: Record<string, string[]>;
}

interface CommanderArgumentLike {
  description?: string;
  variadic?: boolean;
}

function uniqueSorted(values: readonly string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function flagValueKey(path: string, flag: string): string {
  return `${path}::${flag}`;
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

function mergeFlagValueMapEntry(
  flagValueMap: Record<string, string[]>,
  path: string,
  flag: string,
  values: readonly string[],
): void {
  const key = flagValueKey(path, flag);
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
  path: string[] = [],
  pathMap: Record<string, string[]> = {},
  flagMap: Record<string, string[]> = {},
  flagValueMap: Record<string, string[]> = {},
): Record<string, string[]> {
  const key = path.join(' ');
  const children = command.commands.filter(isVisibleCommand);
  pathMap[key] = uniqueSorted(children.map((child) => child.name()));
  flagMap[key] = collectLongFlags(command);
  for (const [flag, values] of Object.entries(STATIC_FLAG_VALUE_HINTS[key] ?? {})) {
    mergeFlagValueMapEntry(flagValueMap, key, flag, values);
  }

  for (const child of children) {
    populatePathMap(child, [...path, child.name()], pathMap, flagMap, flagValueMap);
  }

  return pathMap;
}

function populateDescribedArgumentPaths(
  command: Command,
  path: string[] = [],
  pathMap: Record<string, string[]> = {},
  flagMap: Record<string, string[]> = {},
  flagValueMap: Record<string, string[]> = {},
): Record<string, string[]> {
  const key = path.join(' ');
  const describedSubcommands = extractDescribedSubcommands(command);
  if (describedSubcommands.length > 0) {
    mergePathMapEntry(pathMap, key, describedSubcommands);
    for (const subcommand of describedSubcommands) {
      const leafKey = [...path, subcommand].join(' ');
      if (!(leafKey in pathMap)) {
        pathMap[leafKey] = [];
      }
      mergeFlagMapEntry(flagMap, leafKey, flagMap[key] ?? []);
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
    populateDescribedArgumentPaths(child, [...path, child.name()], pathMap, flagMap, flagValueMap);
  }

  return pathMap;
}

function quoteForShell(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function quoteForFishConditionArg(value: string): string {
  return `"${value.replace(/["\\]/g, '\\$&')}"`;
}

function renderPathMapAssignments(spec: CompletionSpec, indent = '  '): string {
  return Object.entries(spec.pathMap)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(
      ([path, subcommands]) =>
        `${indent}_response_subcommands[${quoteForShell(path)}]=${quoteForShell(subcommands.join(' '))}`,
    )
    .join('\n');
}

function renderFlagMapAssignments(spec: CompletionSpec, indent = '  '): string {
  return Object.entries(spec.flagMap)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(
      ([path, flags]) =>
        `${indent}_response_flags[${quoteForShell(path)}]=${quoteForShell(flags.join(' '))}`,
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

export function createCompletionSpec(
  program: Command,
  extraRootFlags: string[] = [],
): CompletionSpec {
  const flagMap: Record<string, string[]> = {};
  const flagValueMap: Record<string, string[]> = {};
  const pathMap = populateDescribedArgumentPaths(
    program,
    [],
    populatePathMap(program, [], {}, flagMap, flagValueMap),
    flagMap,
    flagValueMap,
  );
  return {
    rootCommands: pathMap[''] ?? [],
    rootFlags: uniqueSorted([...collectLongFlags(program), ...extraRootFlags]),
    pathMap,
    flagMap,
    flagValueMap,
  };
}

export function renderBashCompletion(spec: CompletionSpec): string {
  const assignments = renderPathMapAssignments(spec);
  const flagAssignments = renderFlagMapAssignments(spec);
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
  declare -A _response_flag_values
${flagValueAssignments}

  local path=""
  local word=""
  local candidate=""
  local i=1
  while [ "$i" -lt "$COMP_CWORD" ]; do
    word="\${COMP_WORDS[$i]}"
    if [[ "$word" == -* ]]; then
      i=$((i + 1))
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

  if [[ "$prev" == --* ]]; then
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
  typeset -A _response_flag_values
${flagValueAssignments}

  local path=""
  local word=""
  local candidate=""
  local i=2
  while (( i < CURRENT )); do
    word="\${words[i]}"
    if [[ "$word" == -* ]]; then
      (( i++ ))
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

  if [[ "$prev" == --* ]]; then
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

function renderFishFlagLines(flags: readonly string[], path = ''): string {
  return flags
    .filter((flag) => flag.startsWith('--'))
    .filter((flag) => flag !== '--model' && flag !== '--output')
    .map(
      (flag) =>
        `complete -c response -n '__response_path_is ${quoteForFishConditionArg(path)}' -l ${flag.slice(2)}`,
    )
    .join('\n');
}

export function renderFishCompletion(spec: CompletionSpec): string {
  const knownPaths = Object.keys(spec.pathMap)
    .filter((path) => path.length > 0)
    .sort((a, b) => a.localeCompare(b))
    .map((path) => quoteForShell(path))
    .join(' ');

  const pathLines = Object.entries(spec.pathMap)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .filter(([, subcommands]) => subcommands.length > 0)
    .map(
      ([path, subcommands]) =>
        `complete -c response -n '__response_path_is ${quoteForFishConditionArg(path)}' -a ${quoteForShell(subcommands.join(' '))}`,
    )
    .join('\n');

  const rootCommands = spec.rootCommands.join(' ');
  const rootFlags = renderFishFlagLines(spec.rootFlags, '');
  const rootValueFlags =
    STATIC_FLAG_VALUE_HINTS[''] && Object.keys(STATIC_FLAG_VALUE_HINTS['']).length > 0
      ? Object.entries(STATIC_FLAG_VALUE_HINTS[''])
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(
            ([flag, values]) =>
              `complete -c response -n '__response_path_is ""' -l ${flag.slice(2)} -xa ${quoteForShell(uniqueSorted(values).join(' '))}`,
          )
          .join('\n')
      : '';
  const nestedFlags = Object.entries(spec.flagMap)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .filter(([path]) => path.length > 0)
    .map(([path, flags]) => renderFishFlagLines(flags, path))
    .filter((block) => block.length > 0)
    .join('\n');
  const nestedValueFlags = Object.entries(spec.flagValueMap)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, values]) => {
      const separator = key.lastIndexOf('::');
      const path = key.slice(0, separator);
      const flag = key.slice(separator + 2);
      return `complete -c response -n '__response_path_is ${quoteForFishConditionArg(path)}' -l ${flag.slice(2)} -xa ${quoteForShell(values.join(' '))}`;
    })
    .filter((line) => !line.includes('__response_path_is ""'))
    .join('\n');

  return `# fish completion for response CLI
# Save to ~/.config/fish/completions/response.fish
function __response_path
  set -l words (commandline -opc)
  if test (count $words) -eq 0
    return
  end
  set -e words[1]
  set -l path ""
  for word in $words
    if string match -qr '^-' -- "$word"
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
  end
  echo "$path"
end

function __response_path_is
  test (__response_path) = "$argv[1]"
end

complete -c response -n '__response_path_is ""' -a ${quoteForShell(rootCommands)}
${rootFlags}
${rootValueFlags}
${pathLines}
${nestedFlags}
${nestedValueFlags}`;
}

export function renderCompletionScript(
  shell: string,
  program: Command,
  extraRootFlags: string[] = [],
): string {
  const spec = createCompletionSpec(program, extraRootFlags);
  switch (shell.toLowerCase()) {
    case 'bash':
      return renderBashCompletion(spec);
    case 'zsh':
      return renderZshCompletion(spec);
    case 'fish':
      return renderFishCompletion(spec);
    default:
      throw new Error(`Unknown shell: ${shell}. Use bash, zsh, or fish.`);
  }
}
