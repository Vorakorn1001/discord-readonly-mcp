import { DiscordApiClient, DiscordApiError } from './discord-api.mjs';
import { assertSnowflake, parseDiscordUrl, snowflakeTimestamp } from './discord-url.mjs';
import { CHANNEL_TYPES, imageReferences, shapeChannel, shapeMessage } from './shapes.mjs';

const THREAD_TYPES = new Set([10, 11, 12]);
const THREAD_PARENT_TYPES = new Set([0, 5, 15, 16]);
const FORUM_TYPES = new Set([15, 16]);

function errorSummary(error) {
  return {
    message: error.message,
    status: error instanceof DiscordApiError ? error.status : null,
    code: error instanceof DiscordApiError ? error.code : null,
    accountId: error instanceof DiscordApiError ? error.accountId : null,
  };
}

function uniqueChannels(channels) {
  const byId = new Map();
  for (const channel of channels) byId.set(channel.id, channel);
  return [...byId.values()];
}

function validateCursors({ before, after, around }) {
  const cursors = [before, after, around].filter(Boolean);
  if (cursors.length > 1) throw new Error('Use only one of before, after, or around');
  for (const [name, value] of Object.entries({ before, after, around })) {
    if (value) assertSnowflake(value, name);
  }
}

export class DiscordService {
  constructor({ accounts, imageLimits, fetchImpl = globalThis.fetch, sleep, maxRetries } = {}) {
    if (!Array.isArray(accounts) || accounts.length === 0) throw new Error('At least one Discord account is required');
    this.accounts = accounts.map((account) => ({
      ...account,
      client: new DiscordApiClient({
        accountId: account.id,
        token: account.token,
        fetchImpl,
        sleep,
        maxRetries,
      }),
    }));
    this.imageLimits = imageLimits || {
      maxBytesPerImage: 8 * 1024 * 1024,
      maxImagesPerCall: 4,
      maxTotalImageBytes: 20 * 1024 * 1024,
    };
    this.discovery = null;
    this.guildAccounts = new Map();
    this.channelAccounts = new Map();
  }

  async discoverServers({ refresh = false } = {}) {
    if (this.discovery && !refresh) return this.discovery;

    const results = await Promise.all(
      this.accounts.map(async (account) => {
        try {
          const [user, guilds] = await Promise.all([account.client.getCurrentUser(), account.client.listGuilds()]);
          return {
            accountId: account.id,
            bot: { id: user.id, username: user.username, globalName: user.global_name || null },
            guilds,
            error: null,
          };
        } catch (error) {
          return { accountId: account.id, bot: null, guilds: [], error: errorSummary(error) };
        }
      }),
    );

    this.guildAccounts.clear();
    const servers = new Map();
    for (const result of results) {
      for (const guild of result.guilds) {
        const accounts = this.guildAccounts.get(guild.id) || [];
        accounts.push(result.accountId);
        this.guildAccounts.set(guild.id, accounts);
        const existing = servers.get(guild.id) || {
          id: guild.id,
          name: guild.name,
          icon: guild.icon || null,
          accounts: [],
        };
        existing.accounts.push(result.accountId);
        servers.set(guild.id, existing);
      }
    }

    const expectedMissing = [];
    for (const account of this.accounts) {
      const result = results.find((item) => item.accountId === account.id);
      const found = new Set(result?.guilds.map((guild) => guild.id) || []);
      for (const guildId of account.expectedGuildIds || []) {
        if (!found.has(guildId)) expectedMissing.push({ accountId: account.id, guildId });
      }
    }

    this.discovery = {
      servers: [...servers.values()].sort((left, right) => left.name.localeCompare(right.name)),
      accounts: results.map((result) => ({
        accountId: result.accountId,
        bot: result.bot,
        guildCount: result.guilds.length,
        error: result.error,
      })),
      expectedMissing,
    };
    return this.discovery;
  }

  accountById(accountId) {
    const account = this.accounts.find((item) => item.id === accountId);
    if (!account) throw new Error(`Unknown Discord account: ${accountId}`);
    return account;
  }

