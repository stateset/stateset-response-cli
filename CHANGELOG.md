# Changelog

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
