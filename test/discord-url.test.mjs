import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDiscordUrl, snowflakeTimestamp } from '../src/discord-url.mjs';

const guildId = '100000000000000001';
const channelId = '200000000000000002';
const messageId = '300000000000000003';

test('parses Discord channel and message URLs', () => {
  assert.deepEqual(parseDiscordUrl(`https://discord.com/channels/${guildId}/${channelId}`), {
    guildId,
    channelId,
    messageId: null,
    url: `https://discord.com/channels/${guildId}/${channelId}`,
  });
  assert.equal(parseDiscordUrl(`https://canary.discord.com/channels/${guildId}/${channelId}/${messageId}`).messageId, messageId);
});

test('rejects arbitrary hosts, DMs, and malformed snowflakes', () => {
  assert.throws(() => parseDiscordUrl(`https://example.com/channels/${guildId}/${channelId}`), /discord\.com/);
  assert.throws(() => parseDiscordUrl(`https://discord.com/channels/@me/${channelId}`), /Direct-message/);
  assert.throws(() => parseDiscordUrl('https://discord.com/channels/1/2/3'), /snowflake/);
});

test('converts Discord snowflakes to timestamps', () => {
  assert.equal(new Date(snowflakeTimestamp('175928847299117063')).toISOString(), '2016-04-30T11:18:25.796Z');
});
