import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadEnvFile } from "dotenv";
import { z } from "zod";

const shouldLoadLocalDotenv = process.env.VERCEL !== "1" && process.env.NODE_ENV !== "production";

if (shouldLoadLocalDotenv) {
  const envFiles = [".env", ".env.local"];
  for (const file of envFiles) {
    const path = resolve(process.cwd(), file);
    if (existsSync(path)) {
      loadEnvFile({ path, override: true, quiet: true });
    }
  }
}

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  SQLITE_DATABASE_URL: z.string().min(1).default("file:./dev.db"),
  EDINET_API_KEY: z.string().min(1).optional(),
  EDINET_API_KEY_1: z.string().min(1).optional(),
  EDINET_API_KEY_2: z.string().min(1).optional(),
  EDINET_API_KEYS: z.string().optional(),
  EDINET_BASE_URL: z.string().url().default("https://edinetdb.jp/v1"),
  COLLECTION_DAILY_LIMIT: z.coerce.number().int().positive().optional(),
});

const parsed = envSchema.safeParse({
  DATABASE_URL: process.env.DATABASE_URL,
  SQLITE_DATABASE_URL: process.env.SQLITE_DATABASE_URL,
  EDINET_API_KEY: process.env.EDINET_API_KEY,
  EDINET_API_KEY_1: process.env.EDINET_API_KEY_1,
  EDINET_API_KEY_2: process.env.EDINET_API_KEY_2,
  EDINET_API_KEYS: process.env.EDINET_API_KEYS,
  EDINET_BASE_URL: process.env.EDINET_BASE_URL,
  COLLECTION_DAILY_LIMIT: process.env.COLLECTION_DAILY_LIMIT,
});

if (!parsed.success) {
  throw new Error(`Invalid environment variables: ${parsed.error.message}`);
}

function normalizeEdinetKeys(input: {
  EDINET_API_KEY?: string;
  EDINET_API_KEY_1?: string;
  EDINET_API_KEY_2?: string;
  EDINET_API_KEYS?: string;
}) {
  const candidates = [
    input.EDINET_API_KEY_1,
    input.EDINET_API_KEY_2,
    input.EDINET_API_KEY,
    ...(input.EDINET_API_KEYS
      ? input.EDINET_API_KEYS.split(",").map((value) => value.trim())
      : []),
  ];

  const deduped = new Set<string>();
  for (const value of candidates) {
    if (!value) {
      continue;
    }
    const normalized = value.trim();
    if (normalized) {
      deduped.add(normalized);
    }
  }

  return [...deduped];
}

const edinetApiKeys = normalizeEdinetKeys(parsed.data);
const limitFromKeyCount = Math.max(1, edinetApiKeys.length) * 1000 + 20;
const collectionDailyLimit = Math.max(parsed.data.COLLECTION_DAILY_LIMIT ?? 0, limitFromKeyCount);

export const env = {
  ...parsed.data,
  EDINET_API_KEYS: edinetApiKeys,
  COLLECTION_DAILY_LIMIT: collectionDailyLimit,
};

export function requireEdinetApiKey(): string {
  const keys = requireEdinetApiKeys();
  return keys[0];
}

export function requireEdinetApiKeys(): string[] {
  if (env.EDINET_API_KEYS.length === 0) {
    throw new Error(
      "EDINET API key is not configured. Set EDINET_API_KEY or EDINET_API_KEY_1 / EDINET_API_KEY_2 in .env.local.",
    );
  }
  return env.EDINET_API_KEYS;
}

