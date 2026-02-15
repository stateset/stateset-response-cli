# StateSet ResponseCX CLI

AI-powered CLI for managing the [StateSet ResponseCX](https://response.cx) platform. Chat with an AI agent that can manage your agents, rules, skills, knowledge base, channels, messages, and more — all from the terminal.

Includes optional WhatsApp and Slack gateways for connecting your agent to messaging platforms.
Current version: `1.3.2`.

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

```bash
# Authenticate with your StateSet organization
response auth login

# Start an interactive chat session
response chat
```

## Authentication

The CLI supports two authentication methods:

**Browser / Device Code (recommended)**

```bash
response auth login
```

Follow the prompts to authenticate via your browser. The CLI will receive a scoped token automatically.

**Manual Setup**

During `response auth login`, you can provide your GraphQL endpoint and admin secret directly.

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

**Session commands (key):**

Use `/help` for the full list. Highlights below.

**Core**
- `/help` Show available commands
- `/clear` Reset conversation history
- `/history` Show conversation turn count
- `/model <name>` Switch model (sonnet, haiku, opus)
- `/attach <path>` Attach file/image to next message
- `/attachments` List staged attachments
- `/attach-clear` Clear staged attachments
- `exit` End the session

**Safety**
- `/apply on|off` Enable or disable write operations
- `/redact on|off` Enable or disable PII redaction
- `/usage on|off` Toggle usage summaries
- `/audit on|off [detail]` Toggle tool audit logging (+ result excerpts)
- `/audit-show [session] [tool=name] [errors] [limit=20]` Show recent audit entries
- `/audit-clear [session]` Clear a session audit log
- `/permissions [list|clear]` Show or clear stored tool-hook decisions

**Sessions**
- `/session` Show current session info
- `/sessions [all]` List sessions (add `all` to include archived)
- `/new [name]` Start a new session
- `/resume <name>` Resume a saved session
- `/archive [name]` Archive a session
- `/unarchive [name]` Unarchive a session
- `/tag list|add|remove <tag> [session]` Manage session tags
- `/search <text> [all] [role=...] [since=YYYY-MM-DD] [until=YYYY-MM-DD] [regex=/.../] [limit=50]` Search transcripts
- `/rename <new-id>` Rename the current session
- `/delete [name]` Delete a session

**Exports**
- `/export [session] [md|json|jsonl] [path]` Export a session transcript
- `/export-list [session]` List export files for a session
- `/export-show <file> [session] [head=40]` Preview an export
- `/export-open <file> [session]` Show an export file path
- `/export-delete <file> [session]` Delete an export
- `/export-prune [session] keep=5` Delete older exports
- `/session-meta [session] [json|md] [out=path]` Session metadata summary

**Prompts**
- `/prompts` List prompt templates
- `/prompt <name>` Fill and send a prompt template
- `/prompt-history` Show recent prompt templates
- `/prompt-validate <name|all>` Validate prompt templates

**Skills**
- `/skills` List available skills
- `/skill <name>` Activate a skill
- `/skill-clear` Clear active skills

**Extensions**
- `/extensions` List loaded extensions
- `/reload` Reload extensions
- `/policy list|set|unset|clear|edit|init|import|export` Manage policy overrides

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
--model <name>     Model to use (sonnet, haiku, opus)
--allow <phones>   Comma-separated allowlist of phone numbers
--groups           Allow messages from group chats
--self-chat        Only respond to messages you send to yourself
--auth-dir <path>  WhatsApp auth credential directory
--reset            Clear stored auth and re-scan QR
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
```

**Behavior:**
- In DMs: responds to all messages
- In channels: responds when @mentioned or in threads the bot has participated in

**Options:**

```
--model <name>      Model to use (sonnet, haiku, opus)
--allow <ids>       Comma-separated allowlist of Slack user IDs
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
{"type":"immediate","text":"Check new orders","session":"ops"}
```

**One-shot**
```json
{"type":"one-shot","text":"Send summary","at":"2026-02-10T09:00:00-08:00","session":"ops"}
```

**Periodic**
```json
{"type":"periodic","text":"Daily report","schedule":"0 9 * * 1-5","timezone":"America/Los_Angeles","session":"ops"}
```

Use `--session` to set a default session, `--usage` for token summaries, `--apply` to enable writes, `--redact` to enable PII redaction, and `--stdout` to print event results to the terminal.

### Multi-Channel Gateway

Run Slack and WhatsApp gateways together:

```bash
response-gateway
```

**Channel Startup**

Slack via the gateway requires the Slack env vars, then run the gateway (optionally disabling WhatsApp):

```bash
export SLACK_BOT_TOKEN=xoxb-...
export SLACK_APP_TOKEN=xapp-...
response-gateway --no-whatsapp
```

WhatsApp via the gateway requires the Baileys package, then run the gateway (optionally disabling Slack):

```bash
npm install @whiskeysockets/baileys
response-gateway --no-slack
```

On first WhatsApp run, scan the QR code (Settings > Linked Devices > Link a Device). Auth state is stored in `~/.stateset/whatsapp-auth/` or the path provided by `--whatsapp-auth-dir`.

**Options:**

```
--model <name>             Model to use (sonnet, haiku, opus)
--no-slack                 Disable Slack channel
--no-whatsapp              Disable WhatsApp channel
--slack-allow <ids>        Comma-separated Slack user ID allowlist
--whatsapp-allow <phones>  Comma-separated phone number allowlist
--whatsapp-groups          Allow WhatsApp group messages
--whatsapp-self-chat       Only respond to messages you send to yourself
--whatsapp-auth-dir <path> WhatsApp auth credential directory
--verbose, -v              Enable debug logging
```

**Notes:**
- Slack requires `SLACK_BOT_TOKEN` + `SLACK_APP_TOKEN`
- WhatsApp requires the `@whiskeysockets/baileys` package to be installed

## Environment Variables

| Variable                 | Required | Description                                    |
|--------------------------|----------|------------------------------------------------|
| `ANTHROPIC_API_KEY`      | Yes      | Anthropic API key for Claude                   |
| `STATESET_INSTANCE_URL`  | No       | StateSet ResponseCX instance URL               |
| `STATESET_GRAPHQL_ENDPOINT` | No    | GraphQL API endpoint                           |
| `STATESET_KB_HOST`       | No       | Knowledge base (Qdrant) host URL               |
| `SHOPIFY_SHOP_DOMAIN`    | Shopify  | Shopify shop domain (e.g., `myshop.myshopify.com`) |
| `SHOPIFY_ACCESS_TOKEN`   | Shopify  | Shopify Admin API access token                 |
| `SHOPIFY_API_VERSION`    | Shopify  | Shopify API version (default: `2025-04`)       |
| `GORGIAS_DOMAIN`         | Gorgias  | Gorgias subdomain (e.g., `acme`)               |
| `GORGIAS_API_KEY`        | Gorgias  | Gorgias API key                                |
| `GORGIAS_EMAIL`          | Gorgias  | Gorgias user email                             |
| `RECHARGE_ACCESS_TOKEN`  | Recharge | Recharge API access token                      |
| `RECHARGE_API_VERSION`   | Recharge | Recharge API version (default: `2021-01`)      |
| `KLAVIYO_API_KEY`        | Klaviyo  | Klaviyo private API key                        |
| `KLAVIYO_REVISION`       | Klaviyo  | Klaviyo API revision header (default: `2026-01-15`) |
| `LOOP_API_KEY`           | Loop     | Loop Returns API key                           |
| `SHIPSTATION_API_KEY`    | ShipStation | ShipStation API key                         |
| `SHIPSTATION_API_SECRET` | ShipStation | ShipStation API secret                      |
| `SHIPHERO_ACCESS_TOKEN`  | ShipHero | ShipHero access token                          |
| `SHIPFUSION_API_KEY`     | ShipFusion | ShipFusion API key                          |
| `SHIPFUSION_CLIENT_ID`   | ShipFusion | ShipFusion client ID                         |
| `SHIPHAWK_API_KEY`       | ShipHawk | ShipHawk API key                              |
| `ZENDESK_SUBDOMAIN`      | Zendesk  | Zendesk subdomain (e.g., `acme`)               |
| `ZENDESK_EMAIL`          | Zendesk  | Zendesk account email                         |
| `ZENDESK_API_TOKEN`      | Zendesk  | Zendesk API token                             |
| `STATESET_ALLOW_APPLY`   | Optional | Enable write operations for integrations       |
| `STATESET_REDACT`        | Optional | Redact customer emails in integration outputs  |
| `STATESET_SHOW_USAGE`    | Optional | Print token usage summaries                    |
| `STATESET_TOOL_AUDIT`    | Optional | Enable tool audit logging                      |
| `STATESET_TOOL_AUDIT_DETAIL` | Optional | Include tool result excerpts in audit logs |
| `SLACK_BOT_TOKEN`        | Slack    | Bot User OAuth Token (`xoxb-...`)              |
| `SLACK_APP_TOKEN`        | Slack    | App-level token for Socket Mode (`xapp-...`)   |
| `OPENAI_API_KEY`         | KB       | OpenAI API key for knowledge base embeddings   |

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
`list_datasets` `get_dataset` `create_dataset` `update_dataset` `delete_dataset` `add_dataset_entry` `delete_dataset_entry`

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
`shopify_list_orders` `shopify_preview_orders` `shopify_release_holds` `shopify_add_tags` `shopify_lookup_order` `shopify_preview_refund` `shopify_process_refund` `shopify_batch_preview_refunds` `shopify_batch_process_refunds` `shopify_graphql` `shopify_rest`

### Gorgias
`gorgias_list_tickets` `gorgias_get_ticket` `gorgias_close_ticket` `gorgias_escalate_ticket` `gorgias_respond_with_macro` `gorgias_add_tags` `gorgias_merge_tickets` `gorgias_batch_close_tickets` `gorgias_batch_tag_tickets` `gorgias_list_macros` `gorgias_get_macro` `gorgias_list_users` `gorgias_list_teams` `gorgias_request`

### Recharge
`recharge_list_customers` `recharge_get_customer` `recharge_list_subscriptions` `recharge_get_subscription` `recharge_list_charges` `recharge_get_charge` `recharge_list_orders` `recharge_get_order` `recharge_request`

### Klaviyo
`klaviyo_list_profiles` `klaviyo_get_profile` `klaviyo_create_profile` `klaviyo_create_or_update_profile` `klaviyo_update_profile` `klaviyo_merge_profiles`
`klaviyo_list_profile_import_jobs` `klaviyo_get_profile_import_job` `klaviyo_create_profile_import_job` `klaviyo_get_profile_import_job_profiles` `klaviyo_get_profile_import_job_errors` `klaviyo_create_data_privacy_deletion_job`
`klaviyo_list_lists` `klaviyo_get_list` `klaviyo_create_list` `klaviyo_update_list` `klaviyo_delete_list` `klaviyo_get_list_profiles` `klaviyo_get_list_profile_ids` `klaviyo_add_profiles_to_list` `klaviyo_remove_profiles_from_list`
`klaviyo_list_segments` `klaviyo_get_segment` `klaviyo_create_segment` `klaviyo_update_segment` `klaviyo_get_segment_profiles` `klaviyo_get_segment_profile_ids`
`klaviyo_list_tags` `klaviyo_get_tag` `klaviyo_create_tag` `klaviyo_update_tag` `klaviyo_delete_tag` `klaviyo_get_tag_flows` `klaviyo_add_tag_flows` `klaviyo_remove_tag_flows` `klaviyo_get_tag_campaigns` `klaviyo_add_tag_campaigns` `klaviyo_remove_tag_campaigns` `klaviyo_get_tag_lists` `klaviyo_add_tag_lists` `klaviyo_remove_tag_lists` `klaviyo_get_tag_segments` `klaviyo_add_tag_segments` `klaviyo_remove_tag_segments`
`klaviyo_list_tag_groups` `klaviyo_get_tag_group` `klaviyo_create_tag_group` `klaviyo_update_tag_group` `klaviyo_delete_tag_group`
`klaviyo_subscribe_profiles_job` `klaviyo_unsubscribe_profiles_job` `klaviyo_suppress_profiles_job` `klaviyo_unsuppress_profiles_job`
`klaviyo_list_campaigns` `klaviyo_get_campaign` `klaviyo_create_campaign` `klaviyo_update_campaign` `klaviyo_delete_campaign`
`klaviyo_list_flows` `klaviyo_get_flow` `klaviyo_create_flow` `klaviyo_update_flow` `klaviyo_delete_flow`
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
`shipstation_list_orders` `shipstation_get_order` `shipstation_update_order` `shipstation_create_label` `shipstation_void_label` `shipstation_get_rates` `shipstation_list_shipments` `shipstation_list_carriers` `shipstation_list_stores` `shipstation_list_tags` `shipstation_add_tag` `shipstation_batch_create_labels` `shipstation_request`

### ShipHero
`shiphero_list_orders` `shiphero_get_order` `shiphero_update_order` `shiphero_create_shipment` `shiphero_get_inventory` `shiphero_adjust_inventory` `shiphero_list_warehouses` `shiphero_route_order` `shiphero_batch_ship_orders` `shiphero_graphql`

### ShipFusion
`shipfusion_list_orders` `shipfusion_get_order` `shipfusion_cancel_order` `shipfusion_get_inventory` `shipfusion_list_shipments` `shipfusion_get_shipment` `shipfusion_get_order_shipments` `shipfusion_get_tracking` `shipfusion_create_asn` `shipfusion_list_returns` `shipfusion_get_return` `shipfusion_process_return` `shipfusion_request`

### ShipHawk
`shiphawk_get_rates` `shiphawk_create_shipment` `shiphawk_get_shipment` `shiphawk_void_shipment` `shiphawk_track_shipment` `shiphawk_track_by_number` `shiphawk_list_shipments` `shiphawk_schedule_pickup` `shiphawk_get_bol` `shiphawk_batch_rate_shop` `shiphawk_request`

### Zendesk
`zendesk_search_tickets` `zendesk_list_tickets` `zendesk_search_users` `zendesk_search_organizations` `zendesk_get_ticket` `zendesk_list_ticket_comments` `zendesk_list_ticket_audits` `zendesk_list_suspended_tickets` `zendesk_create_ticket` `zendesk_update_ticket` `zendesk_add_comment` `zendesk_close_ticket` `zendesk_escalate_ticket` `zendesk_apply_macro` `zendesk_add_tags` `zendesk_merge_tickets` `zendesk_list_macros` `zendesk_get_macro` `zendesk_list_groups` `zendesk_get_group` `zendesk_list_users` `zendesk_get_user` `zendesk_create_user` `zendesk_update_user` `zendesk_list_organizations` `zendesk_get_organization` `zendesk_create_organization` `zendesk_update_organization` `zendesk_list_ticket_fields` `zendesk_get_ticket_field` `zendesk_create_ticket_field` `zendesk_update_ticket_field` `zendesk_delete_ticket_field` `zendesk_list_ticket_forms` `zendesk_get_ticket_form` `zendesk_create_ticket_form` `zendesk_update_ticket_form` `zendesk_delete_ticket_form` `zendesk_list_views` `zendesk_get_view` `zendesk_list_triggers` `zendesk_get_trigger` `zendesk_list_automations` `zendesk_get_automation` `zendesk_list_sla_policies` `zendesk_get_sla_policy` `zendesk_batch_update_tickets` `zendesk_request`

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
- `/search <text> [all] [role=user|assistant] [since=YYYY-MM-DD] [until=YYYY-MM-DD] [regex=/pattern/i] [limit=50]` searches session transcripts
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

## Architecture

The CLI uses the [Model Context Protocol (MCP)](https://modelcontextprotocol.io) to expose platform tools to Claude. On startup, the CLI spawns an MCP server as a child process over stdio. Claude calls tools through this server, which executes GraphQL queries against the StateSet backend.

```
User  <-->  CLI (Anthropic SDK)  <-->  MCP Server  <-->  StateSet GraphQL API
                                                    <-->  Qdrant Vector DB
```

The WhatsApp and Slack gateways create per-user agent sessions with the same architecture. Sessions have a 30-minute TTL and are automatically cleaned up.

## Changelog

- [CHANGELOG.md](CHANGELOG.md)

## Development

```bash
# Run in development mode (no build step)
npm run dev

# Build TypeScript
npm run build

# Run production build
npm start
```

## License

[MIT](LICENSE)
