import { db, getActiveSnapshot } from "./database.mjs";

function rankingItem(row) {
  return {
    rank: Number(row.rank),
    nickname: row.nickname,
    nexonSn: row.nexon_sn,
    level: row.level == null ? null : Number(row.level),
    clubValue: row.club_value,
    elo: row.elo == null ? null : Number(row.elo),
    winRate: row.win_rate == null ? null : Number(row.win_rate),
    wins: row.wins == null ? null : Number(row.wins),
    draws: row.draws == null ? null : Number(row.draws),
    losses: row.losses == null ? null : Number(row.losses),
    teamColors: JSON.parse(row.team_colors_json || "[]"),
    primaryTeamColor: row.primary_team_color,
    teamImage: row.team_image,
    teamColorCount: row.team_color_count == null ? null : Number(row.team_color_count),
    formation: row.formation,
    currentGrade: row.current_grade,
    bestGrade: row.best_grade,
    previousGrade: row.previous_grade,
    lineupStatus: row.lineup_status,
  };
}

export function listTeamColors() {
  const snapshot = getActiveSnapshot();
  if (!snapshot) return { snapshot: null, items: [] };
  const rows = db.prepare(`
    SELECT json_extract(color.value, '$.name') AS name, COUNT(DISTINCT e.ranker_id) AS managers
    FROM ranking_entries e, json_each(e.team_colors_json) color
    WHERE e.snapshot_id = ? AND json_extract(color.value, '$.name') <> ''
    GROUP BY name
    ORDER BY name COLLATE NOCASE ASC
  `).all(snapshot.id);
  return { snapshot, items: rows };
}

export function suggestNicknames(prefix, limit = 10) {
  const snapshot = getActiveSnapshot();
  if (!snapshot || !prefix) return { snapshot, items: [] };
  const escaped = prefix.replace(/[\\%_]/g, "\\$&");
  const rows = db.prepare(`
    SELECT r.nickname, e.rank
    FROM ranking_entries e
    JOIN rankers r ON r.id = e.ranker_id
    WHERE e.snapshot_id = ? AND r.nickname LIKE ? ESCAPE '\\' COLLATE NOCASE
    ORDER BY r.nickname COLLATE NOCASE ASC, e.rank ASC
    LIMIT ?
  `).all(snapshot.id, `${escaped}%`, limit);
  return { snapshot, items: rows.map((row) => ({ nickname: row.nickname, rank: Number(row.rank) })) };
}

export function getUserProfile(nickname) {
  const snapshot = getActiveSnapshot();
  if (!snapshot) return null;
  const row = db.prepare(`
    SELECT
      r.id AS ranker_id, r.ouid,
      e.rank, r.nickname, r.nexon_sn, e.level,
      CAST(e.club_value AS TEXT) AS club_value,
      e.elo, e.win_rate, e.wins, e.draws, e.losses,
      e.team_colors_json, e.primary_team_color, e.team_color_count,
      e.formation, e.current_grade, e.best_grade, e.previous_grade,
      asset.image_url AS team_image,
      e.lineup_status
    FROM ranking_entries e
    JOIN rankers r ON r.id = e.ranker_id
    LEFT JOIN team_color_assets asset ON asset.name = e.primary_team_color
    WHERE e.snapshot_id = ? AND r.nickname = ? COLLATE NOCASE
    LIMIT 1
  `).get(snapshot.id, nickname);
  if (!row) return { snapshot, profile: null, history: [], squad: [] };

  const history = db.prepare(`
    SELECT data_time, rank, CAST(club_value AS TEXT) AS club_value, win_rate
    FROM ranking_history
    WHERE ranker_id = ?
    ORDER BY datetime(data_time) ASC
  `).all(row.ranker_id).map((item) => ({
    dataTime: item.data_time,
    rank: Number(item.rank),
    clubValue: String(item.club_value),
    winRate: item.win_rate == null ? null : Number(item.win_rate),
  }));

  const squad = db.prepare(`
    SELECT
      l.slot, l.spid, l.grade, l.position_id, p.name, p.season_name,
      pos.name AS position
    FROM lineup_players l
    LEFT JOIN player_metadata p ON p.spid = l.spid
    LEFT JOIN position_metadata pos ON pos.position_id = l.position_id
    WHERE l.snapshot_id = ? AND l.ranker_id = ?
    ORDER BY l.slot ASC
  `).all(snapshot.id, row.ranker_id).map((item) => ({
    slot: Number(item.slot),
    spid: String(item.spid),
    grade: Number(item.grade),
    position: item.position,
    name: item.name,
    season: item.season_name,
  }));

  return {
    snapshot,
    profile: { ...rankingItem(row), hasOuid: Boolean(row.ouid) },
    history,
    squad,
  };
}

