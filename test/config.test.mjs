import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../src/config.mjs';

test('loads the legacy single-token configuration', () => {
  const config = loadConfig({ DISCORD_TOKEN: 'secret-token' });
  assert.equal(config.accounts.length, 1);
  assert.equal(config.accounts[0].id, 'default');
  assert.equal(config.accounts[0].token, 'secret-token');
});

test('loads and prioritizes account definitions without embedding tokens', () => {
  const env = {
    DISCORD_ACCOUNTS_JSON: JSON.stringify({
      accounts: [
        { id: 'secondary', tokenEnv: 'TOKEN_SECONDARY', priority: 10 },
        { id: 'primary', tokenEnv: 'TOKEN_PRIMARY', priority: 100, expectedGuildIds: ['100000000000000001'] },
      ],
    }),
    TOKEN_PRIMARY: 'primary-secret',
    TOKEN_SECONDARY: 'secondary-secret',
  };
  const config = loadConfig(env);
  assert.deepEqual(config.accounts.map((account) => account.id), ['primary', 'secondary']);
  assert.equal(config.accounts[0].token, 'primary-secret');
  assert.equal(config.accounts[0].tokenEnv, 'TOKEN_PRIMARY');
});

test('loads account definitions from a file', () => {
  const config = loadConfig(
    { DISCORD_ACCOUNTS_FILE: '/safe/accounts.json', TOKEN: 'secret' },
    (path) => {
      assert.equal(path, '/safe/accounts.json');
      return JSON.stringify([{ id: 'reader', tokenEnv: 'TOKEN' }]);
    },
  );
  assert.equal(config.accounts[0].id, 'reader');
});

test('fails with the environment variable name, never a token value', () => {
  assert.throws(
    () => loadConfig({ DISCORD_ACCOUNTS_JSON: JSON.stringify([{ id: 'reader', tokenEnv: 'MISSING_TOKEN' }]) }),
    /requires environment variable MISSING_TOKEN/,
  );
});

test('rejects an unresolved client environment placeholder', () => {
  assert.throws(
    () => loadConfig({
      DISCORD_ACCOUNTS_JSON: JSON.stringify([{ id: 'reader', tokenEnv: 'DISCORD_READER_TOKEN' }]),
      DISCORD_READER_TOKEN: '${DISCORD_READER_TOKEN}',
    }),
    /requires environment variable DISCORD_READER_TOKEN/,
  );
});
