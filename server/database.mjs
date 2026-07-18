import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "./config.mjs";

mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new DatabaseSync(config.dbPath);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");
db.exec("PRAGMA busy_timeout = 5000");
db.exec("PRAGMA synchronous = NORMAL");

export function initializeDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      data_time TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      status TEXT NOT NULL CHECK (status IN ('building', 'active', 'retained', 'failed')),
      stage TEXT NOT NULL DEFAULT 'starting',
      ranking_count INTEGER NOT NULL DEFAULT 0,
      lineup_count INTEGER NOT NULL DEFAULT 0,
      failure_count INTEGER NOT NULL DEFAULT 0,
      error_message TEXT
    );

    CREATE TABLE IF NOT EXISTS rankers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nexon_sn TEXT NOT NULL UNIQUE,
      nickname TEXT NOT NULL,
      ouid TEXT UNIQUE,
      ouid_resolved_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ranking_entries (
      snapshot_id INTEGER NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
      ranker_id INTEGER NOT NULL REFERENCES rankers(id),
      rank INTEGER NOT NULL CHECK (rank BETWEEN 1 AND 10000),
      level INTEGER,
      level_gauge REAL,
      club_value INTEGER,
      elo REAL,
      win_rate REAL,
      wins INTEGER,
      draws INTEGER,
      losses INTEGER,
      team_colors_json TEXT NOT NULL DEFAULT '[]',
      primary_team_color TEXT,
      team_color_count INTEGER,
      formation TEXT,
      current_grade TEXT,
      best_grade TEXT,
      previous_grade TEXT,
      lineup_status TEXT NOT NULL DEFAULT 'PENDING',
      match_id TEXT,
      PRIMARY KEY (snapshot_id, ranker_id),
      UNIQUE (snapshot_id, rank)
    );

    CREATE TABLE IF NOT EXISTS lineup_players (
      snapshot_id INTEGER NOT NULL,
      ranker_id INTEGER NOT NULL,
      slot INTEGER NOT NULL,
      spid INTEGER NOT NULL,
      pid INTEGER NOT NULL,
      season_id INTEGER NOT NULL,
      position_id INTEGER NOT NULL CHECK (position_id BETWEEN 0 AND 27),
      grade INTEGER NOT NULL,
      rating REAL,
      goals INTEGER,
      assists INTEGER,
      PRIMARY KEY (snapshot_id, ranker_id, slot),
      FOREIGN KEY (snapshot_id, ranker_id)
        REFERENCES ranking_entries(snapshot_id, ranker_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS player_metadata (
      spid INTEGER PRIMARY KEY,
      pid INTEGER NOT NULL,
      season_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      season_name TEXT,
      season_image TEXT,
      image_url TEXT,
      image_checked_at TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS position_metadata (
      position_id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS team_color_assets (
      name TEXT PRIMARY KEY,
      image_url TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ranking_history (
      ranker_id INTEGER NOT NULL REFERENCES rankers(id),
      data_time TEXT NOT NULL,
      rank INTEGER NOT NULL,
      club_value INTEGER,
      win_rate REAL,
      PRIMARY KEY (ranker_id, data_time)
    );

    CREATE TABLE IF NOT EXISTS squad_profile_cache (
      snapshot_id INTEGER NOT NULL,
      ranker_id INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      PRIMARY KEY (snapshot_id, ranker_id),
      FOREIGN KEY (snapshot_id, ranker_id)
        REFERENCES ranking_entries(snapshot_id, ranker_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS backend_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      level TEXT NOT NULL CHECK (level IN ('정보', '경고', '오류', '성공')),
      component TEXT NOT NULL,
      message TEXT NOT NULL,
      details_json TEXT
    );

    CREATE TABLE IF NOT EXISTS community_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      login_id TEXT NOT NULL UNIQUE COLLATE NOCASE,
      nickname TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS community_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES community_users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS community_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      author_id INTEGER NOT NULL REFERENCES community_users(id),
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      view_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS community_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
      author_id INTEGER NOT NULL REFERENCES community_users(id),
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS ranking_entries_filter_idx
      ON ranking_entries(snapshot_id, rank, primary_team_color);
    CREATE INDEX IF NOT EXISTS lineup_players_pick_idx
      ON lineup_players(snapshot_id, position_id, spid, grade);
    CREATE INDEX IF NOT EXISTS ranking_history_time_idx
      ON ranking_history(data_time);
    CREATE INDEX IF NOT EXISTS ranking_history_ranker_idx
      ON ranking_history(ranker_id, data_time);
    CREATE INDEX IF NOT EXISTS backend_logs_created_idx
      ON backend_logs(created_at DESC);
    CREATE INDEX IF NOT EXISTS community_sessions_expiry_idx
      ON community_sessions(expires_at);
    CREATE INDEX IF NOT EXISTS community_posts_created_idx
      ON community_posts(created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS community_comments_post_idx
      ON community_comments(post_id, created_at, id);
  `);

  const playerMetadataColumns = new Set(
    db.prepare("PRAGMA table_info(player_metadata)").all().map((column) => column.name),
  );
  if (!playerMetadataColumns.has("image_url")) {
    db.exec("ALTER TABLE player_metadata ADD COLUMN image_url TEXT");
  }
  if (!playerMetadataColumns.has("image_checked_at")) {
    db.exec("ALTER TABLE player_metadata ADD COLUMN image_checked_at TEXT");
  }
}

export function transaction(callback) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = callback();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function getActiveSnapshot() {
  return db.prepare(`
    SELECT s.*
    FROM snapshots s
    JOIN app_state a ON a.key = 'active_snapshot_id' AND a.value = CAST(s.id AS TEXT)
    WHERE s.status = 'active'
  `).get() || null;
}

export function createSnapshot(dataTime) {
  const result = db.prepare(`
    INSERT INTO snapshots (data_time, started_at, status, stage)
    VALUES (?, ?, 'building', 'ranking')
  `).run(dataTime, new Date().toISOString());
  return Number(result.lastInsertRowid);
}

export function updateSnapshot(id, fields) {
  const allowed = ["stage", "ranking_count", "lineup_count", "failure_count", "error_message"];
  const entries = Object.entries(fields).filter(([key]) => allowed.includes(key));
  if (entries.length === 0) return;
  const set = entries.map(([key]) => `${key} = ?`).join(", ");
  db.prepare(`UPDATE snapshots SET ${set} WHERE id = ?`).run(...entries.map(([, value]) => value), id);
}

export function failSnapshot(id, error) {
  db.prepare(`
    UPDATE snapshots
    SET status = 'failed', stage = 'failed', completed_at = ?, error_message = ?
    WHERE id = ?
  `).run(new Date().toISOString(), String(error?.message || error).slice(0, 2000), id);
}

export function failAbandonedSnapshots() {
  const result = db.prepare(`
    UPDATE snapshots
    SET status = 'failed', stage = 'failed', completed_at = ?,
        error_message = 'Backend stopped before collection completed.'
    WHERE status = 'building'
  `).run(new Date().toISOString());
  return Number(result.changes);
}

export function acquireCollectionLock(owner) {
  return transaction(() => {
    const current = db.prepare("SELECT value FROM app_state WHERE key = 'collection_lock'").get();
    if (current) {
      try {
        const lock = JSON.parse(current.value);
        const age = Date.now() - Number(lock.acquiredAt || 0);
        let processAlive = false;
        if (Number.isInteger(lock.pid) && lock.pid > 0) {
          try {
            process.kill(lock.pid, 0);
            processAlive = true;
          } catch {}
        }
        if (processAlive && age < 6 * 60 * 60 * 1000) return false;
      } catch {}
      db.prepare("DELETE FROM app_state WHERE key = 'collection_lock'").run();
    }
    db.prepare("INSERT INTO app_state (key, value) VALUES ('collection_lock', ?)").run(JSON.stringify({
      owner,
      pid: process.pid,
      acquiredAt: Date.now(),
    }));
    return true;
  });
}

export function releaseCollectionLock(owner) {
  const current = db.prepare("SELECT value FROM app_state WHERE key = 'collection_lock'").get();
  if (!current) return;
  try {
    if (JSON.parse(current.value).owner !== owner) return;
  } catch {
    return;
  }
  db.prepare("DELETE FROM app_state WHERE key = 'collection_lock'").run();
}

export function promoteSnapshot(id) {
  transaction(() => {
    const current = getActiveSnapshot();
    if (current) {
      db.prepare("UPDATE snapshots SET status = 'retained' WHERE id = ?").run(current.id);
    }

    db.prepare(`
      UPDATE snapshots
      SET status = 'active', stage = 'complete', completed_at = ?
      WHERE id = ? AND status = 'building'
    `).run(new Date().toISOString(), id);

    db.prepare(`
      INSERT INTO app_state (key, value) VALUES ('active_snapshot_id', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(String(id));

    db.prepare(`
      INSERT OR REPLACE INTO ranking_history (ranker_id, data_time, rank, club_value, win_rate)
      SELECT e.ranker_id, s.data_time, e.rank, e.club_value, e.win_rate
      FROM ranking_entries e
      JOIN snapshots s ON s.id = e.snapshot_id
      WHERE e.snapshot_id = ?
    `).run(id);

    db.prepare("DELETE FROM ranking_history WHERE datetime(data_time) < datetime('now', '-30 days')").run();

    const retained = db.prepare(`
      SELECT id FROM snapshots
      WHERE status = 'retained'
      ORDER BY completed_at DESC, id DESC
    `).all();
    for (const old of retained.slice(1)) {
      db.prepare("DELETE FROM snapshots WHERE id = ?").run(old.id);
    }
    db.prepare("DELETE FROM snapshots WHERE status = 'failed' AND started_at < datetime('now', '-24 hours')").run();
  });
}

initializeDatabase();