export function getRankerOuid(nickname) {
  return db.prepare("SELECT ouid FROM rankers WHERE nickname = ? COLLATE NOCASE LIMIT 1").get(nickname)?.ouid || null;
}

export function listAvailablePositions({ rankStart, rankEnd, teamColor }) {
  const snapshot = getActiveSnapshot();
  if (!snapshot) return null;

  const teamClause = teamColor
    ? "AND EXISTS (SELECT 1 FROM json_each(e.team_colors_json) c WHERE json_extract(c.value, '$.name') = ?)"
    : "";
  const parameters = teamColor
    ? [snapshot.id, rankStart, rankEnd, teamColor]
    : [snapshot.id, rankStart, rankEnd];
  const rows = db.prepare(`
    WITH eligible AS (
      SELECT e.ranker_id
      FROM ranking_entries e
      WHERE e.snapshot_id = ? AND e.rank BETWEEN ? AND ? AND e.lineup_status = 'READY'
      ${teamClause}
    )
    SELECT pos.name, COUNT(*) AS count
    FROM lineup_players l
    JOIN eligible q ON q.ranker_id = l.ranker_id
    JOIN position_metadata pos ON pos.position_id = l.position_id
    WHERE l.snapshot_id = ${Number(snapshot.id)}
    GROUP BY l.position_id, pos.name
    HAVING COUNT(*) > 0
  `).all(...parameters);

  return {
    snapshot,
    items: rows.map((row) => ({ name: row.name, count: Number(row.count) })),
  };
}

export function getPickRates({ rankStart, rankEnd, teamColor, position, offset, limit }) {
  const snapshot = getActiveSnapshot();
  if (!snapshot) return null;

  const positionRow = db.prepare("SELECT position_id FROM position_metadata WHERE name = ?").get(position);
  if (!positionRow) return { snapshot, matchingManagers: 0, positionTotal: 0, totalItems: 0, items: [] };

  const teamClause = teamColor
    ? "AND EXISTS (SELECT 1 FROM json_each(e.team_colors_json) c WHERE json_extract(c.value, '$.name') = ?)"
    : "";
  const parameters = teamColor
    ? [snapshot.id, rankStart, rankEnd, teamColor]
    : [snapshot.id, rankStart, rankEnd];
  const cte = `
    WITH eligible AS (
      SELECT e.ranker_id
      FROM ranking_entries e
      WHERE e.snapshot_id = ? AND e.rank BETWEEN ? AND ? AND e.lineup_status = 'READY'
      ${teamClause}
    ), picks AS (
      SELECT l.spid, l.grade, l.position_id, COUNT(*) AS pick_count
      FROM lineup_players l
      JOIN eligible q ON q.ranker_id = l.ranker_id
      WHERE l.snapshot_id = ${Number(snapshot.id)} AND l.position_id = ?
      GROUP BY l.spid, l.grade, l.position_id
    )
  `;
  const common = [...parameters, Number(positionRow.position_id)];
  const matchingManagers = Number(db.prepare(`
    SELECT COUNT(*) AS count FROM ranking_entries e
    WHERE e.snapshot_id = ? AND e.rank BETWEEN ? AND ? AND e.lineup_status = 'READY'
    ${teamClause}
  `).get(...parameters).count);
  const positionTotal = Number(db.prepare(`${cte} SELECT COALESCE(SUM(pick_count), 0) AS count FROM picks`).get(...common).count);
  const totalItems = Number(db.prepare(`${cte} SELECT COUNT(*) AS count FROM picks`).get(...common).count);
  const rows = db.prepare(`${cte}
    SELECT
      p.spid, m.pid, m.season_id, m.name, m.season_name, m.season_image,
      p.grade, p.position_id, pos.name AS position, p.pick_count
    FROM picks p
    LEFT JOIN player_metadata m ON m.spid = p.spid
    LEFT JOIN position_metadata pos ON pos.position_id = p.position_id
    ORDER BY p.pick_count DESC, m.name ASC, p.spid ASC, p.grade ASC
    LIMIT ? OFFSET ?
  `).all(...common, limit, offset);

  return {
    snapshot,
    matchingManagers,
    positionTotal,
    totalItems,
    items: rows.map((row) => ({
      spid: String(row.spid),
      pid: String(row.pid),
      seasonId: Number(row.season_id),
      season: row.season_name,
      seasonImage: row.season_image,
      name: row.name,
      grade: Number(row.grade),
      position: row.position,
      count: Number(row.pick_count),
      pickRate: positionTotal === 0 ? 0 : Number(((Number(row.pick_count) / positionTotal) * 100).toFixed(2)),
    })),
  };
}

