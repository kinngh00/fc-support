import { runCollection } from "./collector.mjs";

try {
  const snapshot = await runCollection();
  console.log(JSON.stringify(snapshot, null, 2));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
