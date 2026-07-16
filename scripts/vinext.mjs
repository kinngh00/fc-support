import { spawn } from "node:child_process";
import path from "node:path";

const command = process.argv[2];
if (!new Set(["dev", "build", "start"]).has(command)) {
  console.error("Usage: node scripts/vinext.mjs <dev|build|start>");
  process.exit(1);
}

const cli = path.resolve("node_modules/vinext/dist/cli.js");
const child = spawn(process.execPath, [cli, command], {
  stdio: "inherit",
  shell: false,
  env: {
    ...process.env,
    WRANGLER_LOG_PATH: process.env.WRANGLER_LOG_PATH || ".wrangler/wrangler.log",
  },
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
