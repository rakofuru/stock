import { runCollectionCycle } from "../src/lib/collection/service";

async function main() {
  const result = await runCollectionCycle();
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

