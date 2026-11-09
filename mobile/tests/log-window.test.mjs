import assert from "node:assert/strict";
import { test } from "node:test";
import { createLogWindow } from "../src/features/deployments/log-window.js";

test("log windows remain exactly one hour when the clock advances between reads", (t) => {
  let now = Date.parse("2026-10-30T09:39:48.793Z");
  let reads = 0;
  t.mock.method(Date, "now", () => {
    reads++;
    return now++;
  });
  const initial = createLogWindow();
  const refreshed = createLogWindow();
  assert.equal(reads, 2);
  for (const window of [initial, refreshed]) {
    assert.equal(Date.parse(window.to) - Date.parse(window.from), 3600000);
  }
  assert.notEqual(initial.to, refreshed.to);
});
