# Workflow Engine Contract

The Response CLI treats the Rust Temporal engine in `next-temporal-rs` as the source of truth for workflow-control routes. The local guardrail is:

```bash
npm run engine:contract:check
```

When `/home/dom/next-temporal-rs/crates/engine-api/src/main.rs` is present, the check scans the Axum router and verifies that every reusable, request/response route is represented by `src/lib/engine-client.ts`. If the sibling Rust checkout is absent, the check skips cleanly so package CI is not tied to a local monorepo layout. Use `node scripts/check-engine-contract-parity.mjs --strict` when a missing Rust checkout should fail the run.

## Covered Surface

| Rust API area | CLI/MCP coverage |
| --- | --- |
| Health and readiness | `/health`, `/healthz`, `/readyz`, `/metrics` |
| Workflow starts | legacy response, response automation v2, connector, sandbox agent loop |
| Workflow lifecycle | status, review, cancel, restart, terminate across supported workflow families |
| Brands | list, create, get, update, validate, activate, effective config |
| Bootstrap | template listing and brand bootstrap |
| Billing | profile, sync, contract, periods, close period, rated outcomes, reconciliation |
| Connectors | list, create, replace, health check |
| Outcomes | summary, list, record |
| Dispatch | health dashboard and guard actions |
| Onboarding, migration, parity, DLQ | list/get/create/update/retry/resolve flows |
| Templates and policy sets | versioned create, get, list, update contracts |
| Events | brand event ingestion with idempotency headers |

## Intentional Exclusions

| Rust route | Reason |
| --- | --- |
| `/v1/workflows/{workflow_id}/events` | Server-sent event stream. This needs a streaming `follow`/log UX rather than a JSON request/response client method. |
| `/v1/brands/yse-beauty/tickets` | Brand-specific workflow entrypoint, not part of the reusable CLI contract. |
| `/v1/brands/yse-beauty/refuse-rts/import` | Brand-specific import workflow, not part of the reusable CLI contract. |

## Allowed Client-Only Routes

| CLI route | Reason |
| --- | --- |
| `/v1/brands/{brand_id}/config-versions` | Optional history endpoint. The CLI falls back to current config when the Rust engine does not expose this route. |
