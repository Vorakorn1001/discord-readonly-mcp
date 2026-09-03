import assert from 'node:assert/strict';
import test from 'node:test';
import { DiscordApiClient } from '../src/discord-api.mjs';

function jsonResponse(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

test('uses bot authorization and GET-only requests', async () => {
  let request;
  const client = new DiscordApiClient({
    accountId: 'reader',
    token: 'secret-token',
    fetchImpl: async (url, options) => {
      request = { url: String(url), options };
      return jsonResponse({ id: '100000000000000001' });
    },
  });
  await client.getGuild('100000000000000001');
  assert.equal(request.options.method, 'GET');
  assert.equal(request.options.headers.Authorization, 'Bot secret-token');
  assert.match(request.url, /\/guilds\/100000000000000001$/);
});

test('paginates all visible guilds', async () => {
  const firstPage = Array.from({ length: 200 }, (_, index) => ({ id: String(100000000000000000n + BigInt(index)), name: `Guild ${index}` }));
  let calls = 0;
  const client = new DiscordApiClient({
    accountId: 'reader',
    token: 'token',
    fetchImpl: async (url) => {
      calls += 1;
      const parsed = new URL(url);
      return jsonResponse(parsed.searchParams.has('after') ? [{ id: '400000000000000001', name: 'Last' }] : firstPage);
    },
  });
  const guilds = await client.listGuilds();
  assert.equal(guilds.length, 201);
  assert.equal(calls, 2);
});

test('respects Discord retry_after on rate limits', async () => {
  let calls = 0;
  const waits = [];
  const client = new DiscordApiClient({
    accountId: 'reader',
    token: 'token',
    sleep: async (milliseconds) => waits.push(milliseconds),
    fetchImpl: async () => {
      calls += 1;
      return calls === 1 ? jsonResponse({ retry_after: 0.01 }, 429) : jsonResponse({ ok: true });
    },
  });
  assert.deepEqual(await client.get('/test'), { ok: true });
  assert.equal(calls, 2);
  assert.deepEqual(waits, [50]);
});

test('fetches approved Discord images and enforces size and host guards', async () => {
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from('image-data'),
  ]);
  const client = new DiscordApiClient({
    accountId: 'reader',
    token: 'token',
    fetchImpl: async () => new Response(png, {
      headers: { 'content-type': 'image/png', 'content-length': String(png.length) },
    }),
  });
  const image = await client.fetchImage('https://cdn.discordapp.com/attachments/1/2/image.png', { maxBytes: 40 });
  assert.equal(image.mimeType, 'image/png');
  assert.deepEqual(Buffer.from(image.data, 'base64'), png);
  await assert.rejects(
    () => client.fetchImage('https://example.com/image.png', { maxBytes: 40 }),
    /approved Discord media host/,
  );
  await assert.rejects(
    () => client.fetchImage('https://cdn.discordapp.com/attachments/1/2/image.png', { maxBytes: 4 }),
    /image limit/,
  );
});

test('rejects image bytes that do not match the declared MIME type', async () => {
  const client = new DiscordApiClient({
    accountId: 'reader',
    token: 'token',
    fetchImpl: async () => new Response(Buffer.from('not-an-image'), {
      headers: { 'content-type': 'image/png' },
    }),
  });
  await assert.rejects(
    () => client.fetchImage('https://cdn.discordapp.com/attachments/1/2/image.png', { maxBytes: 40 }),
    /do not match/,
  );
});

test('uses a thread snowflake cursor for joined private archives', async () => {
  const urls = [];
  let page = 0;
  const client = new DiscordApiClient({
    accountId: 'reader',
    token: 'token',
    fetchImpl: async (url) => {
      urls.push(String(url));
      page += 1;
      return jsonResponse(page === 1 ? {
        threads: [{ id: '300000000000000001', thread_metadata: { archive_timestamp: '2026-01-01T00:00:00.000Z' } }],
        has_more: true,
      } : { threads: [], has_more: false });
    },
  });
  await client.listArchivedThreads('200000000000000001', { kind: 'joined-private' });
  assert.equal(new URL(urls[1]).searchParams.get('before'), '300000000000000001');
});
