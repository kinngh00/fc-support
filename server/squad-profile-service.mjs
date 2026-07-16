import { db, getActiveSnapshot } from "./database.mjs";

const PROFILE_ROOT = "https://fconline.nexon.com";
const allowedImageHosts = new Set([
  "fco.dn.nexoncdn.co.kr",
  "fo4.dn.nexoncdn.co.kr",
  "ssl.nexon.com",
]);

function plainText(value = "") {
  return String(value)
    .replace(/<em>\s*\|\s*<\/em>/gi, "|")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function splitEffects(value = "") {
  return plainText(value).split("|").map((item) => item.trim()).filter(Boolean);
}

function safeImage(value) {
  if (!value) return null;
  try {
    const url = new URL(String(value), "https://fco.dn.nexoncdn.co.kr/live/externalAssets/common/");
    return url.protocol === "https:" && allowedImageHosts.has(url.hostname) ? url.href : null;
  } catch {
    return null;
  }
}

function safePlayerImage(value) {
  if (!value) return null;
  const text = String(value).trim();
  if (text.startsWith("/playersAction/")) {
    return safeImage(`https://fo4.dn.nexoncdn.co.kr/live/externalAssets/common${text}`);
  }
  return safeImage(text);
}

async function fetchText(url, headers) {
  let lastError;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(url, { headers });
      if (!response.ok) throw new Error(`FC Online squad request returned ${response.status}.`);
      return await response.text();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** attempt));
    }
  }
  throw lastError;
}

function normalizeTeamColors(totalTeamColor = {}) {
  const categoryLabels = { affiliation: "소속", feature: "특성", enhance: "강화" };
  return Object.entries(categoryLabels).flatMap(([category, categoryLabel]) =>
    Object.values(totalTeamColor?.[category] || {}).flatMap((color) => {
      const name = plainText(color?.name);
      if (!name) return [];
      return [{
        id: String(color.id || ""),
        category,
        categoryLabel,
        level: Number(color.lv || 0),
        name,
        effects: splitEffects(color.skill),
        image: safeImage(color.image),
        playerCount: Number(color.playercnt || 0),
      }];
    }),
  );
}

function normalizePayload(payload) {
  const adaptation = Math.max(0, Math.min(5, Number(payload?.adap || 0)));
  const adaptationOvrBonus = Math.max(0, 5 - adaptation);
  const starters = (Array.isArray(payload?.players) ? payload.players : [])
    .filter((player) => Number(player.state) === 0 && Number.isFinite(Number(player.x)) && Number.isFinite(Number(player.y)))
    .map((player) => ({
      spid: String(player.spid),
      name: plainText(player.name) || null,
      position: plainText(player.role || player.position).toUpperCase() || null,
      grade: Number(player.buildUp || 0),
      season: plainText(player.season) || null,
      seasonImage: null,
      image: safePlayerImage(player.thumb || player.thumb_custom),
      ovr: Number(player.ovr || 0) + adaptationOvrBonus,
      pay: Number(player.pay || 0),
      price: plainText(player.price) || null,
      nationId: plainText(player.nationImg) || null,
      nationImage: player.nationImg
        ? safeImage(`https://fco.dn.nexoncdn.co.kr/live/externalAssets/common/countries/largeflags/f_${player.nationImg}.png`)
        : null,
      x: Math.max(0, Math.min(100, Number(player.x))),
      y: Math.max(0, Math.min(100, Number(player.y))),
    }));
  const coach = payload?.coachinfo || {};
  return {
    formation: plainText(payload?.formation) || null,
    adaptation,
    players: starters,
    coach: plainText(coach.name) ? {
      id: String(coach.id || payload.coach || ""),
      name: plainText(coach.name),
      image: safeImage(coach.thumb),
      description: plainText(coach.desc) || null,
      abilities: splitEffects(coach.ability),
      formations: splitEffects(coach.formation),
    } : null,
    teamColors: normalizeTeamColors(payload?.totalTeamColor),
  };
}

