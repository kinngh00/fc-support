import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

test("portfolio metrics use only the active snapshot and never invent collection values", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "fc-support-metrics-"));
  process.env.FC_DB_PATH = path.join(directory, "metrics.db");
  process.env.FC_SCHEDULER_ENABLED = "false";
  const { db } = await import("../server/database.mjs");
  const { portfolioMetrics } = await import("../server/queries.mjs");

  const empty = portfolioMetrics();
  assert.equal(empty.snapshot, null);
  assert.equal(empty.collection, null);
  assert.deepEqual(empty.community, { members: 0, posts: 0, comments: 0 });

  const inserted = db.prepare(`
    INSERT INTO snapshots (
      data_time, started_at, completed_at, status, stage,
      ranking_count, lineup_count, failure_count
    ) VALUES (?, ?, ?, 'active', 'complete', ?, ?, ?)
  `).run(
    "2026-07-18T22:00:00+09:00",
    "2026-07-18T13:05:00.000Z",
    "2026-07-18T13:10:30.000Z",
    10000,
    98765,
    25,
  );
  db.prepare("INSERT INTO app_state (key, value) VALUES ('active_snapshot_id', ?)").run(String(inserted.lastInsertRowid));

  const actual = portfolioMetrics();
  assert.equal(actual.snapshot.id, Number(inserted.lastInsertRowid));
  assert.equal(actual.collection.rankingCount, 10000);
  assert.equal(actual.collection.lineupCount, 98765);
  assert.equal(actual.collection.failureCount, 25);
  assert.equal(actual.collection.successfulCount, 9975);
  assert.equal(actual.collection.successRate, 99.75);
  assert.equal(actual.collection.durationSeconds, 330);

  db.close();
  rmSync(directory, { recursive: true, force: true });
});
