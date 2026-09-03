const API_BASE = 'https://discord.com/api/v10';
const USER_AGENT = 'discord-readonly-mcp/2.0 (+https://github.com/Vorakorn1001/discord-readonly-mcp)';
const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isAllowedMediaHost(hostname) {
  const host = hostname.toLowerCase();
  return (
    host === 'cdn.discordapp.com' ||
    host === 'media.discordapp.net' ||
    /^images-ext-\d+\.discordapp\.net$/.test(host)
  );
}

function parseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function detectImageMime(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'))) return 'image/gif';
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

export class DiscordApiError extends Error {
  constructor(message, { status = null, code = null, path = null, accountId = null } = {}) {
    super(message);
    this.name = 'DiscordApiError';
    this.status = status;
    this.code = code;
    this.path = path;
    this.accountId = accountId;
  }
}

export class DiscordApiClient {
  constructor({ accountId, token, fetchImpl = globalThis.fetch, sleep = wait, maxRetries = 3, requestTimeoutMs = 30_000 }) {
    if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required');
    this.accountId = accountId;
    this.token = token;
    this.fetch = fetchImpl;
    this.sleep = sleep;
    this.maxRetries = maxRetries;
    this.requestTimeoutMs = requestTimeoutMs;
  }

  async get(path) {
    if (!path.startsWith('/')) throw new Error('Discord API paths must start with /');
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const response = await this.fetch(`${API_BASE}${path}`, {
        method: 'GET',
        headers: { Authorization: `Bot ${this.token}`, 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
      const text = await response.text();
      const body = parseJson(text);

      if (response.ok) return body;
      const retryAfter = Number(body?.retry_after);
      if (response.status === 429 && attempt < this.maxRetries && Number.isFinite(retryAfter)) {
        await this.sleep(Math.min(Math.max(retryAfter * 1000, 50), 30_000));
        continue;
      }
      if (response.status >= 500 && attempt < this.maxRetries) {
        await this.sleep(250 * 2 ** attempt);
        continue;
      }

      const detail = typeof body === 'string' ? body : body?.message;
      throw new DiscordApiError(
        `Discord API ${response.status}${detail ? `: ${String(detail).slice(0, 300)}` : ''}`,
        {
          status: response.status,
          code: typeof body === 'object' && body ? body.code : null,
          path: path.split('?')[0],
          accountId: this.accountId,
        },
      );
    }
    throw new DiscordApiError('Discord API retry limit exceeded', { accountId: this.accountId });
  }

  getCurrentUser() {
    return this.get('/users/@me');
  }

  async listGuilds() {
    const guilds = [];
    let after;
    do {
      const query = new URLSearchParams({ limit: '200' });
      if (after) query.set('after', after);
      const page = await this.get(`/users/@me/guilds?${query}`);
      if (!Array.isArray(page)) throw new DiscordApiError('Discord returned an invalid guild list');
      guilds.push(...page);
      after = page.length === 200 ? page.at(-1)?.id : null;
    } while (after);
    return guilds;
  }

  getGuild(guildId) {
    return this.get(`/guilds/${guildId}`);
  }

  listGuildChannels(guildId) {
    return this.get(`/guilds/${guildId}/channels`);
  }

  listActiveGuildThreads(guildId) {
    return this.get(`/guilds/${guildId}/threads/active`);
  }

  getChannel(channelId) {
    return this.get(`/channels/${channelId}`);
  }

  getMessage(channelId, messageId) {
    return this.get(`/channels/${channelId}/messages/${messageId}`);
  }

  listMessages(channelId, { limit = 50, before, after, around } = {}) {
    const query = new URLSearchParams({ limit: String(Math.min(Math.max(Number(limit) || 50, 1), 100)) });
    if (before) query.set('before', before);
    if (after) query.set('after', after);
    if (around) query.set('around', around);
    return this.get(`/channels/${channelId}/messages?${query}`);
  }

  async listArchivedThreads(channelId, { kind = 'public', limit = 100, maxItems = 500 } = {}) {
    const route =
      kind === 'joined-private'
        ? `/channels/${channelId}/users/@me/threads/archived/private`
        : `/channels/${channelId}/threads/archived/${kind}`;
    const threads = [];
    let before;
    let hasMore = true;
    while (hasMore && threads.length < maxItems) {
      const query = new URLSearchParams({ limit: String(Math.min(Math.max(limit, 1), 100)) });
      if (before) query.set('before', before);
      const page = await this.get(`${route}?${query}`);
      const pageThreads = Array.isArray(page?.threads) ? page.threads : [];
      threads.push(...pageThreads);
      hasMore = Boolean(page?.has_more) && pageThreads.length > 0;
      before = kind === 'joined-private'
        ? pageThreads.at(-1)?.id || null
        : pageThreads.at(-1)?.thread_metadata?.archive_timestamp || null;
      if (!before) hasMore = false;
    }
    return { threads: threads.slice(0, maxItems), hasMore };
  }

  async fetchImage(url, { maxBytes }) {
    let current;
    try {
      current = new URL(url);
    } catch {
      throw new Error('Attachment URL is invalid');
    }

    for (let redirect = 0; redirect <= 3; redirect += 1) {
      if (current.protocol !== 'https:' || !isAllowedMediaHost(current.hostname)) {
        throw new Error('Attachment URL must use an approved Discord media host');
      }
      const response = await this.fetch(current, {
        method: 'GET',
        redirect: 'manual',
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location || redirect === 3) throw new Error('Discord attachment redirected too many times');
        current = new URL(location, current);
        continue;
      }
      if (!response.ok) throw new Error(`Discord attachment returned HTTP ${response.status}`);

      const mimeType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
      if (!IMAGE_MIME_TYPES.has(mimeType)) {
        throw new Error(`Unsupported attachment MIME type: ${mimeType || 'unknown'}`);
      }
      const contentLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(contentLength) && contentLength > maxBytes) {
        throw new Error(`Attachment exceeds the ${maxBytes}-byte image limit`);
      }

      const chunks = [];
      let size = 0;
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Attachment response has no readable body');
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
          await reader.cancel();
          throw new Error(`Attachment exceeds the ${maxBytes}-byte image limit`);
        }
        chunks.push(value);
      }
      const buffer = Buffer.concat(chunks);
      const detectedMimeType = detectImageMime(buffer);
      if (!detectedMimeType || detectedMimeType !== mimeType) {
        throw new Error(`Attachment bytes do not match declared MIME type ${mimeType}`);
      }
      return { data: buffer.toString('base64'), mimeType, size };
    }
    throw new Error('Unable to fetch Discord attachment');
  }
}

export const discordMedia = { isAllowedMediaHost, imageMimeTypes: IMAGE_MIME_TYPES, detectImageMime };
