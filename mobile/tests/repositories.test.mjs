import assert from "node:assert/strict";
import { test } from "node:test";
import { createAuthenticatedRequest } from "../src/features/auth/request.js";
import { createGitHubApi } from "../src/features/github/api.js";
import {
  createRepositoryClient,
  disposeRepositoryClient,
  repositoryKey,
} from "../src/features/repositories/cache.js";
import {
  sortDirectoryEntries,
  breadcrumbs,
  flattenPages,
  previewReason,
  repositoryRoute,
} from "../src/features/repositories/model.js";

test("directory navigation preserves repository/ref, supports slash branches, and breadcrumbs", () => {
  assert.deepEqual(repositoryRoute("a", "feature/fix", "src/index.js", true), {
    pathname: "/repository/[id]/file",
    params: { id: "a", ref: "feature/fix", path: "src/index.js" },
  });
  assert.deepEqual(breadcrumbs("src/utils"), [
    { label: "Root", path: "" },
    { label: "src", path: "src" },
    { label: "utils", path: "src/utils" },
  ]);
  assert.notDeepEqual(
    repositoryKey("a", "file", "main", "x"),
    repositoryKey("b", "file", "main", "x"),
  );
  assert.notDeepEqual(
    repositoryKey("a", "file", "main", "x"),
    repositoryKey("a", "file", "next", "x"),
  );
});

test("preview rejects binary/oversized files and pagination deduplicates stable IDs", () => {
  assert.match(previewReason({ size: 524289 }), /512 KiB/);
  assert.match(
    previewReason({ size: 4, content: null, encoding: "binary" }),
    /Binary/,
  );
  assert.equal(
    previewReason({ size: 0, content: "", encoding: "utf-8" }),
    null,
  );
  assert.deepEqual(
    flattenPages({
      pages: [{ data: [{ id: "a" }] }, { data: [{ id: "a" }, { id: "b" }] }],
    }),
    [{ id: "a" }, { id: "b" }],
  );
});

test("API propagates abort signal and encodes filenames and refs without leaking signal to query", async () => {
  const calls = [];
  const api = createGitHubApi(async (...args) => {
    calls.push(args);
  });
  const controller = new AbortController();
  await api.listTree("repo", {
    path: "src/a #.js",
    ref: "feature/fix",
    signal: controller.signal,
  });
  const url = new URL(calls[0][0], "https://api.example.test");
  assert.equal(url.searchParams.get("path"), "src/a #.js");
  assert.equal(url.searchParams.get("ref"), "feature/fix");
  assert.equal(url.searchParams.has("signal"), false);
  assert.equal(calls[0][1].signal, controller.signal);
});

test("search and pagination work with URLSearchParams implementations without size", async () => {
  const original = globalThis.URLSearchParams;
  const calls = [];
  try {
    globalThis.URLSearchParams = class extends original {
      get size() {
        return undefined;
      }
    };
    const api = createGitHubApi(async (path) => {
      calls.push(path);
    });
    await api.listRepositories({ cursor: "signed", search: "api", limit: 30 });
    await api.listBranches("repo", "branches-cursor");
    assert.match(calls[0], /cursor=signed/);
    assert.match(calls[0], /search=api/);
    assert.match(calls[1], /cursor=branches-cursor/);
  } finally {
    globalThis.URLSearchParams = original;
  }
});

test("editor write calls stay on authenticated GitHub routes and include idempotency keys", async () => {
  const calls = [];
  const api = createGitHubApi(async (...args) => calls.push(args));
  await api.getBranch("repo-id", "feature/fix");
  await api.createFixBranch("repo-id", { branch: "fix/task" }, "idempotency-key-123");
  await api.commitFixFile("repo-id", { branch: "fix/task", content: "safe" }, "idempotency-key-456");
  await api.createPullRequest("repo-id", { head: "fix/task", base: "main" }, "idempotency-key-789");
  assert.match(calls[0][0], /branches\/metadata\?branch=feature%2Ffix/);
  for (const [index, key] of [[1, "idempotency-key-123"], [2, "idempotency-key-456"], [3, "idempotency-key-789"]]) {
    assert.equal(calls[index][1].headers["Idempotency-Key"], key);
    assert.equal(calls[index][1].method, index === 2 ? "PUT" : "POST");
  }
});

