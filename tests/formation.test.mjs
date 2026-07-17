import assert from "node:assert/strict";
import test from "node:test";

import { inferFormation } from "../server/formation.mjs";

test("infers 4-1-2-3 from JJC제주의 latest match starter positions", () => {
  assert.equal(inferFormation([
    "RCM", "LB", "RCB", "CDM", "RB", "RAM", "CAM", "LCM", "LCB", "LAM", "GK",
  ]), "4-1-2-3");
});

test("infers 4-2-3-1 and excludes the goalkeeper", () => {
  assert.equal(inferFormation([
    "LB", "LCB", "RCB", "RB", "LDM", "RDM", "LAM", "CAM", "RAM", "ST", "GK",
  ]), "4-2-3-1");
});

test("omits unoccupied formation lines", () => {
  assert.equal(inferFormation(["LB", "LCB", "RCB", "RB", "LCM", "RCM", "LW", "ST", "RW", "GK"]), "4-2-3");
  assert.equal(inferFormation(["GK"]), null);
});
