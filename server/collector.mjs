import { config, requireApiKeys } from "./config.mjs";
import {
  acquireCollectionLock,
  createSnapshot,
  db,
  failSnapshot,
  promoteSnapshot,
  releaseCollectionLock,
  transaction,
  updateSnapshot,
} from "./database.mjs";
import { randomUUID } from "node:crypto";
import { fetchAllRankings } from "./ranking-source.mjs";
import { expectedKstDataTime } from "./freshness.mjs";
import { logger } from "./logger.mjs";
import {
  latestManagerMatchPath,
  mapWithKeyPool,
  matchDetailPath,
  nexonJson,
  nicknamePath,
} from "./nexon-api.mjs";

let activeCollection = null;

function progressLogger(component, unit, step = 500) {
  let lastReported = 0;
  return ({ completed, total }) => {
    if (completed === total || completed - lastReported >= step) {
      lastReported = completed;
      logger.info(component, `${unit} 진행 중`, { completed, total });
    }
  };
}

async function fetchConsistentRankings() {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const rankings = await fetchAllRankings(
        config.rankingConcurrency,
        progressLogger("랭킹", "랭킹 페이지 조회", 50),
      );
      const seen = new Map();
      for (const ranking of rankings) {
        const previous = seen.get(ranking.nexonSn);
        if (previous) {
          throw new Error(`Ranking identity duplicated at ranks ${previous.rank} and ${ranking.rank}.`);
        }
        seen.set(ranking.nexonSn, ranking);
      }
      return rankings;
    } catch (error) {
      lastError = error;
      if (attempt === 3) break;
      logger.warn("랭킹", "페이지 조회 중 순위 갱신이 겹쳐 전체 랭킹을 다시 조회합니다.", {
        attempt,
        error: String(error?.message || error),
      });
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
  throw lastError;
}

async function refreshMetadata() {
  logger.info("메타데이터", "선수·시즌·포지션 메타데이터 조회를 시작합니다.");
  const [playersResponse, seasonsResponse, positionsResponse] = await Promise.all([
    fetch("https://open.api.nexon.com/static/fconline/meta/spid.json"),
    fetch("https://open.api.nexon.com/static/fconline/meta/seasonid.json"),
    fetch("https://open.api.nexon.com/static/fconline/meta/spposition.json"),
  ]);
  if (!playersResponse.ok || !seasonsResponse.ok || !positionsResponse.ok) {
    throw new Error("FC Online metadata request failed.");
  }

  const [players, seasons, positions] = await Promise.all([
    playersResponse.json(),
    seasonsResponse.json(),
    positionsResponse.json(),
  ]);
  const seasonMap = new Map(seasons.map((season) => [Number(season.seasonId), season]));
  const now = new Date().toISOString();

  transaction(() => {
    const upsertPlayer = db.prepare(`
      INSERT INTO player_metadata
        (spid, pid, season_id, name, season_name, season_image, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(spid) DO UPDATE SET
        pid = excluded.pid,
        season_id = excluded.season_id,
        name = excluded.name,
        season_name = excluded.season_name,
        season_image = excluded.season_image,
        updated_at = excluded.updated_at
    `);
    for (const player of players) {
      const spid = Number(player.id);
      const seasonId = Math.floor(spid / 1_000_000);
      const season = seasonMap.get(seasonId);
      upsertPlayer.run(
        spid,
        spid % 1_000_000,
        seasonId,
        String(player.name),
        season?.className || null,
        season?.seasonImg || null,
        now,
      );
    }

    const upsertPosition = db.prepare(`
      INSERT INTO position_metadata (position_id, name, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(position_id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at
    `);
    for (const position of positions) {
      upsertPosition.run(Number(position.spposition), String(position.desc), now);
    }
  });
  logger.success("메타데이터", "메타데이터 저장을 완료했습니다.", {
    players: players.length,
    seasons: seasons.length,
    positions: positions.length,
  });
}

