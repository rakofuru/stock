process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://stock:stockpass@localhost:5433/stockdb_test?schema=public";
process.env.SQLITE_DATABASE_URL = process.env.SQLITE_DATABASE_URL ?? "file:./dev.db";
process.env.EDINET_API_KEY = process.env.EDINET_API_KEY ?? "test_key";
process.env.EDINET_BASE_URL = process.env.EDINET_BASE_URL ?? "https://edinetdb.jp/v1";
process.env.COLLECTION_DAILY_LIMIT = process.env.COLLECTION_DAILY_LIMIT ?? "1020";
