import { db, transaction } from "./database.mjs";
import { config } from "./config.mjs";
import { logger } from "./logger.mjs";
import { fetchAllRankings } from "./ranking-source.mjs";

logger.info("팀 마크", "현재 랭킹에서 실제 팀 마크 URL 동기화를 시작합니다.");
const rankings = await fetchAllRankings(config.rankingConcurrency);
const assets = new Map();
for (const ranking of rankings) {
  for (const color of ranking.teamColors) {
    if (color.name && color.image) assets.set(color.name, color.image);
  }
}

const now = new Date().toISOString();
transaction(() => {
  const upsert = db.prepare(`
    INSERT INTO team_color_assets (name, image_url, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET image_url = excluded.image_url, updated_at = excluded.updated_at
  `);
  for (const [name, image] of assets) upsert.run(name, image, now);
});
logger.success("팀 마크", "실제 팀 마크 URL 동기화를 완료했습니다.", { count: assets.size });
console.log(JSON.stringify({ count: assets.size }, null, 2));