function storeRankings(snapshotId, rankings) {
  const now = new Date().toISOString();
  const selectRanker = db.prepare("SELECT id, nickname, ouid FROM rankers WHERE nexon_sn = ?");
  const insertRanker = db.prepare(`
    INSERT INTO rankers (nexon_sn, nickname, created_at, updated_at)
    VALUES (?, ?, ?, ?)
  `);
  const renameRanker = db.prepare(`
    UPDATE rankers
    SET nickname = ?, ouid = NULL, ouid_resolved_at = NULL, updated_at = ?
    WHERE id = ?
  `);
  const touchRanker = db.prepare("UPDATE rankers SET updated_at = ? WHERE id = ?");
  const insertEntry = db.prepare(`
    INSERT INTO ranking_entries (
      snapshot_id, ranker_id, rank, level, level_gauge, club_value, elo, win_rate,
      wins, draws, losses, team_colors_json, primary_team_color, team_color_count,
      formation, current_grade, best_grade, previous_grade
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const upsertTeamAsset = db.prepare(`
    INSERT INTO team_color_assets (name, image_url, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET image_url = excluded.image_url, updated_at = excluded.updated_at
  `);

  transaction(() => {
    for (const ranking of rankings) {
      for (const color of ranking.teamColors) {
        if (color.name && color.image) upsertTeamAsset.run(color.name, color.image, now);
      }
      let ranker = selectRanker.get(ranking.nexonSn);
      if (!ranker) {
        const result = insertRanker.run(ranking.nexonSn, ranking.nickname, now, now);
        ranker = { id: Number(result.lastInsertRowid), nickname: ranking.nickname, ouid: null };
      } else if (ranker.nickname !== ranking.nickname) {
        renameRanker.run(ranking.nickname, now, ranker.id);
        ranker = { ...ranker, nickname: ranking.nickname, ouid: null };
      } else {
        touchRanker.run(now, ranker.id);
      }

      insertEntry.run(
        snapshotId,
        ranker.id,
        ranking.rank,
        ranking.level,
        ranking.levelGauge,
        ranking.clubValue,
        ranking.elo,
        ranking.winRate,
        ranking.wins,
        ranking.draws,
        ranking.losses,
        JSON.stringify(ranking.teamColors),
        ranking.primaryTeamColor,
        ranking.teamColorCount,
        null,
        ranking.currentGrade,
        ranking.bestGrade,
        ranking.previousGrade,
      );
    }
  });
  logger.success("랭킹", "1위부터 10,000위까지 랭킹 저장을 완료했습니다.", {
    snapshotId,
    count: rankings.length,
  });
}

async function resolveOuid(snapshotId, keys) {
  const unresolved = db.prepare(`
    SELECT r.id, r.nickname
    FROM rankers r
    JOIN ranking_entries e ON e.ranker_id = r.id
    WHERE e.snapshot_id = ? AND r.ouid IS NULL
    ORDER BY e.rank
  `).all(snapshotId);
  if (unresolved.length === 0) {
    logger.info("OUID", "새로 조회할 OUID가 없습니다. 저장된 값을 재사용합니다.");
    return { apiErrors: 0 };
  }
  logger.info("OUID", "닉네임으로 OUID 조회를 시작합니다.", { target: unresolved.length, keys: keys.length });

  const results = await mapWithKeyPool(
    unresolved,
    keys,
    config.apiConcurrencyPerKey,
    async (ranker, key) => nexonJson(nicknamePath(ranker.nickname), key),
    { onProgress: progressLogger("OUID", "OUID 조회") },
  );
  let apiErrors = 0;
  const now = new Date().toISOString();
  transaction(() => {
    const updateRanker = db.prepare("UPDATE rankers SET ouid = ?, ouid_resolved_at = ?, updated_at = ? WHERE id = ?");
    const updateStatus = db.prepare(`
      UPDATE ranking_entries SET lineup_status = ? WHERE snapshot_id = ? AND ranker_id = ?
    `);
    results.forEach((result, index) => {
      const ranker = unresolved[index];
      if (result.ok && result.value?.ouid) {
        updateRanker.run(String(result.value.ouid), now, now, ranker.id);
      } else {
        const permanent = result.error?.status >= 400 && result.error?.status < 500 && result.error?.status !== 429;
        updateStatus.run(permanent ? "OUID_NOT_FOUND" : "API_ERROR", snapshotId, ranker.id);
        if (!permanent) apiErrors += 1;
      }
    });
  });
  logger.success("OUID", "OUID 조회 단계를 완료했습니다.", {
    target: unresolved.length,
    transientErrors: apiErrors,
  });
  return { apiErrors };
}

async function collectLatestMatches(snapshotId, keys) {
  const rankers = db.prepare(`
    SELECT r.id, r.ouid, r.nickname
    FROM rankers r
    JOIN ranking_entries e ON e.ranker_id = r.id
    WHERE e.snapshot_id = ? AND r.ouid IS NOT NULL AND e.lineup_status = 'PENDING'
    ORDER BY e.rank
  `).all(snapshotId);
  logger.info("매치", "감독별 최신 감독모드 경기 조회를 시작합니다.", { target: rankers.length });

  const matchResults = await mapWithKeyPool(
    rankers,
    keys,
    config.apiConcurrencyPerKey,
    async (ranker, key) => nexonJson(latestManagerMatchPath(ranker.ouid), key),
    { onProgress: progressLogger("매치", "최신 경기 조회") },
  );

  const matchTasks = [];
  let apiErrors = 0;
  transaction(() => {
    const update = db.prepare(`
      UPDATE ranking_entries SET lineup_status = ?, match_id = ?
      WHERE snapshot_id = ? AND ranker_id = ?
    `);
    matchResults.forEach((result, index) => {
      const ranker = rankers[index];
      if (!result.ok) {
        update.run("API_ERROR", null, snapshotId, ranker.id);
        apiErrors += 1;
        return;
      }
      const matchId = Array.isArray(result.value) ? result.value[0] : null;
      if (!matchId) {
        update.run("NO_MATCH", null, snapshotId, ranker.id);
        return;
      }
      update.run("MATCH_FOUND", String(matchId), snapshotId, ranker.id);
      matchTasks.push({ ...ranker, matchId: String(matchId) });
    });
  });

  logger.info("매치", "확인된 최신 경기의 상세정보 조회를 시작합니다.", { target: matchTasks.length });

  const detailResults = await mapWithKeyPool(
    matchTasks,
    keys,
    config.apiConcurrencyPerKey,
    async (task, key) => nexonJson(matchDetailPath(task.matchId), key),
    { onProgress: progressLogger("선발", "선발 선수 추출") },
  );

  let readyCount = 0;
  transaction(() => {
    const update = db.prepare(`
      UPDATE ranking_entries SET lineup_status = ?
      WHERE snapshot_id = ? AND ranker_id = ?
    `);
    const insertPlayer = db.prepare(`
      INSERT INTO lineup_players (
        snapshot_id, ranker_id, slot, spid, pid, season_id, position_id,
        grade, rating, goals, assists
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    detailResults.forEach((result, index) => {
      const task = matchTasks[index];
      if (!result.ok) {
        update.run("API_ERROR", snapshotId, task.id);
        apiErrors += 1;
        return;
      }

      const participant = result.value?.matchInfo?.find((info) => info.ouid === task.ouid);
      if (!participant) {
        update.run("NO_SELF", snapshotId, task.id);
        return;
      }
      const starters = (participant.player || []).filter(
        (player) => Number(player.spPosition) >= 0 && Number(player.spPosition) <= 27,
      );
      if (starters.length === 0) {
        update.run("NO_STARTERS", snapshotId, task.id);
        return;
      }

      starters.forEach((player, slot) => {
        const spid = Number(player.spId);
        insertPlayer.run(
          snapshotId,
          task.id,
          slot,
          spid,
          spid % 1_000_000,
          Math.floor(spid / 1_000_000),
          Number(player.spPosition),
          Number(player.spGrade),
          player.status?.spRating ?? null,
          player.status?.goal ?? null,
          player.status?.assist ?? null,
        );
      });
      update.run("READY", snapshotId, task.id);
      readyCount += 1;
    });
  });
  logger.success("선발", "본인 선발 선수 추출 단계를 완료했습니다.", {
    ready: readyCount,
    total: rankers.length,
    transientErrors: apiErrors,
  });
  return { readyCount, apiErrors };
}

async function performCollection() {
  const keys = requireApiKeys();
  const dataTime = expectedKstDataTime();
  const snapshotId = createSnapshot(dataTime);
  logger.info("수집기", "새 스냅샷 집계를 시작합니다.", {
    snapshotId,
    dataTime,
    apiKeyCount: keys.length,
  });

  try {
    updateSnapshot(snapshotId, { stage: "metadata" });
    await refreshMetadata();

    updateSnapshot(snapshotId, { stage: "ranking" });
    const rankings = await fetchConsistentRankings();
    storeRankings(snapshotId, rankings);
    updateSnapshot(snapshotId, { ranking_count: rankings.length, stage: "ouid" });

    const ouid = await resolveOuid(snapshotId, keys);
    updateSnapshot(snapshotId, { stage: "matches" });
    const matches = await collectLatestMatches(snapshotId, keys);
    const apiErrors = ouid.apiErrors + matches.apiErrors;
    const failureCount = Number(db.prepare(`
      SELECT COUNT(*) AS count FROM ranking_entries
      WHERE snapshot_id = ? AND lineup_status <> 'READY'
    `).get(snapshotId).count);
    updateSnapshot(snapshotId, {
      lineup_count: matches.readyCount,
      failure_count: failureCount,
      stage: "validating",
    });

    if (apiErrors > 0) {
      throw new Error(`${apiErrors} transient NEXON API requests failed after retries.`);
    }
    const rankingCount = Number(db.prepare("SELECT COUNT(*) AS count FROM ranking_entries WHERE snapshot_id = ?").get(snapshotId).count);
    if (rankingCount !== 10000) throw new Error(`Snapshot contains ${rankingCount} rankings instead of 10000.`);

    promoteSnapshot(snapshotId);
    const completed = db.prepare("SELECT * FROM snapshots WHERE id = ?").get(snapshotId);
    logger.success("수집기", "새 스냅샷을 활성화했습니다.", {
      snapshotId,
      rankingCount,
      lineupCount: matches.readyCount,
      excludedCount: failureCount,
    });
    return completed;
  } catch (error) {
    failSnapshot(snapshotId, error);
    logger.error("수집기", "집계에 실패해 기존 스냅샷을 유지합니다.", {
      snapshotId,
      error: String(error?.message || error),
    });
    throw error;
  }
}

export function runCollection() {
  if (activeCollection) return activeCollection;
  const owner = `${process.pid}:${randomUUID()}`;
  if (!acquireCollectionLock(owner)) {
    return Promise.reject(new Error("다른 서버 인스턴스에서 이미 집계를 진행하고 있습니다."));
  }
  activeCollection = performCollection().finally(() => {
    releaseCollectionLock(owner);
    activeCollection = null;
  });
  return activeCollection;
}

export function isCollectionRunning() {
  return activeCollection !== null;
}
