import assert from "node:assert/strict";
import test from "node:test";

process.env.FC_DB_PATH = `work/test-player-images-${process.pid}.db`;
process.env.FC_SCHEDULER_ENABLED = "false";
process.env.FC_COLLECT_ON_EMPTY = "false";

const { parsePlayerAbilityImage } = await import("../server/player-image-service.mjs");

test("extracts Nexon's high-resolution PID image including its variant suffix", () => {
  const html = `
    <input type="hidden" name="hidPlayerCustImg"
      value="https://fo4.dn.nexoncdn.co.kr/live/externalAssets/common/playersAction/p239301_25.png" />
    <img src="https://fo4.dn.nexoncdn.co.kr/live/externalAssets/common/playersActionHigh/p239301_25.png?rd=202607161120">
  `;
  assert.equal(
    parsePlayerAbilityImage(html),
    "https://fo4.dn.nexoncdn.co.kr/live/externalAssets/common/playersActionHigh/p239301_25.png?rd=202607161120",
  );
});

test("rejects image locations outside Nexon's player CDN", () => {
  assert.equal(parsePlayerAbilityImage('<img src="https://example.com/playersActionHigh/p239301_25.png">'), null);
});
