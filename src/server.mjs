import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod/v4';

const snowflake = z.string().regex(/^\d{17,20}$/).describe('Discord snowflake ID');
const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

function success(structuredContent, extraContent = []) {
  return {
    content: [{ type: 'text', text: JSON.stringify(structuredContent, null, 2) }, ...extraContent],
    structuredContent,
  };
}

function failure(error) {
  const structuredContent = {
    error: {
      message: error?.message || String(error),
      status: error?.status ?? null,
      code: error?.code ?? null,
      failures: error?.failures ?? null,
    },
  };
  return {
    content: [{ type: 'text', text: `Error: ${structuredContent.error.message}` }],
    structuredContent,
    isError: true,
  };
}

function register(server, name, options, handler) {
  server.registerTool(
    name,
    { ...options, annotations: { ...readOnlyAnnotations, title: options.title } },
    async (args) => {
      try {
        return await handler(args);
      } catch (error) {
        return failure(error);
      }
    },
  );
}

export function createDiscordMcpServer(service) {
  const server = new McpServer(
    { name: 'discord-readonly', version: '2.0.0' },
    {
      instructions:
        'Read-only Discord access. Prefer discord_read for Discord message/channel URLs; it selects the configured bot automatically and can inline safe image attachments. Use discord_list_servers then discord_list_channels when no URL is available. The server never writes to Discord and stores no periodic state.',
    },
  );

  register(server, 'discord_list_servers', {
    title: 'List Discord Servers',
    description: 'List every Discord server visible to the configured bot account(s), including account health.',
    inputSchema: { refresh: z.boolean().default(false).describe('Refresh Discord discovery instead of using the process cache') },
  }, async ({ refresh }) => success(await service.listServers({ refresh })));

  register(server, 'discord_list_channels', {
    title: 'List Discord Channels',
    description: 'List a server channel tree. Includes active threads by default and can page archived public/joined-private threads.',
    inputSchema: {
      guildId: snowflake,
      includeThreads: z.boolean().default(true),
      includeArchivedThreads: z.boolean().default(false),
      parentChannelIds: z.array(snowflake).default([]).describe('Limit archived-thread discovery to these parent channels'),
      maxArchivedPerParent: z.number().int().min(1).max(500).default(200),
    },
  }, async (args) => success(await service.listChannels(args)));

  register(server, 'discord_list_tickets', {
    title: 'List Discord Tickets',
    description: 'List ticket-like forum posts and threads, optionally including text channels under configured categories. Supports archived tickets and an explicit updatedAfter filter for external periodic callers.',
    inputSchema: {
      guildId: snowflake,
      parentChannelIds: z.array(snowflake).default([]),
      categoryIds: z.array(snowflake).default([]),
      includeArchived: z.boolean().default(true),
      includeTextChannels: z.boolean().default(false),
      namePattern: z.string().max(200).optional(),
      updatedAfter: z.string().datetime({ offset: true }).optional(),
      limit: z.number().int().min(1).max(500).default(200),
    },
  }, async (args) => success(await service.listTickets(args)));

  register(server, 'discord_read', {
    title: 'Read Discord',
    description: 'Read a Discord message URL, channel URL, message ID, channel, or ticket thread. Automatically selects an authorized bot. Image attachments are returned as MCP image content by default.',
    inputSchema: {
      url: z.string().url().optional().describe('Discord /channels/<guild>/<channel>[/<message>] URL'),
      guildId: snowflake.optional(),
      channelId: snowflake.optional(),
      messageId: snowflake.optional(),
      limit: z.number().int().min(1).max(100).default(50),
      before: snowflake.optional(),
      after: snowflake.optional(),
      around: snowflake.optional(),
      includeImages: z.boolean().default(true),
      maxImages: z.number().int().min(1).max(10).optional(),
      includeArchivedThreads: z.boolean().default(false),
    },
  }, async (args) => {
    const result = await service.read(args);
    return success(result.structured, result.images);
  });

  register(server, 'discord_fetch_attachment', {
    title: 'Fetch Discord Image',
    description: 'Fetch one image from a Discord message using a fresh lookup, or from a direct Discord CDN/media URL. Only approved Discord media hosts and image MIME types are allowed.',
    inputSchema: {
      messageUrl: z.string().url().optional(),
      attachmentUrl: z.string().url().optional(),
      attachmentId: z.string().optional(),
      filename: z.string().optional(),
      index: z.number().int().min(0).max(20).default(0),
    },
  }, async (args) => {
    const result = await service.fetchAttachment(args);
    return success(result.structured, [result.image]);
  });

  register(server, 'discord_check_access', {
    title: 'Check Discord Access',
    description: 'Probe each configured bot account for read access to a guild, channel, and optional message. Useful for diagnosing ticket permissions.',
    inputSchema: { guildId: snowflake.optional(), channelId: snowflake.optional(), messageId: snowflake.optional() },
  }, async (args) => success(await service.checkAccess(args)));

  register(server, 'discord_get_message', {
    title: 'Get Discord Message (Legacy)',
    description: 'Compatibility alias: fetch one Discord message by channel and message ID.',
    inputSchema: { channelId: snowflake, messageId: snowflake },
  }, async (args) => success(await service.legacyGetMessage(args)));

  register(server, 'discord_read_messages', {
    title: 'Read Discord Messages (Legacy)',
    description: 'Compatibility alias: list messages in a channel with Discord snowflake cursors.',
    inputSchema: {
      channelId: snowflake,
      limit: z.number().int().min(1).max(100).default(50),
      before: snowflake.optional(),
      after: snowflake.optional(),
      around: snowflake.optional(),
    },
  }, async (args) => success(await service.legacyReadMessages(args)));

  register(server, 'discord_get_channel', {
    title: 'Get Discord Channel (Legacy)',
    description: 'Compatibility alias: get raw metadata for one channel or thread.',
    inputSchema: { channelId: snowflake },
  }, async (args) => success(await service.legacyGetChannel(args)));

  register(server, 'discord_get_server_info', {
    title: 'Get Discord Server (Legacy)',
    description: 'Compatibility alias: get one guild and its base channels.',
    inputSchema: { guildId: snowflake },
  }, async (args) => success(await service.legacyGetServerInfo(args)));

  return server;
}

export async function runStdioServer(service) {
  const server = createDiscordMcpServer(service);
  await server.connect(new StdioServerTransport());
  return server;
}
