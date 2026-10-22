import assert from "node:assert/strict";
import test from "node:test";
import {
  createCompletionSecret,
  parseAuthCallback,
  pendingSessionStorageKey,
  protectedRouteAction,
  sessionStorageKey,
  shouldRotateSession,
} from "../src/features/auth/session.js";

test("creates a 256-bit hexadecimal completion secret from secure random bytes", () => {
  const bytes = Uint8Array.from({ length: 32 }, (_value, index) => index);
  const secret = createCompletionSecret(bytes);
  assert.equal(secret.length, 64);
  assert.match(secret, /^[a-f0-9]{64}$/);
  assert.throws(() => createCompletionSecret(new Uint8Array(16)));
});

test("accepts only the exact allowlisted app callback and a single-use handoff", () => {
  const handoff = "h".repeat(43);
  assert.deepEqual(
    parseAuthCallback(
      `pocketops://auth/callback?handoff=${handoff}`,
      "pocketops://auth/callback",
    ),
    { handoffCode: handoff, error: null },
  );
  assert.throws(
    () =>
      parseAuthCallback(
        `pocketops://attacker/callback?handoff=${handoff}`,
        "pocketops://auth/callback",
      ),
    /did not match this app/,
  );
  assert.throws(
    () =>
      parseAuthCallback(
        `pocketops://auth/callback?handoff=${"x".repeat(43)}&error=access_denied`,
        "pocketops://auth/callback",
      ),
    /callback is invalid/,
  );
});

test("maps only known provider failures and rejects untrusted callback errors", () => {
  assert.deepEqual(
    parseAuthCallback(
      "pocketops://auth/callback?error=access_denied",
      "pocketops://auth/callback",
    ),
    { handoffCode: null, error: "access_denied" },
  );
  assert.throws(
    () =>
      parseAuthCallback(
        "pocketops://auth/callback?error=https%3A%2F%2Fattacker.example",
        "pocketops://auth/callback",
      ),
    /callback is invalid/,
  );
});

test("uses separate SecureStore keys for active and recoverable rotation tokens", () => {
  assert.notEqual(sessionStorageKey, pendingSessionStorageKey);
  const now = Date.parse("2026-10-22T00:00:00.000Z");
  assert.equal(
    shouldRotateSession("2026-10-28T00:00:00.000Z", now),
    true,
  );
  assert.equal(
    shouldRotateSession("2026-11-20T00:00:00.000Z", now),
    false,
  );
  assert.equal(shouldRotateSession("invalid", now), false);
});

test("holds protected tabs until session restoration has resolved", () => {
  assert.equal(protectedRouteAction("starting"), "loading");
  assert.equal(protectedRouteAction("authenticated"), "render");
  assert.equal(protectedRouteAction("failed"), "retry");
  assert.equal(protectedRouteAction("signed_out"), "sign_in");
  assert.equal(protectedRouteAction("expired"), "sign_in");
});