  async accountForGuild(guildId) {
    assertSnowflake(guildId, 'guildId');
    await this.discoverServers();
    const preferredIds = this.guildAccounts.get(guildId) || [];
    const candidates = [
      ...preferredIds.map((id) => this.accountById(id)),
      ...this.accounts.filter((account) => !preferredIds.includes(account.id)),
    ];
    const failures = [];
    for (const account of candidates) {
      try {
        await account.client.getGuild(guildId);
        return account;
      } catch (error) {
        failures.push(errorSummary(error));
      }
    }
    const error = new Error(`No configured Discord bot can access guild ${guildId}`);
    error.failures = failures;
    throw error;
  }

  async resolveChannel(channelId, guildId = null) {
    assertSnowflake(channelId, 'channelId');
    if (guildId) assertSnowflake(guildId, 'guildId');
    const cachedId = this.channelAccounts.get(channelId);
    const failures = [];
    if (cachedId) {
      const cached = this.accountById(cachedId);
      try {
        const channel = await cached.client.getChannel(channelId);
        if (!guildId || !channel.guild_id || channel.guild_id === guildId) {
          return { account: cached, channel };
        }
      } catch (error) {
        failures.push(errorSummary(error));
      }
      this.channelAccounts.delete(channelId);
    }

    let candidates = this.accounts;
    if (guildId) {
      await this.discoverServers();
      const preferredIds = this.guildAccounts.get(guildId) || [];
      candidates = [
        ...preferredIds.map((id) => this.accountById(id)),
        ...this.accounts.filter((account) => !preferredIds.includes(account.id)),
      ];
    }
    for (const account of candidates) {
      if (account.id === cachedId) continue;
      try {
        const channel = await account.client.getChannel(channelId);
        if (guildId && channel.guild_id && channel.guild_id !== guildId) continue;
        this.channelAccounts.set(channelId, account.id);
        return { account, channel };
      } catch (error) {
        failures.push(errorSummary(error));
      }
    }
    const error = new Error(`No configured Discord bot can access channel ${channelId}`);
    error.failures = failures;
    throw error;
  }

  async accountForChannel(channelId, guildId = null) {
    return (await this.resolveChannel(channelId, guildId)).account;
  }

  listServers(options) {
    return this.discoverServers(options);
  }

  async listChannels({ guildId, includeThreads = true, includeArchivedThreads = false, parentChannelIds = [], maxArchivedPerParent = 200 }) {
    const account = await this.accountForGuild(guildId);
    const [guild, baseChannels, active] = await Promise.all([
      account.client.getGuild(guildId),
      account.client.listGuildChannels(guildId),
      includeThreads ? account.client.listActiveGuildThreads(guildId) : Promise.resolve({ threads: [] }),
    ]);
    const warnings = [];
    const archived = [];

    if (includeArchivedThreads) {
      const requestedParents = new Set(parentChannelIds);
      const parents = baseChannels.filter(
        (channel) => THREAD_PARENT_TYPES.has(channel.type) && (requestedParents.size === 0 || requestedParents.has(channel.id)),
      );
      for (const parent of parents) {
        const archiveKinds = parent.type === 0 ? ['public', 'joined-private'] : ['public'];
        for (const kind of archiveKinds) {
          try {
            const page = await account.client.listArchivedThreads(parent.id, {
              kind,
              maxItems: maxArchivedPerParent,
            });
            archived.push(...page.threads);
            if (page.hasMore) {
              warnings.push({
                channelId: parent.id,
                kind,
                warning: `Archived thread results reached the ${maxArchivedPerParent}-item limit`,
              });
            }
          } catch (error) {
            if (error instanceof DiscordApiError && [403, 404].includes(error.status)) {
              warnings.push({ channelId: parent.id, kind, error: errorSummary(error) });
              continue;
            }
            throw error;
          }
        }
      }
    }

    const channels = uniqueChannels([
      ...baseChannels,
      ...(Array.isArray(active?.threads) ? active.threads : []),
      ...archived,
    ]).map(shapeChannel);
    return {
      accountId: account.id,
      guild: { id: guild.id, name: guild.name, icon: guild.icon || null },
      channels,
      warnings,
    };
  }

