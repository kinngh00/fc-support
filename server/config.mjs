import path from "node:path";

function integer(name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = process.env[name];
  const value = raw == null || raw === "" ? fallback : Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

function boolean(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

export const config = {
  port: integer("FC_BACKEND_PORT", 8787, { min: 1, max: 65535 }),
  host: process.env.FC_BACKEND_HOST || "127.0.0.1",
  dbPath: path.resolve(process.env.FC_DB_PATH || "data/fc-support.db"),
  frontendOrigin: process.env.FC_FRONTEND_ORIGIN || "http://localhost:3000",
  adminToken: process.env.FC_ADMIN_TOKEN || "",
  schedulerEnabled: boolean("FC_SCHEDULER_ENABLED", true),
  collectOnEmpty: boolean("FC_COLLECT_ON_EMPTY", true),
  rankingConcurrency: integer("FC_RANKING_CONCURRENCY", 5, { min: 1, max: 20 }),
  apiConcurrencyPerKey: integer("FC_API_CONCURRENCY_PER_KEY", 2, { min: 1, max: 8 }),
  nexonApiKeys: (process.env.NEXON_API_KEYS || "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean),
};

export function requireApiKeys() {
  if (config.nexonApiKeys.length === 0) {
    throw new Error("NEXON_API_KEYS is empty. Add newly issued keys to the local .env file.");
  }
  return config.nexonApiKeys;
}
