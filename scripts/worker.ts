import cron from "node-cron";
import { runCollectionCycle } from "../src/lib/collection/service";

const CRON_EXPRESSIONS = ["5 0 * * *", "0 12 * * *"];
const TIMEZONE = "Asia/Tokyo";
let running = false;

async function executeCollection(trigger: string) {
  if (running) {
    console.log(`[worker] skip (${trigger}): previous run is still active`);
    return;
  }

  running = true;
  const startedAt = new Date();
  console.log(`[worker] collection start (${trigger}): ${startedAt.toISOString()}`);
  try {
    const result = await runCollectionCycle();
    console.log(`[worker] collection result (${trigger}): ${JSON.stringify(result)}`);
  } catch (error) {
    console.error(`[worker] collection failed (${trigger})`, error);
  } finally {
    running = false;
  }
}

for (const expression of CRON_EXPRESSIONS) {
  cron.schedule(
    expression,
    () => {
      void executeCollection(expression);
    },
    {
      timezone: TIMEZONE,
    },
  );
}

console.log(`[worker] scheduled ${CRON_EXPRESSIONS.join(", ")} (${TIMEZONE})`);
console.log("[worker] process started. Press Ctrl+C to stop.");

if (process.env.RUN_ON_START === "true") {
  void executeCollection("RUN_ON_START");
}

