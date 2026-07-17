import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchSquadMakerProfile,
  normalizeSquadMakerResponse,
  squadMakerRequestBody,
  SQUAD_MAKER_SOURCE_KIND,
} from "../server/squad-maker-source.mjs";

const actualSquadPlayer = {
  spid: "845239301",
  name: "L. 마르티네스",
  position: "LB",
  grade: 11,
  season: "CH (Continental Heroes)",
  seasonImage: "https://ssl.nexon.com/s2/game/fc/online/obt/externalAssets/new/season/ch.png",
  image: null,
  ovr: null,
  pay: null,
  price: null,
  nationId: null,
  nationImage: null,
  x: 12,
  y: 19,
};

const actualProfile = {
  formation: "4-1-2-3",
  coach: { id: "272689", name: "루이스 데라푸엔테" },
  players: [actualSquadPlayer],
  teamColors: [],
};

const successfulPayload = {
  ResultCode: 1,
  ResultMsg: "성공",
  ResultData: {
    Squadinfo: {
      formation: "4-1-2-3",
      adap: 5,
      players: [{
        spid: 845239301,
        name: "L. 마르티네스",
        season: "CH",
        thumb_custom: "/playersAction/p239301_25.png?rd=202607170350",
        ovr: 149,
        pay: 28,
        price: "35,600,000,000,000,000",
        nationImg: 52,
        teamColor: {
          teamColor1: { id: 1005, name: "맨체스터 유나이티드", image: "https://fco.dn.nexoncdn.co.kr/live/externalAssets/common/crests/light/medium/l11.png" },
          teamColor2: { id: 40577, name: "레드데블스 전설의 듀오", image: "https://fco.dn.nexoncdn.co.kr/live/externalAssets/common/teamcolorboost/icon/medium/4_l11.png" },
        },
      }],
      totalTeamColor: {
        affiliation: {
          1005: {
            lv: 4,
            name: "맨체스터 유나이티드",
            skill: [{ type: "전체 능력치", value: 4 }],
            image: "https://fco.dn.nexoncdn.co.kr/live/externalAssets/common/crests/light/medium/l11.png",
            playercnt: 11,
          },
        },
        feature: {
          40577: {
            lv: 1,
            name: "레드데블스 전설의 듀오",
            skill: [{ type: "가속력", value: 1 }],
            image: "https://fco.dn.nexoncdn.co.kr/live/externalAssets/common/teamcolorboost/icon/medium/4_l11.png",
            playercnt: 2,
            playerlist: [852230025, 850226764],
          },
        },
        enhance: {},
      },
    },
  },
};

test("sends the stored real squad fields in the session-free sync request", () => {
  const parameters = new URLSearchParams(squadMakerRequestBody(actualProfile));
  assert.equal(parameters.get("strMethod"), "syncsquadinfo");
  const snapshot = JSON.parse(parameters.get("strSquadJson"));
  assert.deepEqual(snapshot.players[0], {
    role: "lb",
    position: "lb",
    position2: "",
    position3: "",
    state: 1,
    x: 12,
    y: 19,
    buildUp: 11,
    strategy: [],
    participation: [],
    traits: [],
    trainer: [],
    thumb_custom: "",
    pid: 239301,
    spid: 845239301,
  });
});

test("does not send cookies or credentials", async () => {
  let request;
  const result = await fetchSquadMakerProfile(actualProfile, async (url, options) => {
    request = { url, options };
    return { ok: true, json: async () => successfulPayload };
  });
  assert.equal(request.options.headers.cookie, undefined);
  assert.equal(request.options.credentials, undefined);
  assert.equal(result.sourceKind, SQUAD_MAKER_SOURCE_KIND);
});

test("applies player details and active team colors from the response", () => {
  const result = normalizeSquadMakerResponse(actualProfile, successfulPayload);
  assert.equal(result.players[0].position, "LB");
  assert.equal(result.players[0].ovr, 149);
  assert.equal(result.players[0].pay, 28);
  assert.equal(result.players[0].price, "35600000000000000");
  assert.equal(result.players[0].nationId, "52");
  assert.equal(result.players[0].nationName, "아르헨티나");
  assert.deepEqual(result.players[0].affiliationTeamColor, {
    id: "1005",
    name: "맨체스터 유나이티드",
    image: "https://fco.dn.nexoncdn.co.kr/live/externalAssets/common/crests/light/medium/l11.png",
  });
  assert.deepEqual(result.players[0].featureTeamColor, {
    id: "40577",
    name: "레드데블스 전설의 듀오",
    image: "https://fco.dn.nexoncdn.co.kr/live/externalAssets/common/teamcolorboost/icon/medium/4_l11.png",
  });
  assert.equal(result.players[0].image, "https://fo4.dn.nexoncdn.co.kr/live/externalAssets/common/playersAction/p239301_25.png?rd=202607170350");
  assert.deepEqual(result.teamColors[0], {
    id: "1005",
    category: "affiliation",
    categoryLabel: "소속 팀컬러",
    level: 4,
    name: "맨체스터 유나이티드",
    effects: ["전체 능력치 +4"],
    image: "https://fco.dn.nexoncdn.co.kr/live/externalAssets/common/crests/light/medium/l11.png",
    playerCount: 11,
    playerSpids: [],
  });
  assert.deepEqual(result.teamColors[1].playerSpids, ["852230025", "850226764"]);
});
