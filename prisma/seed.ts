import { ensureDefaultSettings } from "../src/lib/settings";

async function main() {
  await ensureDefaultSettings();
  console.log("Default settings seeded.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

