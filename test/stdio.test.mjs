import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('serves the v2 and compatibility tools over MCP stdio', async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['index.mjs'],
    cwd: process.cwd(),
    env: { ...process.env, DISCORD_TOKEN: 'fake-token' },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'discord-readonly-test', version: '1.0.0' });
  await client.connect(transport);
  try {
    const result = await client.listTools();
    const names = result.tools.map((tool) => tool.name);
    assert.ok(names.includes('discord_list_servers'));
    assert.ok(names.includes('discord_read'));
    assert.ok(names.includes('discord_fetch_attachment'));
    assert.ok(names.includes('discord_get_message'));
    assert.ok(result.tools.every((tool) => tool.annotations?.readOnlyHint === true));
  } finally {
    await client.close();
  }
});
