import { spawn } from "node:child_process";
import { cpSync, mkdirSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import path from "node:path";
import {
  ensureRuntimeDirectories,
  isPidAlive,
  readJson,
  releasesDir,
  rootDir,
  routesPath,
  spawnDetached,
  statePath,
  stopProcessTree,
  waitForHttp,
  writeJson,
} from "./shared.mjs";

const command = process.argv[2] || "deploy";
const frontendPorts = { a: 3100, b: 3101 };
const vinextPorts = { a: 3300, b: 3301 };
const backendPorts = { a: 8880, b: 8881 };

function run(commandName, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(commandName, args, { stdio: "inherit", windowsHide: true, ...options });
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${commandName} exited with ${code}.`)));
  });
}

function copyRelease(releaseDir) {
  const ignored = new Set([".git", ".next", ".vinext", ".wrangler", "data", "dist", "node_modules", "work"]);
  for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
    if (ignored.has(entry.name) || entry.name.startsWith(".env")) continue;
    cpSync(path.join(rootDir, entry.name), path.join(releaseDir, entry.name), { recursive: true });
  }
  symlinkSync(path.join(rootDir, "node_modules"), path.join(releaseDir, "node_modules"), "junction");
}

async function prepareRelease() {
  ensureRuntimeDirectories();
  const state = readJson(statePath, {});
  if (state.pending?.frontendPid) {
    await Promise.all([stopProcessTree(state.pending.frontendPid), stopProcessTree(state.pending.backendPid)]);
  }
  const slot = state.active?.slot === "a" ? "b" : "a";
  const releaseId = new Date().toISOString().replace(/[-:.TZ]/g, "");
  const releaseDir = path.join(releasesDir, releaseId);
  mkdirSync(releaseDir, { recursive: true });
  console.log(`[1/4] 격리된 릴리스 ${releaseId}를 준비합니다.`);
  copyRelease(releaseDir);

  console.log("[2/4] 테스트와 운영 빌드를 실행합니다.");
  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error("npm 실행 경로를 찾지 못했습니다.");
  await run(process.execPath, [npmCli, "test"], {
    cwd: releaseDir,
    env: { ...process.env, NEXT_PUBLIC_API_BASE_URL: "http://localhost:8787" },
  });

  console.log("[3/4] 새 서버를 기존 서버와 다른 포트에서 먼저 실행합니다.");
  const commonEnv = {
    ...process.env,
    FC_DB_PATH: path.join(rootDir, "data", "fc-support.db"),
    FC_COLLECT_ON_EMPTY: "false",
    FC_COLLECT_ON_STALE: isPidAlive(state.proxyPid) ? "true" : "false",
    FC_RECOVER_ABANDONED_SNAPSHOTS: "false",
  };
  const backendPid = spawnDetached(process.execPath, [
    `--env-file-if-exists=${path.join(rootDir, ".env")}`,
    "server/index.mjs",
  ], {
    cwd: releaseDir,
    env: { ...commonEnv, FC_BACKEND_PORT: String(backendPorts[slot]), FC_FRONTEND_ORIGIN: "http://localhost:3000" },
    logName: `backend-${releaseId}`,
  });
  const frontendPid = spawnDetached(process.execPath, [
    "scripts/runtime/frontend-server.mjs",
    `port=${frontendPorts[slot]}`,
    `vinextPort=${vinextPorts[slot]}`,
  ], {
    cwd: releaseDir,
    env: { ...commonEnv, PORT: String(frontendPorts[slot]), NEXT_PUBLIC_API_BASE_URL: "http://localhost:8787" },
    logName: `frontend-${releaseId}`,
  });

  try {
    await Promise.all([
      waitForHttp(`http://127.0.0.1:${backendPorts[slot]}/api/health`, {
        timeoutMs: 45_000,
        validate: async (response) => response.ok && (await response.json()).ok === true,
      }),
      waitForHttp(`http://127.0.0.1:${frontendPorts[slot]}/`, { timeoutMs: 45_000 }),
    ]);
  } catch (error) {
    await Promise.all([stopProcessTree(frontendPid), stopProcessTree(backendPid)]);
    rmSync(releaseDir, { recursive: true, force: true });
    throw error;
  }

  const pending = {
    releaseId, releaseDir, slot,
    frontendPort: frontendPorts[slot], backendPort: backendPorts[slot],
    frontendPid, backendPid,
  };
  writeJson(statePath, { ...state, pending });
  console.log("[4/4] 새 서버의 화면과 API 정상 응답을 확인했습니다.");
  return pending;
}

async function activatePending() {
  ensureRuntimeDirectories();
  const state = readJson(statePath, {});
  const pending = state.pending;
  if (!pending || !isPidAlive(pending.frontendPid) || !isPidAlive(pending.backendPid)) {
    throw new Error("전환할 준비가 끝난 새 서버가 없습니다. 먼저 production:prepare를 실행하세요.");
  }
  writeJson(routesPath, {
    releaseId: pending.releaseId,
    frontend: { port: pending.frontendPort },
    backend: { port: pending.backendPort },
    switchedAt: new Date().toISOString(),
  });

  let proxyPid = state.proxyPid;
  if (!isPidAlive(proxyPid)) {
    proxyPid = spawnDetached(process.execPath, [path.join(rootDir, "scripts", "runtime", "proxy.mjs")], {
      cwd: rootDir,
      logName: "proxy",
    });
    await waitForHttp("http://127.0.0.1:8799/", { timeoutMs: 15_000 });
  }

  const previous = state.active;
  writeJson(statePath, { proxyPid, active: pending, pending: null, switchedAt: new Date().toISOString() });
  if (previous?.frontendPid || previous?.backendPid) {
    spawnDetached(process.execPath, [
      path.join(rootDir, "scripts", "runtime", "retire.mjs"),
      String(previous.frontendPid || 0),
      String(previous.backendPid || 0),
      String(previous.backendPort || 0),
      String(previous.releaseDir || ""),
    ], { cwd: rootDir, logName: `retire-${previous.releaseId || "previous"}` });
  }
  console.log(`운영 연결을 ${pending.releaseId} 릴리스로 전환했습니다. 기존 요청은 종료될 시간을 확보한 뒤 정리됩니다.`);
}

async function showStatus() {
  const state = readJson(statePath, {});
  const routes = readJson(routesPath, {});
  console.log(JSON.stringify({
    proxyRunning: isPidAlive(state.proxyPid),
    active: state.active || null,
    pending: state.pending || null,
    routes,
  }, null, 2));
}

try {
  if (command === "prepare") await prepareRelease();
  else if (command === "activate") await activatePending();
  else if (command === "status") await showStatus();
  else if (command === "deploy") {
    await prepareRelease();
    const state = readJson(statePath, {});
    if (isPidAlive(state.proxyPid)) await activatePending();
    else console.log("최초 전환 준비가 끝났습니다. 현재 직접 실행 서버를 종료한 뒤 production:activate를 한 번 실행하세요.");
  } else throw new Error(`Unknown command: ${command}`);
} catch (error) {
  console.error(`배포 실패: ${error.message}`);
  process.exitCode = 1;
}
