import assert from "node:assert/strict";
import test from "node:test";
import { createAuthLifecycle } from "../src/features/auth/lifecycle.js";
import { sessionStorageKey as activeKey, pendingSessionStorageKey as pendingKey } from "../src/features/auth/session.js";
const url = `pocketops://auth/callback?handoff=${"h".repeat(43)}`;
const identity = { user: { id: "user-current" }, session: { id: "session-current", expiresAt: "2099-01-01T00:00:00Z" } };
const denied = () => Object.assign(new Error("Session invalid"), { code: "UNAUTHENTICATED", status: 401 });
const unavailable = () => Object.assign(new Error("Offline"), { code: "NETWORK_ERROR" });
function deferred() { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture(initial = {}) {
  const values = new Map(Object.entries(initial)); const calls = []; const opened = deferred(); const browser = deferred();
  let state; let handler;
  const storage = { async getItemAsync(key) { return values.get(key) || null; }, async setItemAsync(key, value) { values.set(key, value); }, async deleteItemAsync(key) { values.delete(key); } };
  const f = { values, calls, opened, browser, storage, redirect: "pocketops://auth/callback", browserCalls: 0, dismissThrows: false,
    get state() { return state; }, setHandler(next) { handler = next; } };
  const request = async (path, options = {}) => { calls.push({ path, ...options }); if (handler) return handler(path, options);
    if (path === "/auth/mobile/start") return { data: { authorizationUrl: "https://api.example.test/api/v1/auth/github?state=fixture" } };
    if (path === "/auth/mobile/exchange") return { data: { token: "new-session-token", ...identity } };
    if (path === "/auth/me") return { data: identity };
    if (path === "/auth/logout") return { data: { loggedOut: true } };
    throw new Error("Unexpected path"); };
  f.controller = createAuthLifecycle({ storage, request, randomBytes: async () => new Uint8Array(32).fill(3), createRedirect: () => f.redirect,
    openSession: async () => { f.browserCalls += 1; opened.resolve(); return browser.promise; }, dismissBrowser: async () => { if (f.dismissThrows) throw new Error("No browser"); }, onChange: (next) => { state = typeof next === "function" ? next(state) : next; } });
  f.start = async () => { await f.controller.restoreSession(); const promise = f.controller.beginGithubLogin(); await opened.promise; return { promise }; };
  return f;
}

test("browser and native deep-link callbacks share one exchange, including a simultaneous browser dismissal", async () => {
  const f = fixture(); const exchange = deferred();
  f.setHandler(async (path) => path === "/auth/mobile/start" ? { data: { authorizationUrl: "https://api.example.test/auth" } } : exchange.promise);
  const { promise: login } = await f.start();
  const one = f.controller.completeCallbackUrl(url); const two = f.controller.completeCallbackUrl(url);
  assert.equal(one, two); assert.equal(f.state.status, "exchanging");
  f.browser.resolve({ type: "dismiss" }); exchange.resolve({ data: { token: "new-session-token", ...identity } });
  await Promise.all([one, two, login]);
  assert.equal(f.state.status, "authenticated"); assert.equal(f.calls.filter((c) => c.path === "/auth/mobile/exchange").length, 1);
  await f.controller.completeCallbackUrl(url); assert.equal(f.calls.filter((c) => c.path === "/auth/mobile/exchange").length, 1);
});

test("canceling an in-flight exchange cannot authenticate later and its issued session is revoked", async () => {
  const f = fixture(); const exchange = deferred();
  f.setHandler(async (path) => path === "/auth/mobile/start" ? { data: { authorizationUrl: "https://api.example.test/auth" } } : path === "/auth/mobile/exchange" ? exchange.promise : { data: { loggedOut: true } });
  const { promise: login } = await f.start(); const callback = f.controller.completeCallbackUrl(url);
  f.dismissThrows = true; await f.controller.cancelGithubLogin();
  f.browser.resolve({ type: "success", url }); exchange.resolve({ data: { token: "canceled-session", ...identity } });
  await Promise.all([callback, login]);
  assert.equal(f.state.status, "signed_out"); assert.equal(f.values.has(activeKey), false);
  assert.ok(f.calls.some((c) => c.path === "/auth/logout" && c.token === "canceled-session"));
});

test("repeated login taps open one browser and old pending rotation credentials cannot override the new login", async () => {
  const f = fixture(); await f.controller.restoreSession(); f.values.set(pendingKey, "old-user-rotation");
  const login = f.controller.beginGithubLogin(); await f.controller.beginGithubLogin(); await f.opened.promise;
  assert.equal(f.browserCalls, 1); f.browser.resolve({ type: "success", url }); await login;
  assert.equal(f.values.get(activeKey), "new-session-token"); assert.equal(f.values.has(pendingKey), false);
  assert.equal(f.state.status, "authenticated");
});

test("a lost rotation response is recovered from the pending SecureStore token without replaying rotation", async () => {
  const f = fixture({ [activeKey]: "old-token" }); let rotated = false;
  f.setHandler(async (path, options) => {
    if (path === "/auth/session/rotate") { rotated = true; throw unavailable(); }
    if (path === "/auth/me" && options.token === "old-token") return { data: { ...identity, session: { ...identity.session, expiresAt: new Date(Date.now() + 1000).toISOString() } } };
    if (path === "/auth/me" && rotated) return { data: identity };
    throw new Error("Unexpected request");
  });
  await f.controller.restoreSession(); assert.equal(f.state.status, "failed"); const pending = f.values.get(pendingKey); assert.ok(pending);
  await f.controller.restoreSession(); assert.equal(f.state.status, "authenticated"); assert.equal(f.values.get(activeKey), pending); assert.equal(f.values.has(pendingKey), false);
  assert.equal(f.calls.filter((c) => c.path === "/auth/session/rotate").length, 1);
});

test("restoration is single-flight and a stale restore response cannot undo logout", async () => {
  const f = fixture({ [activeKey]: "old-token" }); const me = deferred();
  f.setHandler(async (path) => path === "/auth/me" ? me.promise : { data: {} });
  const one = f.controller.restoreSession(); const two = f.controller.restoreSession(); assert.equal(one, two);
  // The storage read is itself serialized; let the first identity read start.
  for (let i = 0; i < 10 && !f.calls.length; i += 1) await Promise.resolve();
  await f.controller.logout(); me.resolve({ data: identity }); await one;
  assert.equal(f.state.status, "signed_out"); assert.equal(f.values.has(activeKey), false); assert.equal(f.calls.filter((c) => c.path === "/auth/me").length, 1);
});

test("a stale 401 expiry handler cannot erase a newer session", async () => {
  const f = fixture({ [activeKey]: "new-token", [pendingKey]: "pending-new-token" });
  await f.controller.onExpired("old-token"); assert.equal(f.values.get(activeKey), "new-token"); assert.equal(f.values.get(pendingKey), "pending-new-token");
});

test("logout revokes active and pending credentials, including a pending-only recoverable session", async () => {
  for (const initial of [{ [activeKey]: "old", [pendingKey]: "new" }, { [pendingKey]: "new" }]) {
    const f = fixture(initial); await f.controller.logout();
    assert.equal(f.state.status, "signed_out"); assert.equal(f.values.size, 0);
    assert.equal(f.calls.filter((c) => c.path === "/auth/logout").length, Object.keys(initial).length);
  }
});

test("restore preserves credentials on network failures and clears both when sessions are conclusively expired", async () => {
  const f = fixture({ [activeKey]: "expired", [pendingKey]: "also-expired" }); f.setHandler(async () => { throw unavailable(); });
  await f.controller.restoreSession(); assert.equal(f.state.status, "failed"); assert.equal(f.values.size, 2);
  f.setHandler(async () => { throw denied(); }); await f.controller.restoreSession(); assert.equal(f.state.status, "expired"); assert.equal(f.values.size, 0);
});

test("SecureStore failure after exchange revokes and discards the issued token", async () => {
  const f = fixture(); const { promise: login } = await f.start(); const original = f.storage.setItemAsync;
  f.storage.setItemAsync = async (key, value) => { await original(key, value); throw new Error("SecureStore write interrupted"); };
  f.browser.resolve({ type: "success", url }); await login;
  assert.equal(f.state.status, "failed"); assert.equal(f.values.has(activeKey), false);
  assert.ok(f.calls.some((c) => c.path === "/auth/logout" && c.token === "new-session-token"));
});

test("Expo Go or a mismatched app scheme fails with actionable setup guidance before sending credentials", async () => {
  const f = fixture(); f.redirect = "exp://192.0.2.1/--/auth/callback";
  await f.controller.restoreSession(); await f.controller.beginGithubLogin(); assert.equal(f.state.status, "failed"); assert.match(f.state.message, /development build/); assert.equal(f.calls.length, 0);
});

test("malformed callbacks do not consume the active attempt; expired process callbacks require a fresh login", async () => {
  const f = fixture(); await assert.rejects(f.controller.completeCallbackUrl(url), /no longer active/);
  const { promise: login } = await f.start();
  await assert.rejects(f.controller.completeCallbackUrl(`${url}&handoff=forged`)); assert.equal(f.state.status, "awaiting_callback");
  f.browser.resolve({ type: "success", url }); await login; assert.equal(f.state.status, "authenticated");
});

test("stale missing-token expiry cannot cancel an active login and late cancel cannot sign out a completed login", async () => {
  const f = fixture(); const { promise: login } = await f.start();
  await f.controller.onExpired(null); assert.equal(f.state.status, "awaiting_callback");
  f.browser.resolve({ type: "success", url }); await login; await f.controller.cancelGithubLogin();
  assert.equal(f.state.status, "authenticated"); assert.equal(f.values.get(activeKey), "new-session-token");
});

test("cancellation during a pending SecureStore write removes the canceled session after the write settles", async () => {
  const f = fixture(); const { promise: login } = await f.start(); const entered = deferred(); const release = deferred();
  f.storage.setItemAsync = async (key, value) => { f.values.set(key, value); entered.resolve(); await release.promise; };
  const callback = f.controller.completeCallbackUrl(url); await entered.promise; await f.controller.cancelGithubLogin();
  release.resolve(); f.browser.resolve({ type: "dismiss" }); await Promise.all([callback, login]);
  assert.equal(f.state.status, "signed_out"); assert.equal(f.values.has(activeKey), false);
});

test("new login deletes the previous rotation journal before committing the new account token", async () => {
  const f = fixture(); const { promise: login } = await f.start(); f.values.set(pendingKey, "previous-account-pending");
  const mutations = []; const set = f.storage.setItemAsync; const remove = f.storage.deleteItemAsync;
  f.storage.setItemAsync = async (key, value) => { mutations.push(`set:${key}`); return set(key, value); };
  f.storage.deleteItemAsync = async (key) => { mutations.push(`delete:${key}`); return remove(key); };
  f.browser.resolve({ type: "success", url }); await login;
  assert.deepEqual(mutations.slice(0, 2), [`delete:${pendingKey}`, `set:${activeKey}`]);
});
