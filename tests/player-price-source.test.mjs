import assert from "node:assert/strict";
import test from "node:test";

import { parseLastRecordedPrice, playerPriceRequestBody } from "../server/player-price-source.mjs";

test("sends the actual SPID and enhancement grade", () => {
  assert.equal(playerPriceRequestBody("861001114", 1), "spid=861001114&n1Strong=1");
  assert.equal(playerPriceRequestBody("846000250", 11), "spid=846000250&n1Strong=11");
});

test("uses the last value in the price graph instead of the current price", () => {
  const html = `
    <strong alt="3,080,000,000,000">3조 800억</strong>
    <script>var json1 = { "time": ["7.15", "7.16"], "value": ["3435454545500", "3440000000000"] };</script>
  `;
  assert.equal(parseLastRecordedPrice(html), "3440000000000");
});

test("does not invent a price when the graph has no values", () => {
  assert.equal(parseLastRecordedPrice("<div>가격 기록 없음</div>"), null);
});
