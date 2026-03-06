# Changelog

## 1.7.8 - 2026-03-06

### Integration UX
- Unified integration readiness around a single snapshot model that accounts for env, persisted store config, and default values.
- Fixed `response doctor` and the interactive chat welcome banner so integrations configured via the local/global integrations store are reported consistently.
- Added regression tests for ready, invalid, and default-only integration states.

### Packaging & Release Hygiene
- Moved published package bin targets to `.js` entrypoints while retaining lightweight compatibility wrappers for the legacy extensionless files.
- Made gateway binaries lazy-load runtime modules so `--help` and `--version` paths work even when optional Slack/WhatsApp packages are not installed.
- Added bin-level smoke coverage and cross-platform smoke CI jobs for the packaged CLI entrypoints.

### Reliability
- Switched npm update detection to semver-aware prerelease comparison.

## 1.7.7 - 2026-03-06

### Security & Data Safety
- Hardened append-based session and audit writes against symlinked parent paths.
- Made `/session cleanup` fail closed so unreadable or oversized session context files are preserved instead of being treated as empty.
- Prevented corrupt platform-operations state from being silently reset and overwritten on the next mutation.

### Build & CI
- Added a build-only TypeScript config so production builds exclude test files.
- Centralized Node/Vitest compatibility shims into a single shared runtime bootstrap.
- Split CI into dedicated quality, matrix test, coverage, and build stages to avoid rerunning coverage on every Node version.

### Tests
- Fixed the flaky MCP server validation test by removing the stale module-reset pattern and correcting its mocked GraphQL client path.
- Added regression tests for audit I/O hardening, secure file writes, session cleanup fail-closed behavior, and operations-store corruption handling.

## 1.7.6 - 2026-03-05

### Security
- Hardened auth device flow URL handling: verification URLs must be HTTP(S), and Windows browser launch now avoids shell interpretation.
- Hardened local writes for permissions, policies, exports, and update-cache files with stricter file modes (`0600`) and directory modes (`0700`).
- Added symlink-target rejection and safer output-path checks for policy/export writes.

### Reliability
- Fatal global error handlers now force process exit on the next tick after logging to avoid undefined runtime state.
- Switched Gorgias HTTP calls to the retrying request helper for better transient error resilience.

### Tests
- Added regression tests for unsafe device verification URLs, unhandled-rejection process exit, and symlink-safe policy writes.
- Updated Gorgias integration tests for the retry helper path and updated export/policy tests to assert secure file-write options.

## 1.7.5 - 2026-03-04

### UX
- Added markdown-aware terminal rendering for agent output, including headings, lists, quotes, inline formatting, and fenced code blocks in streaming responses.
- Added context-aware tab completion for slash commands and common arguments (model aliases, session IDs, toggles, and command sub-actions).
- Added persistent local input history at `~/.stateset/input-history` for interactive chat prompts.

### Runtime
- Added non-blocking npm update checks with a 24-hour cache to surface newer published CLI versions.

### Tests
- Added dedicated tests for markdown rendering, streaming markdown behavior, command completion, input history persistence, and update checks.
- Expanded chat action tests to cover the updated rendering and interaction flow.

## 1.7.1 - 2026-02-27

### Quality Gates
- Hardened pre-commit checks to run lint-staged and strict TypeScript typechecking.
- Split coverage into two enforced profiles:
  - Full-suite coverage gate at 75% (lines/branches/functions/statements).
  - Deterministic core-module gate at 100%.
- CI checks now enforce both coverage profiles.

### Integrations Diagnostics
- Replaced placeholder output in `response integrations health`, `limits`, and `logs`.
- Health now reports required-field coverage, resolved configuration source (env/store/default), URL validation, and readiness status.
- Limits now reports observed calls, errors, and rate-limit events from tool-audit telemetry.
- Logs now surfaces recent integration tool activity with session, status, and duration metadata.

### Analytics
- Enforced `--from/--to` date filtering in analytics summary paths where timestamped data is available.
- Removed stale “not yet enforced” text from analytics/stats option help.

### Documentation & Repo Hygiene
- Updated README version and development quality-gate documentation to match runtime behavior.
- Added `SECURITY.md`, `CONTRIBUTING.md`, and `SUPPORT.md`.
- Refreshed release notes alignment with current 1.7.x release line.

## 1.3.5 - 2026-02-21

### Architecture
- Modularized slash command handlers: split 5,000-line `commands-shortcuts.ts` into 11 focused modules under `cli/shortcuts/`.
- Built declarative command registry (`cli/command-registry.ts`): 70+ commands self-register with metadata; `/help` output and tab completion are now auto-generated.
- Replaced 10 copy-paste try-catch blocks in MCP server with declarative integration registry loop.

### Features
- Added tab completion for all slash commands (press Tab to autocomplete).
- Enriched session switching: shows message count, last activity, and tags on `/resume` and session switch.
- Updated model aliases to latest Claude 4.6 family (`claude-sonnet-4-6`, `claude-haiku-4-5-20251001`, `claude-opus-4-6-20250514`).
- Redesigned welcome screen: concise essential commands instead of 70-line wall of text.

### Fixes
- Fixed 31 failing tests across 12 test files (mock ordering, vi.mock hoisting, syntax errors, assertion mismatches).
- Fixed syntax error in MCP helpers module (extra parenthesis in spread expression).
- Fixed gateway orchestrator to gracefully handle missing optional dependencies (Slack/WhatsApp).
- Fixed `resolveSafeOutputPath` error handling in export, policy, and session commands.
- Simplified agent loop termination condition (removed redundant check).

## 1.3.4 - 2026-02-17

- Bumped package version to `1.3.4` in npm metadata and lockfile.
- Added/updated quick release notes for the latest CLI release.
- Documented all supported integrations and platform capabilities for visibility:
  - Shopify, Gorgias, Recharge, Klaviyo, Loop Returns, ShipStation, ShipHero, ShipFusion, ShipHawk, Zendesk.
  - Multi-channel delivery via WhatsApp/Slack/gateway entry points.
  - MCP-backed operational and content tools (agents, rules, skills, messages, KB, orders/integration toolsets, org settings, etc.).

## 1.3.3 - 2026-02-16

- Bumped package version to `1.3.3`.

## 1.3.2 - 2026-02-15

- Bumped package version to `1.3.2`.
- Synchronized package metadata between `package.json` and `package-lock.json`.
- Refreshed CLI behavior and integrations from recent repository updates.
- Updated documentation to capture release notes and current version.
