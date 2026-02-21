# StateSet ResponseCLI Release Notes (v1.3.5)

## Overview

StateSet ResponseCLI `v1.3.5` is a major architecture and quality release. The CLI internals have been modularized, a declarative command registry now powers help and tab completion, and 31 previously-failing tests have been fixed.

## What's new in v1.3.5

### Architecture overhaul
- Slash command handlers split from a monolithic 5,000-line file into 11 focused modules under `cli/shortcuts/`.
- New declarative command registry (`cli/command-registry.ts`) — 70+ commands self-register with metadata, driving auto-generated `/help` output and tab completion.
- MCP server integration logic consolidated from 10 copy-paste try-catch blocks into a single declarative registry loop.

### Key features
- **Tab completion** for all slash commands (press Tab to autocomplete).
- **Richer session switching** — `/resume` and session switch now display message count, last activity, and tags.
- **Updated model aliases** to the Claude 4.6 family (`claude-sonnet-4-6-20250514`, `claude-haiku-4-5-20251001`, `claude-opus-4-6-20250514`).
- **Redesigned welcome screen** — concise essential-commands view replaces the previous 70-line wall of text.

### Stability & fixes
- Fixed 31 failing tests across 12 test files (mock ordering, vi.mock hoisting, syntax errors, assertion mismatches).
- Fixed syntax error in MCP helpers module (extra parenthesis in spread expression).
- Gateway orchestrator now gracefully handles missing optional dependencies (Slack/WhatsApp).
- Corrected `resolveSafeOutputPath` error handling in export, policy, and session commands.
- Simplified agent loop termination condition (removed redundant check).

## Integration support (10 total)

1. Shopify
2. Gorgias
3. Recharge
4. Klaviyo
5. Loop Returns
6. ShipStation
7. ShipHero
8. ShipFusion
9. ShipHawk
10. Zendesk

## CLI entry points

- `response`
- `response-whatsapp`
- `response-slack`
- `response-gateway`

## Platform tool domains (MCP-powered)

- Agents, Rules, Skills, Attributes, Examples, Evaluations, Datasets, Functions
- Responses, Knowledge Base, Channels, Messages, Settings, Organizations
- Integration tool groups for Shopify, Gorgias, Recharge, Klaviyo, Loop, ShipStation, ShipHero, ShipFusion, ShipHawk, Zendesk
- Event scheduling and export/session management support
