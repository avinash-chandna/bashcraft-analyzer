import test from "node:test";
import assert from "node:assert/strict";
import {
  coerceHttpUrl,
  crawlResourceKey,
  displayPath,
  isAnchorOnlyHref,
  isInternalUrl,
  normalizeUrl,
  siteKeyFromUrl,
} from "./url.js";

test("normalizeUrl drops fragments, trailing slashes, and default ports", () => {
  assert.equal(
    normalizeUrl("HTTPS://Example.COM:443/About/#team"),
    "https://example.com/About",
  );
  assert.equal(normalizeUrl("http://example.com:80/"), "http://example.com/");
});

test("normalizeUrl removes known tracking parameters and sorts the rest", () => {
  assert.equal(
    normalizeUrl("https://example.com/?utm_source=news&b=2&a=1&fbclid=abc#x"),
    "https://example.com/?a=1&b=2",
  );
  assert.equal(
    normalizeUrl("https://example.com/read?ref=home&page=2"),
    "https://example.com/read?page=2&ref=home",
  );
});

test("normalizeUrl keeps meaningful query values and normalizes percent encoding", () => {
  assert.equal(
    normalizeUrl("https://example.com/caf%c3%a9?q=hello%20world"),
    "https://example.com/caf%C3%A9?q=hello+world",
  );
  assert.equal(normalizeUrl("https://example.com/%7euser"), "https://example.com/~user");
  assert.equal(normalizeUrl("https://example.com/a%2fb"), "https://example.com/a%2Fb");
});

test("normalizeUrl rejects non-http protocols, credentials, and garbage", () => {
  assert.equal(normalizeUrl("ftp://example.com/file"), null);
  assert.equal(normalizeUrl("mailto:hello@example.com"), null);
  assert.equal(normalizeUrl("https://user:pass@example.com/"), null);
  assert.equal(normalizeUrl("not a url"), null);
  assert.equal(normalizeUrl(""), null);
});

test("site identity treats www, http, and https as the same site", () => {
  assert.equal(siteKeyFromUrl("https://www.Example.com/a"), "example.com");
  assert.equal(siteKeyFromUrl("http://example.com/b"), "example.com");
  assert.equal(isInternalUrl("https://www.example.com/about", "example.com"), true);
  assert.equal(isInternalUrl("https://example.com.evil.test/", "example.com"), false);
});

test("site identity preserves non-default ports", () => {
  assert.equal(siteKeyFromUrl("http://localhost:3000/"), "localhost:3000");
  assert.equal(isInternalUrl("http://localhost:3001/", "localhost:3000"), false);
});

test("crawlResourceKey merges protocol, www, slash, and fragment variants", () => {
  const key = crawlResourceKey("https://www.example.com/about/", "example.com");
  assert.equal(key, "example.com/about");
  assert.equal(crawlResourceKey("http://example.com/about#team", "example.com"), key);
  assert.equal(crawlResourceKey("https://example.com/about?page=2", "example.com"), "example.com/about?page=2");
});

test("coerceHttpUrl adds a scheme to bare domains", () => {
  assert.equal(coerceHttpUrl("bashcraftclub.vercel.app")?.toString(), "https://bashcraftclub.vercel.app/");
  assert.equal(coerceHttpUrl("//example.com")?.toString(), "https://example.com/");
  assert.equal(coerceHttpUrl("ftp://example.com"), null);
});

test("displayPath keeps query strings and strips a trailing slash", () => {
  assert.equal(displayPath("https://example.com/"), "/");
  assert.equal(displayPath("https://example.com/team/?page=2"), "/team?page=2");
});

test("hash routes and fragments are treated as same-document navigation", () => {
  assert.equal(isAnchorOnlyHref("#main"), true);
  assert.equal(isAnchorOnlyHref("#!/router"), true);
  assert.equal(isAnchorOnlyHref("/about#team"), false);
  assert.equal(isAnchorOnlyHref("https://example.com/#team"), false);
});
