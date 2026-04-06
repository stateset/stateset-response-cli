# StateSet ResponseCX CLI

AI-powered CLI for managing the [StateSet ResponseCX](https://response.cx) platform. Chat with an AI agent that can manage your agents, rules, skills, knowledge base, channels, messages, and more — all from the terminal.

Includes optional Slack, Telegram, and WhatsApp gateways for connecting your agent to messaging platforms or running a multi-channel bot on Kubernetes.
Current version: `1.9.3`.

## Features

- **100+ MCP tools** across 16 integrations — Shopify, Gorgias, Recharge, Klaviyo, Loop, ShipStation, ShipHero, ShipFusion, ShipHawk, Zendesk, Skio, Stay.ai, Amazon SP-API, DHL, FedEx, Global-e
- **Slack, Telegram, and WhatsApp gateways** with a multi-channel orchestrator for running them from one process
- **Interactive chat** with session management, memory, file attachments, and prompt templates
- **Markdown-aware terminal output** with streaming-safe rendering for headings, lists, quotes, and code fences
- **Productive CLI ergonomics** with slash-command tab completion and persistent local input history
- **Capability map** that groups commands by workflow area so operators can discover setup, runtime, workflow-studio, curation, and control-plane flows quickly
- **Extension system** with trust policies, tool hooks, and hash verification
- **Event-driven automation** — immediate, one-shot, and periodic (cron) agent runs
- **Shortcut commands** for direct CLI operations (deploy, backup, monitor, snapshot, diff, etc.)
- **Circuit breaker** and retry with exponential backoff + jitter for HTTP/GraphQL resilience
- **Version awareness** with cached npm update checks that surface newer CLI releases
- **Security hardened** — AES-256-GCM credential encryption, SSRF prevention, ANSI escape sanitization, path traversal protection, strict auth URL validation, and symlink-safe policy/export/cache writes with tighter `0600/0700` file permissions

## Install

Node.js 18+ is required.

```bash
npm install -g stateset-response-cli
```

Or clone and build locally:

```bash
git clone https://github.com/stateset/stateset-response-cli.git
cd stateset-response-cli
npm install
npm run build
```

## Quick Start

For a shorter onboarding path, see [`docs/GETTING_STARTED.md`](docs/GETTING_STARTED.md).

```bash
# Guided onboarding (recommended)
response init

# Or run setup manually
response auth login
response doctor

# Send one prompt and exit
response ask "Summarize the latest failed orders"

# Start an interactive chat session
response chat

# See the CLI grouped by workflow area
response capabilities
```

## Authentication

The CLI supports two authentication methods:

**Browser / Device Code (recommended)**

```bash
response auth login
```

Follow the prompts to authenticate via your browser. The CLI will receive a scoped token automatically.
The CLI attempts to open your browser automatically (disable with `--no-open-browser`).

**Manual Setup**

During `response auth login`, you can provide your GraphQL endpoint and admin secret directly.
You can choose either the browser/device flow or manual setup during login.

**Non-interactive auth (CI/scripts)**

```bash
# Device flow without prompts
response auth login --device --instance-url https://response.cx --non-interactive

# Manual auth without prompts
response auth login \
  --manual \
  --org-id acme \
  --org-name "Acme" \
  --graphql-endpoint https://response.cx/v1/graphql \
  --admin-secret "$STATESET_ADMIN_SECRET" \
  --non-interactive
```

Credentials are stored in `~/.stateset/config.json` with restricted file permissions (600).

### Multiple Organizations

```bash
# Switch between configured organizations
response auth switch <org-id>

# View current auth status
response auth status
```

## Usage

### Interactive Chat

```bash
response chat
response chat --model haiku
response chat --model opus
response chat --apply
response chat --redact
response chat --session ops
response chat --file ./invoice.csv --file ./photo.png
response chat --usage
```

The agent understands natural language. Ask it to list your agents, create rules, search the knowledge base, etc.

### One-Shot Prompts

```bash
response ask "Summarize the latest failed orders"
response ask --session ops --usage "What changed in this session?"
cat incident.txt | response ask --stdin --session ops
response ask --file ./incident.md "Summarize this file and propose next steps"
```

Use `response ask` when you want a single answer with the normal session, attachment, and tool settings available from chat mode, but without opening the interactive prompt.

**Session commands (key):**

<!-- BEGIN GENERATED COMMAND REFERENCE -->
Use `/help` for the full list. This reference is generated from [`src/cli/command-registry.ts`](src/cli/command-registry.ts) via `npm run readme:sync`.

**Core**

- `/help [command|category]` Show help (optionally for a specific command or category) Aliases: `/commands`, `/h`.
- `/clear` Reset conversation history Aliases: `/c`.
- `/history` Show conversation turn count Aliases: `/hist`.
- `/model <name>` Switch model (sonnet, haiku, opus) Aliases: `/m`.
- `/usage on|off` Enable or disable usage summaries
- `/metrics [json] [reset]` Show session metrics, token usage, and tool breakdown
- `/whoami` Show full session dashboard (org, model, profile, engine, cost)
- `/cost` Show estimated session cost based on token usage
- `/trends [7d|30d|90d|all]` Show token usage and cost trends over time
- `/debug on|off` Toggle debug logging for this session
- `/copy` Copy the last assistant response to clipboard
- `/attach <path>` Attach a file or image to the next message
- `/attachments` List staged attachments
- `/attach-clear` Clear staged attachments
- `/context` Show context window usage
- `/retry` Retry the last user message

**Safety & Policy**

- `/apply on|off` Enable or disable write operations
- `/agentic on|off` Enable or disable structured MCP metadata
- `/redact on|off` Enable or disable PII redaction
- `/audit on|off [detail]` Toggle tool audit logging (optional excerpts)
- `/audit-show [session] [tool=name] [errors] [limit=20]` Show recent audit entries
- `/audit-clear [session]` Clear audit log for a session
- `/permissions [list|clear]` List or clear stored permissions
- `/policy list|set|unset|clear|edit|init|import` Manage policy overrides
- `/policy export [local|global] [out=path] [--unsafe-path]` Export policy overrides
- `/policy import <path> [merge|replace]` Import policy overrides from JSON

**Integrations**

- `/integrations` Show integration status
- `/integrations status` Alias for /integrations
- `/integrations setup [integration]` Run integration setup wizard
- `/integrations health [integration] [--detailed]` Show integration readiness and config health
- `/integrations limits [integration]` Show integration call/error and rate-limit telemetry
- `/integrations logs [integration] [--last 20]` Show recent integration audit events

**Workflow Engine**

- `/engine` Show workflow engine connection status
- `/capabilities [area]` Show the CLI grouped by workflow areas such as setup, runtime, workflow-studio, curation, operations, and resources
- `/engine setup` Configure the workflow engine connection
- `/engine init [brand-slug]` Initialize .stateset/<brand>/ config-as-code directory with scaffold files
- `/engine config [pull|push|validate|history] <brand>` Manage local `.stateset/<brand>` workflow studio config against the engine
- `/engine config show <brand-slug|brand-id>` Show the effective remote workflow studio config for a brand
- `/engine config pull <brand-slug|brand-id>` Pull brand workflow studio config into `.stateset/<brand>`
- `/engine config history <brand-slug|brand-id>` Show config version history for a brand
- `/engine config validate <brand-slug>` Validate local brand workflow studio config files
- `/engine config push <brand-slug>` Push local brand workflow studio config to the engine
- `/engine activate <brand-slug|brand-id> [config-version]` Activate the current config for a brand
- `/engine validate <brand-slug|brand-id>` Run remote engine validation for a brand
- `/engine brands [slug]` List or search brands in the workflow engine
- `/engine brands show <brand-slug|brand-id>` Show brand details from the workflow engine
- `/engine brands create <json-file>` Create a brand from a JSON file, optionally bootstrapping a template-backed workflow config
- `/engine brands bootstrap <brand-slug|brand-id> [ecommerce|subscription|knowledge_base] [activate]` Create or repair a workflow-studio brand and bootstrap response automation
- `/engine brands update <brand-slug|brand-id> <json-file>` Update a brand from a JSON patch file
- `/engine executions <brand-slug|brand-id> [status]` List recent workflow executions for a brand
- `/engine connectors <brand-slug|brand-id> [create <json-file>|health <connector-id>|plan [loop-mode] [--source local|platform]|sync [loop-mode] [--source local|platform]]` List connectors, create connectors, plan connector sync from local or platform credentials, or create missing live connectors for a brand
- `/engine connectors <brand-slug|brand-id> create <json-file>` Create a connector for a brand from a JSON file
- `/engine connectors <brand-slug|brand-id> plan [subscriptions|returns|both] [--source local|platform]` Show the workflow-studio connector sync plan from local integrations or platform credentials
- `/engine connectors <brand-slug|brand-id> sync [subscriptions|returns|both] [--source local|platform]` Write local connector config, persist connector preferences, and create missing live connectors from local integrations or platform credentials
- `/engine connectors <brand-slug|brand-id> env [subscriptions|returns|both] [dotenv|shell|json] [out=path]` Inspect or export the brand-scoped connector secret env vars your local workers need
- `/engine local apply <brand-slug|brand-id> [subscriptions|returns|both] [out=path] [compose=path] [services=a,b,c] [--write-only]` Write the brand env file and refresh the local Temporal stack services
- `/engine onboard <brand-slug|brand-id> [notes]` Start an onboarding run for a brand
- `/engine onboard list <brand-slug|brand-id>` List onboarding runs for a brand
- `/engine onboard show <brand-slug|brand-id> <run-id>` Show a specific onboarding run
- `/engine onboard update <brand-slug|brand-id> <run-id> <status> [notes]` Update onboarding run status or notes
- `/engine migration <brand-slug|brand-id>` Show migration state for a brand
- `/engine migration update <brand-slug|brand-id> <json-file>` Update migration state for a brand from a JSON patch file
- `/engine parity <brand-slug|brand-id> [from] [to]` Show parity dashboard for a brand
- `/engine health` Check workflow engine health
- `/engine dispatch-health [--tenant-id <tenant-id>] [--limit <n>] [--offset <n>]` Show dispatch health dashboard across brands
- `/engine dispatch-guard [--tenant-id <tenant-id>] [--apply true|false] [--minimum-health-status warning|critical] [--max-actions <n>]` Plan or apply dispatch guard actions for unhealthy brands
- `/engine test <brand-slug|brand-id> <ticket-id>` Dispatch a dry-run workflow-studio test event for a brand
- `/engine event <brand-slug|brand-id> <json-file> [idempotency-key]` Ingest a workflow engine event payload from a JSON file
- `/engine templates [key] [version]` List or get workflow templates
- `/engine templates create <json-file>` Create a workflow template version from a JSON file
- `/engine templates update <template-key> <version> <json-file>` Update a workflow template version from a JSON file
- `/engine policy-sets [key]` List or get versioned policy sets
- `/engine policy-sets get <policy-set-key> [version]` Get a policy set version
- `/engine policy-sets create <json-file>` Create a policy set version from a JSON file
- `/engine policy-sets update <policy-set-key> <version> <json-file>` Update a policy set version from a JSON file
- `/engine dlq <brand-slug|brand-id> [status]` List dead-letter queue items for a brand
- `/engine dlq retry <brand-slug|brand-id> <dlq-id>` Retry a dead-letter queue item
- `/engine dlq resolve <brand-slug|brand-id> <dlq-id> [action] [notes]` Resolve a dead-letter queue item
- `/workflows [list|start|status|cancel|terminate|restart|review|retry]` Manage workflow executions in the engine Aliases: `/wf`.
- `/onboard [init]` Interactive onboarding wizard — brand, integrations, KB, rules, workflow, deploy
- `/onboard init [brand-slug]` Initialize .stateset/<brand>/ config-as-code directory
- `/finetune [list|export|validate|create|deploy]` Fine-tuning pipeline: export evals → validate datasets → create job spec → deploy model
- `/finetune export [output-dir] [--format all|sft|dpo|openai-sft|studio-sft|trl-sft|studio-dpo|pair-dpo] [--status approved] [--validation-ratio 0.1]` Export evals into the SFT and DPO dataset formats used by workflow studio and synthetic-data-studio
- `/finetune validate [path] [--format auto|openai-sft|studio-sft|trl-sft|studio-dpo|pair-dpo]` Validate exported datasets before training
- `/finetune create [dataset-file] [--method supervised|dpo]` Create a new fine-tuning job spec from a validated dataset
- `/finetune deploy <model-id>` Deploy a fine-tuned model to workflow config
- `/evals [list|create|create-from-response|get|update|delete|export|review|suggest|<id>]` Manage eval records and fine-tuning examples
- `/evals create-from-response <response-id> [--seed preferred|rejected|none]` Seed a new eval from a stored response so curators can turn live agent output into SFT or DPO data
- `/evals review [eval-id] [--status pending]` Interactively review pending evals
- `/evals suggest` Auto-suggest eval criteria based on conversation patterns Aliases: `/evals-suggest`.
- `/datasets [list|create|get|update|delete|add-entry|update-entry|delete-entry|import|export|<id>]` Manage datasets and message-based dataset entries for training-data curation
- `/datasets add-entry <dataset-id> (--messages <json> | --file <path>)` Add a message-based training example to a dataset
- `/datasets import <dataset-id> <json|jsonl-file>` Bulk import dataset entries from JSON or JSONL
- `/datasets export <dataset-id> [--out <path>]` Export a dataset with all of its entries
- `/rules generate [brand-slug]` Auto-generate rules from KB and business data (with human confirmation)

**Sessions**

- `/session stats` Show session storage statistics
- `/session cleanup [days=30] [--dry-run]` Remove empty sessions older than N days
- `/session` Show current session info
- `/sessions [all] [tag=tag]` List sessions (optionally include archived or filter by tag) Aliases: `/s`.
- `/new [name]` Start a new session
- `/resume <name>` Resume a saved session
- `/archive [name]` Archive a session
- `/unarchive [name]` Unarchive a session
- `/rename <name>` Rename the current session
- `/delete [name]` Delete a session
- `/tag list|add|remove <tag> [session]` Manage session tags
- `/search <text> [all] [role=user|assistant] [since=YYYY-MM-DD] [until=YYYY-MM-DD] [regex=/.../] [limit=100]` Search session transcripts (scans up to 5000 entries)
- `/session-meta [session] [json|md] [out=path] [--unsafe-path]` Show or export session metadata

**Shortcut Commands**

- `/rules [get|list|create|toggle|delete|import|export|agent|<id>]` Manage agent rules Aliases: `/r`.
- `/kb [search|add|ingest|delete|scroll|list|info]` Manage KB entries
- `/kb ingest <path> [--chunk_size 2000] [--overlap 200]` Bulk ingest local files/directories into KB with chunking
- `/agents [list|get|create|switch|export|import|bootstrap|<id>]` Manage agents Aliases: `/a`.
- `/channels [list|create|messages|<id>]` Manage conversation channels
- `/convos [get|recent|search|count|export|replay|tag|<id>]` Inspect conversations
- `/conversations [get|recent|search|count|export|replay|tag|<id>]` Alias for /convos
- `/messages [list|get|search|count|create|annotate|delete|<id>]` Manage messages
- `/responses [list|search|count|get|rate|<id>]` Inspect and rate responses
- `/status` Show platform status summary Aliases: `/st`.
- `/stats` Show analytics summary (supports positional window: 7d/30d/90d)
- `/analytics` Show analytics summaries (supports positional window: 7d/30d/90d)
- `/snapshot [list|create|show]` Manage local snapshots
- `/bulk [export|import]` Bulk import/export workflows
- `/pull [dir]` Pull remote config into a directory
- `/push [source]` Push a local config file or directory
- `/validate [source]` Validate local state-set payload
- `/watch [dir]` Watch .stateset for changes and sync
- `/webhooks [list|get|create|update|deliveries|logs|delete]` Manage remote webhook subscriptions and delivery history
- `/alerts [list|get|create|delete]` Manage alert rules
- `/monitor [status|live]` Watch live platform metrics
- `/test [message...] [--agent <agent-id>]` Run a non-persistent test message
- `/diff` Show config diff
- `/drift [--json]` Detect configuration drift between local and remote state
- `/deploy` Push snapshot-backed changes (--schedule/--approve)
- `/rollback` Rollback config changes (--schedule/--approve)
- `/deployments` Inspect deployment history and scheduled jobs

**Exports**

- `/export [session] [md|json|jsonl|html] [path] [--unsafe-path]` Export session to markdown/json/jsonl/html
- `/export-list [session]` List export files for a session
- `/export-show <file> [session] [head=40]` Preview an export file
- `/export-open <file> [session]` Show export file path
- `/export-delete <file> [session]` Delete an export file
- `/export-prune [session] keep=5` Delete older exports

**Prompts & Skills**

- `/prompts` List prompt templates
- `/prompt <name>` Fill and send a prompt template
- `/prompt-history` Show recent prompt templates
- `/prompt-validate [name|all]` Validate prompt templates
- `/skills` List available skills
- `/skill <name>` Activate a skill for this session
- `/skill-clear` Clear active skills

**Extensions**

- `/extensions` List loaded extensions
- `/reload` Reload extensions
- `/exit /quit` End the session Aliases: `/quit`.
<!-- END GENERATED COMMAND REFERENCE -->

Multi-line input is supported — end a line with `\` to continue on the next line. Press `Ctrl+C` to cancel the current request.

**Sessions**

Sessions persist chat history on disk in `~/.stateset/sessions/<name>/context.jsonl`. Use `--session <name>` to switch.  
`/clear` clears both in-memory and on-disk session history.

**Memory**

You can add long-lived context in:

- `~/.stateset/MEMORY.md` (global)
- `~/.stateset/sessions/<name>/MEMORY.md` (session-specific)

These are injected into the system prompt on each turn.

**Attachments**

Use `--file` or `/attach` to include file contents or images. Images are sent as vision inputs.  
Large or unreadable files are skipped with a warning.

**Usage Summaries**

Use `--usage` or set `STATESET_SHOW_USAGE=true` to print token usage per turn.

**Write Safety**

Integration tools are read-only by default. Enable writes explicitly:

- `response chat --apply` or `/apply on`
- `STATESET_ALLOW_APPLY=true` (non-interactive)

Optional redaction:

- `response chat --redact` or `/redact on`
- `STATESET_REDACT=true`

Tool auditing:

- `/audit on` or `STATESET_TOOL_AUDIT=true`
- `STATESET_TOOL_AUDIT_DETAIL=true` to include result excerpts

### WhatsApp Gateway

Bridge incoming WhatsApp messages to your StateSet Response agent.

```bash
response-whatsapp
```

On first run, scan the QR code with WhatsApp (Settings > Linked Devices > Link a Device). Auth state is persisted in `~/.stateset/whatsapp-auth/`.

**Options:**

```
--model <name>, -m  Model to use (sonnet|haiku|opus or full model ID)
--allow <phones>   Comma-separated allowlist of phone numbers
--groups           Allow messages from group chats
--self-chat        Only respond to messages you send to yourself
--auth-dir <path>  WhatsApp auth credential directory
--reset            Clear stored auth and re-scan QR
--version, -V      Show version
--verbose, -v      Enable debug logging
```

**Examples:**

```bash
response-whatsapp --model haiku
response-whatsapp --allow 14155551234,14155559999
response-whatsapp --self-chat
response-whatsapp --reset
```

When `--self-chat` is enabled, responses are prefixed with `[agent]`, and any incoming `[agent]` messages are ignored to prevent loops.

### Telegram Gateway

Bridge private Telegram chats to your StateSet Response agent.

```bash
response-telegram
```

**Setup:**

1. Create a bot with `@BotFather`
2. Copy the bot token
3. Set environment variables:

```bash
export TELEGRAM_BOT_TOKEN=<token>
export ANTHROPIC_API_KEY=<key>
# Optional: enable real state changes instead of read-only responses
export STATESET_ALLOW_APPLY=true
```

**Behavior:**

- In private chats: responds to all messages
- Group chats and channels are ignored by the current gateway runtime

**Options:**

```
--model <name>, -m  Model to use (sonnet|haiku|opus or full model ID)
--allow <ids>       Comma-separated allowlist of Telegram user IDs
--version, -V       Show version
--verbose, -v       Enable debug logging
```

**Examples:**

```bash
response-telegram
response-telegram --model haiku
response-telegram --allow 12345,6789
response-telegram --verbose
```

### Slack Gateway

Bridge Slack messages to your StateSet Response agent via Socket Mode.

```bash
response-slack
```

**Setup:**

1. Create a Slack app at https://api.slack.com/apps
2. Enable Socket Mode (Settings > Socket Mode)
3. Generate an app-level token (`xapp-...`) with `connections:write` scope
4. Add Bot Token Scopes: `chat:write`, `app_mentions:read`, `im:history`, `channels:history`
5. Install the app to your workspace
6. Set environment variables:

```bash
export SLACK_BOT_TOKEN=xoxb-...
export SLACK_APP_TOKEN=xapp-...
# Optional: enable real state changes instead of read-only responses
export STATESET_ALLOW_APPLY=true
```

**Behavior:**

- In DMs: responds to all messages
- In channels: responds when @mentioned or in threads the bot has participated in

**Options:**

```
--model <name>, -m   Model to use (sonnet|haiku|opus or full model ID)
--allow <ids>       Comma-separated allowlist of Slack user IDs
--version, -V       Show version
--verbose, -v       Enable debug logging
```

### Events

Run a background watcher that triggers agent runs from JSON files:

```bash
response events
```

Event files live in `~/.stateset/events/` and support three types:

**Immediate**

```json
{ "type": "immediate", "text": "Check new orders", "session": "ops" }
```

**One-shot**

```json
{ "type": "one-shot", "text": "Send summary", "at": "2026-02-10T09:00:00-08:00", "session": "ops" }
```

**Periodic**

```json
{
  "type": "periodic",
  "text": "Daily report",
  "schedule": "0 9 * * 1-5",
  "timezone": "America/Los_Angeles",
  "session": "ops"
}
```

Use `--session` to set a default session, `--usage` for token summaries, `--apply` to enable writes, `--redact` to enable PII redaction, and `--stdout` to print event results to the terminal.

### Shortcut Commands

Direct CLI commands for common platform operations — no interactive chat required.

```bash
# List resources
response agents
response rules
response kb
response channels
response messages
response responses

# Platform status & analytics
response status
response stats
response analytics --from 2026-02-01 --to 2026-02-19

# Snapshots & diff
response snapshot                          # Take a point-in-time snapshot
response diff --from snap1 --to snap2      # Compare two snapshots

# Deploy & rollback
response deploy <source> [--dry-run] [--strict] [--yes]
response rollback <source> [--dry-run] [--yes]
response deployments [--status applied] [--limit 10] [--offset 10]
response deployments retry <deployment-id> [--from <snapshot>]

# Pull & push configuration
response pull [--out ./backup]             # Export org config to disk
response push <source> [--dry-run]         # Import config from file/directory

# Bulk operations
response bulk <resource> <action> [--json]

# Backup & restore
response backup [--out ./backup]
response restore <source> [--dry-run] [--yes]

# Validate configuration
response validate <source> [--strict]

# Watch for changes
response watch [--interval 30] [--once]

# Webhooks, alerts & monitoring
response webhooks
response alerts
response monitor [--interval 60]
```

Most commands accept `--json` for machine-readable output and `--agent <id>` to scope to a specific agent.

### Integrations Management

Configure, inspect, and troubleshoot third-party integrations from the CLI.

```bash
# Show configuration status for all integrations
response integrations status

# Interactive setup wizard
response integrations setup

# Configure a single integration
response integrations setup shopify

# Use env vars to prefill + validate only
response integrations setup --from-env --validate-only

# Non-interactive setup from env vars (fails if required fields are missing)
response integrations setup shopify --from-env --non-interactive --scope local

# Show config file path
response integrations edit

# Health, limits & logs
response integrations health [integration] [--detailed]
response integrations limits [integration]
response integrations logs [integration]
```

Settings are stored in `~/.stateset/integrations.json` (global) or `.stateset/integrations.json` (project). Environment variables always override stored settings.

### Multi-Channel Gateway

Run Slack and Telegram from one process, with WhatsApp available when you need it:

```bash
response-gateway --no-whatsapp
```

**Channel Startup**

Slack + Telegram together:

```bash
export SLACK_BOT_TOKEN=xoxb-...
export SLACK_APP_TOKEN=xapp-...
export TELEGRAM_BOT_TOKEN=<token>
# Optional: enable real state changes instead of read-only responses
export STATESET_ALLOW_APPLY=true
response-gateway --no-whatsapp
```

Telegram-only:

```bash
export TELEGRAM_BOT_TOKEN=<token>
response-gateway --no-slack --no-whatsapp
```

WhatsApp via the gateway requires the Baileys package, then run the gateway (optionally disabling Slack and/or Telegram):

```bash
npm install @whiskeysockets/baileys
response-gateway --no-slack --no-telegram
```

On first WhatsApp run, scan the QR code (Settings > Linked Devices > Link a Device). Auth state is stored in `~/.stateset/whatsapp-auth/` or the path provided by `--whatsapp-auth-dir`. Telegram currently handles private chats only.

**Options:**

```
--model <name>, -m         Model to use (sonnet|haiku|opus or full model ID)
--no-slack                 Disable Slack channel
--no-telegram              Disable Telegram channel
--no-whatsapp              Disable WhatsApp channel
--slack-allow <ids>        Comma-separated Slack user ID allowlist
--telegram-allow <ids>     Comma-separated Telegram user ID allowlist
--whatsapp-allow <phones>  Comma-separated phone number allowlist
--whatsapp-groups          Allow WhatsApp group messages
--whatsapp-self-chat       Only respond to messages you send to yourself
--whatsapp-auth-dir <path> WhatsApp auth credential directory
--version, -V              Show version
--verbose, -v              Enable debug logging
```

**Notes:**

- Slack requires `SLACK_BOT_TOKEN` + `SLACK_APP_TOKEN`
- Telegram requires `TELEGRAM_BOT_TOKEN`
- WhatsApp requires the `@whiskeysockets/baileys` package to be installed
- Set `STATESET_ALLOW_APPLY=true` if the bot should execute state-changing operations
- Set `STATESET_GATEWAY_HEALTH_PORT` or `PORT` to expose `/healthz` and `/readyz`

### Kubernetes Deployment

The repo includes a container image definition plus `k8s/` manifests for the combined Slack + Telegram gateway. The default deployment runs `node ./bin/stateset-gateway.js --no-whatsapp`, exposes `/healthz` and `/readyz` on port `3000`, and bootstraps `~/.stateset/config.json` from environment variables on first start.

```bash
docker build -t registry.example.com/stateset/stateset-response-cli:1.9.3 .
docker push registry.example.com/stateset/stateset-response-cli:1.9.3
# Replace STATESET_RESPONSE_CLI_IMAGE in k8s/deployment.yaml before applying
kubectl apply -k k8s
```

Populate `k8s/secret.yaml`, replace `STATESET_RESPONSE_CLI_IMAGE` in `k8s/deployment.yaml`, then apply the manifests.

Required Kubernetes secrets/config:

- `ANTHROPIC_API_KEY`
- `STATESET_ORG_ID`
- `STATESET_GRAPHQL_ENDPOINT`
- `STATESET_CLI_TOKEN` or `STATESET_ADMIN_SECRET`
- `SLACK_BOT_TOKEN` + `SLACK_APP_TOKEN` for Slack
- `TELEGRAM_BOT_TOKEN` for Telegram

No public ingress is required for Slack Socket Mode or Telegram long polling. The bundled Service is there for probes and optional `kubectl port-forward`. The default manifest uses `emptyDir` for `/home/agent/.stateset`; switch that volume to a PVC if you want persistent session artifacts or WhatsApp auth state across pod restarts.

## Environment Variables

| Variable                       | Required      | Description                                                          |
| ------------------------------ | ------------- | -------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`            | Yes           | Anthropic API key for Claude                                         |
| `STATESET_INSTANCE_URL`        | No            | StateSet ResponseCX instance URL                                     |
| `STATESET_GRAPHQL_ENDPOINT`    | No            | GraphQL API endpoint; required when bootstrapping gateway config     |
| `STATESET_KB_HOST`             | No            | Knowledge base (Qdrant) host URL                                     |
| `STATESET_KB_BASE_URL`         | No            | Explicit KB/Qdrant base URL for workflow-studio connector sync       |
| `STATESET_SECRET_PASSPHRASE`   | No            | Optional secret used to encrypt/decrypt stored credentials           |
| `STATESET_ORG_ID`            | Gateway/K8s   | Organization ID used to bootstrap config in headless deployments     |
| `STATESET_ORG_NAME`          | Gateway/K8s   | Optional organization display name for env bootstrapping             |
| `STATESET_CLI_TOKEN`         | Gateway/K8s   | CLI token used to bootstrap config in headless deployments           |
| `STATESET_ADMIN_SECRET`      | Gateway/K8s   | Admin secret alternative to `STATESET_CLI_TOKEN`                     |
| `STATESET_MODEL`             | Optional      | Default model for CLI and gateway runtime bootstrap                  |
| `STATESET_STATE_DIR`         | Optional      | Override the `~/.stateset` runtime state directory                   |
| `STATESET_GATEWAY_HEALTH_PORT` | Optional    | HTTP health probe port for `response-gateway`                        |
| `PORT`                       | Optional      | Alias for `STATESET_GATEWAY_HEALTH_PORT`                             |
| `SHOPIFY_SHOP_DOMAIN`          | Shopify       | Shopify shop domain (e.g., `myshop.myshopify.com`)                   |
| `SHOPIFY_ACCESS_TOKEN`         | Shopify       | Shopify Admin API access token                                       |
| `SHOPIFY_API_VERSION`          | Shopify       | Shopify API version (default: `2025-04`)                             |
| `GORGIAS_DOMAIN`               | Gorgias       | Gorgias subdomain (e.g., `acme`)                                     |
| `GORGIAS_API_KEY`              | Gorgias       | Gorgias API key                                                      |
| `GORGIAS_EMAIL`                | Gorgias       | Gorgias user email                                                   |
| `RECHARGE_ACCESS_TOKEN`        | Recharge      | Recharge API access token                                            |
| `RECHARGE_API_VERSION`         | Recharge      | Recharge API version (default: `2021-01`)                            |
| `SKIO_API_KEY`                 | Skio          | Skio API key                                                         |
| `SKIO_BASE_URL`                | Skio          | Skio API base URL (default: `https://api.skio.com/v1`)               |
| `SKIO_API_VERSION`             | Skio          | Skio API version (default: `2024-01`)                                |
| `STAYAI_API_KEY`               | Stay.ai       | Stay.ai API key                                                      |
| `STAYAI_BASE_URL`              | Stay.ai       | Stay.ai API base URL (default: `https://api.stay.ai/v1`)             |
| `STAYAI_API_VERSION`           | Stay.ai       | Stay.ai API version (default: `2024-01`)                             |
| `AMAZON_LWA_CLIENT_ID`         | Amazon SP-API | Amazon Login with Amazon (LWA) client ID                             |
| `AMAZON_LWA_CLIENT_SECRET`     | Amazon SP-API | Amazon LWA client secret                                             |
| `AMAZON_LWA_REFRESH_TOKEN`     | Amazon SP-API | Amazon LWA refresh token                                             |
| `AMAZON_AWS_ACCESS_KEY_ID`     | Amazon SP-API | AWS access key ID for SP-API signing                                 |
| `AMAZON_AWS_SECRET_ACCESS_KEY` | Amazon SP-API | AWS secret access key for SP-API signing                             |
| `AMAZON_AWS_SESSION_TOKEN`     | Amazon SP-API | Optional AWS session token                                           |
| `AMAZON_SP_API_REGION`         | Amazon SP-API | SP-API signing region (default: `us-east-1`)                         |
| `AMAZON_SP_API_ENDPOINT`       | Amazon SP-API | SP-API endpoint (default: `https://sellingpartnerapi-na.amazon.com`) |
| `AMAZON_SP_MARKETPLACE_ID`     | Amazon SP-API | Default marketplace ID                                               |
| `DHL_API_KEY`                  | DHL           | DHL API key                                                          |
| `DHL_ACCESS_TOKEN`             | DHL           | Optional DHL bearer access token                                     |
| `DHL_ACCOUNT_NUMBER`           | DHL           | Optional DHL account number                                          |
| `DHL_BASE_URL`                 | DHL           | DHL API base URL (default: `https://api-m.dhl.com`)                  |
| `GLOBALE_MERCHANT_ID`          | Global-e      | Global-e merchant ID                                                 |
| `GLOBALE_API_KEY`              | Global-e      | Global-e API key                                                     |
| `GLOBALE_CHANNEL`              | Global-e      | Optional Global-e channel                                            |
| `GLOBALE_BASE_URL`             | Global-e      | Global-e API base URL (default: `https://api.global-e.com`)          |
| `FEDEX_CLIENT_ID`              | FedEx         | FedEx OAuth client ID                                                |
| `FEDEX_CLIENT_SECRET`          | FedEx         | FedEx OAuth client secret                                            |
| `FEDEX_ACCOUNT_NUMBER`         | FedEx         | Optional FedEx account number                                        |
| `FEDEX_LOCALE`                 | FedEx         | FedEx locale header (default: `en_US`)                               |
| `FEDEX_BASE_URL`               | FedEx         | FedEx API base URL (default: `https://apis.fedex.com`)               |
| `KLAVIYO_API_KEY`              | Klaviyo       | Klaviyo private API key                                              |
| `KLAVIYO_REVISION`             | Klaviyo       | Klaviyo API revision header (default: `2026-01-15`)                  |
| `LOOP_API_KEY`                 | Loop          | Loop Returns API key                                                 |
| `SHIPSTATION_API_KEY`          | ShipStation   | ShipStation API key                                                  |
| `SHIPSTATION_API_SECRET`       | ShipStation   | ShipStation API secret                                               |
| `SHIPHERO_ACCESS_TOKEN`        | ShipHero      | ShipHero access token                                                |
| `SHIPFUSION_API_KEY`           | ShipFusion    | ShipFusion API key                                                   |
| `SHIPFUSION_CLIENT_ID`         | ShipFusion    | ShipFusion client ID                                                 |
| `SHIPHAWK_API_KEY`             | ShipHawk      | ShipHawk API key                                                     |
| `ZENDESK_SUBDOMAIN`            | Zendesk       | Zendesk subdomain (e.g., `acme`)                                     |
| `ZENDESK_EMAIL`                | Zendesk       | Zendesk account email                                                |
| `ZENDESK_API_TOKEN`            | Zendesk       | Zendesk API token                                                    |
| `STATESET_ALLOW_APPLY`         | Optional      | Enable write operations for integrations and messaging gateways      |
| `STATESET_REDACT`              | Optional      | Redact customer emails in integration outputs                        |
| `STATESET_SHOW_USAGE`          | Optional      | Print token usage summaries                                          |
| `STATESET_TOOL_AUDIT`          | Optional      | Enable tool audit logging                                            |
| `STATESET_TOOL_AUDIT_DETAIL`   | Optional      | Include tool result excerpts in audit logs                           |
| `SLACK_BOT_TOKEN`              | Slack         | Bot User OAuth Token (`xoxb-...`)                                    |
| `SLACK_APP_TOKEN`              | Slack         | App-level token for Socket Mode (`xapp-...`)                         |
| `SLACK_ALLOW`                  | Slack         | Optional comma-separated Slack user ID allowlist                     |
| `TELEGRAM_BOT_TOKEN`           | Telegram      | Bot token from `@BotFather`                                          |
| `TELEGRAM_ALLOW`               | Telegram      | Optional comma-separated Telegram user ID allowlist                  |
| `WHATSAPP_ALLOW`               | WhatsApp      | Optional comma-separated phone number allowlist                      |
| `OPENAI_API_KEY`               | KB            | OpenAI API key for knowledge base embeddings                         |
| `OPEN_AI`                      | KB            | Alternative OpenAI API key variable                                  |

## Available Tools

The AI agent has access to 100+ tools organized by resource type:

### Agents

`list_agents` `get_agent` `create_agent` `update_agent` `delete_agent` `bootstrap_agent` `export_agent`

### Rules

`list_rules` `get_agent_rules` `create_rule` `update_rule` `delete_rule` `import_rules` `bulk_update_rule_status` `bulk_assign_rules_to_agent` `bulk_delete_rules`

### Skills

`list_skills` `get_agent_skills` `create_skill` `update_skill` `delete_skill` `import_skills` `bulk_update_skill_status` `bulk_delete_skills`

### Attributes

`list_attributes` `create_attribute` `update_attribute` `delete_attribute` `import_attributes`

### Examples

`list_examples` `create_example` `update_example` `delete_example` `import_examples`

### Evaluations

`list_evals` `create_eval` `update_eval` `delete_eval` `export_evals_for_finetuning`

### Datasets

`list_datasets` `get_dataset` `create_dataset` `update_dataset` `delete_dataset` `add_dataset_entry` `update_dataset_entry` `delete_dataset_entry` `import_dataset_entries`

### Functions

`list_functions` `create_function` `update_function` `delete_function` `import_functions`

### Responses

`list_responses` `get_response` `get_response_count` `bulk_update_response_ratings` `search_responses`

### Knowledge Base

`kb_search` `kb_upsert` `kb_update` `kb_delete` `kb_get_collection_info` `kb_scroll`

### Channels

`list_channels` `get_channel` `get_channel_with_messages` `create_channel` `update_channel` `delete_channel` `get_channel_count`

### Messages

`list_messages` `get_message` `create_message` `update_message` `delete_message` `search_messages` `get_message_count`

### Settings

`list_agent_settings` `get_agent_settings` `update_agent_settings` `get_channel_settings`

### Shopify

`shopify_list_orders` `shopify_preview_orders` `shopify_release_holds` `shopify_add_tags` `shopify_remove_tags` `shopify_lookup_order` `shopify_preview_refund` `shopify_process_refund` `shopify_batch_preview_refunds` `shopify_batch_process_refunds` `shopify_graphql` `shopify_rest` `shopify_preview_fulfillment_operation` `shopify_confirm_fulfillment_operation` `shopify_cancel_order` `shopify_create_fulfillment` `shopify_update_fulfillment` `shopify_cancel_fulfillment` `shopify_update_tracking` `shopify_job_status` `shopify_job_retry` `shopify_job_rollback`

### Gorgias

`gorgias_list_tickets` `gorgias_get_ticket` `gorgias_close_ticket` `gorgias_escalate_ticket` `gorgias_respond_with_macro` `gorgias_add_tags` `gorgias_merge_tickets` `gorgias_batch_close_tickets` `gorgias_batch_tag_tickets` `gorgias_reply_ticket` `gorgias_assign_ticket` `gorgias_set_ticket_state` `gorgias_list_macros` `gorgias_get_macro` `gorgias_list_users` `gorgias_list_teams` `gorgias_request`

### Recharge

`recharge_list_customers` `recharge_get_customer` `recharge_list_subscriptions` `recharge_get_subscription` `recharge_list_charges` `recharge_get_charge` `recharge_list_orders` `recharge_get_order` `recharge_preview_subscription_change` `recharge_confirm_subscription_change` `recharge_skip_charge` `recharge_reschedule_charge` `recharge_issue_refund` `recharge_update_customer_shipping` `recharge_update_customer_payment` `recharge_job_status` `recharge_job_retry` `recharge_job_rollback` `recharge_request`

### Skio

`skio_list_customers` `skio_get_customer` `skio_list_subscriptions` `skio_get_subscription` `skio_list_charges` `skio_get_charge` `skio_list_orders` `skio_get_order` `skio_preview_subscription_change` `skio_confirm_subscription_change` `skio_skip_charge` `skio_reschedule_charge` `skio_issue_refund` `skio_update_customer_shipping` `skio_update_customer_payment` `skio_job_status` `skio_job_retry` `skio_job_rollback` `skio_request`

### Stay.ai

`stayai_list_customers` `stayai_get_customer` `stayai_list_subscriptions` `stayai_get_subscription` `stayai_list_charges` `stayai_get_charge` `stayai_list_orders` `stayai_get_order` `stayai_preview_subscription_change` `stayai_confirm_subscription_change` `stayai_skip_charge` `stayai_reschedule_charge` `stayai_issue_refund` `stayai_update_customer_shipping` `stayai_update_customer_payment` `stayai_job_status` `stayai_job_retry` `stayai_job_rollback` `stayai_request`

### Amazon SP-API

`amazon_list_orders` `amazon_get_order` `amazon_list_order_items` `amazon_list_fulfillment_orders` `amazon_get_fulfillment_order` `amazon_get_fulfillment_preview` `amazon_preview_create_fulfillment_order` `amazon_confirm_create_fulfillment_order` `amazon_preview_update_fulfillment_order` `amazon_confirm_update_fulfillment_order` `amazon_cancel_fulfillment_order` `amazon_get_package_tracking` `amazon_request`

### DHL

`dhl_track_shipment` `dhl_get_rates` `dhl_create_shipment` `dhl_cancel_shipment` `dhl_schedule_pickup` `dhl_cancel_pickup` `dhl_request`

### Global-e

`globale_track_shipment` `globale_get_rates` `globale_create_shipment` `globale_cancel_shipment` `globale_schedule_pickup` `globale_cancel_pickup` `globale_request`
`globale_track_shipment` requires `endpoint_override`; `globale_get_rates` requires both `endpoint_override` and `rate_payload` (merchant-specific contract).

### FedEx

`fedex_track_shipment` `fedex_get_rates` `fedex_create_shipment` `fedex_cancel_shipment` `fedex_schedule_pickup` `fedex_cancel_pickup` `fedex_request`
`fedex_get_rates` builds a FedEx Rate v1 quote payload and supports optional `package_type` and `service_type`.

### Klaviyo

`klaviyo_list_profiles` `klaviyo_get_profile` `klaviyo_create_profile` `klaviyo_create_or_update_profile` `klaviyo_update_profile` `klaviyo_merge_profiles`
`klaviyo_list_profile_import_jobs` `klaviyo_get_profile_import_job` `klaviyo_create_profile_import_job` `klaviyo_get_profile_import_job_profiles` `klaviyo_get_profile_import_job_errors` `klaviyo_create_data_privacy_deletion_job`
`klaviyo_list_lists` `klaviyo_get_list` `klaviyo_create_list` `klaviyo_update_list` `klaviyo_delete_list` `klaviyo_get_list_profiles` `klaviyo_get_list_profile_ids` `klaviyo_add_profiles_to_list` `klaviyo_remove_profiles_from_list`
`klaviyo_list_segments` `klaviyo_get_segment` `klaviyo_create_segment` `klaviyo_update_segment` `klaviyo_get_segment_profiles` `klaviyo_get_segment_profile_ids`
`klaviyo_list_tags` `klaviyo_get_tag` `klaviyo_create_tag` `klaviyo_update_tag` `klaviyo_delete_tag` `klaviyo_get_tag_flows` `klaviyo_add_tag_flows` `klaviyo_remove_tag_flows` `klaviyo_get_tag_campaigns` `klaviyo_add_tag_campaigns` `klaviyo_remove_tag_campaigns` `klaviyo_get_tag_lists` `klaviyo_add_tag_lists` `klaviyo_remove_tag_lists` `klaviyo_get_tag_segments` `klaviyo_add_tag_segments` `klaviyo_remove_tag_segments`
`klaviyo_list_tag_groups` `klaviyo_get_tag_group` `klaviyo_create_tag_group` `klaviyo_update_tag_group` `klaviyo_delete_tag_group`
`klaviyo_subscribe_profiles_job` `klaviyo_unsubscribe_profiles_job` `klaviyo_suppress_profiles_job` `klaviyo_unsuppress_profiles_job`
`klaviyo_list_campaigns` `klaviyo_get_campaign` `klaviyo_create_campaign` `klaviyo_update_campaign` `klaviyo_delete_campaign` `klaviyo_schedule_campaign` `klaviyo_send_campaign_now` `klaviyo_cancel_campaign`
`klaviyo_list_flows` `klaviyo_get_flow` `klaviyo_create_flow` `klaviyo_update_flow` `klaviyo_delete_flow` `klaviyo_pause_flow` `klaviyo_resume_flow`
`klaviyo_list_templates` `klaviyo_get_template` `klaviyo_create_template` `klaviyo_update_template` `klaviyo_delete_template` `klaviyo_render_template` `klaviyo_clone_template`
`klaviyo_list_forms` `klaviyo_get_form` `klaviyo_create_form` `klaviyo_delete_form`
`klaviyo_list_images` `klaviyo_get_image` `klaviyo_upload_image_from_url` `klaviyo_upload_image_from_file` `klaviyo_update_image`
`klaviyo_list_catalog_items` `klaviyo_get_catalog_item` `klaviyo_create_catalog_item` `klaviyo_update_catalog_item` `klaviyo_delete_catalog_item`
`klaviyo_list_catalog_variants` `klaviyo_get_catalog_variant` `klaviyo_create_catalog_variant` `klaviyo_update_catalog_variant` `klaviyo_delete_catalog_variant`
`klaviyo_list_catalog_categories` `klaviyo_get_catalog_category` `klaviyo_create_catalog_category` `klaviyo_update_catalog_category` `klaviyo_delete_catalog_category`
`klaviyo_list_coupons` `klaviyo_get_coupon` `klaviyo_create_coupon` `klaviyo_update_coupon` `klaviyo_delete_coupon`
`klaviyo_list_coupon_codes` `klaviyo_get_coupon_code` `klaviyo_create_coupon_code` `klaviyo_update_coupon_code` `klaviyo_delete_coupon_code`
`klaviyo_list_push_tokens` `klaviyo_get_push_token` `klaviyo_create_push_token` `klaviyo_update_push_token` `klaviyo_delete_push_token`
`klaviyo_create_campaign_values_report` `klaviyo_create_flow_values_report` `klaviyo_create_flow_series_report` `klaviyo_create_form_values_report` `klaviyo_create_form_series_report` `klaviyo_create_segment_values_report` `klaviyo_create_segment_series_report`
`klaviyo_query_metric_aggregates` `klaviyo_list_metrics` `klaviyo_get_metric` `klaviyo_create_event` `klaviyo_list_events` `klaviyo_get_event` `klaviyo_request`

### Loop Returns

`loop_list_returns` `loop_get_return` `loop_approve_return` `loop_reject_return` `loop_process_exchange` `loop_issue_refund` `loop_create_label` `loop_add_note` `loop_batch_approve_returns` `loop_request`

### ShipStation

`shipstation_list_orders` `shipstation_get_order` `shipstation_update_order` `shipstation_create_label` `shipstation_void_label` `shipstation_get_rates` `shipstation_list_shipments` `shipstation_list_carriers` `shipstation_list_stores` `shipstation_list_tags` `shipstation_add_tag` `shipstation_batch_create_labels` `shipstation_create_order` `shipstation_cancel_shipment` `shipstation_create_scan_form` `shipstation_get_scan_form` `shipstation_schedule_pickup` `shipstation_cancel_pickup` `shipstation_request`

### ShipHero

`shiphero_list_orders` `shiphero_get_order` `shiphero_update_order` `shiphero_create_shipment` `shiphero_get_inventory` `shiphero_adjust_inventory` `shiphero_list_warehouses` `shiphero_route_order` `shiphero_batch_ship_orders` `shiphero_set_order_hold` `shiphero_cancel_shipment` `shiphero_create_return` `shiphero_update_return` `shiphero_resolve_order_exception` `shiphero_graphql`

### ShipFusion

`shipfusion_list_orders` `shipfusion_get_order` `shipfusion_cancel_order` `shipfusion_get_inventory` `shipfusion_list_shipments` `shipfusion_get_shipment` `shipfusion_get_order_shipments` `shipfusion_get_tracking` `shipfusion_create_asn` `shipfusion_list_returns` `shipfusion_get_return` `shipfusion_process_return` `shipfusion_hold_order` `shipfusion_cancel_shipment` `shipfusion_create_return` `shipfusion_update_return` `shipfusion_resolve_exception` `shipfusion_job_status` `shipfusion_job_retry` `shipfusion_job_rollback` `shipfusion_request`

### ShipHawk

`shiphawk_get_rates` `shiphawk_create_shipment` `shiphawk_get_shipment` `shiphawk_void_shipment` `shiphawk_track_shipment` `shiphawk_track_by_number` `shiphawk_list_shipments` `shiphawk_schedule_pickup` `shiphawk_get_bol` `shiphawk_batch_rate_shop` `shiphawk_request`

### Zendesk

`zendesk_search_tickets` `zendesk_list_tickets` `zendesk_search_users` `zendesk_search_organizations` `zendesk_get_ticket` `zendesk_list_ticket_comments` `zendesk_list_ticket_audits` `zendesk_list_suspended_tickets` `zendesk_create_ticket` `zendesk_update_ticket` `zendesk_add_comment` `zendesk_reply_ticket` `zendesk_assign_ticket` `zendesk_set_ticket_state` `zendesk_close_ticket` `zendesk_escalate_ticket` `zendesk_apply_macro` `zendesk_add_tags` `zendesk_merge_tickets` `zendesk_list_macros` `zendesk_get_macro` `zendesk_list_groups` `zendesk_get_group` `zendesk_list_users` `zendesk_get_user` `zendesk_create_user` `zendesk_update_user` `zendesk_list_organizations` `zendesk_get_organization` `zendesk_create_organization` `zendesk_update_organization` `zendesk_list_ticket_fields` `zendesk_get_ticket_field` `zendesk_create_ticket_field` `zendesk_update_ticket_field` `zendesk_delete_ticket_field` `zendesk_list_ticket_forms` `zendesk_get_ticket_form` `zendesk_create_ticket_form` `zendesk_update_ticket_form` `zendesk_delete_ticket_form` `zendesk_list_views` `zendesk_get_view` `zendesk_list_triggers` `zendesk_get_trigger` `zendesk_list_automations` `zendesk_get_automation` `zendesk_list_sla_policies` `zendesk_get_sla_policy` `zendesk_batch_update_tickets` `zendesk_request`

### Organizations

`get_organization` `get_organization_overview` `update_organization`

## Customization

The CLI can load local context files, skills, and prompt templates from `~/.stateset` and your project.

**Context files**

- `~/.stateset/AGENTS.md` or `~/.stateset/CLAUDE.md`
- `.stateset/AGENTS.md` or `.stateset/CLAUDE.md` in the current project
- Any `AGENTS.md` or `CLAUDE.md` in parent directories (walks up from the current working directory)

**System prompt overrides**

- `.stateset/SYSTEM.md` (project) or `~/.stateset/SYSTEM.md` (global) replaces the default system prompt
- `.stateset/APPEND_SYSTEM.md` or `~/.stateset/APPEND_SYSTEM.md` appends extra instructions

**Prompt templates**

- Store Markdown templates in `.stateset/prompts/*.md` or `~/.stateset/prompts/*.md`
- Use `/prompts` to list and `/prompt <name>` to fill and send a template
- Defaults can be set inline using `{{variable=default}}`
- Reuse partials with `{{> partial}}` or `{{include:partial}}`
- Pass variables into partials: `{{> partial name="Support" priority=high}}`
- Conditionals: `{{#if variable}}...{{/if}}` and `{{#unless variable}}...{{/unless}}`
- Use `/prompt-history` to show recently used templates
- Use `/prompt-validate <name|all>` to check for missing includes
- `/prompt-validate` also checks unmatched `{{#if}}`/`{{#unless}}` blocks
- `/prompt-validate` flags unknown template variables
- `/prompt-validate` flags unused variables in the template
- `/prompt-validate` flags conflicting default values for the same variable

**Skills**

- Store skills in `.stateset/skills/<name>.md` or `.stateset/skills/<name>/SKILL.md` (also in `~/.stateset/skills`)
- Use `/skills` to list, `/skill <name>` to activate, and `/skill-clear` to reset

**Extensions**

- Add JavaScript files in `.stateset/extensions/` or `~/.stateset/extensions/`
- Each extension should export a default `register(api)` function and call `api.registerCommand(...)`
- Project-local extensions require explicit trust policy configuration to run (`STATESET_EXTENSIONS_ENFORCE_TRUST=true` + allow/deny rules).
- Trust policy behavior:
  - `STATESET_EXTENSIONS_DENY` denies listed extensions (deny-only mode).
  - `STATESET_EXTENSIONS_ALLOW` enables allowlist mode.
  - `STATESET_EXTENSIONS_ENFORCE_TRUST=true` with no allow/deny entries blocks all project extensions.
  - `STATESET_EXTENSIONS_HASHES` supports explicit integrity checks in `<name>:<sha256>` format (`alpha:deadbeef...`).
  - `STATESET_EXTENSIONS_REQUIRE_HASHES=true` enforces hash verification for trusted extensions that define hashes.
  - Trust files (`~/.stateset/extension-trust.json` or `.stateset/extension-trust.json`) support `enforce`, `allow`, `deny`, `requireHashes`, and `hashes` entries.
    - `{"enforce": true, "allow": ["name"], "deny": ["name"]}`
- Use `/extensions` to list loaded extensions and `/reload` to reload them
- Extensions can also hook tool calls with `api.registerToolHook(...)` and `api.registerToolResultHook(...)`
- Tool hook policies can be declared inline via `policy: "deny" | "allow"` plus `tools: ["shopify_*"]`
- Tool hooks can be scoped to session tags via `tags: ["prod", "high-risk"]`
- Global policy overrides can be set in `.stateset/policies.json` or `~/.stateset/policies.json`
- Manage overrides in the CLI with `/policy list [local|global|merged]`, `/policy set|unset|clear`, `/policy edit`, `/policy init`
- Import/export overrides with `/policy import <path> [merge|replace]` and `/policy export [out=path] [local|global|merged]`

**Sessions**

- `/sessions` lists sessions (use `/sessions all` to include archived)
- `/sessions tag=refunds` filters by tag
- `/archive [session]` and `/unarchive [session]` toggle archived state
- `/tag list|add|remove <tag> [session]` manages session tags
- `/search <text> [all] [role=user|assistant] [since=YYYY-MM-DD] [until=YYYY-MM-DD] [regex=/pattern/i] [limit=100]` searches session transcripts
- Session exports are stored in `~/.stateset/sessions/<session>/exports`
- `/export-list [session]` lists exports, `/export-show <file> [session]` previews them
- `/export-delete <file> [session]` deletes an export; `/export-prune [session] keep=5` keeps the newest files
- `/session-meta [session] [json|md] [out=path]` outputs session metadata

**Audit**

- `/audit on|off` toggles tool audit logging (stored per session as `tool-audit.jsonl`)
- Set `STATESET_TOOL_AUDIT_DETAIL=true` to include truncated tool result excerpts
- `/audit-show [session] [tool=foo] [errors] [limit=20]` displays recent audit entries
- `/audit-clear [session]` clears the audit log for a session

**Permissions**

- When an extension hook denies a tool call, the CLI prompts to allow/deny once or persist the choice
- `/permissions` lists stored decisions and `/permissions clear` resets them

**Operations Store**

The shortcut commands track alerts and deployments in a local store at `~/.stateset/platform-operations.json`. `response webhooks` now uses the remote platform webhook records and delivery history, while `response monitor` prefers remote webhook state and falls back to the local store if webhook tools are unavailable.

## Architecture

The CLI uses the [Model Context Protocol (MCP)](https://modelcontextprotocol.io) to expose platform tools to Claude. On startup, the CLI spawns an MCP server as a child process over stdio. Claude calls tools through this server, which executes GraphQL queries against the StateSet backend and third-party integration APIs.

```
                     ┌─────────────────────────────────┐
                     │         MCP Server (stdio)       │
User ──► CLI ──►     │  ┌───────────┐  ┌────────────┐  │
         (Anthropic  │  │  GraphQL   │  │Integration │  │
          SDK)       │  │  Client    │  │  Clients   │  │
                     │  └─────┬─────┘  └─────┬──────┘  │
                     └────────┼──────────────┼─────────┘
                              │              │
                     ┌────────▼───┐  ┌───────▼────────┐
                     │  StateSet   │  │ Shopify, Klaviyo│
                     │  GraphQL    │  │ Gorgias, etc.  │
                     │  API        │  └────────────────┘
                     └────────┬───┘
                              │
                     ┌────────▼───┐
                     │  Qdrant    │
                     │  Vector DB │
                     └────────────┘
```

**Resilience:**

- **Circuit breaker** on all outbound HTTP calls — trips after repeated failures, auto-recovers
- **Retry with exponential backoff + jitter** and `Retry-After` header support (429/502/503/504)
- **Eager config validation** at all entry points (CLI, gateways, events)

**Gateways:**

- WhatsApp and Slack gateways create per-user agent sessions with the same MCP architecture
- Sessions have a 30-minute TTL and a 400-session cap, with automatic cleanup

## Security

- **Credential encryption** — AES-256-GCM with scrypt v2 key derivation (`enc:v2:` prefix), backward-compatible with v1
- **File permissions** — config files written with `0o600`, config directory with `0o700`
- **SSRF prevention** — full URL parsing and validation on integration base URLs; Zendesk subdomain regex enforcement
- **ANSI escape sanitization** — all untrusted tool output is stripped of escape sequences before display
- **Path traversal protection** — attachment paths are resolved and validated to reject directory traversal
- **API key format validation** — rejects keys that don't match the expected `sk-ant-*` prefix
- **PII redaction** — opt-in redaction of customer emails in integration outputs (`--redact`)
- **Extension sandboxing** — registration timeout (10s), handler timeouts, and optional SHA-256 hash verification
- **System prompt size cap** — prompts are capped at 200K characters to prevent abuse

## Changelog

See [GitHub Releases](https://github.com/stateset/stateset-response-cli/releases) for version history.

## Development

```bash
# Run in development mode (no build step)
npm run dev

# Build TypeScript
npm run build

# Run production build
npm start

# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Full quality check (typecheck + lint + format + full coverage + strict core coverage)
npm run check

# Lint & format
npm run lint
npm run format
```

**Testing:** 85 test files, 1500+ tests (vitest). Full-suite coverage gate: 75% lines/branches/functions/statements. Core module coverage gate: 100% lines/branches/functions/statements.

**CI:** GitHub Actions matrix across Node 18, 20, and 22. Release workflow publishes to npm with provenance on GitHub Release creation.

**Pre-commit hooks:** lint-staged runs ESLint + Prettier on staged files, followed by `tsc --noEmit` for type checking.

## License

[MIT](LICENSE)