test("central authentication expires only PocketOps 401, not GitHub provider authorization", async () => {
  let expired = 0;
  let failure = { status: 401, code: "GITHUB_AUTH_REVOKED" };
  const request = createAuthenticatedRequest({
    getToken: async () => "session",
    request: async () => {
      throw failure;
    },
    onExpired: async () => {
      expired++;
    },
  });
  await assert.rejects(request("/github/repositories"));
  assert.equal(expired, 0);
  failure = { status: 401, code: "UNAUTHENTICATED" };
  await assert.rejects(request("/github/repositories"));
  assert.equal(expired, 1);
});

for (const status of [401, 403, 404]) {
  test(`known ${status} hides cached source and removes related repository metadata`, async () => {
    const client = createRepositoryClient();
    client.setDefaultOptions({ queries: { retry: false } });
    const key = repositoryKey("a", "file", "main", "secret.txt");
    client.setQueryData(key, { data: { content: "private" } });
    client.setQueryData(["repositories", "list", ""], {
      pages: [{ data: [{ id: "a" }] }],
    });
    await assert.rejects(
      client.fetchQuery({
        queryKey: key,
        queryFn: async () => {
          throw { status };
        },
      }),
    );
    assert.equal(client.getQueryData(key), undefined);
    assert.equal(client.getQueryData(["repositories", "list", ""]), undefined);
    await disposeRepositoryClient(client);
    assert.equal(client.getQueryCache().getAll().length, 0);
  });
}

test("logout disposal aborts delayed requests and prevents late cache repopulation", async () => {
  const client = createRepositoryClient();
  let aborted = false;
  const request = client
    .fetchQuery({
      queryKey: repositoryKey("a", "file"),
      queryFn: ({ signal }) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () => {
            aborted = true;
            reject(new Error("cancelled"));
          }),
        ),
    })
    .catch(() => {});
  await disposeRepositoryClient(client);
  await request;
  assert.equal(aborted, true);
  assert.equal(client.getQueryCache().getAll().length, 0);
});

test("an old request cannot expire a newly rotated or signed-in session", async () => {
  let token = "old";
  let expired = false;
  const request = createAuthenticatedRequest({
    getToken: async () => token,
    request: async () => {
      token = "new";
      throw { status: 401, code: "UNAUTHENTICATED" };
    },
    onExpired: async () => {
      expired = true;
    },
  });
  await assert.rejects(request("/github/repositories"));
  assert.equal(expired, false);
});

test("known-denied Render responses erase deployment and log caches before they can be displayed", async () => {
  for (const status of [401, 403, 404, 409]) {
    const client = createRepositoryClient();
    const projectKey = ["deployments", "project", "project-id"];
    const logsKey = ["deployments", "logs", "project-id", "{}"];
    client.setQueryData(projectKey, { data: { name: "Private service" } });
    client.setQueryData(logsKey, { data: { items: [{ message: "Private log" }] } });
    await assert.rejects(client.fetchQuery({ queryKey: projectKey, queryFn: async () => { throw Object.assign(new Error("Access denied"), { status }); }, retry: false }));
    assert.equal(client.getQueryData(projectKey), undefined);
    assert.equal(client.getQueryData(logsKey), undefined);
    await disposeRepositoryClient(client);
  }
});


test("directory order places folders first with natural case-insensitive filenames without changing cached data", () => {
  const entries = [
    { name: "file10.js", type: "file" }, { name: "Zoo", type: "dir" },
    { name: "file2.js", type: "file" }, { name: ".github", type: "dir" },
    { name: "alpha.js", type: "file" }, { name: "src", type: "dir" },
    { name: "Alpha.js", type: "file" },
  ].map(Object.freeze);
  Object.freeze(entries);
  assert.deepEqual(sortDirectoryEntries(entries).map((item) => item.name),
    [".github", "src", "Zoo", "Alpha.js", "alpha.js", "file2.js", "file10.js"]);
  assert.equal(entries[0].name, "file10.js");
  assert.deepEqual(sortDirectoryEntries(), []);
});
