import { spawn } from "node:child_process";
import path from "node:path";
import { cloneProductionDatabase } from "./clone-db.mjs";
import { rootDir, stopProcessTree } from "./shared.mjs";

const dbPath = cloneProductionDatabase({ force: true });
const commonEnv = {
  ...process.env,
  FC_DB_PATH: dbPath,
  FC_SCHEDULER_ENABLED: "false",
  FC_COLLECT_ON_EMPTY: "false",
  FC_COLLECT_ON_STALE: "false",
  FC_RECOVER_ABANDONED_SNAPSHOTS: "false",
};
const backend = spawn(process.execPath, ["--watch", `--env-file-if-exists=${path.join(rootDir, ".env")}`, "server/index.mjs"], {
  cwd: rootDir,
  env: { ...commonEnv, FC_BACKEND_PORT: "8788", FC_FRONTEND_ORIGIN: "http://localhost:3001" },
  stdio: "inherit",
  windowsHide: true,
});
const frontend = spawn(process.execPath, ["node_modules/vinext/dist/cli.js", "dev", "--port", "3001"], {
  cwd: rootDir,
  env: { ...commonEnv, PORT: "3001", NEXT_PUBLIC_API_BASE_URL: "http://localhost:8788" },
  stdio: "inherit",
  windowsHide: true,
});

console.log("테스트 환경: http://localhost:3001 (테스트 DB 및 API: 8788)");
async function shutdown() {
  await Promise.all([stopProcessTree(frontend.pid), stopProcessTree(backend.pid)]);
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
frontend.on("exit", (code) => { if (code) shutdown(); });
backend.on("exit", (code) => { if (code) shutdown(); });
