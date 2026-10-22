import assert from "node:assert/strict";
import test from "node:test";
import { parseGitHubAppCallback } from "../src/features/github/callback.js";

const redirectUri = "pocketops://github/callback";

test("accepts only recognized GitHub connection results on the configured callback", () => {
  assert.equal(
    parseGitHubAppCallback(`${redirectUri}?status=connected`, redirectUri),
    "connected",
  );
  assert.equal(
    parseGitHubAppCallback(`${redirectUri}?status=cancelled`, redirectUri),
    "cancelled",
  );
  assert.equal(
    parseGitHubAppCallback(`${redirectUri}?status=failed`, redirectUri),
    "failed",
  );
});

test("rejects a callback from a different origin, port, path, or with untrusted parameters", () => {
  for (const url of [
    "pocketops://attacker/callback?status=connected",
    "pocketops://github:1234/callback?status=connected",
    "pocketops://github/other?status=connected",
    `${redirectUri}?status=connected&handoff=secret`,
    `${redirectUri}?status=connected&status=failed`,
    `${redirectUri}?status=unknown`,
  ]) {
    assert.throws(() => parseGitHubAppCallback(url, redirectUri));
  }
});
