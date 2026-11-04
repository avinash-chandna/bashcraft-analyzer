# CraftScope Testing Report

This document records the automated and manual verification performed for CraftScope. All results below reflect the delivered source tree.

## Test environment

| Item | Value |
| --- | --- |
| Date | 4 November 2026 |
| Platform | Windows (`win32`) |
| Runtime | Node.js v26.12.1 |
| Browser | Bundled Playwright Chromium |
| Test runner | `node --test server` (Node built-in) |
| Target for the real scan | <https://bashcraftclub.vercel.app/> |
| Target for UI failure tests | Local fixture at `http://127.0.0.1:8899/` |

## Commands run

```bash
npm test              # automated suite
npx tsc --noEmit      # TypeScript check
npm run build         # production bundle
npm run check         # all three in sequence
```

## Automated suite summary

**Result: 40 tests, 40 passed, 0 failed.**

| Test file | Tests | Coverage |
| --- | ---: | --- |
| `server/crawler/fetch.test.js` | 2 | Timeout and off-site redirect handling |
| `server/crawler/html.test.js` | 8 | HTML extraction, whitespace, soft-404 heuristics, warnings |
| `server/crawler/robots.test.js` | 7 | User-agent groups, wildcards, precedence, HTML fallback rejection |
| `server/crawler/ssrf.test.js` | 7 | Private/reserved IP classification and `ALLOW_PRIVATE_HOSTS` |
| `server/crawler/url.test.js` | 10 | Normalization, site identity, dedupe keys, input coercion, hash links |
| `server/crawler/validate.test.js` | 5 | Payload validation, bounds, malformed URLs, long URLs |
| `server/crawler/integration.test.js` | 1 | End-to-end crawl of a local fixture with failures, loops, robots, and duplicates |
| **Total** | **40** | |

## Key automated cases: expected vs actual

| # | Test case | Expected | Actual |
| ---: | --- | --- | --- |
| 1 | Normalize fragments, trailing slash, default port | `https://example.com/about` | Pass |
| 2 | Remove `utm_*` and sort remaining query parameters | `https://example.com/about?a=1&b=2` | Pass |
| 3 | Decode unreserved percent encoding, preserve reserved slashes | `/~user`, `%2F` preserved | Pass |
| 4 | Reject non-HTTP protocols, credentials, and garbage URLs | `null` | Pass |
| 5 | Treat `www`, `http`, and `https` as one site identity | Same site key | Pass |
| 6 | Preserve non-default ports in site identity | `example.com:8080` distinct | Pass |
| 7 | Collapse protocol/`www`/slash/fragment variants into one crawl key | One resource key | Pass |
| 8 | Coerce a bare domain to HTTPS | Valid URL with scheme | Pass |
| 9 | Treat `#fragment` and `#/route` as same-document navigation | Not separate pages | Pass |
| 10 | Keep display paths with query strings and strip trailing slash | `/about?x=1` | Pass |
| 11 | Specific robots user-agent group overrides wildcard group | Specific rules only | Pass |
| 12 | Wildcard group applies when no specific agent matches | Wildcard rules | Pass |
| 13 | Longest robots rule wins; `Allow` wins equal-length tie | Allowed/blocked as declared | Pass |
| 14 | Support `*` wildcards and `$` end anchors | `/files/report.pdf` blocked, query variant allowed | Pass |
| 15 | Treat literal `tmp` prefix correctly | `/tmp42/cache` blocked; `/temporary/cache` allowed | Pass |
| 16 | Reject BashCraft-style HTML response for `/robots.txt` | No usable rules | Pass |
| 17 | Detect BashCraft SPA soft 404 (`RESOURCE_NOT_FOUND`) | `isSoft404: true` | Pass |
| 18 | Detect short generic not-found page | `isSoft404: true` | Pass |
| 19 | Do **not** flag a long article that mentions 404 | `isSoft404: false` | Pass |
| 20 | Do **not** flag a short link hub containing “Soft 404” anchor text | `isSoft404: false` | Pass |
| 21 | Ignore non-200 and non-HTML responses for soft-404 checks | `isSoft404: false` | Pass |
| 22 | Warn on a missing title without a spurious thin-content warning | One title warning | Pass |
| 23 | Warn on a very long title | One long-title warning | Pass |
| 24 | Extract title, description, h1, language, base href, link text, invalid anchors | Correct values/counts | Pass |
| 25 | Block private IPv4, loopback, link-local, CGNAT, reserved, documentation ranges | All blocked | Pass |
| 26 | Block IPv6 loopback, unique-local, link-local, multicast, documentation | All blocked | Pass |
| 27 | Block localhost, `.local`, `.internal`, metadata hostnames | All blocked | Pass |
| 28 | Allow public IP literals | Allowed | Pass |
| 29 | `ALLOW_PRIVATE_HOSTS=true` overrides the private-network guard | Allowed | Pass |
| 30 | Reject missing, malformed, credentialed, and overlong URLs | Correct error codes | Pass |
| 31 | Reject out-of-range pages/depth/timeout and non-boolean options | `INVALID_OPTION` | Pass |
| 32 | Apply defaults for a bare domain | 25 pages, depth 3, JS/robots on, 15 s timeout | Pass |
| 33 | Integration crawl finds 404, soft 404, loop, robots block, duplicate variants | 7 pages, 2 broken, 1 blocked, 0 external requests | Pass |
| 34 | Integration crawl respects depth and computes inverse/child counts | Depth 2 reached, counts correct | Pass |
| 35 | Slow server produces a timeout result | `TIMEOUT`, no body | Pass |
| 36 | Off-site redirect is reported but not followed | `EXTERNAL_REDIRECT`, status 302, no body | Pass |

