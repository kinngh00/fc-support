import http from "node:http";
import { config } from "./config.mjs";
import { isCollectionRunning, runCollection } from "./collector.mjs";
import { failAbandonedSnapshots, getActiveSnapshot } from "./database.mjs";
import { getPickRates, getUserProfile, listAvailablePositions, listRankings, listTeamColors, portfolioMetrics, recentSnapshots, searchRankings, suggestNicknames } from "./queries.mjs";
import { startScheduler } from "./scheduler.mjs";
import { listLogs, logger } from "./logger.mjs";
import { inspectSnapshotFreshness } from "./freshness.mjs";
import { listRecentMatches } from "./match-service.mjs";
import { getSquadProfile } from "./squad-profile-service.mjs";
import {
  CommunityError,
  createComment,
  createPost,
  deleteComment,
  deletePost,
  getPost,
  listPosts,
  loginUser,
  logoutUser,
  registerUser,
  requireUser,
  sessionCookie,
  sessionTokenFromRequest,
  userFromSessionToken,
} from "./community-service.mjs";

function send(response, status, payload, headers = {}) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": config.frontendOrigin,
    "access-control-allow-headers": "content-type, authorization",
    "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
    "access-control-allow-credentials": "true",
    vary: "origin",
    ...headers,
  });
  response.end(status === 204 ? undefined : JSON.stringify(payload));
}

async function jsonBody(request) {
  if (!String(request.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
    throw new CommunityError(415, "JSON_REQUIRED", "JSON 형식으로 요청해 주세요.");
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64 * 1024) throw new CommunityError(413, "PAYLOAD_TOO_LARGE", "요청 내용이 너무 큽니다.");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new CommunityError(400, "INVALID_JSON", "올바른 JSON 형식이 아닙니다.");
  }
}

function positiveId(value, name) {
  const id = Number.parseInt(value, 10);
  if (!Number.isInteger(id) || id < 1) throw new CommunityError(400, "INVALID_ID", `${name} 번호가 올바르지 않습니다.`);
  return id;
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
    const sessionToken = sessionTokenFromRequest(request);
    const sessionUser = userFromSessionToken(sessionToken);

    if (request.method === "GET" && url.pathname === "/api/auth/me") {
      return send(response, 200, { user: sessionUser });
    }

    if (request.method === "POST" && url.pathname === "/api/auth/register") {
      const result = await registerUser(await jsonBody(request));
      return send(response, 201, { user: result.user }, { "set-cookie": sessionCookie(result.token) });
    }

    if (request.method === "POST" && url.pathname === "/api/auth/login") {
      const result = await loginUser(await jsonBody(request));
      return send(response, 200, { user: result.user }, { "set-cookie": sessionCookie(result.token) });
    }

    if (request.method === "POST" && url.pathname === "/api/auth/logout") {
      logoutUser(sessionToken);
      return send(response, 200, { ok: true }, { "set-cookie": sessionCookie("", 0) });
    }

    if (request.method === "GET" && url.pathname === "/api/community/posts") {
      const offset = integer(url, "offset", 0, 0, 1000000);
      const limit = integer(url, "limit", 10, 1, 50);
      return send(response, 200, listPosts({ offset, limit, viewerId: sessionUser?.id || null }));
    }

    if (request.method === "POST" && url.pathname === "/api/community/posts") {
      const user = requireUser(sessionToken);
      return send(response, 201, createPost(user.id, await jsonBody(request)));
    }

    const postMatch = url.pathname.match(/^\/api\/community\/posts\/(\d+)$/);
    if (request.method === "GET" && postMatch) {
      return send(response, 200, getPost(positiveId(postMatch[1], "게시글"), { viewerId: sessionUser?.id || null }));
    }
    if (request.method === "DELETE" && postMatch) {
      const user = requireUser(sessionToken);
      deletePost(user.id, positiveId(postMatch[1], "게시글"));
      return send(response, 200, { ok: true });
    }

    const commentCreateMatch = url.pathname.match(/^\/api\/community\/posts\/(\d+)\/comments$/);
    if (request.method === "POST" && commentCreateMatch) {
      const user = requireUser(sessionToken);
      return send(response, 201, createComment(user.id, positiveId(commentCreateMatch[1], "게시글"), await jsonBody(request)));
    }

    const commentMatch = url.pathname.match(/^\/api\/community\/comments\/(\d+)$/);
    if (request.method === "DELETE" && commentMatch) {
      const user = requireUser(sessionToken);
      deleteComment(user.id, positiveId(commentMatch[1], "댓글"));
      return send(response, 200, { ok: true });
    }

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

    if (request.method === "GET" && url.pathname === "/api/portfolio/metrics") {
      return send(response, 200, portfolioMetrics());
    }

    if (request.method === "GET" && url.pathname === "/api/team-colors") {
      return send(response, 200, listTeamColors());
    }

    if (request.method === "GET" && url.pathname === "/api/positions") {
      const rankStart = integer(url, "rankStart", 1, 1, 10000);
      const rankEnd = integer(url, "rankEnd", 10000, 1, 10000);
      if (rankStart > rankEnd) throw new Error("rankStart cannot be greater than rankEnd.");
      const teamColor = (url.searchParams.get("teamColor") || "").trim();
      const detailedPositions = url.searchParams.get("detailedPositions") !== "false";
      const result = listAvailablePositions({ rankStart, rankEnd, teamColor, detailedPositions });
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
      const result = searchRankings({ nickname, limit: 10 });
      if (!result) return send(response, 404, { code: "NO_SNAPSHOT", message: "수집된 데이터가 없습니다." });
      return send(response, 200, { ...result, offset: 0, limit: 10, hasMore: false });
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

    if (request.method === "GET" && url.pathname === "/api/users/squad-details") {
      const nickname = (url.searchParams.get("nickname") || "").trim();
      if (!nickname) throw new Error("nickname is required.");
      if (nickname.length > 50) throw new Error("nickname must be 50 characters or fewer.");
      const result = await getSquadProfile(nickname);
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
      const detailedPositions = url.searchParams.get("detailedPositions") !== "false";
      const result = getPickRates({ rankStart, rankEnd, teamColor, position, offset, limit, detailedPositions });
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
    const status = error instanceof CommunityError ? error.status : 400;
    const code = error instanceof CommunityError ? error.code : "BAD_REQUEST";
    return send(response, status, { code, message: String(error?.message || error) });
  }
});

server.listen(config.port, config.host, () => {
  logger.success("서버", "백엔드 서버가 시작되었습니다.", { url: `http://${config.host}:${config.port}` });
  const abandonedCount = config.recoverAbandonedSnapshots ? failAbandonedSnapshots() : 0;
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
    if (!freshness.fresh && config.collectOnStale && config.nexonApiKeys.length > 0) {
      logger.warn("신선도 검사", "활성 스냅샷이 최신 기대 시각보다 오래되어 즉시 재집계를 시작합니다.", {
        snapshotId: activeSnapshot.id,
        snapshotDataTime: freshness.snapshotDataTime,
        expectedDataTime: freshness.expectedDataTime,
      });
      runCollection().catch((error) => {
        logger.error("신선도 검사", "오래된 스냅샷의 재집계가 실패했습니다.", { error: String(error?.message || error) });
      });
    } else if (!freshness.fresh && config.collectOnStale) {
      logger.warn("신선도 검사", "활성 스냅샷이 오래됐지만 API 키가 없어 재집계를 시작하지 못했습니다.", freshness);
    } else if (!freshness.fresh) {
      logger.info("신선도 검사", "테스트 환경에서는 오래된 데이터의 자동 재집계를 실행하지 않습니다.", freshness);
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