export function recentSnapshots(limit = 10) {
  return db.prepare(`
    SELECT id, data_time, started_at, completed_at, status, stage,
           ranking_count, lineup_count, failure_count, error_message
    FROM snapshots ORDER BY id DESC LIMIT ?
  `).all(limit);
}

export function listRankings({ rankStart, rankEnd, teamColor, offset, limit }) {
  const snapshot = getActiveSnapshot();
  if (!snapshot) return null;
  const teamClause = teamColor
    ? "AND EXISTS (SELECT 1 FROM json_each(e.team_colors_json) c WHERE json_extract(c.value, '$.name') = ?)"
    : "";
  const parameters = teamColor
    ? [snapshot.id, rankStart, rankEnd, teamColor]
    : [snapshot.id, rankStart, rankEnd];

  const total = Number(db.prepare(`
    SELECT COUNT(*) AS count
    FROM ranking_entries e
    WHERE e.snapshot_id = ? AND e.rank BETWEEN ? AND ? ${teamClause}
  `).get(...parameters).count);

  const rows = db.prepare(`
    SELECT
      e.rank, r.nickname, r.nexon_sn, e.level,
      CAST(e.club_value AS TEXT) AS club_value,
      e.elo, e.win_rate, e.wins, e.draws, e.losses,
      e.team_colors_json, e.primary_team_color, e.team_color_count,
      e.formation, e.current_grade, e.best_grade, e.previous_grade,
      asset.image_url AS team_image,
      e.lineup_status
    FROM ranking_entries e
    JOIN rankers r ON r.id = e.ranker_id
    LEFT JOIN team_color_assets asset ON asset.name = e.primary_team_color
    WHERE e.snapshot_id = ? AND e.rank BETWEEN ? AND ? ${teamClause}
    ORDER BY e.rank ASC
    LIMIT ? OFFSET ?
  `).all(...parameters, limit, offset);

  return {
    snapshot,
    total,
    items: rows.map(rankingItem),
  };
}

export function searchRankings({ nickname, limit = 20 }) {
  const snapshot = getActiveSnapshot();
  if (!snapshot) return null;
  const escaped = nickname.replace(/[\\%_]/g, "\\$&");
  const pattern = `${escaped}%`;

  const rows = db.prepare(`
    SELECT
      e.rank, r.nickname, r.nexon_sn, e.level,
      CAST(e.club_value AS TEXT) AS club_value,
      e.elo, e.win_rate, e.wins, e.draws, e.losses,
      e.team_colors_json, e.primary_team_color, e.team_color_count,
      e.formation, e.current_grade, e.best_grade, e.previous_grade,
      asset.image_url AS team_image,
      e.lineup_status
    FROM ranking_entries e
    JOIN rankers r ON r.id = e.ranker_id
    LEFT JOIN team_color_assets asset ON asset.name = e.primary_team_color
    WHERE e.snapshot_id = ? AND r.nickname LIKE ? ESCAPE '\\' COLLATE NOCASE
    ORDER BY r.nickname COLLATE NOCASE ASC, e.rank ASC
    LIMIT ?
  `).all(snapshot.id, pattern, limit);

  return { snapshot, total: rows.length, items: rows.map(rankingItem) };
}
