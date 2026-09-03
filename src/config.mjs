import { readFileSync } from 'node:fs';
import { z } from 'zod/v4';

const accountSchema = z.object({
  id: z.string().trim().min(1).regex(/^[a-zA-Z0-9_-]+$/),
  tokenEnv: z.string().trim().min(1).regex(/^[A-Z_][A-Z0-9_]*$/),
  priority: z.number().int().default(0),
  expectedGuildIds: z.array(z.string().regex(/^\d{17,20}$/)).default([]),
});

const accountsDocumentSchema = z.union([
  z.array(accountSchema),
  z.object({ accounts: z.array(accountSchema).min(1) }).transform((value) => value.accounts),
]);

function parsePositiveInteger(value, fallback, maximum) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, maximum);
}

function parseAccountsDocument(text, source) {
  let json;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error(`${source} must contain valid JSON: ${error.message}`);
  }
  const parsed = accountsDocumentSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`${source} has an invalid accounts schema: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

export function loadConfig(env = process.env, readFile = readFileSync) {
  let definitions;

  if (env.DISCORD_ACCOUNTS_JSON) {
    definitions = parseAccountsDocument(env.DISCORD_ACCOUNTS_JSON, 'DISCORD_ACCOUNTS_JSON');
  } else if (env.DISCORD_ACCOUNTS_FILE) {
    definitions = parseAccountsDocument(
      readFile(env.DISCORD_ACCOUNTS_FILE, 'utf8'),
      `DISCORD_ACCOUNTS_FILE (${env.DISCORD_ACCOUNTS_FILE})`,
    );
  } else if (env.DISCORD_TOKEN) {
    definitions = [
      {
        id: 'default',
        tokenEnv: 'DISCORD_TOKEN',
        priority: 0,
        expectedGuildIds: [],
      },
    ];
  } else {
    throw new Error(
      'Discord credentials are not configured. Set DISCORD_TOKEN or define DISCORD_ACCOUNTS_JSON/DISCORD_ACCOUNTS_FILE.',
    );
  }

  const seen = new Set();
  const accounts = definitions
    .map((definition) => {
      if (seen.has(definition.id)) throw new Error(`Duplicate Discord account id: ${definition.id}`);
      seen.add(definition.id);
      const token = env[definition.tokenEnv];
      const trimmedToken = token?.trim();
      if (!trimmedToken || /^\$\{[A-Z_][A-Z0-9_]*\}$/.test(trimmedToken)) {
        throw new Error(`Discord account ${definition.id} requires environment variable ${definition.tokenEnv}`);
      }
      return { ...definition, token: trimmedToken };
    })
    .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id));

  return {
    accounts,
    imageLimits: {
      maxBytesPerImage: parsePositiveInteger(env.DISCORD_MAX_IMAGE_BYTES, 8 * 1024 * 1024, 25 * 1024 * 1024),
      maxImagesPerCall: parsePositiveInteger(env.DISCORD_MAX_IMAGES, 4, 10),
      maxTotalImageBytes: parsePositiveInteger(env.DISCORD_MAX_TOTAL_IMAGE_BYTES, 20 * 1024 * 1024, 50 * 1024 * 1024),
    },
  };
}