## Manual and end-to-end verification

| Area | Test performed | Expected | Actual result |
| --- | --- | --- | --- |
| Landing page | Desktop at 1440 px | Renders, no document overflow | Pass; `scrollWidth == clientWidth == 1440` |
| Landing page | Mobile at 390 px | Renders, no document overflow | Pass; `scrollWidth == clientWidth == 390` |
| Form validation | Empty URL | Inline error | Pass |
| Form validation | Malformed URL | Inline error | Pass |
| Form validation | Unsupported protocol | Inline/API error | Pass |
| Live scan | BashCraft with defaults | Progress events, then report | Pass |
| Live scan | BashCraft results | 15 pages, 75 internal links, 0 broken | Pass; exact report preserved in `docs/sample-output/` |
| Sitemap graph | Tree and all-links modes | Edges and nodes render | Pass |
| Sitemap graph | Search, zoom, pan, selection | Graph responds and inspector updates | Pass |
| Pages view | Health filters and sorting | Rows filter/sort correctly | Pass |
| Links view | Broken/internal/external tabs, filters, search, sort | Correct rows and counts | Pass |
| Export | Download JSON | Valid, parseable report | Pass; 15 page records |
| Export | Download pages CSV | Valid CSV with headers | Pass; header + 15 rows |
| Export | Download broken-links CSV | Valid CSV; empty result handled by UI | Pass; header-only file because scan had 0 broken links |
| Export | Download internal-links CSV | Valid CSV | Pass; header + 75 rows |
| Export | Download sitemap XML | Valid XML with 2xx URLs only | Pass; 15 `<loc>` entries |
| Method modal | Open/close via button and Escape | Focused modal, dismisses cleanly | Pass |
| API errors | Invalid JSON body | `400 INVALID_JSON` | Pass |
| API errors | Private destination | `403 PRIVATE_DESTINATION` | Pass |
| API errors | Invalid protocol | `400 INVALID_URL` | Pass |
| API errors | Nonexistent domain | `403 ENOTFOUND` with hint | Pass |
| Production | `npm run build` + `npm start` | Serves SPA and API from one port | Pass |
| Production | Deep SPA route | Serves `index.html` | Pass |
| Production | Unknown API route | `404 NOT_FOUND` JSON | Pass |
| Browser console | All captured pages | No console/page errors | Pass |
| Clipboard | Copy JSON in automated Chromium | Clipboard works | Environment limitation: automated browser reported `COPY FAILED — TRY DOWNLOAD`; JSON download works |

### Broken-link UI fixture

A dedicated fixture (`scripts/fixture-site.mjs`) serves healthy pages, an HTTP 404, a soft 404, duplicate variants, warning pages, a JavaScript-generated page, and an external “tripwire” on a second local port. `scripts/verify-broken-ui.mjs` drives the production UI with Playwright.

