import { test } from "node:test";
import assert from "node:assert/strict";
import { app } from "../src/app.js";
test("health endpoint returns ok", async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/health`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).data.status, "ok");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
