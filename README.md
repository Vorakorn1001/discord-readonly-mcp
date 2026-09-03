# discord-readonly-mcp

A read-only [Model Context Protocol](https://modelcontextprotocol.io) server for
Discord. It discovers every server visible to one or more configured bots, reads
channels and ticket threads, resolves Discord message URLs, and returns safe image
attachments as MCP image content.

The server only issues Discord REST `GET` requests. It does not send, edit, delete,
react to, or moderate anything, and it stores no polling cursor or scheduler state.

## Requirements

- Node.js 18 or newer.
- A Discord application with a bot. One bot can be invited to multiple servers.
- Enable **Message Content Intent** under Developer Portal > Bot > Privileged
  Gateway Intents. Discord applies this intent to message content, embeds, and
  attachments returned to verified apps even though this MCP uses REST only.
- Grant the bot **View Channel** and **Read Message History** only where it should
  read. Add it to private threads that it needs to inspect.

For a LonglenAI setup, invite the same reader bot to `longlenai`,
`longlenai-creator`, and `longlenai-dev`. Discord server and channel permissions
remain the access boundary.

## Install and run

```bash
npm install
DISCORD_TOKEN=your_bot_token npm start
```

`DISCORD_TOKEN` is the v1-compatible single-bot configuration. For named or
multiple bots, keep token values in environment variables and point account
definitions at those variable names:

```bash
export DISCORD_TOKEN_LONGLENAI_READER='your_bot_token'
export DISCORD_ACCOUNTS_JSON='[{"id":"longlenai-reader","tokenEnv":"DISCORD_TOKEN_LONGLENAI_READER","priority":100}]'
node index.mjs
```

`DISCORD_ACCOUNTS_FILE` can contain the same JSON array. Never put a token value in
that file; `tokenEnv` is an environment variable name, not a token.

## Tools

| Tool | Purpose |
| --- | --- |
| `discord_list_servers` | List all servers visible across configured bot accounts and report account health. |
| `discord_list_channels` | List categories, channels, active threads, and optionally archived threads for one server. |
| `discord_list_tickets` | Find forum posts, threads, and optionally text-channel tickets with parent/category/name/time filters. |
| `discord_read` | Read a message/channel URL or IDs, auto-select the bot with access, and inline image attachments. |
| `discord_fetch_attachment` | Fetch one selected image from a message or a direct Discord CDN/media URL. |
| `discord_check_access` | Diagnose which configured bot can read a guild, channel, or message. |

The four v1 tools remain as compatibility aliases:
`discord_get_message`, `discord_read_messages`, `discord_get_channel`, and
`discord_get_server_info`.

## Periodic callers

Scheduling is intentionally outside this MCP. A periodic job should persist its
own cursor and pass it back explicitly:

- Use `discord_list_tickets.updatedAfter` to find recently active tickets.
- Use `discord_read.after` with the newest message snowflake saved by the caller.
- Save `cursors.newest` only after the caller has processed the returned messages.

The MCP process keeps only disposable routing caches. Restarting it does not lose
caller state or change the periodic contract.

## Codex configuration

Codex can forward a named environment variable without storing its value in TOML:

```toml
[mcp_servers.discord]
command = "node"
args = ["/absolute/path/to/discord-readonly-mcp/index.mjs"]
env_vars = ["DISCORD_TOKEN_LONGLENAI_READER"]

[mcp_servers.discord.env]
DISCORD_ACCOUNTS_JSON = '[{"id":"longlenai-reader","tokenEnv":"DISCORD_TOKEN_LONGLENAI_READER","priority":100}]'
```

Launch Codex from a shell where `DISCORD_TOKEN_LONGLENAI_READER` is exported.

## Claude Code configuration

Project `.mcp.json`:

```json
{
  "mcpServers": {
    "discord": {
      "command": "node",
      "args": ["/absolute/path/to/discord-readonly-mcp/index.mjs"],
      "env": {
        "DISCORD_TOKEN_LONGLENAI_READER": "${DISCORD_TOKEN_LONGLENAI_READER}",
        "DISCORD_ACCOUNTS_JSON": "[{\"id\":\"longlenai-reader\",\"tokenEnv\":\"DISCORD_TOKEN_LONGLENAI_READER\",\"priority\":100}]"
      }
    }
  }
}
```

Restart the client after changing MCP configuration. Both Codex and Claude use the
same stdio server and tool schemas.

## Image controls

Images are fetched only over HTTPS from Discord CDN/media hosts. Redirect targets,
declared MIME types, file signatures, and byte limits are checked before returning
base64 MCP image blocks.

| Environment variable | Default | Maximum |
| --- | ---: | ---: |
| `DISCORD_MAX_IMAGE_BYTES` | 8 MiB per image | 25 MiB |
| `DISCORD_MAX_IMAGES` | 4 per call | 10 |
| `DISCORD_MAX_TOTAL_IMAGE_BYTES` | 20 MiB per call | 50 MiB |

## Development

```bash
npm test
npm pack --dry-run
```

Tests use mocked Discord REST responses and never need a real bot token.

## License

MIT (c) Vorakorn Kosidphokin
