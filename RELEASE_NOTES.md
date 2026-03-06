# StateSet ResponseCLI Release Notes (v1.8.0)

## Overview

StateSet ResponseCLI `v1.8.0` sharpens the interactive CLI, adds a real one-shot prompt mode for scripts and pipelines, and hardens packaged runtime startup when the shell is still pinned to an older Node version.

## Highlights

### Interactive and one-shot UX

- Improved `/help` discoverability with category-aware matching, fuzzy suggestions, and stronger integrations command coverage.
- Added `response ask` for one-shot prompts with session support, file attachments, and `--stdin` input for pipeline-friendly usage.
- Updated the README and getting-started docs so the new one-shot workflow is visible from first use.

### Runtime resilience

- Added Node runtime relaunch support so shipped binaries can recover when the current shell still resolves `node` to an unsupported version.
- Extended packaged bin smoke coverage and added launcher-focused regression tests for re-exec behavior under piped execution.

### Integration diagnostics

- Unified integration readiness around a single snapshot model that understands env, persisted store values, and defaults.
- Fixed `response doctor` and the chat welcome banner so store-backed integrations are reported consistently instead of looking unconfigured.

## CLI entry points

- `response`
- `response-whatsapp`
- `response-slack`
- `response-gateway`
