const DISCORD_HOSTS = new Set([
  'discord.com',
  'www.discord.com',
  'ptb.discord.com',
  'canary.discord.com',
  'discordapp.com',
  'www.discordapp.com',
]);

const SNOWFLAKE_PATTERN = /^\d{17,20}$/;
const DISCORD_EPOCH = 1420070400000n;

export function isSnowflake(value) {
  return typeof value === 'string' && SNOWFLAKE_PATTERN.test(value);
}

export function assertSnowflake(value, label) {
  if (!isSnowflake(value)) throw new Error(`${label} must be a Discord snowflake`);
  return value;
}

export function parseDiscordUrl(input) {
  if (typeof input !== 'string' || !input.trim()) throw new Error('Discord URL is required');
  const normalized = input.trim().replace(/^<|>$/g, '');
  let url;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error('Invalid Discord URL');
  }
  if (url.protocol !== 'https:' || !DISCORD_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error('URL must use https on discord.com');
  }

  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] !== 'channels' || parts.length < 3 || parts.length > 4) {
    throw new Error('Discord URL must match /channels/<guild>/<channel>[/<message>]');
  }
  const [, guildId, channelId, messageId] = parts;
  if (guildId === '@me') throw new Error('Direct-message Discord URLs are not supported');
  assertSnowflake(guildId, 'guildId');
  assertSnowflake(channelId, 'channelId');
  if (messageId) assertSnowflake(messageId, 'messageId');

  return { guildId, channelId, messageId: messageId || null, url: normalized };
}

export function snowflakeTimestamp(value) {
  assertSnowflake(value, 'snowflake');
  return Number((BigInt(value) >> 22n) + DISCORD_EPOCH);
}