  async listTickets({
    guildId,
    parentChannelIds = [],
    categoryIds = [],
    includeArchived = true,
    includeTextChannels = false,
    namePattern,
    updatedAfter,
    limit = 200,
  }) {
    const listing = await this.listChannels({
      guildId,
      includeThreads: true,
      includeArchivedThreads: includeArchived,
      parentChannelIds,
      maxArchivedPerParent: Math.min(Math.max(limit, 1), 500),
    });
    const byId = new Map(listing.channels.map((channel) => [channel.id, channel]));
    const parentIds = new Set(parentChannelIds);
    const categories = new Set(categoryIds);
    let pattern;
    if (namePattern) {
      try {
        pattern = new RegExp(namePattern, 'i');
      } catch {
        throw new Error('namePattern must be a valid regular expression');
      }
    }
    const updatedAfterMs = updatedAfter ? Date.parse(updatedAfter) : null;
    if (updatedAfter && !Number.isFinite(updatedAfterMs)) throw new Error('updatedAfter must be an ISO-8601 date');

    const tickets = listing.channels.filter((channel) => {
      const parent = channel.parentId ? byId.get(channel.parentId) : null;
      const isThreadTicket = THREAD_TYPES.has(channel.type) &&
        (parentIds.size === 0 || parentIds.has(channel.parentId)) &&
        (categories.size === 0 || categories.has(parent?.parentId));
      const isTextTicket = includeTextChannels && channel.type === 0 &&
        (categories.size === 0 || categories.has(channel.parentId)) &&
        (parentIds.size === 0 || parentIds.has(channel.id));
      if (!isThreadTicket && !isTextTicket) return false;
      if (pattern && !pattern.test(channel.name || '')) return false;
      if (Number.isFinite(updatedAfterMs)) {
        const activity = channel.lastMessageId ? snowflakeTimestamp(channel.lastMessageId) : Date.parse(channel.archiveTimestamp || '');
        if (!Number.isFinite(activity) || activity <= updatedAfterMs) return false;
      }
      return true;
    });

    return {
      accountId: listing.accountId,
      guild: listing.guild,
      tickets: tickets.slice(0, Math.min(Math.max(limit, 1), 500)),
      truncated: tickets.length > limit,
      warnings: listing.warnings,
    };
  }

  normalizeReadSource({ url, guildId, channelId, messageId }) {
    if (url) {
      if (guildId || channelId || messageId) throw new Error('Use url or Discord IDs, not both');
      return parseDiscordUrl(url);
    }
    if (!channelId) throw new Error('Provide a Discord url or channelId');
    assertSnowflake(channelId, 'channelId');
    if (guildId) assertSnowflake(guildId, 'guildId');
    if (messageId) assertSnowflake(messageId, 'messageId');
    return { guildId: guildId || null, channelId, messageId: messageId || null, url: null };
  }

  async imageContent(account, messages, maxImages) {
    const content = [];
    const warnings = [];
    let totalBytes = 0;
    const cap = Math.min(maxImages || this.imageLimits.maxImagesPerCall, this.imageLimits.maxImagesPerCall);

    outer: for (const message of messages) {
      for (const reference of imageReferences(message)) {
        if (content.length >= cap) break outer;
        try {
          const image = await account.client.fetchImage(reference.url, {
            maxBytes: Math.min(
              this.imageLimits.maxBytesPerImage,
              this.imageLimits.maxTotalImageBytes - totalBytes,
            ),
          });
          totalBytes += image.size;
          content.push({
            type: 'image',
            data: image.data,
            mimeType: image.mimeType,
            annotations: { audience: ['user', 'assistant'], priority: 0.9 },
          });
          if (totalBytes >= this.imageLimits.maxTotalImageBytes) break outer;
        } catch (error) {
          warnings.push({ messageId: message.id, image: reference.name, error: error.message });
        }
      }
    }
    return { content, warnings };
  }

  async read({
    url,
    guildId,
    channelId,
    messageId,
    limit = 50,
    before,
    after,
    around,
    includeImages = true,
    maxImages,
    includeArchivedThreads = false,
  }) {
    validateCursors({ before, after, around });
    const source = this.normalizeReadSource({ url, guildId, channelId, messageId });
    const { account, channel } = await this.resolveChannel(source.channelId, source.guildId);

    if (!source.messageId && FORUM_TYPES.has(channel.type)) {
      const tickets = await this.listTickets({
        guildId: channel.guild_id,
        parentChannelIds: [channel.id],
        includeArchived: includeArchivedThreads,
        limit,
      });
      return { structured: { kind: 'ticket-list', channel: shapeChannel(channel), ...tickets }, images: [] };
    }

    const rawMessages = source.messageId
      ? [await account.client.getMessage(source.channelId, source.messageId)]
      : await account.client.listMessages(source.channelId, { limit, before, after, around });
    const enrichedMessages = rawMessages.map((message) => ({
      ...message,
      channel_id: message.channel_id || source.channelId,
      guild_id: message.guild_id || channel.guild_id || source.guildId,
    }));
    const ordered = source.messageId ? enrichedMessages : [...enrichedMessages].reverse();
    const images = includeImages
      ? await this.imageContent(account, ordered, maxImages)
      : { content: [], warnings: [] };
    const structured = {
      kind: source.messageId ? 'message' : THREAD_TYPES.has(channel.type) ? 'ticket' : 'channel',
      accountId: account.id,
      guildId: channel.guild_id || source.guildId,
      channel: shapeChannel(channel),
      messages: ordered.map(shapeMessage),
      imageWarnings: images.warnings,
      cursors: ordered.length
        ? { oldest: ordered[0].id, newest: ordered.at(-1).id }
        : { oldest: null, newest: null },
    };
    return { structured, images: images.content };
  }

