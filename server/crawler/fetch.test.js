import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fetchTextResource } from "./fetch.js";

let server;
let origin;

before(async () => {
  server = createServer((req, res) => {
    if (req.url === "/slow") {
      // Deliberately never respond; the client timeout must win.
      return;
    }
    if (req.url === "/external-redirect") {
      res.writeHead(302, { location: "https://example.com/" });
      res.end();
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end("<html><head><title>OK</title></head><body>OK</body></html>");
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (!server) return;
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

test("a slow server produces a TIMEOUT result", async () => {
  const result = await fetchTextResource(`${origin}/slow`, { timeoutMs: 80 });
  assert.equal(result.error?.code, "TIMEOUT");
  assert.equal(result.status, null);
  assert.equal(result.body, "");
});

test("an off-site redirect is reported without being followed", async () => {
  const result = await fetchTextResource(`${origin}/external-redirect`, {
    timeoutMs: 2000,
  });
  assert.equal(result.externalRedirect, true);
  assert.equal(result.error?.code, "EXTERNAL_REDIRECT");
  assert.equal(result.status, 302);
  assert.equal(result.finalUrl, "https://example.com/");
  assert.equal(result.redirects.length, 1);
  assert.equal(result.body, "");
});
