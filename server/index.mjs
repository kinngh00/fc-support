import http from "node:http";
import { config } from "./config.mjs";
import { isCollectionRunning, runCollection } from "./collector.mjs";
import { getActiveSnapshot } from "./database.mjs";
import { getPickRates, listAvailablePositions, listRankings, listTeamColors, recentSnapshots } from "./queries.mjs";
import { startScheduler } from "./scheduler.mjs";
import { listLogs, logger } from "./logger.mjs";

function send(response, status, payload) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": config.frontendOrigin,
    "access-control-allow-headers": "content-type, authorization",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    vary: "origin",
  });
  response.end(JSON.stringify(payload));
}

function integer(url, name, fallback, min, max) {
  const raw = url.searchParams.get(name);
  const value = raw == null || raw === "" ? fallback : Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be between ${min} and ${max}.`);
  }
  return value;
}

const server = http.createServer(async (request, response) => {
  if (request.method === "OPTIONS") return send(response, 204, null);
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

  try {
    if (request.method === "GET" && url.pathname === "/api/health") {
      return send(response, 200, {
        ok: true,
        collectionRunning: isCollectionRunning(),
        activeSnapshot: getActiveSnapshot(),
        schedulerEnabled: config.schedulerEnabled,
        configuredApiKeyCount: config.nexonApiKeys.length,
      });
    }

    if (request.method === "GET" && url.pathname === "/api/team-colors") {
      return send(response, 200, listTeamColors());
    }

    if (request.method === "GET" && url.pathname === "/api/positions") {
      const rankStart = integer(url, "rankStart", 1, 1, 10000);
      const rankEnd = integer(url, "rankEnd", 10000, 1, 10000);
      if (rankStart > rankEnd) throw new Error("rankStart cannot be greater than rankEnd.");
      const teamColor = (url.searchParams.get("teamColor") || "").trim();
      const result = listAvailablePositions({ rankStart, rankEnd, teamColor });
      if (!result) return send(response, 404, { code: "NO_SNAPSHOT", message: "수집된 데이터가 없습니다." });
      return send(response, 200, result);
    }

    if (request.method === "GET" && url.pathname === "/api/rankings") {
      const rankStart = integer(url, "rankStart", 1, 1, 10000);
      const rankEnd = integer(url, "rankEnd", 10000, 1, 10000);
      if (rankStart > rankEnd) throw new Error("rankStart cannot be greater than rankEnd.");
      const teamColor = (url.searchParams.get("teamColor") || "").trim();
      const offset = integer(url, "offset", 0, 0, 10000);
      const limit = integer(url, "limit", 20, 1, 100);
      const result = listRankings({ rankStart, rankEnd, teamColor, offset, limit });
      if (!result) return send(response, 404, { code: "NO_SNAPSHOT", message: "수집된 데이터가 없습니다." });
      return send(response, 200, {
        ...result,
        offset,
        limit,
        hasMore: offset + result.items.length < result.total,
      });
    }

    if (request.method === "GET" && url.pathname === "/api/pick-rates") {
      const rankStart = integer(url, "rankStart", 1, 1, 10000);
      const rankEnd = integer(url, "rankEnd", 10000, 1, 10000);
      if (rankStart > rankEnd) throw new Error("rankStart cannot be greater than rankEnd.");
      const position = (url.searchParams.get("position") || "").trim().toUpperCase();
      if (!position) throw new Error("position is required.");
      const teamColor = (url.searchParams.get("teamColor") || "").trim();
      const offset = integer(url, "offset", 0, 0, 100000);
      const limit = integer(url, "limit", 3, 1, 30);
      const result = getPickRates({ rankStart, rankEnd, teamColor, position, offset, limit });
      if (!result) return send(response, 404, { code: "NO_SNAPSHOT", message: "수집된 데이터가 없습니다." });
      return send(response, 200, {
        ...result,
        offset,
        limit,
        hasMore: offset + result.items.length < result.totalItems,
      });
    }

    if (request.method === "GET" && url.pathname === "/api/admin/snapshots") {
      return send(response, 200, { items: recentSnapshots(20) });
    }

    if (request.method === "GET" && url.pathname === "/api/logs") {
      const limit = integer(url, "limit", 200, 1, 500);
      const afterId = integer(url, "afterId", 0, 0, Number.MAX_SAFE_INTEGER);
      return send(response, 200, {
        collectionRunning: isCollectionRunning(),
        items: listLogs(limit, afterId),
      });
    }

    if (request.method === "POST" && url.pathname === "/api/admin/collect") {
      if (!config.adminToken) return send(response, 503, { code: "ADMIN_TOKEN_NOT_CONFIGURED" });
      if (request.headers.authorization !== `Bearer ${config.adminToken}`) {
        return send(response, 401, { code: "UNAUTHORIZED" });
      }
      if (isCollectionRunning()) return send(response, 409, { code: "COLLECTION_RUNNING" });
      runCollection().catch((error) => console.error("[collector]", error));
      return send(response, 202, { accepted: true });
    }

    return send(response, 404, { code: "NOT_FOUND" });
  } catch (error) {
    return send(response, 400, { code: "BAD_REQUEST", message: String(error?.message || error) });
  }
});

server.listen(config.port, config.host, () => {
  logger.success("서버", "백엔드 서버가 시작되었습니다.", { url: `http://${config.host}:${config.port}` });
  startScheduler();
  if (config.collectOnEmpty && !getActiveSnapshot()) {
    if (config.nexonApiKeys.length === 0) {
      logger.warn("초기 집계", "DB가 비어 있지만 API 키가 없어 즉시 집계를 시작하지 못했습니다.");
    } else {
      logger.info("초기 집계", "DB에 활성 데이터가 없어 즉시 집계를 시작합니다.");
      runCollection().catch((error) => {
        logger.error("초기 집계", "서버 시작 직후 집계가 실패했습니다.", { error: String(error?.message || error) });
      });
    }
  } else if (getActiveSnapshot()) {
    logger.info("초기 집계", "기존 활성 스냅샷을 확인했습니다. 즉시 집계를 건너뜁니다.", { snapshotId: getActiveSnapshot().id });
  }
});

function shutdown() {
  server.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
