import test from "node:test";
import assert from "node:assert/strict";
import {
  collapseWhitespace,
  detectSoft404,
  extractPageFromHtml,
  pageWarnings,
} from "./html.js";

test("collapseWhitespace normalizes spacing and enforces a limit", () => {
  assert.equal(collapseWhitespace("  hello \n  world  "), "hello world");
  assert.equal(collapseWhitespace("abcdef", 3), "abc");
  assert.equal(collapseWhitespace(null), "");
});

test("extractPageFromHtml reads metadata, links, and invalid anchors", () => {
  const html = `
    <!doctype html>
    <html lang="en">
      <head>
        <title>  Example   Page </title>
        <meta name="description" content="A useful description">
        <base href="/base/">
      </head>
      <body>
        <h1>Hello <span>world</span></h1>
        <a href="about" aria-label="Read about us"><img alt="ignored"></a>
        <a href="/contact" title="Contact">Contact</a>
        <a href="mailto:test@example.com">Email</a>
        <a href="http://[bad">Broken</a>
      </body>
    </html>
  `;
  const page = extractPageFromHtml(html, "https://example.com/docs/page");

  assert.equal(page.title, "Example Page");
  assert.equal(page.description, "A useful description");
  assert.equal(page.h1, "Hello world");
  assert.equal(page.lang, "en");
  assert.equal(page.anchors.length, 3);
  assert.equal(page.anchors[0].href, "https://example.com/base/about");
  assert.equal(page.anchors[0].text, "Read about us");
  assert.equal(page.anchors[1].href, "https://example.com/contact");
  assert.equal(page.invalidHrefCount, 1);
  assert.ok(page.htmlBytes > 0);
});

test("soft 404 detection catches the BashCraft SPA fallback", () => {
  const result = detectSoft404({
    statusCode: 200,
    title: "BashCraft Club — no fluff; just engineering",
    h1: "404",
    bodyText: "RESOURCE_NOT_FOUND // THE VOID CLAIMS THIS LINK",
    contentType: "text/html",
  });
  assert.equal(result.isSoft404, true);
  assert.match(result.reason, /not-found/i);
});

test("soft 404 detection catches short generic not-found pages", () => {
  const result = detectSoft404({
    statusCode: 200,
    title: "Oops",
    h1: "",
    bodyText: "Sorry, nothing was found at this address.",
    contentType: "text/html; charset=utf-8",
  });
  assert.equal(result.isSoft404, true);
});

test("soft 404 detection does not flag a normal long article mentioning 404", () => {
  const filler = "This article explains the history of the web. ".repeat(40);
  const result = detectSoft404({
    statusCode: 200,
    title: "A history of HTTP status codes",
    h1: "A history of HTTP status codes",
    bodyText: `${filler} The 404 status means not found, while 200 means OK.`,
    contentType: "text/html",
  });
  assert.equal(result.isSoft404, false);
});

test("soft 404 detection does not flag a short link hub containing 'Soft 404'", () => {
  const result = detectSoft404({
    statusCode: 200,
    title: "Fixture Home",
    h1: "Fixture Home",
    bodyText:
      "Fixture Home About About with slash About anchor About tracked Missing page Soft 404 Loop Untitled Private page External destination Same-page anchor",
    contentType: "text/html",
  });
  assert.equal(result.isSoft404, false);
});

test("soft 404 detection ignores non-200 and non-HTML responses", () => {
  assert.equal(
    detectSoft404({
      statusCode: 404,
      title: "404 Not Found",
      h1: "404",
      bodyText: "Not found",
      contentType: "text/html",
    }).isSoft404,
    false,
  );
  assert.equal(
    detectSoft404({
      statusCode: 200,
      title: "404",
      h1: "404",
      bodyText: "Not found",
      contentType: "application/json",
    }).isSoft404,
    false,
  );
});

test("page warnings cover missing and very long titles", () => {
  assert.deepEqual(
    pageWarnings({
      title: "",
      titleLength: 0,
      contentType: "text/html",
      bodyText: "Enough server-rendered content to avoid the thin-content warning.",
      rendered: false,
    }),
    ["This page has no <title> element."],
  );
  const long = pageWarnings({
    title: "x".repeat(121),
    titleLength: 121,
    contentType: "text/html",
    bodyText: "Enough server-rendered content to avoid the thin-content warning.",
    rendered: false,
  });
  assert.equal(long.length, 1);
  assert.match(long[0], /very long/);
});