function enrichPlayerMetadata(profile) {
  const metadata = db.prepare("SELECT name, season_name, season_image FROM player_metadata WHERE spid = ?");
  return {
    ...profile,
    players: profile.players.map((player) => {
      const item = metadata.get(Number(player.spid));
      return {
        ...player,
        name: item?.name || player.name,
        season: item?.season_name || player.season,
        seasonImage: safeImage(item?.season_image) || player.seasonImage || null,
      };
    }),
  };
}

async function fetchSquadProfile(nexonSn) {
  const profileUrl = `${PROFILE_ROOT}/profile/squad/popup/${encodeURIComponent(nexonSn)}`;
  const profileHtml = await fetchText(profileUrl, {
    accept: "text/html,application/xhtml+xml",
    "accept-language": "ko-KR,ko;q=0.9",
    referer: `${PROFILE_ROOT}/datacenter/rank?rt=manager`,
    "user-agent": "FC-SUPPORT/1.0",
  });
  const squadMatch = profileHtml.match(/SquadProfile\.SetSquadInfo\("(\d+)",\s*"(\d+)",\s*"[^"]+",\s*"([^"]+)"\)/i);
  if (!squadMatch) throw new Error("현재 대표팀 스쿼드 식별자를 찾지 못했습니다.");

  const parameters = new URLSearchParams({
    strTeamType: squadMatch[1],
    n1Type: squadMatch[2],
    n8NexonSN: String(nexonSn),
    strCharacterID: squadMatch[3],
  });
  const detailText = await fetchText(`${PROFILE_ROOT}/datacenter/SquadGetUserInfo?${parameters}`, {
    accept: "application/json, text/javascript, */*; q=0.01",
    "accept-language": "ko-KR,ko;q=0.9",
    referer: profileUrl,
    "user-agent": "FC-SUPPORT/1.0",
    "x-requested-with": "XMLHttpRequest",
  });
  return normalizePayload(JSON.parse(detailText));
}

export async function getSquadProfile(nickname) {
  const snapshot = getActiveSnapshot();
  if (!snapshot) return null;
  const ranker = db.prepare(`
    SELECT r.id, r.nexon_sn
    FROM ranking_entries e
    JOIN rankers r ON r.id = e.ranker_id
    WHERE e.snapshot_id = ? AND r.nickname = ? COLLATE NOCASE
    LIMIT 1
  `).get(snapshot.id, nickname);
  if (!ranker) return { snapshot, profile: null };

  const cached = db.prepare(`
    SELECT payload_json FROM squad_profile_cache
    WHERE snapshot_id = ? AND ranker_id = ?
  `).get(snapshot.id, ranker.id);
  if (cached) {
    const cachedProfile = JSON.parse(cached.payload_json);
    const needsDetailedPlayers = cachedProfile.players.some((player) =>
      player.ovr == null || player.pay == null || player.price == null || player.nationImage == null || player.image == null,
    );
    if (needsDetailedPlayers) {
      const profile = enrichPlayerMetadata(await fetchSquadProfile(ranker.nexon_sn));
      db.prepare(`UPDATE squad_profile_cache SET payload_json = ?, fetched_at = ? WHERE snapshot_id = ? AND ranker_id = ?`)
        .run(JSON.stringify(profile), new Date().toISOString(), snapshot.id, ranker.id);
      return { snapshot, profile, cached: false };
    }
    const profile = enrichPlayerMetadata(cachedProfile);
    if (profile.players.some((player, index) => player.seasonImage !== cachedProfile.players[index]?.seasonImage)) {
      db.prepare(`UPDATE squad_profile_cache SET payload_json = ?, fetched_at = ? WHERE snapshot_id = ? AND ranker_id = ?`)
        .run(JSON.stringify(profile), new Date().toISOString(), snapshot.id, ranker.id);
    }
    return { snapshot, profile, cached: true };
  }

  const profile = enrichPlayerMetadata(await fetchSquadProfile(ranker.nexon_sn));
  db.prepare(`
    INSERT OR REPLACE INTO squad_profile_cache (snapshot_id, ranker_id, payload_json, fetched_at)
    VALUES (?, ?, ?, ?)
  `).run(snapshot.id, ranker.id, JSON.stringify(profile), new Date().toISOString());
  return { snapshot, profile, cached: false };
}
