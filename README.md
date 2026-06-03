# discord-readonly-mcp

A tiny, **dependency-free, read-only** [Model Context Protocol](https://modelcontextprotocol.io) server for Discord.

It lets an MCP client (Claude Code, Claude Desktop, Cursor, …) **read** Discord:
fetch any message by ID (no matter how old), page through channel history, and
look up channel/server info — and nothing else. It only issues `GET` requests, so
it can **never send, delete, or modify** anything. Ideal for letting an AI read a
support/bug-report channel without granting it write access.

## Why this exists

Most Discord MCP servers either can't fetch an old/specific **message by ID**
(they only return the newest ~100 with no cursor), or they bundle lots of
write/admin tools you may not want pointed at a production community. This one is
GET-only, has **zero npm dependencies**, and is a single ~200-line file.

## Tools

| Tool | What it does |
|------|--------------|
| `discord_get_message` | Fetch one message by ID — **any age**. Use for links like `…/channels/<guild>/<channel>/<message>`. |
| `discord_read_messages` | List messages oldest-first; `limit` 1–100; `before`/`after`/`around` cursors to page through history. |
| `discord_get_channel` | Channel/thread metadata (name, type, parent, guild). |
| `discord_get_server_info` | A guild and the list of its channels. |

## Requirements

- **Node 18+** or **bun** (uses the runtime's global `fetch`; no install/build step).
- A **Discord bot token**:
  1. Create an app + bot at <https://discord.com/developers/applications>.
  2. Copy the bot token (Bot → Reset Token).
  3. Invite the bot to your server with **View Channels** + **Read Message History**
     (OAuth2 → URL Generator → scope `bot`).
  - *Message Content Intent is not required* — the REST API returns message content
    to an authorized bot regardless of the gateway intent.

## Run

```bash
git clone https://github.com/Vorakorn1001/discord-readonly-mcp.git
cd discord-readonly-mcp
DISCORD_TOKEN=your_bot_token node index.mjs   # or: bun index.mjs
```

The server talks MCP over stdio, so you normally don't run it by hand — your MCP
client launches it. Token can also be passed as `--config <token>` instead of the
env var.

## Use it in an MCP client

### Claude Code / Cursor (`.mcp.json`)

```json
{
  "mcpServers": {
    "discord": {
      "command": "node",
      "args": ["/absolute/or/relative/path/to/discord-readonly-mcp/index.mjs"],
      "env": { "DISCORD_TOKEN": "your_bot_token" }
    }
  }
}
```

### Claude Desktop (`claude_desktop_config.json`)

Same shape under `mcpServers`. Restart the client and approve the server on first use.

> Keep your token out of version control — put it in the client config's `env`,
> not in code. This repo intentionally contains **no token**.

## Quick manual test

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{}}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
| DISCORD_TOKEN=your_bot_token node index.mjs
```

You should see an `initialize` result followed by the four tools.

## How it works

MCP's stdio transport is just **newline-delimited JSON-RPC 2.0**: the client
launches this process and exchanges one JSON message per line over stdin/stdout.
The server handles `initialize`, `tools/list`, and `tools/call`, mapping each tool
to a Discord REST `GET`. All logging goes to stderr so stdout stays a clean
protocol stream.

## Security

- **Read-only:** only performs `GET` requests. No message sending, deleting,
  moderation, or server management.
- The bot can only see servers it has been invited to, with whatever channel
  permissions you grant it.

## License

MIT © Vorakorn Kosidphokin
