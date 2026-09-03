import { snowflakeTimestamp } from './discord-url.mjs';

export const CHANNEL_TYPES = {
  0: 'GUILD_TEXT',
  1: 'DM',
  2: 'GUILD_VOICE',
  3: 'GROUP_DM',
  4: 'GUILD_CATEGORY',
  5: 'GUILD_ANNOUNCEMENT',
  10: 'ANNOUNCEMENT_THREAD',
  11: 'PUBLIC_THREAD',
  12: 'PRIVATE_THREAD',
  13: 'GUILD_STAGE_VOICE',
  14: 'GUILD_DIRECTORY',
  15: 'GUILD_FORUM',
  16: 'GUILD_MEDIA',
};

export function shapeChannel(channel) {
  return {
    id: channel.id,
    guildId: channel.guild_id || null,
    name: channel.name || null,
    type: channel.type,
    typeName: CHANNEL_TYPES[channel.type] || `UNKNOWN_${channel.type}`,
    parentId: channel.parent_id || null,
    position: channel.position ?? null,
    topic: channel.topic ?? null,
    lastMessageId: channel.last_message_id || null,
    lastActivityAt: channel.last_message_id
      ? new Date(snowflakeTimestamp(channel.last_message_id)).toISOString()
      : null,
    appliedTags: Array.isArray(channel.applied_tags) ? channel.applied_tags : [],
    archived: channel.thread_metadata?.archived ?? null,
    archiveTimestamp: channel.thread_metadata?.archive_timestamp ?? null,
    locked: channel.thread_metadata?.locked ?? null,
  };
}

export function shapeAttachment(attachment) {
  return {
    id: attachment.id || null,
    name: attachment.filename || null,
    description: attachment.description || null,
    type: attachment.content_type || null,
    size: attachment.size ?? null,
    width: attachment.width ?? null,
    height: attachment.height ?? null,
    url: attachment.url || null,
    proxyUrl: attachment.proxy_url || null,
  };
}

function shapeEmbed(embed) {
  return {
    type: embed.type || null,
    title: embed.title || null,
    description: embed.description || null,
    url: embed.url || null,
    imageUrl: embed.image?.url || null,
    thumbnailUrl: embed.thumbnail?.url || null,
  };
}

export function shapeMessage(message) {
  const author = message.author || {};
  const guildId = message.guild_id || null;
  const channelId = message.channel_id || null;
  return {
    id: message.id,
    guildId,
    channelId,
    url: guildId && channelId ? `https://discord.com/channels/${guildId}/${channelId}/${message.id}` : null,
    author: (author.global_name || author.username || 'unknown') +
      (author.username ? ` (@${author.username})` : ''),
    authorId: author.id || null,
    bot: Boolean(author.bot),
    timestamp: message.timestamp || null,
    editedTimestamp: message.edited_timestamp || null,
    replyTo: message.referenced_message?.id || message.message_reference?.message_id || null,
    content: message.content || '',
    attachments: (message.attachments || []).map(shapeAttachment),
    embeds: (message.embeds || []).map(shapeEmbed),
  };
}

function isImageAttachment(attachment) {
  if (attachment.content_type?.toLowerCase().startsWith('image/')) return true;
  return /\.(?:png|jpe?g|webp|gif)(?:$|\?)/i.test(attachment.filename || attachment.url || '');
}

export function imageReferences(message) {
  const references = [];
  for (const attachment of message.attachments || []) {
    if (!attachment.url || !isImageAttachment(attachment)) continue;
    references.push({
      key: attachment.id || attachment.filename,
      source: 'attachment',
      name: attachment.filename || attachment.id || 'image',
      url: attachment.url,
      declaredType: attachment.content_type || null,
    });
  }
  for (const [index, embed] of (message.embeds || []).entries()) {
    if (embed.image?.url) {
      references.push({ key: `embed-${index}-image`, source: 'embed', name: embed.title || 'embed image', url: embed.image.url });
    }
    if (embed.thumbnail?.url) {
      references.push({ key: `embed-${index}-thumbnail`, source: 'embed', name: embed.title || 'embed thumbnail', url: embed.thumbnail.url });
    }
  }
  return references;
}
