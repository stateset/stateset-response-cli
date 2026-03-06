# StateSet ResponseCLI Release Notes (v1.7.8)

## Overview

StateSet ResponseCLI `v1.7.8` aligns integration readiness reporting with persisted configuration, hardens packaged CLI entrypoints, and adds release-level smoke coverage for the shipped binaries.

## Highlights

### Integration UX and diagnostics
- Unified integration readiness around a single snapshot model that understands env, persisted store values, and defaults.
- Fixed `response doctor` and the chat welcome banner so store-backed integrations are reported consistently instead of looking unconfigured.
- Added targeted regression coverage for ready, partial, invalid, and default-only integration states.

### Packaging and release safety
- Moved published package bin targets to `.js` entrypoints while keeping compatibility wrappers for the legacy extensionless files.
- Made Slack, WhatsApp, and gateway bins lazy-load optional runtime dependencies so `--help` and `--version` work without optional packages installed.
- Added executable bin smoke coverage for the shipped package commands and wired it into CI, including cross-platform smoke jobs.

### Update handling
- Replaced the hand-rolled update-version comparison with semver-aware prerelease handling so stable releases compare correctly against prerelease builds.

## CLI entry points

- `response`
- `response-whatsapp`
- `response-slack`
- `response-gateway`
