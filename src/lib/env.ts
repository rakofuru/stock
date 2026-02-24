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
  EDINET_BASE_URL: z.string().url().default("https://edinetdb.jp/v1"),
  COLLECTION_DAILY_LIMIT: z.coerce.number().int().positive().default(980),
});

const parsed = envSchema.safeParse({
  DATABASE_URL: process.env.DATABASE_URL,
  SQLITE_DATABASE_URL: process.env.SQLITE_DATABASE_URL,
  EDINET_API_KEY: process.env.EDINET_API_KEY,
  EDINET_BASE_URL: process.env.EDINET_BASE_URL,
  COLLECTION_DAILY_LIMIT: process.env.COLLECTION_DAILY_LIMIT,
});

if (!parsed.success) {
  throw new Error(`Invalid environment variables: ${parsed.error.message}`);
}

export const env = parsed.data;

export function requireEdinetApiKey(): string {
  if (!env.EDINET_API_KEY) {
    throw new Error("EDINET_API_KEY is not configured. Set it in .env.local before collecting data.");
  }
  return env.EDINET_API_KEY;
}

