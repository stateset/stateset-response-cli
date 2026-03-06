# StateSet ResponseCLI Release Notes (v1.9.0)

## Overview

StateSet ResponseCLI `v1.9.0` adds a traced simulator and conversation replay workflow for faster agent iteration, expands CLI operations around drift detection and bulk updates, and adds scaffolding and runbook generation for faster rollout across brands.

## Highlights

### Agent simulation and replay

- Turned `response test` into a traced simulator with visible tool calls, sandboxed write blocking, optional mock tool responses, and final-response inspection.
- Added `response replay <conversation-id>` so existing conversations can be rerun step by step with tool visibility.
- Added `response logs --watch` to tail local session and audit activity during rollouts and debugging.

### Operational controls

- Added `response diff --remote` to compare local `.stateset` config with deployed remote state before deploys.
- Added `response sync status` to summarize integration readiness, last success, and failure signals from local telemetry.
- Added bulk mutation flows for rules and agents so repetitive cross-brand updates can be handled from the CLI.

### Templates, analytics, and runbooks

- Added `response init --template refund-agent|subscription-management` to scaffold local starter bundles.
- Added `response analytics quality` for derived CSAT, escalation, resolution, and per-agent quality reporting.
- Added `response export runbook --agent ...` to generate human-readable documentation for audits and handoffs.

## CLI entry points

- `response`
- `response-whatsapp`
- `response-slack`
- `response-gateway`
