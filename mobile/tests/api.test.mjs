import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { ApiError, apiRequest, getApiHealth } from "../src/services/api.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("API client returns the standard successful response envelope", async () => {
  globalThis.fetch = async (_url, options) => {
    assert.equal(
      new Headers(options.headers).get("authorization"),
      "Bearer pocketops-session-token",
    );
    return new Response(
      JSON.stringify({
        success: true,
        data: { status: "ok" },
        meta: { requestId: "client-test" },
      }),
      { status: 200 },
    );
  };

  const result = await getApiHealth({ token: "pocketops-session-token" });
  assert.equal(result.data.status, "ok");
  assert.equal(result.meta.requestId, "client-test");
});

test("API client surfaces safe API error codes and request IDs", async () => {
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        success: false,
        error: { code: "NOT_READY", message: "Required dependencies are unavailable" },
        meta: { requestId: "ready-test" },
      }),
      { status: 503 },
    );

  await assert.rejects(
    apiRequest("/ready"),
    (error) =>
      error instanceof ApiError &&
      error.code === "NOT_READY" &&
      error.status === 503 &&
      error.requestId === "ready-test",
  );
});

test("API client reports network failures without leaking fetch details", async () => {
  globalThis.fetch = async () => {
    throw new Error("internal network detail");
  };

  await assert.rejects(
    apiRequest("/health"),
    (error) =>
      error instanceof ApiError &&
      error.code === "NETWORK_ERROR" &&
      !error.message.includes("internal network detail"),
  );
});

test("API client aborts requests after the configured timeout", async () => {
  globalThis.fetch = (_url, { signal }) =>
    new Promise((_resolve, reject) => {
      signal.addEventListener(
        "abort",
        () => reject(new DOMException("Aborted", "AbortError")),
        { once: true },
      );
    });

  await assert.rejects(
    apiRequest("/health", { timeoutMs: 5 }),
    (error) => error instanceof ApiError && error.code === "REQUEST_TIMEOUT",
  );
});
