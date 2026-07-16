import { sleep, stopProcessTree } from "./shared.mjs";
import { rmSync } from "node:fs";

const [frontendPidRaw, backendPidRaw, backendPortRaw, releaseDir] = process.argv.slice(2);
const frontendPid = Number(frontendPidRaw);
const backendPid = Number(backendPidRaw);
const backendPort = Number(backendPortRaw);

await sleep(10_000);
await stopProcessTree(frontendPid);
for (;;) {
  try {
    const response = await fetch(`http://127.0.0.1:${backendPort}/api/health`, { signal: AbortSignal.timeout(3000) });
    const health = await response.json();
    if (!health.collectionRunning) break;
  } catch {
    break;
  }
  await sleep(15_000);
}
await stopProcessTree(backendPid);
if (releaseDir) rmSync(releaseDir, { recursive: true, force: true });
