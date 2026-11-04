import test from "node:test";
import assert from "node:assert/strict";
import {
  isUsableRobotsResponse,
  looksLikeRobotsTxt,
  parseRobotsTxt,
} from "./robots.js";

const sample = `
# Global policy
User-agent: *
Disallow: /private
Allow: /private/public
Crawl-delay: 2
Sitemap: https://example.com/sitemap.xml

User-agent: CraftScopeBot
Disallow: /
Allow: /about$
Crawl-delay: 1.5
Sitemap: https://example.com/sitemap.xml
`;

test("a specific user-agent group overrides the wildcard group", () => {
  const parser = parseRobotsTxt(sample, "CraftScopeBot/1.0");
  assert.equal(parser.matchedSpecificGroup, true);
  assert.equal(parser.isAllowed("/about"), true);
  assert.equal(parser.isAllowed("/about/extra"), false);
  assert.equal(parser.isAllowed("/private/public"), false);
  assert.equal(parser.crawlDelaySeconds, 1.5);
});

test("the wildcard group applies when no specific agent matches", () => {
  const parser = parseRobotsTxt(sample, "AnotherBot");
  assert.equal(parser.matchedSpecificGroup, false);
  assert.equal(parser.isAllowed("/private"), false);
  assert.equal(parser.isAllowed("/private/public"), true);
  assert.equal(parser.isAllowed("/about"), true);
});

test("longest matching rule wins, with Allow winning an equal-length tie", () => {
  const parser = parseRobotsTxt(`
    User-agent: *
    Disallow: /docs
    Allow: /docs/public
    Disallow: /exact
    Allow: /exact
  `);
  assert.equal(parser.isAllowed("/docs/internal"), false);
  assert.equal(parser.isAllowed("/docs/public/page"), true);
  assert.equal(parser.isAllowed("/exact"), true);
  assert.equal(parser.isAllowed("/elsewhere"), true);
});

test("wildcards and end anchors are honoured", () => {
  const parser = parseRobotsTxt(`
    User-agent: *
    Disallow: /*.pdf$
    Disallow: /tmp*/cache
  `);
  assert.equal(parser.isAllowed("/files/report.pdf"), false);
  assert.equal(parser.isAllowed("/files/report.pdf?download=1"), true);
  assert.equal(parser.isAllowed("/tmp42/cache"), false);
  assert.equal(parser.isAllowed("/tmp42/not-cache"), true);
  // The wildcard must not make the literal "tmp" prefix fuzzy.
  assert.equal(parser.isAllowed("/temporary/cache"), true);
});

test("Sitemap directives are collected once across groups", () => {
  const parser = parseRobotsTxt(sample);
  assert.deepEqual(parser.sitemaps, [
    "https://example.com/sitemap.xml",
  ]);
});

test("robots detection rejects the BashCraft HTML fallback", () => {
  const html = "<!doctype html><html><body><div id=\"root\"></div></body></html>";
  assert.equal(looksLikeRobotsTxt(html), false);
  assert.equal(looksLikeRobotsTxt("User-agent: *\nDisallow: /admin"), true);
  assert.equal(
    isUsableRobotsResponse({ status: 200, contentType: "text/html", body: "User-agent: *\nDisallow: /" }),
    false,
  );
  assert.equal(
    isUsableRobotsResponse({ status: 404, contentType: "text/plain", body: "User-agent: *" }),
    false,
  );
  assert.equal(
    isUsableRobotsResponse({
      status: 200,
      contentType: "text/plain; charset=utf-8",
      body: "User-agent: *\nDisallow: /admin",
    }),
    true,
  );
});

test("blank and malformed lines do not produce rules", () => {
  const parser = parseRobotsTxt(`
    nope
    User-agent: *
    Disallow:
    Crawl-delay: soon
  `);
  assert.equal(parser.rules.length, 0);
  assert.equal(parser.crawlDelaySeconds, 0);
  assert.equal(parser.isAllowed("/anything"), true);
});
