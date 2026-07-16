import { spawn } from "node:child_process";
import { mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const runtimeDir = path.join(rootDir, "data", "runtime");
export const releasesDir = path.join(path.dirname(rootDir), ".fc-support-releases");
export const statePath = path.join(runtimeDir, "state.json");
export const routesPath = path.join(runtimeDir, "routes.json");

export function ensureRuntimeDirectories() {
  mkdirSync(releasesDir, { recursive: true });
  mkdirSync(path.join(runtimeDir, "logs"), { recursive: true });
}

export function readJson(file, fallback = null) {
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return fallback; }
}

export function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export function spawnDetached(command, args, { cwd = rootDir, env = process.env, logName = "process" } = {}) {
  ensureRuntimeDirectories();
  const log = openSync(path.join(runtimeDir, "logs", `${logName}.log`), "a");
  const child = spawn(command, args, {
    cwd,
    env,
    detached: true,
    windowsHide: true,
    stdio: ["ignore", log, log],
  });
  child.unref();
  return child.pid;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForHttp(url, { timeoutMs = 30_000, validate = (response) => response.ok } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(3000) });
      if (await validate(response)) return response;
    } catch (error) { lastError = error; }
    await sleep(300);
  }
  throw lastError || new Error(`${url} did not become healthy.`);
}

export async function stopProcessTree(pid) {
  if (!isPidAlive(pid)) return;
  if (process.platform === "win32") {
    await new Promise((resolve) => {
      spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }).on("exit", resolve);
    });
    return;
  }
  try { process.kill(pid, "SIGTERM"); } catch {}
}
