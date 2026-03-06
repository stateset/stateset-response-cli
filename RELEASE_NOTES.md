# StateSet ResponseCLI Release Notes (v1.7.7)

## Overview

StateSet ResponseCLI `v1.7.7` hardens local state handling, tightens build and CI behavior, and removes a flaky MCP validation test path.

## Highlights

### State and file safety
- Hardened append-based session and audit writes against symlinked parent paths.
- Made `/session cleanup` fail closed when session context cannot be read, instead of treating those sessions as empty.
- Prevented corrupt platform-operations state from being silently reset and overwritten during later mutations.

### Build and CI
- Added a build-only TypeScript config so production builds exclude test files.
- Added a cleaning build wrapper to avoid stale `dist/` output carrying old compiled tests forward.
- Split CI into quality, matrix test, coverage, and build stages so coverage only runs once on Node 22.

### Test and tooling quality
- Added and updated tests for:
  - audit I/O hardening
  - secure file append/write protection
  - fail-closed session cleanup
  - corrupt operations-store preservation
- Fixed the flaky MCP server validation test by correcting the mocked module path and removing the stale `resetModules()` pattern.

## CLI entry points

- `response`
- `response-whatsapp`
- `response-slack`
- `response-gateway`
