import http from "node:http";
import { config } from "./config.mjs";
import { isCollectionRunning, runCollection } from "./collector.mjs";
import { failAbandonedSnapshots, getActiveSnapshot } from "./database.mjs";
import { getPickRates, getUserProfile, listAvailablePositions, listRankings, listTeamColors, recentSnapshots, searchRankings, suggestNicknames } from "./queries.mjs";
import { startScheduler } from "./scheduler.mjs";
import { listLogs, logger } from "./logger.mjs";
import { inspectSnapshotFreshness } from "./freshness.mjs";
import { listRecentMatches } from "./match-service.mjs";

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
      const activeSnapshot = getActiveSnapshot();
      return send(response, 200, {
        ok: true,
        collectionRunning: isCollectionRunning(),
        activeSnapshot,
        freshness: inspectSnapshotFreshness(activeSnapshot),
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

    if (request.method === "GET" && url.pathname === "/api/rankings/search") {
      const nickname = (url.searchParams.get("nickname") || "").trim();
      if (!nickname) throw new Error("nickname is required.");
      if (nickname.length > 50) throw new Error("nickname must be 50 characters or fewer.");
      const result = searchRankings({ nickname, limit: 20 });
      if (!result) return send(response, 404, { code: "NO_SNAPSHOT", message: "수집된 데이터가 없습니다." });
      return send(response, 200, { ...result, offset: 0, limit: 20, hasMore: result.total > result.items.length });
    }

    if (request.method === "GET" && url.pathname === "/api/users/suggestions") {
      const prefix = (url.searchParams.get("prefix") || "").trim();
      if (prefix.length > 50) throw new Error("prefix must be 50 characters or fewer.");
      return send(response, 200, suggestNicknames(prefix, 10));
    }

    if (request.method === "GET" && url.pathname === "/api/users/profile") {
      const nickname = (url.searchParams.get("nickname") || "").trim();
      if (!nickname) throw new Error("nickname is required.");
      const result = getUserProfile(nickname);
      if (!result) return send(response, 404, { code: "NO_SNAPSHOT", message: "수집된 데이터가 없습니다." });
      if (!result.profile) return send(response, 404, { code: "USER_NOT_FOUND", message: "현재 랭킹에서 구단주를 찾지 못했습니다." });
      return send(response, 200, result);
    }

    if (request.method === "GET" && url.pathname === "/api/users/matches") {
      const nickname = (url.searchParams.get("nickname") || "").trim();
      if (!nickname) throw new Error("nickname is required.");
      const offset = integer(url, "offset", 0, 0, 1000);
      const limit = integer(url, "limit", 20, 1, 20);
      const result = await listRecentMatches({ nickname, offset, limit });
      if (!result) return send(response, 404, { code: "OUID_NOT_FOUND", message: "구단주의 경기 식별 정보를 찾지 못했습니다." });
      return send(response, 200, result);
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
  const abandonedCount = failAbandonedSnapshots();
  if (abandonedCount > 0) {
    logger.warn("수집 복구", "이전 서버 종료로 미완료된 스냅샷을 실패 처리했습니다.", { count: abandonedCount });
  }
  startScheduler();
  const activeSnapshot = getActiveSnapshot();
  if (config.collectOnEmpty && !activeSnapshot) {
    if (config.nexonApiKeys.length === 0) {
      logger.warn("초기 집계", "DB가 비어 있지만 API 키가 없어 즉시 집계를 시작하지 못했습니다.");
    } else {
      logger.info("초기 집계", "DB에 활성 데이터가 없어 즉시 집계를 시작합니다.");
      runCollection().catch((error) => {
        logger.error("초기 집계", "서버 시작 직후 집계가 실패했습니다.", { error: String(error?.message || error) });
      });
    }
  } else if (activeSnapshot) {
    const freshness = inspectSnapshotFreshness(activeSnapshot);
    if (!freshness.fresh && config.nexonApiKeys.length > 0) {
      logger.warn("신선도 검사", "활성 스냅샷이 최신 기대 시각보다 오래되어 즉시 재집계를 시작합니다.", {
        snapshotId: activeSnapshot.id,
        snapshotDataTime: freshness.snapshotDataTime,
        expectedDataTime: freshness.expectedDataTime,
      });
      runCollection().catch((error) => {
        logger.error("신선도 검사", "오래된 스냅샷의 재집계가 실패했습니다.", { error: String(error?.message || error) });
      });
    } else if (!freshness.fresh) {
      logger.warn("신선도 검사", "활성 스냅샷이 오래됐지만 API 키가 없어 재집계를 시작하지 못했습니다.", freshness);
    } else {
      logger.info("신선도 검사", "활성 스냅샷이 최신 상태입니다.", {
        snapshotId: activeSnapshot.id,
        snapshotDataTime: freshness.snapshotDataTime,
        expectedDataTime: freshness.expectedDataTime,
      });
    }
  }
});

function shutdown() {
  server.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
