# StateSet ResponseCLI Release Notes (v1.7.1)

## Overview

StateSet ResponseCLI `v1.7.1` focuses on production readiness: stronger quality gates, real integration diagnostics (not placeholders), enforced analytics date filtering in summary mode, and refreshed security/process documentation.

## Highlights

### Quality and CI
- Pre-commit now enforces lint-staged + TypeScript typecheck.
- Coverage is enforced in two layers:
  - Full test suite: minimum 75% for lines/branches/functions/statements.
  - Core deterministic modules: strict 100% for lines/branches/functions/statements.
- CI runs both coverage gates.

### Integrations observability
- `response integrations health` now reports:
  - readiness status (`ready`, `degraded`, `disabled`, etc.)
  - required-field coverage
  - config source resolution (`env`, `store`, `default`)
  - URL validation status
- `response integrations limits` now reports telemetry from tool-audit history:
  - call count
  - error count
  - observed rate-limit events
  - last seen/last rate-limit timestamps
- `response integrations logs` now returns real recent integration tool events with session and duration context.

### Analytics filtering
- `response stats` and `response analytics` now apply date filters in summary mode where timestamped data is available.
- Help text no longer claims `--from`/`--to` are "not yet enforced."

### Documentation and governance
- README version and quality-check docs now match shipped behavior.
- Added:
  - `SECURITY.md`
  - `CONTRIBUTING.md`
  - `SUPPORT.md`

## CLI entry points

- `response`
- `response-whatsapp`
- `response-slack`
- `response-gateway`
