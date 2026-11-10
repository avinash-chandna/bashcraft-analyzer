import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createApp } from "./app.js";

let server;
let origin;

before(async () => {
  server = createApp().listen(0, "127.0.0.1");
  await once(server, "listening");
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (!server) return;
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

test("the health endpoint reports a running analyzer", async () => {
  const response = await fetch(`${origin}/api/health`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.tool, "CraftScope");
  assert.equal(typeof body.activeScans, "number");
});

test("unknown API routes return a JSON 404 instead of the frontend", async () => {
  const response = await fetch(`${origin}/api/does-not-exist`);
  assert.equal(response.status, 404);
  const body = await response.json();
  assert.equal(body.error.code, "NOT_FOUND");
});

test("invalid scan payloads are rejected before the stream starts", async () => {
  const response = await fetch(`${origin}/api/analyze`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error.code, "URL_REQUIRED");
  assert.match(response.headers.get("content-type") ?? "", /application\/json/);
});

test("malformed JSON returns an actionable error", async () => {
  const response = await fetch(`${origin}/api/analyze`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{not json",
  });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error.code, "INVALID_JSON");
});