  async fetchAttachment({ messageUrl, attachmentUrl, attachmentId, filename, index = 0 }) {
    if (Boolean(messageUrl) === Boolean(attachmentUrl)) {
      throw new Error('Provide exactly one of messageUrl or attachmentUrl');
    }
    if (attachmentUrl) {
      if (attachmentId || filename || index) {
        throw new Error('attachmentId, filename, and index can only be used with messageUrl');
      }
      const image = await this.accounts[0].client.fetchImage(attachmentUrl, {
        maxBytes: this.imageLimits.maxBytesPerImage,
      });
      return {
        structured: {
          accountId: null,
          messageId: null,
          attachment: { key: null, name: null, source: 'direct-url', size: image.size, type: image.mimeType },
        },
        image: { type: 'image', data: image.data, mimeType: image.mimeType },
      };
    }
    const source = parseDiscordUrl(messageUrl);
    if (!source.messageId) throw new Error('messageUrl must include a message ID');
    const { account } = await this.resolveChannel(source.channelId, source.guildId);
    const message = await account.client.getMessage(source.channelId, source.messageId);
    let references = imageReferences(message);
    if (attachmentId) references = references.filter((reference) => reference.key === attachmentId);
    if (filename) references = references.filter((reference) => reference.name === filename);
    const reference = references[index];
    if (!reference) throw new Error('Requested image attachment was not found on the Discord message');
    const image = await account.client.fetchImage(reference.url, {
      maxBytes: this.imageLimits.maxBytesPerImage,
    });
    return {
      structured: {
        accountId: account.id,
        messageId: message.id,
        attachment: { key: reference.key, name: reference.name, source: reference.source, size: image.size, type: image.mimeType },
      },
      image: { type: 'image', data: image.data, mimeType: image.mimeType },
    };
  }

  async checkAccess({ guildId, channelId, messageId }) {
    if (!guildId && !channelId) throw new Error('Provide guildId or channelId');
    if (messageId && !channelId) throw new Error('messageId requires channelId');
    const checks = [];
    for (const account of this.accounts) {
      const result = { accountId: account.id, guild: null, channel: null, message: null, error: null };
      try {
        if (guildId) result.guild = { ok: true, value: await account.client.getGuild(guildId) };
        if (channelId) result.channel = { ok: true, value: shapeChannel(await account.client.getChannel(channelId)) };
        if (channelId && messageId) result.message = { ok: true, value: shapeMessage(await account.client.getMessage(channelId, messageId)) };
      } catch (error) {
        result.error = errorSummary(error);
      }
      checks.push(result);
    }
    return { checks };
  }

  async legacyGetMessage({ channelId, messageId }) {
    return (await this.read({ channelId, messageId, includeImages: false })).structured.messages[0];
  }

  async legacyReadMessages(args) {
    const result = (await this.read({ ...args, includeImages: false })).structured;
    return { channelId: args.channelId, count: result.messages.length, messages: result.messages };
  }

  async legacyGetChannel({ channelId }) {
    return (await this.resolveChannel(channelId)).channel;
  }

  async legacyGetServerInfo({ guildId }) {
    const listing = await this.listChannels({ guildId, includeThreads: false });
    return {
      id: listing.guild.id,
      name: listing.guild.name,
      channels: listing.channels.map((channel) => ({
        id: channel.id,
        name: channel.name,
        type: channel.type,
        parent_id: channel.parentId,
      })),
    };
  }
}

export const discordTypes = { channelTypes: CHANNEL_TYPES, threadTypes: THREAD_TYPES };
