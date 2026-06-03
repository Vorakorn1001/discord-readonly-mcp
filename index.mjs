#!/usr/bin/env node
/**
 * discord-readonly-mcp — a tiny, dependency-free, READ-ONLY Discord MCP server.
 *
 * Speaks MCP over stdio (newline-delimited JSON-RPC 2.0). No npm deps; uses the
 * runtime's global fetch + node:readline (works on Node 18+ and bun).
 *
 * Token: read from env DISCORD_TOKEN (preferred) or `--config <token>` arg.
 * Read-only by design: it only performs GET requests against the Discord REST
 * API, so it can never send / delete / modify anything.
 *
 * Tools:
 *   - discord_get_message      GET one message by ID (any age)
 *   - discord_read_messages    list messages with before/after/around paging
 *   - discord_get_channel      channel/thread metadata
 *   - discord_get_server_info  guild + its channels
 */
import { createInterface } from "node:readline";

const API = "https://discord.com/api/v10";
const UA = "discord-readonly-mcp/1.0 (+https://github.com/Vorakorn1001/discord-readonly-mcp)";

const TOKEN =
  process.env.DISCORD_TOKEN ||
  (() => {
    const i = process.argv.indexOf("--config");
    return i !== -1 ? process.argv[i + 1] : null;
  })();

const logErr = (...a) => process.stderr.write(`[discord-readonly] ${a.join(" ")}\n`);

async function discordGet(path) {
  if (!TOKEN) throw new Error("DISCORD_TOKEN is not set");
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bot ${TOKEN}`, "User-Agent": UA },
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const detail = typeof body === "string" ? body : JSON.stringify(body);
    throw new Error(`Discord API ${res.status} on ${path}: ${detail}`);
  }
  return body;
}

// Compact a raw Discord message into the fields we care about.
function shapeMessage(m) {
  const a = m.author || {};
  return {
    id: m.id,
    author: (a.global_name || a.username || "unknown") + (a.username ? ` (@${a.username})` : ""),
    authorId: a.id || null,
    bot: !!a.bot,
    timestamp: m.timestamp,
    replyTo: m.referenced_message?.id || m.message_reference?.message_id || null,
    content: m.content || "",
    attachments: (m.attachments || []).map((x) => ({
      name: x.filename,
      type: x.content_type || null,
      url: x.url,
    })),
    embeds: (m.embeds || []).length,
  };
}

const TOOLS = [
  {
    name: "discord_get_message",
    description:
      "Fetch a SINGLE Discord message by its ID — works for any message regardless of age. Use for message links like /channels/<guild>/<channel>/<message> (pass the channel id and the message id).",
    inputSchema: {
      type: "object",
      properties: {
        channelId: { type: "string", description: "Channel or thread ID (middle id in the link)" },
        messageId: { type: "string", description: "Message ID (last id in the link)" },
      },
      required: ["channelId", "messageId"],
    },
  },
  {
    name: "discord_read_messages",
    description:
      "List messages in a channel/thread, oldest-first. limit 1-100 (default 50). Optional cursor (a message ID): 'before' = older than it, 'after' = newer than it, 'around' = centered on it. With no cursor returns the newest messages. Page back through history by passing the oldest id you've seen as 'before'.",
    inputSchema: {
      type: "object",
      properties: {
        channelId: { type: "string" },
        limit: { type: "number", description: "1-100, default 50" },
        before: { type: "string", description: "Message ID; return messages older than this" },
        after: { type: "string", description: "Message ID; return messages newer than this" },
        around: { type: "string", description: "Message ID; return messages centered on this" },
      },
      required: ["channelId"],
    },
  },
  {
    name: "discord_get_channel",
    description: "Get metadata about a channel or thread (name, type, parent_id, guild_id).",
    inputSchema: {
      type: "object",
      properties: { channelId: { type: "string" } },
      required: ["channelId"],
    },
  },
  {
    name: "discord_get_server_info",
    description: "Get a guild/server and the list of its channels (id, name, type, parent_id).",
    inputSchema: {
      type: "object",
      properties: { guildId: { type: "string" } },
      required: ["guildId"],
    },
  },
];

async function callTool(name, args = {}) {
  switch (name) {
    case "discord_get_message": {
      const m = await discordGet(`/channels/${args.channelId}/messages/${args.messageId}`);
      return shapeMessage(m);
    }
    case "discord_read_messages": {
      const q = new URLSearchParams();
      q.set("limit", String(Math.min(Math.max(Number(args.limit) || 50, 1), 100)));
      if (args.before) q.set("before", args.before);
      if (args.after) q.set("after", args.after);
      if (args.around) q.set("around", args.around);
      const arr = await discordGet(`/channels/${args.channelId}/messages?${q.toString()}`);
      // Discord returns newest-first; flip to oldest-first for readability.
      return {
        channelId: args.channelId,
        count: Array.isArray(arr) ? arr.length : 0,
        messages: (Array.isArray(arr) ? arr : []).map(shapeMessage).reverse(),
      };
    }
    case "discord_get_channel":
      return await discordGet(`/channels/${args.channelId}`);
    case "discord_get_server_info": {
      const g = await discordGet(`/guilds/${args.guildId}`);
      const chans = await discordGet(`/guilds/${args.guildId}/channels`);
      return {
        id: g.id,
        name: g.name,
        channels: (chans || []).map((c) => ({
          id: c.id,
          name: c.name,
          type: c.type,
          parent_id: c.parent_id || null,
        })),
      };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ---- JSON-RPC 2.0 over newline-delimited stdio ----------------------------
const send = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);

const rl = createInterface({ input: process.stdin });
rl.on("line", async (raw) => {
  const line = raw.trim();
  if (!line) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return; // ignore non-JSON lines
  }
  const { id, method, params } = msg;
  try {
    switch (method) {
      case "initialize":
        send({
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: params?.protocolVersion || "2025-06-18",
            capabilities: { tools: {} },
            serverInfo: { name: "discord-readonly", version: "1.0.0" },
          },
        });
        break;
      case "notifications/initialized":
      case "initialized":
        break; // notification, no response
      case "ping":
        send({ jsonrpc: "2.0", id, result: {} });
        break;
      case "tools/list":
        send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
        break;
      case "resources/list":
        send({ jsonrpc: "2.0", id, result: { resources: [] } });
        break;
      case "prompts/list":
        send({ jsonrpc: "2.0", id, result: { prompts: [] } });
        break;
      case "tools/call": {
        try {
          const out = await callTool(params?.name, params?.arguments || {});
          send({
            jsonrpc: "2.0",
            id,
            result: { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] },
          });
        } catch (e) {
          send({
            jsonrpc: "2.0",
            id,
            result: { content: [{ type: "text", text: `Error: ${e?.message || e}` }], isError: true },
          });
        }
        break;
      }
      default:
        if (id !== undefined)
          send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
    }
  } catch (e) {
    if (id !== undefined)
      send({ jsonrpc: "2.0", id, error: { code: -32603, message: e?.message || String(e) } });
  }
});

logErr("started; token", TOKEN ? "present" : "MISSING");
