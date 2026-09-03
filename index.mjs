#!/usr/bin/env node
import { loadConfig } from './src/config.mjs';
import { runStdioServer } from './src/server.mjs';
import { DiscordService } from './src/service.mjs';

async function main() {
  const config = loadConfig();
  const service = new DiscordService(config);
  await runStdioServer(service);
  process.stderr.write(`[discord-readonly] v2 started with ${config.accounts.length} account(s)\n`);
}

main().catch((error) => {
  process.stderr.write(`[discord-readonly] startup failed: ${error.message}\n`);
  process.exit(1);
});
