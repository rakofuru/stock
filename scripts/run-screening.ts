import { runScreening } from "../src/lib/screening/service";

async function main() {
  const result = await runScreening();
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

