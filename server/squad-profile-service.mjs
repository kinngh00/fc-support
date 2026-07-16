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

const positionCoordinates = {
  GK: [50, 2], SW: [50, 10],
  LWB: [8, 24], LB: [12, 19], LCB: [35, 15], CB: [50, 15], RCB: [65, 15], RB: [88, 19], RWB: [92, 24],
  LDM: [35, 34], CDM: [50, 31], RDM: [65, 34],
  LM: [12, 50], LCM: [35, 50], CM: [50, 50], RCM: [65, 50], RM: [88, 50],
  LAM: [25, 67], CAM: [50, 67], RAM: [75, 67],
  LW: [12, 82], LF: [30, 80], CF: [50, 82], RF: [70, 80], RW: [88, 82],
  LS: [38, 88], ST: [50, 90], RS: [62, 88],
};

function latestMatchProfile(snapshotId, rankerId, matchId, profile) {
  const matchPlayers = db.prepare(`
    SELECT l.slot, l.spid, l.grade, l.position_id, l.rating, l.goals, l.assists,
           p.name, p.season_name, p.season_image, pos.name AS position
    FROM lineup_players l
    LEFT JOIN player_metadata p ON p.spid = l.spid
    LEFT JOIN position_metadata pos ON pos.position_id = l.position_id
    WHERE l.snapshot_id = ? AND l.ranker_id = ?
    ORDER BY l.slot ASC
  `).all(snapshotId, rankerId);
  if (matchPlayers.length === 0) return {
    ...profile,
    sourceKind: "latest-manager-match",
    sourceMatchId: matchId || null,
  };

  const currentPlayers = Array.isArray(profile?.players) ? profile.players : [];
  return {
    ...profile,
    sourceKind: "latest-manager-match",
    sourceMatchId: matchId || null,
    players: matchPlayers.map((matchPlayer) => {
      const spid = String(matchPlayer.spid);
      const grade = Number(matchPlayer.grade || 0);
      const current = currentPlayers.find((player) => String(player.spid) === spid) || null;
      const exactGrade = current && Number(current.grade) === grade;
      const exactPosition = exactGrade && current.position === matchPlayer.position;
      const [x, y] = positionCoordinates[matchPlayer.position] || [50, 50];
      return {
        spid,
        name: matchPlayer.name || current?.name || null,
        position: matchPlayer.position || null,
        grade,
        season: matchPlayer.season_name || current?.season || null,
        seasonImage: safeImage(matchPlayer.season_image) || current?.seasonImage || null,
        image: current?.image || null,
        ovr: exactPosition ? current.ovr : null,
        pay: current?.pay ?? null,
        price: exactGrade ? current.price : null,
        nationId: current?.nationId || null,
        nationImage: current?.nationImage || null,
        x,
        y,
        rating: matchPlayer.rating == null ? null : Number(matchPlayer.rating),
        goals: matchPlayer.goals == null ? null : Number(matchPlayer.goals),
        assists: matchPlayer.assists == null ? null : Number(matchPlayer.assists),
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
    SELECT r.id, r.nexon_sn, e.match_id
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
    const needsLatestMatchPlayers = cachedProfile.sourceKind !== "latest-manager-match"
      || cachedProfile.sourceMatchId !== (ranker.match_id || null);
    const needsDetailedPlayers = needsLatestMatchPlayers;
    if (needsDetailedPlayers) {
      const currentProfile = enrichPlayerMetadata(await fetchSquadProfile(ranker.nexon_sn));
      const profile = latestMatchProfile(snapshot.id, ranker.id, ranker.match_id, currentProfile);
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

  const currentProfile = enrichPlayerMetadata(await fetchSquadProfile(ranker.nexon_sn));
  const profile = latestMatchProfile(snapshot.id, ranker.id, ranker.match_id, currentProfile);
  db.prepare(`
    INSERT OR REPLACE INTO squad_profile_cache (snapshot_id, ranker_id, payload_json, fetched_at)
    VALUES (?, ?, ?, ?)
  `).run(snapshot.id, ranker.id, JSON.stringify(profile), new Date().toISOString());
  return { snapshot, profile, cached: false };
}
