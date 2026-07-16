import assert from "node:assert/strict";
import test from "node:test";
import { expectedKstDataTime, inspectSnapshotFreshness } from "../server/freshness.mjs";

test("uses the previous hour before the KST five-minute collection point", () => {
  assert.equal(expectedKstDataTime(new Date("2026-07-16T08:03:00Z")), "2026-07-16T16:00:00+09:00");
});

test("uses the current hour after the KST five-minute collection point", () => {
  assert.equal(expectedKstDataTime(new Date("2026-07-16T08:30:00Z")), "2026-07-16T17:00:00+09:00");
});

test("marks an older snapshot stale", () => {
  const result = inspectSnapshotFreshness(
    { data_time: "2026-07-16T13:00:00+09:00" },
    new Date("2026-07-16T08:30:00Z"),
  );
  assert.equal(result.fresh, false);
  assert.equal(result.expectedDataTime, "2026-07-16T17:00:00+09:00");
});
