# StateSet ResponseCLI Release Notes (v1.3.4)

## Overview

StateSet ResponseCLI `v1.3.4` is the latest release in the repo and focuses on:

- Cleaner version publishing flow
- A complete view of available integrations and command surfaces
- Better visibility into platform capabilities for operators and AI sessions

## Quick feature highlights

- Chat-first AI workflows for ResponseCX administration
- Session persistence with searchable history, exports, and metadata summaries
- Attachments and multimodal input support (`--file`, `/attach`)
- Policy and permission controls for safer write operations (`/apply`, `/policy`, `/permissions`, `/audit`)
- Skills, prompt templates, and extensions loading for local customization
- Audit tooling for traceability in high-risk operations
- Dedicated command surfaces for gateways and integrations

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

## Release caveat

Versioned artifacts and changelog now reflect `1.3.4`. A publish attempt previously failed in this environment due network/DNS registry reachability (`EAI_AGAIN`), but repository metadata is ready for publish once registry access is available.
