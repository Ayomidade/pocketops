import assert from "node:assert/strict";
import { test } from "node:test";
import { createEditorDraftStore, editorDraftTtlMs } from "../src/features/editor/drafts.js";
import { createEditorBridge, editorMaximumContentBytes, editorMaximumMessageBytes, isAllowedEditorNavigation } from "../src/features/editor/protocol.js";

test("bridge validates versioned payloads and correlates document replies exactly once", () => {
  const sent = [];
  const received = [];
  const rejected = [];
  const bridge = createEditorBridge({
    sessionId: "session-123",
    bootRequestId: "boot-123",
    postMessage: (message) => sent.push(JSON.parse(message)),
    onMessage: (message) => received.push(message),
    onReject: (reason) => rejected.push(reason),
  });
  const envelope = (type, requestId, payload = {}) => JSON.stringify({ version: 1, type, sessionId: "session-123", requestId, payload });
  assert.equal(bridge.receive(envelope("EDITOR_READY", "boot-123")), true);
  const loadId = bridge.send("LOAD_DOCUMENT", {
    content: "const ok = true;",
    path: "src/index.js",
    ref: "main",
    sha: "a".repeat(40),
    language: "js",
    readOnly: false,
  }, "load-123");
  assert.equal(loadId, "load-123");
  assert.equal(bridge.receive(envelope("DOCUMENT_READY", loadId, { readOnly: false })), true);
  assert.equal(bridge.receive(envelope("DOCUMENT_READY", loadId, { readOnly: false })), false);
  assert.equal(bridge.receive(JSON.stringify({ version: 1, type: "DOCUMENT_CHANGED", sessionId: "session-123", requestId: "change-1", payload: { content: "x", line: 1, column: 1, extra: true } })), false);
  assert.equal(bridge.receive(envelope("DOCUMENT_CHANGED", "change-2", { content: "x", line: 1, column: 1 })), true);
  assert.equal(received.at(-1).payload.content, "x");
  assert.equal(rejected.length, 2);
  assert.equal(sent.length, 1);
});

test("bridge rejects oversized content, external navigation and stale session replies", () => {
  const rejected = [];
  const bridge = createEditorBridge({
    sessionId: "session-123",
    bootRequestId: "boot-123",
    postMessage() {},
    onReject: (reason) => rejected.push(reason),
  });
  assert.equal(isAllowedEditorNavigation("https://example.com"), false);
  assert.equal(isAllowedEditorNavigation("https://editor.pocketops.invalid/"), true);
  assert.equal(editorMaximumContentBytes, 512 * 1024);
  assert.equal(bridge.receive(JSON.stringify({ version: 1, type: "EDITOR_READY", sessionId: "wrong-session", requestId: "boot-123", payload: {} })), false);
  assert.equal(bridge.receive(JSON.stringify({ version: 1, type: "DOCUMENT_CHANGED", sessionId: "session-123", requestId: "change-large", payload: { content: "x".repeat(editorMaximumContentBytes + 1), line: 1, column: 1 } })), false);
  assert.equal(rejected.length, 2);
});

test("bridge rejects unknown message types and oversized messages in both directions", () => {
  const rejected = [];
  const bridge = createEditorBridge({
    sessionId: "session-123",
    bootRequestId: "boot-123",
    postMessage() {},
    onReject: (reason) => rejected.push(reason),
  });
  assert.equal(bridge.receive(JSON.stringify({ version: 1, type: "EXECUTE_CODE", sessionId: "session-123", requestId: "unknown-1", payload: { code: "process.exit()" } })), false);
  assert.equal(bridge.receive(JSON.stringify({ version: 2, type: "EDITOR_READY", sessionId: "session-123", requestId: "boot-123", payload: {} })), false);
  const oversized = `{"version":1,"type":"EDITOR_ERROR","sessionId":"session-123","requestId":"big-1","payload":{"code":"X","pad":"${"x".repeat(editorMaximumMessageBytes)}"}}`;
  assert.equal(bridge.receive(oversized), false);
  assert.deepEqual(rejected, ["INVALID_MESSAGE", "INVALID_MESSAGE", "MESSAGE_SIZE_OR_STATE"]);
  assert.throws(
    () => bridge.send("LOAD_DOCUMENT", {
      content: "x".repeat(editorMaximumContentBytes + 1),
      path: "src/index.js",
      ref: "main",
      sha: "a".repeat(40),
      language: "js",
      readOnly: false,
    }, "load-oversized"),
    /Invalid editor request/,
  );
});

test("drafts are encrypted, scoped to user/repository/ref/path, expire and clear per user", async () => {
  let time = 10_000;
  let counter = 0;
  const secure = new Map();
  const files = new Map();
  const store = createEditorDraftStore({
    secureStore: {
      getItemAsync: async (key) => secure.get(key) || null,
      setItemAsync: async (key, value) => secure.set(key, value),
      deleteItemAsync: async (key) => secure.delete(key),
    },
    fileStore: {
      makeDirectoryAsync: async () => {},
      writeAsStringAsync: async (uri, value) => files.set(uri, value),
      readAsStringAsync: async (uri) => files.get(uri),
      deleteAsync: async (uri) => {
        for (const key of files.keys()) if (key.startsWith(uri)) files.delete(key);
      },
    },
    randomBytes: async (length) => Uint8Array.from({ length }, () => ++counter % 255),
    hash: async (value) => {
      const bytes = Uint8Array.from(Array.from(value, (character) => character.charCodeAt(0)));
      let state = 2166136261;
      for (const byte of bytes) state = Math.imul(state ^ byte, 16777619) >>> 0;
      return state.toString(16).padStart(8, "0").repeat(8);
    },
    now: () => time,
    directoryUri: "file:///drafts/",
  });
  const draft = { userId: "user-a", repositoryId: "repo", branch: "fix/task", path: "src/index.js", baseSha: "a".repeat(40), expectedSha: "b".repeat(40), content: "const safe = true;" };
  await store.save(draft);
  assert.equal([...files.values()][0].includes(draft.content), false);
  assert.equal((await store.load(draft)).content, draft.content);
  assert.equal(await store.load({ ...draft, userId: "user-b" }), null);
  assert.equal(await store.load({ ...draft, branch: "main" }), null);
  assert.equal(editorDraftTtlMs, 24 * 60 * 60 * 1000);
  time += editorDraftTtlMs + 1;
  assert.equal(await store.load(draft), null);
  await store.save(draft);
  await store.clearUser("user-a");
  assert.equal(files.size, 0);
  assert.equal(secure.size, 0);
});
