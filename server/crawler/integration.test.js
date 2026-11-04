import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { analyzeSite } from "./analyzer.js";
import { siteKeyFromUrl } from "./url.js";

const requestedPaths = [];
let server;
let origin;

const pages = {
  "/": `<!doctype html><html lang="en"><head>
      <title>Fixture Home</title>
      <meta name="description" content="A fixture site for crawler integration tests.">
    </head><body>
      <h1>Fixture Home</h1>
      <a href="/about">About</a>
      <a href="/about/">About with slash</a>
      <a href="/about#team">About anchor</a>
      <a href="/about?utm_source=navigation">About tracked</a>
      <a href="/missing">Missing page</a>
      <a href="/soft-404">Soft 404</a>
      <a href="/loop">Loop</a>
      <a href="/untitled">Untitled</a>
      <a href="/private">Private page</a>
      <a href="https://example.com/external">External destination</a>
      <a href="#section">Same-page anchor</a>
    </body></html>`,
  "/about": `<!doctype html><html lang="en"><head><title>About the Fixture</title></head>
    <body><h1>About</h1>
    <p>This fixture page describes the project and exists to exercise healthy-page crawling with enough visible content.</p>
    <a href="/">Home</a><a href="/contact">Contact</a></body></html>`,
  "/contact": `<!doctype html><html lang="en"><head><title>Contact the Fixture</title></head>
    <body><h1>Contact</h1>
    <p>Contact details for the fixture project, including enough server-rendered prose to avoid a thin-content warning.</p>
    <a href="/">Home</a></body></html>`,
  "/loop": `<!doctype html><html lang="en"><head><title>Loop Page</title></head>
    <body><h1>Loop</h1>
    <p>This page links back to itself and to the home page to verify loop detection during a crawl.</p>
    <a href="/loop">Self</a><a href="/">Home</a></body></html>`,
  "/untitled": `<!doctype html><html lang="en"><head></head>
    <body><h1>Untitled</h1><p>This page deliberately has no title element, but it has enough visible content to be inspected.</p></body></html>`,
  "/soft-404": `<!doctype html><html lang="en"><head><title>Fixture Club</title></head>
    <body><h1>404</h1><p>RESOURCE_NOT_FOUND // THE VOID CLAIMS THIS LINK</p></body></html>`,
};

before(async () => {
  server = createServer((req, res) => {
    const pathname = new URL(req.url, "http://fixture.test").pathname;
    requestedPaths.push(pathname);

    if (pathname === "/robots.txt") {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end("User-agent: *\nDisallow: /private\nCrawl-delay: 0\nSitemap: /sitemap.xml\n");
      return;
    }

    if (pathname === "/private") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html><head><title>Should Not Be Requested</title></head><body>Private.</body></html>");
      return;
    }

    if (pathname === "/missing") {
      res.writeHead(404, { "content-type": "text/html" });
      res.end("<html><head><title>Missing Page</title></head><body><h1>Missing</h1></body></html>");
      return;
    }

    const body = pages[pathname];
    if (!body) {
      res.writeHead(404, { "content-type": "text/html" });
      res.end("<html><head><title>Not Found</title></head><body>Not found.</body></html>");
      return;
    }

    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(body);
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  origin = `http://127.0.0.1:${port}`;
});

after(async () => {
  if (!server) return;
  await new Promise((resolve) => server.close(resolve));
});

test("a fixture crawl finds broken links, soft 404s, loops, and robots blocks", async () => {
  const startUrl = `${origin}/`;
  const report = await analyzeSite({
    originalUrl: startUrl,
    startUrl,
    siteKey: siteKeyFromUrl(startUrl),
    options: {
      maxPages: 25,
      maxDepth: 3,
      renderJs: false,
      respectRobots: true,
      timeoutMs: 5000,
    },
  });

  const pageByPath = new Map(report.pages.map((page) => [page.path, page]));

  assert.equal(report.pages.length, 7);
  assert.equal(pageByPath.get("/")?.health, "ok");
  assert.equal(pageByPath.get("/about")?.health, "ok");
  assert.equal(pageByPath.get("/contact")?.health, "ok");
  assert.equal(pageByPath.get("/loop")?.health, "ok");
  assert.equal(pageByPath.get("/untitled")?.health, "warning");
  assert.equal(pageByPath.get("/missing")?.statusCode, 404);
  assert.equal(pageByPath.get("/missing")?.health, "broken");
  assert.equal(pageByPath.get("/soft-404")?.health, "broken");
  assert.equal(pageByPath.get("/soft-404")?.soft404, true);
  assert.match(pageByPath.get("/soft-404")?.failureReason ?? "", /not-found/i);

  assert.equal(report.summary.healthyPages, 4);
  assert.equal(report.summary.warningPages, 1);
  assert.equal(report.summary.brokenPages, 2);
  assert.equal(report.summary.brokenLinks, 2);
  assert.equal(report.summary.brokenLinkRelations, 2);
  assert.equal(report.summary.linksBlockedByRobots, 1);
  assert.ok(report.summary.duplicatesMerged > 0, "URL variants should be merged");

  const brokenPaths = report.links.broken.map((entry) => entry.path).sort();
  assert.deepEqual(brokenPaths, ["/missing", "/soft-404"]);

  const privateRelation = report.links.internal.find(
    (relation) => relation.targetPath === "/private",
  );
  assert.equal(privateRelation?.status, "blocked");
  assert.match(privateRelation?.reason ?? "", /robots/i);
  assert.equal(requestedPaths.includes("/private"), false);

  const selfLoop = report.links.internal.find(
    (relation) => relation.sourcePath === "/loop" && relation.targetPath === "/loop",
  );
  assert.equal(selfLoop?.status, "ok");

  assert.equal(report.links.external.length, 1);
  assert.equal(report.links.external[0].host, "example.com");
  assert.equal(report.links.external[0].sourceCount, 1);
  assert.equal(report.summary.externalHosts, 1);

  assert.equal(report.robots.checked, true);
  assert.equal(report.robots.found, true);
  assert.equal(report.robots.disallowRuleCount, 1);
  assert.match(report.robots.note, /wildcard/i);

  assert.equal(report.meta.crawledWith, "http");
  assert.equal(report.renderer.pagesRendered, 0);
  assert.equal(report.config.maxDepth, 3);
  assert.equal(report.summary.maxDepthReached, 2);
});
