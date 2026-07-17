import { nationName } from "./nation-metadata.mjs";

const SQUAD_MAKER_ENDPOINT = "https://fconline.nexon.com/squadmakerapi/SquadMakerProc";

export const SQUAD_MAKER_SOURCE_KIND = "squad-maker-sync-no-session-v2";

const defaultTeamStrategy = {
  defensivestyle: 1,
  defwidth: 6,
  defdepth: 6,
  offensive_style_buildup: 1,
  offensive_style_chancecreation: 1,
  offwidth: 6,
  offplayerinbox: 6,
  offcornerkick: 3,
  offfreekick: 3,
  teammentality: 3,
};

const teamColorCategories = {
  affiliation: "소속 팀컬러",
  feature: "특성 팀컬러",
  enhance: "강화 팀컬러",
};

function numberOr(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function pidFromSpid(spid) {
  const value = String(spid || "");
  return numberOr(value.slice(3), 0);
}

function playerImage(value) {
  const path = String(value || "").trim();
  if (!path) return null;
  if (/^https:\/\//i.test(path)) return path;
  if (path.startsWith("/playersAction/")) {
    return `https://fo4.dn.nexoncdn.co.kr/live/externalAssets/common${path}`;
  }
  return null;
}

function nationImage(nationId) {
  return nationId == null || nationId === ""
    ? null
    : `https://fco.dn.nexoncdn.co.kr/live/externalAssets/common/countries/largeflags/f_${nationId}.png`;
}

function playerTeamColor(value) {
  const name = String(value?.name || "").trim();
  const image = String(value?.image || "").trim();
  if (!name || !image) return null;
  return { id: String(value.id || ""), name, image };
}

export function squadMakerRequestBody(profile) {
  const players = (Array.isArray(profile?.players) ? profile.players : []).map((player) => {
    const position = String(player.position || "").trim().toLowerCase();
    return {
      role: position,
      position,
      position2: "",
      position3: "",
      state: 1,
      x: numberOr(player.x, 50),
      y: numberOr(player.y, 50),
      buildUp: numberOr(player.grade, 0),
      strategy: [],
      participation: [],
      traits: [],
      trainer: [],
      thumb_custom: "",
      pid: pidFromSpid(player.spid),
      spid: numberOr(player.spid, 0),
    };
  });
  const snapshot = {
    squadName: "",
    contents: "",
    mode: "1",
    formation: profile?.formation || "",
    coach: numberOr(profile?.coach?.id, 0),
    adap: 5,
    preset: 0,
    backcolor: null,
    ovr: { fw: 0, mf: 0, df: 0, gk: 0, total: 0 },
    players,
    teamSt: defaultTeamStrategy,
    coachinfo: null,
    totalPay: "0",
    totalPrice: "0",
    totalTeamColor: null,
  };
  return new URLSearchParams({
    strMethod: "syncsquadinfo",
    strSquadJson: JSON.stringify(snapshot),
  }).toString();
}

export function normalizeSquadMakerResponse(profile, payload) {
  if (numberOr(payload?.ResultCode, -1) !== 1 || !payload?.ResultData?.Squadinfo) {
    throw new Error(payload?.ResultMsg || "SquadMakerProc 응답에 스쿼드 정보가 없습니다.");
  }
  const squad = payload.ResultData.Squadinfo;
  const responsePlayers = new Map((Array.isArray(squad.players) ? squad.players : [])
    .map((player) => [String(player.spid), player]));
  const players = profile.players.map((player) => {
    const detail = responsePlayers.get(String(player.spid));
    if (!detail) return player;
    const nationId = detail.nationImg == null ? null : String(detail.nationImg);
    const price = String(detail.price || "").replace(/[^0-9]/g, "") || null;
    return {
      ...player,
      name: String(detail.name || player.name || "").trim() || null,
      season: String(player.season || detail.season || "").trim() || null,
      image: playerImage(detail.thumb_custom || detail.thumb),
      ovr: Number.isFinite(Number(detail.ovr)) ? Number(detail.ovr) : null,
      pay: Number.isFinite(Number(detail.pay)) ? Number(detail.pay) : null,
      price,
      nationId,
      nationName: nationName(nationId),
      nationImage: nationImage(nationId),
      affiliationTeamColor: playerTeamColor(detail.teamColor?.teamColor1),
      featureTeamColor: playerTeamColor(detail.teamColor?.teamColor2),
    };
  });
  const teamColors = Object.entries(teamColorCategories).flatMap(([category, categoryLabel]) =>
    Object.entries(squad.totalTeamColor?.[category] || {}).map(([id, color]) => ({
      id: String(id),
      category,
      categoryLabel,
      level: numberOr(color?.lv, 0),
      name: String(color?.name || "").trim(),
      effects: (Array.isArray(color?.skill) ? color.skill : []).map((skill) => {
        const type = String(skill?.type || "").trim();
        const value = String(skill?.value ?? "").trim();
        return [type, value && `+${value}`].filter(Boolean).join(" ");
      }).filter(Boolean),
      image: String(color?.image || "").trim() || null,
      playerCount: numberOr(color?.playercnt, Array.isArray(color?.playerlist) ? color.playerlist.length : 0),
      playerSpids: (Array.isArray(color?.playerlist) ? color.playerlist : []).map((spid) => String(spid)),
    })).filter((color) => color.name),
  );
  return {
    ...profile,
    sourceKind: SQUAD_MAKER_SOURCE_KIND,
    squadMakerSourceKind: SQUAD_MAKER_SOURCE_KIND,
    formation: String(squad.formation || profile.formation || "").trim() || null,
    adaptation: numberOr(squad.adap, 5),
    players,
    teamColors,
  };
}

export async function fetchSquadMakerProfile(profile, fetchImpl = fetch) {
  const body = squadMakerRequestBody(profile);
  let lastError;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetchImpl(SQUAD_MAKER_ENDPOINT, {
        method: "POST",
        headers: {
          accept: "application/json, text/plain, */*",
          "content-type": "application/x-www-form-urlencoded",
          origin: "https://fconline.nexon.com",
          referer: "https://fconline.nexon.com/squadmaker",
          "x-requested-with": "XMLHttpRequest",
        },
        body,
      });
      if (!response.ok) throw new Error(`SquadMakerProc returned ${response.status}.`);
      return normalizeSquadMakerResponse(profile, await response.json());
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** attempt));
    }
  }
  throw lastError;
}
