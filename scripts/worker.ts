import cron from "node-cron";
import { runCollectionCycle } from "../src/lib/collection/service";

const CRON_EXPRESSION = "0 12 * * *";
const TIMEZONE = "Asia/Tokyo";

async function executeCollection() {
  const startedAt = new Date();
  console.log(`[worker] collection start: ${startedAt.toISOString()}`);
  try {
    const result = await runCollectionCycle();
    console.log(`[worker] collection result: ${JSON.stringify(result)}`);
  } catch (error) {
    console.error("[worker] collection failed", error);
  }
}

cron.schedule(
  CRON_EXPRESSION,
  () => {
    void executeCollection();
  },
  {
    timezone: TIMEZONE,
  },
);

console.log(`[worker] scheduled ${CRON_EXPRESSION} (${TIMEZONE})`);
console.log("[worker] process started. Press Ctrl+C to stop.");

if (process.env.RUN_ON_START === "true") {
  void executeCollection();
}

