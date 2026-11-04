/**
 * Local fixture used by `npm run verify:ui` (or directly with Playwright) to
 * exercise broken links, soft 404s, duplicate variants, warnings, and
 * JavaScript-generated links through the real CraftScope UI.
 *
 * Usage:
 *   node scripts/fixture-site.mjs
 *   ALLOW_PRIVATE_HOSTS=true PORT=8790 npm start
 *   node scripts/verify-broken-ui.mjs
 */
import { createServer } from "node:http";

const PORT = Number(process.env.FIXTURE_PORT) || 8899;
const TRIPWIRE_PORT = Number(process.env.TRIPWIRE_PORT) || 8898;
let tripwireHits = 0;

const longTitle =
  "A deliberately long fixture title that keeps going so CraftScope can flag it as unusually long for a page heading and exercise the warning path";

const pages = {
  "/": `<!doctype html><html lang="en"><head>
      <title>Broken Link Fixture</title>
      <meta name="description" content="A local fixture for broken links, soft 404s, duplicates, and JavaScript links.">
    </head><body>
      <h1>Broken Link Fixture</h1>
      <p>This fixture exercises broken links, soft 404 responses, duplicate URL variants, warning states, and JavaScript-generated navigation in the analyzer UI.</p>
      <a href="/about">About</a>
      <a href="/about/">About with slash</a>
      <a href="/about#team">About with fragment</a>
      <a href="/about?utm_source=navigation">About with tracking</a>
      <a href="/missing">Missing page</a>
      <a href="/soft-404">Soft 404</a>
      <a href="/long-title">Long title</a>
      <a href="/untitled">Untitled</a>
      <a href="http://127.0.0.1:${TRIPWIRE_PORT}/external-target">External tripwire</a>
      <a href="https://example.com/another-external">Another external</a>
      <a href="#section">In-page anchor</a>
      <script>
        setTimeout(() => {
          const link = document.createElement("a");
          link.href = "/js-page";
          link.textContent = "JavaScript page";
          document.body.appendChild(link);
        }, 60);
      </script>
    </body></html>`,
  "/about": `<!doctype html><html lang="en"><head><title>About the Fixture</title></head>
    <body><h1>About</h1>
    <p>This page has enough visible server-rendered content to be considered healthy. It links back to the fixture home page.</p>
    <a href="/">Home</a></body></html>`,
  "/js-page": `<!doctype html><html lang="en"><head><title>JavaScript Page</title></head>
    <body><h1>JavaScript Page</h1>
    <p>This page is only discoverable through a link added by client-side JavaScript after the document loads.</p>
    <a href="/">Home</a></body></html>`,
  "/long-title": `<!doctype html><html lang="en"><head><title>${longTitle}</title></head>
    <body><h1>Long title</h1>
    <p>This page has a deliberately long title to exercise CraftScope's title-length warning without failing the link check.</p>
    <a href="/">Home</a></body></html>`,
  "/untitled": `<!doctype html><html lang="en"><head></head>
    <body><h1>Untitled</h1>
    <p>This page deliberately omits its title element but still contains enough visible content to be inspected.</p>
    <a href="/">Home</a></body></html>`,
  "/soft-404": `<!doctype html><html lang="en"><head><title>Broken Link Fixture</title></head>
    <body><h1>404</h1><p>RESOURCE_NOT_FOUND // THE VOID CLAIMS THIS LINK</p></body></html>`,
};

function sendHtml(res, status, body) {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  res.end(body);
}

const fixture = createServer((req, res) => {
  const pathname = new URL(req.url, "http://fixture.test").pathname;
  if (pathname === "/robots.txt") {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    res.end("User-agent: *\nDisallow: /private\n");
    return;
  }
  if (pathname === "/missing") {
    sendHtml(
      res,
      404,
      `<!doctype html><html lang="en"><head><title>Missing Page</title></head><body><h1>Missing</h1><p>This fixture page is intentionally missing.</p></body></html>`,
    );
    return;
  }
  const body = pages[pathname];
  if (!body) {
    sendHtml(
      res,
      404,
      `<!doctype html><html lang="en"><head><title>Not Found</title></head><body><h1>Not Found</h1></body></html>`,
    );
    return;
  }
  sendHtml(res, 200, body);
});

const tripwire = createServer((req, res) => {
  if (req.url === "/__hits") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ hits: tripwireHits }));
    return;
  }
  tripwireHits += 1;
  sendHtml(
    res,
    200,
    `<!doctype html><html lang="en"><head><title>Tripwire</title></head><body><p>This external host must never be requested.</p></body></html>`,
  );
});

await new Promise((resolve) => fixture.listen(PORT, "127.0.0.1", resolve));
await new Promise((resolve) => tripwire.listen(TRIPWIRE_PORT, "127.0.0.1", resolve));

console.log(`[fixture] site      http://127.0.0.1:${PORT}/`);
console.log(`[fixture] tripwire  http://127.0.0.1:${TRIPWIRE_PORT}/`);

function shutdown() {
  fixture.close();
  tripwire.close();
  process.exit(0);
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
