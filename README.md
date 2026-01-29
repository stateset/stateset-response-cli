# StateSet Response CLI

AI-powered CLI for managing the [StateSet ResponseCX](https://response.cx) platform. Chat with an AI agent that can manage your agents, rules, skills, knowledge base, channels, messages, and more — all from the terminal.

Includes optional WhatsApp and Slack gateways for connecting your agent to messaging platforms.

## Install

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
```

The agent understands natural language. Ask it to list your agents, create rules, search the knowledge base, etc.

**Session commands:**

| Command   | Description                         |
|-----------|-------------------------------------|
| `/help`   | Show available commands             |
| `/clear`  | Reset conversation history          |
| `/history`| Show conversation turn count        |
| `/model`  | Switch model (sonnet, haiku, opus)  |
| `exit`    | End the session                     |

Multi-line input is supported — end a line with `\` to continue on the next line. Press `Ctrl+C` to cancel the current request.

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
--auth-dir <path>  WhatsApp auth credential directory
--reset            Clear stored auth and re-scan QR
--verbose, -v      Enable debug logging
```

**Examples:**

```bash
response-whatsapp --model haiku
response-whatsapp --allow 14155551234,14155559999
response-whatsapp --reset
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

## Environment Variables

| Variable                 | Required | Description                                    |
|--------------------------|----------|------------------------------------------------|
| `ANTHROPIC_API_KEY`      | Yes      | Anthropic API key for Claude                   |
| `STATESET_INSTANCE_URL`  | No       | StateSet ResponseCX instance URL               |
| `STATESET_GRAPHQL_ENDPOINT` | No    | GraphQL API endpoint                           |
| `STATESET_KB_HOST`       | No       | Knowledge base (Qdrant) host URL               |
| `SLACK_BOT_TOKEN`        | Slack    | Bot User OAuth Token (`xoxb-...`)              |
| `SLACK_APP_TOKEN`        | Slack    | App-level token for Socket Mode (`xapp-...`)   |
| `OPENAI_API_KEY`         | KB       | OpenAI API key for knowledge base embeddings   |

## Available Tools

The AI agent has access to 80+ tools organized by resource type:

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

### Organizations
`get_organization` `get_organization_overview` `update_organization`

## Architecture

The CLI uses the [Model Context Protocol (MCP)](https://modelcontextprotocol.io) to expose platform tools to Claude. On startup, the CLI spawns an MCP server as a child process over stdio. Claude calls tools through this server, which executes GraphQL queries against the StateSet backend.

```
User  <-->  CLI (Anthropic SDK)  <-->  MCP Server  <-->  StateSet GraphQL API
                                                    <-->  Qdrant Vector DB
```

The WhatsApp and Slack gateways create per-user agent sessions with the same architecture. Sessions have a 30-minute TTL and are automatically cleaned up.

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