| Check | Expected | Actual |
| --- | --- | --- |
| Pages discovered | 7 internal pages | 7 |
| Healthy / warning / broken pages | 3 / 2 / 2 | 3 / 2 / 2 |
| Internal links | Checked internal relationships | 10 |
| External links | 2 destinations, not fetched | 2 |
| Broken tab | `/missing` and `/soft-404` cards | Both shown |
| HTTP 404 reason | `HTTP 404 Not Found.` | Shown |
| Soft 404 reason | HTTP 200 not-found explanation | Shown |
| JS-generated link | `/js-page` discovered and listed | Discovered |
| Long title | Warning page | Present |
| Missing title | Warning page | Present |
| External policy label | `NOT REQUESTED` | Present |
| External tripwire hits | 0 | 0 |
| Document overflow | None | `scrollWidth == clientWidth` |
| Browser console | No errors | No errors |
| Screenshot | `screenshots/broken-links-desktop.png` | Captured and reviewed |

## BashCraft live verification

Full details and screenshots are in [BASHCRAFT-DEMO.md](BASHCRAFT-DEMO.md).

| Check | Expected | Actual |
| --- | --- | --- |
| Scan URL | <https://bashcraftclub.vercel.app/> | Used |
| JavaScript rendering | All pages rendered | 15/15 pages, bundled Chromium, 0 fallbacks |
| Pages discovered | All primary routes and detail pages | 15 pages at depth 2 |
| Internal relationships | No broken links | 75 internal, 75 checked, 0 broken |
| External destinations | Catalogued, never requested | 43 destinations, 103 references, 7 hosts |
| Soft 404 on unknown route | Flag HTTP 200 fallback | Rendered `h1` = `404`, body contains `RESOURCE_NOT_FOUND // THE VOID CLAIMS THIS LINK`, screenshot captured |
| `/robots.txt` fallback | Treat HTML as no rules | HTTP 200, `text/html`, doctype HTML; 0 rules applied |
| Warnings | None expected for the healthy scan | 0 |
| Runtime | Complete within a reasonable window | 28.7 seconds |
| Duplicate occurrences | Variants collapsed | 84 duplicate occurrences merged |
| Page limit reached | No | No |
| Max depth | 2 reached of 3 allowed | 2 |

## Edge cases exercised

- Self-link/loop on the fixture `/loop` page.
- `/about`, `/about/`, `/about#team`, and `/about?utm_source=...` merged into one page.
- HTTP 404 response (`/missing`).
- HTTP 200 soft 404 (`/soft-404` and BashCraft’s SPA fallback).
- Request timeout against a non-responsive local server.
- Off-site redirect reported without being followed.
- 43 external destinations across 7 hosts, with zero external link requests.
- Missing title and very long title warnings.
- Thin server-rendered content warning.
- JavaScript-generated link (`/js-page`) discovered only after rendering.
- Invalid URL, malformed JSON, unsupported protocol, private host, and nonexistent domain.
- robots.txt disallow + wildcard matching + HTML fallback.
- Depth limit, page count, and duplicate counting in the integration fixture.
- Mobile and desktop responsive layouts, including compact report/link tabs and graph viewport.

## Known testing gaps

- No test of authenticated pages, paywalled content, or CAPTCHA/anti-bot challenges.
- No large-scale performance test beyond the 15-page BashCraft scan and small local fixtures.
- Non-UTF-8 page encodings are not explicitly tested; response decoding assumes UTF-8.
- Advanced robots.txt semantics beyond the documented wildcard, anchor, precedence, and delay behavior are not covered.
- Page-limit and depth-limit “reached” banners were inspected in code and during normal runs, but not exhaustively tested with a site larger than 100 pages.
- Screenshot coverage is desktop-first; mobile captures cover landing, report, and links, not every modal/table state.

## How to reproduce

```bash
# Automated suite
npm test

# Type-check and production build
npx tsc --noEmit
npm run build

# Real BashCraft scan through the UI
npm run dev
# open http://localhost:5173, keep the default URL, and scan

# Broken-link UI fixture
npm run fixture
# in another terminal, after npm run build:
$env:ALLOW_PRIVATE_HOSTS = "true"
$env:PORT = "8790"
npm start
# in a third terminal:
npm run verify:ui
```
