import { config, requireApiKeys } from "./config.mjs";
import { db } from "./database.mjs";
import { getRankerOuid } from "./queries.mjs";
import { latestManagerMatchPath, mapWithKeyPool, matchDetailPath, nexonJson } from "./nexon-api.mjs";

const selectPlayerMetadata = db.prepare("SELECT name, season_name, season_image FROM player_metadata WHERE spid = ?");
const selectPositionMetadata = db.prepare("SELECT name FROM position_metadata WHERE position_id = ?");

function participantSummary(participant) {
  if (!participant) return null;
  const detail = participant.matchDetail || {};
  const shoot = participant.shoot || {};
  const pass = participant.pass || {};
  return {
    nickname: participant.nickname,
    result: detail.matchResult || null,
    score: Number(shoot.goalTotalDisplay ?? shoot.goalTotal ?? 0),
    possession: Number(detail.possession ?? 0),
    shots: Number(shoot.shootTotal ?? 0),
    effectiveShots: Number(shoot.effectiveShootTotal ?? 0),
    passTry: Number(pass.passTry ?? 0),
    passSuccess: Number(pass.passSuccess ?? 0),
    fouls: Number(detail.foul ?? 0),
    corners: Number(detail.cornerKick ?? 0),
    yellowCards: Number(detail.yellowCards ?? 0),
    redCards: Number(detail.redCards ?? 0),
  };
}

function playerSummary(player) {
  const spid = Number(player.spId);
  const metadata = selectPlayerMetadata.get(spid);
  const position = selectPositionMetadata.get(Number(player.spPosition));
  return {
    spid: String(spid),
    name: metadata?.name || null,
    season: metadata?.season_name || null,
    seasonImage: metadata?.season_image || null,
    position: position?.name || null,
    grade: Number(player.spGrade ?? 0),
    status: player.status || null,
  };
}

function matchSummary(detail, ouid) {
  const participants = Array.isArray(detail?.matchInfo) ? detail.matchInfo : [];
  const self = participants.find((item) => item.ouid === ouid);
  const opponent = participants.find((item) => item.ouid !== ouid);
  return {
    matchId: String(detail.matchId),
    matchDate: detail.matchDate,
    self: participantSummary(self),
    opponent: participantSummary(opponent),
    players: {
      self: (self?.player || []).filter((player) => Number(player.spPosition) >= 0 && Number(player.spPosition) <= 27).map(playerSummary),
      opponent: (opponent?.player || []).filter((player) => Number(player.spPosition) >= 0 && Number(player.spPosition) <= 27).map(playerSummary),
    },
  };
}

export async function listRecentMatches({ nickname, offset, limit }) {
  const keys = requireApiKeys();
  const ouid = getRankerOuid(nickname);
  if (!ouid) return null;
  const matchIds = await nexonJson(latestManagerMatchPath(ouid, offset, limit), keys[offset % keys.length]);
  const ids = Array.isArray(matchIds) ? matchIds.map(String) : [];
  const results = await mapWithKeyPool(
    ids,
    keys,
    Math.min(config.apiConcurrencyPerKey, 2),
    (matchId, key) => nexonJson(matchDetailPath(matchId), key),
  );
  const items = results
    .filter((result) => result.ok)
    .map((result) => matchSummary(result.value, ouid));
  return {
    items,
    offset,
    limit,
    hasMore: ids.length === limit,
    failedCount: results.length - items.length,
  };
}
