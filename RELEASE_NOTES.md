# StateSet ResponseCLI Release Notes (v1.7.5)

## Overview

StateSet ResponseCLI `v1.7.5` improves interactive UX with markdown-aware terminal rendering, context-aware tab completion, persistent prompt history, and cached update notifications. This release also expands test coverage for the new CLI behavior.

## Highlights

### Chat and terminal UX
- Added markdown rendering for streamed agent output:
  - headings, lists, block quotes, inline emphasis, links, and fenced code blocks
  - streaming-safe buffering behavior for partial lines and code fences
- Updated chat flow to use the new markdown rendering path.

### CLI productivity
- Added smart tab completion for slash commands and common arguments.
- Added persistent local input history at `~/.stateset/input-history`.
- Added update checks against npm latest with 24-hour local caching (non-blocking startup behavior).

### Test coverage
- Added dedicated tests for:
  - markdown renderer
  - markdown stream renderer
  - command completer
  - history storage utilities
  - update check utility
- Expanded chat action test coverage for the updated output path.

## CLI entry points

- `response`
- `response-whatsapp`
- `response-slack`
- `response-gateway`
