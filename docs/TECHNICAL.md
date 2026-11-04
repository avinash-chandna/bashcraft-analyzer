# CraftScope Technical Documentation

This document explains how CraftScope works internally, how the crawl behaves, how the report is assembled, and why the main design decisions were made. For installation and usage, see the [README](../README.md). For test evidence, see [TESTING.md](TESTING.md). For the BashCraft run, see [BASHCRAFT-DEMO.md](BASHCRAFT-DEMO.md).

## System overview

CraftScope is a two-part application:

```text
┌──────────────────────────────────────────────────────────────┐
│ Browser                                                      │
│  React 19 + TypeScript SPA                                   │
│  - scan form and validation                                  │
│  - live NDJSON progress reader                               │
│  - sitemap graph, page inspector, link ledger, exports       │
└──────────────────────────────┬───────────────────────────────┘
                               │ POST /api/analyze (JSON)
                               │ ← NDJSON events
┌──────────────────────────────▼───────────────────────────────┐
│ Express 5 API                                                │
│  validate payload → SSRF preflight → analyzeSite()           │
│                                                              │
│  analyzeSite()                                               │
│    robots.txt → sequential queue → render/fetch → parse      │
│    → health/soft-404 → classify links → build report         │
└──────────────────────────────┬───────────────────────────────┘
                               │
              ┌────────────────┴────────────────┐
              │                                 │
     Playwright Chromium                 Native fetch
     JavaScript-rendered pages           static HTML fallback
```

In development, Vite serves the frontend on port 5173 and proxies `/api` to Express on port 8787. In production, `npm run build` writes `dist/`, and Express serves the SPA and API from a single port.

## Module map

| Path | Responsibility |
| --- | --- |
| `server/index.js` | Express app, validation, concurrency limit, NDJSON streaming, static SPA serving |
| `server/crawler/analyzer.js` | Crawl orchestration, frontier, page records, link relations, report aggregation |
| `server/crawler/validate.js` | Payload validation, defaults, option bounds, destination preflight |
| `server/crawler/ssrf.js` | Private/reserved IP classification and DNS-based destination guard |
| `server/crawler/url.js` | URL normalization, site identity, crawl resource keys, input coercion |
| `server/crawler/fetch.js` | Manual redirect handling, timeouts, response size cap, network error mapping |
| `server/crawler/browser.js` | Playwright launch/fallback, isolated rendering, DOM extraction |
| `server/crawler/html.js` | Cheerio parsing, metadata extraction, warnings, soft-404 detection |
| `server/crawler/robots.js` | robots.txt parsing, wildcard matching, precedence, response detection |
| `src/App.tsx` | View state and NDJSON stream parsing |
| `src/components/` | Landing, scanning, report, graph, inspector, tables, export, errors |
| `src/lib/export.ts` | JSON/CSV/XML serialization and browser downloads |
| `src/types.ts` | Shared report and UI types |

## Scan request lifecycle

1. **Validation.** `validateScanPayload` requires a non-empty URL, coerces a bare domain to `https://`, rejects credentials, non-HTTP protocols, malformed URLs, overlong inputs, and out-of-range options.
2. **Destination preflight.** `validateDestination` resolves the hostname and rejects loopback, private, link-local, carrier-grade NAT, multicast, reserved, documentation, and cloud-metadata destinations. `ALLOW_PRIVATE_HOSTS=true` bypasses this guard for local fixtures.
3. **Scan slot.** At most two scans may run at once. Extra requests receive HTTP 429 before streaming begins.
4. **Stream start.** The API returns `application/x-ndjson` and sends `accepted` immediately, followed by `stage`, `progress`, `warning`, and `complete` events. A 15-second `ping` keeps intermediaries from idling the connection out.
5. **Robots check.** If enabled, CraftScope requests `/robots.txt` before any page. The result is reported even when no rules are usable.
6. **Crawl.** `analyzeSite` processes a sequential queue until it is empty or the page limit is reached.
7. **Report assembly.** Internal relations, broken groups, external destinations, incoming counts, children, external hosts, and summary statistics are built from the collected page data.
8. **Response.** The final `complete` event carries the full report. Errors before streaming are JSON responses; errors after streaming begin are emitted as an `error` event.

## Crawling approach

### Sequential, polite crawl

The crawler intentionally processes one page at a time. This keeps memory bounded, makes progress easy to follow, and avoids hammering a small site. A minimum 200 ms delay is inserted between page requests. A robots.txt `Crawl-delay` overrides that minimum, capped at 10 seconds so a scan cannot stall indefinitely.

### Scope and site identity

`siteKeyFromUrl` defines the crawl boundary:

- hostname is lowercased and a trailing dot is removed;
- a leading `www.` is removed;
- a non-default port is preserved (`example.com:8080` is distinct from `example.com`);
- protocol is not part of the key, so `http` and `https` are treated as the same site;
- subdomains remain distinct and are external.

This means `http://www.example.com/` and `https://example.com/` share one crawl identity, while `docs.example.com` is external.

### Queue and page limits

Each queued task stores its URL, resource key, depth, parent URL/title, and the anchor text that discovered it. The crawler:

- skips a task if its resource key has already been visited;
- stops when `pages.length >= maxPages`;
- refuses to enqueue children deeper than `maxDepth`;
- records links beyond either limit as `unchecked` with an explanatory reason;
- records robots-disallowed targets as `blocked`;
- records page-limit overflow in `summary.pageLimitReached` so the UI can show a banner.

### JavaScript rendering and HTTP fallback

When `renderJs` is true, `renderPage` creates a fresh Playwright context for each URL:

- headless Chromium is preferred; system Chrome and Edge are fallback launch targets;
- images, media, and fonts are aborted;
- service workers are blocked;
- the page loads with `domcontentloaded`, then waits up to 2.4 s for network idle, waits briefly for non-empty body text, and settles for 180 ms;
- anchors, title, description, h1, body text, canonical URL, language, and response status are extracted from the rendered DOM;
- the redirect chain is reconstructed from Playwright request history.

If no browser is available, navigation fails, or `renderJs` is false, `fetchTextResource` retrieves static HTML and Cheerio parses it. The report records `renderer.pagesUsingHttpFallback` and per-page `renderError` details.

The renderer is best-effort. Content revealed only after scrolling, hover, form interaction, or unusual Shadow DOM access may not be discovered.

### Redirects

Static fetches use `redirect: "manual"` and follow at most six redirects while the destination remains on the same site. Off-site redirects are not followed; the page is marked with a warning and an `EXTERNAL_REDIRECT` error. Redirect loops produce `REDIRECT_LOOP`.

Playwright handles browser navigation redirects itself, after which CraftScope checks the final URL. If it is off-site, the page is treated as an external redirect and no links are extracted.

### robots.txt

`parseRobotsTxt` builds groups of user-agent rules. CraftScope identifies as `CraftScopeBot/1.0`.

- A group naming CraftScopeBot takes precedence over the wildcard group.
- `*` wildcards match any sequence; a trailing `$` anchors the match at the end.
- The longest matching pattern wins.
- On an equal-length tie, `Allow` wins.
- `Crawl-delay` may be fractional; the largest matching value wins.
- `Sitemap` directives are collected for reporting but are not used to seed the crawl.

`isUsableRobotsResponse` rejects non-200 responses, HTML content types, and bodies without a recognizable `User-agent:` or `Sitemap:` line. This is why BashCraft's HTML `/robots.txt` response is treated as having no rules instead of being parsed as directives.

## URL normalization and duplicate handling

### Normalized form

`normalizeUrl` is deliberately conservative and only merges variations that should identify the same HTTP resource:

- fragments are dropped;
- hostname is lowercased and a trailing dot is removed;
- pathname trailing slashes are removed except for `/`;
- known tracking parameters are removed (`utm_*`, `ga_*`, `fbclid`, `gclid`, `msclkid`, `_ga`, `_gl`, and similar);
- remaining query parameters are sorted;
- percent-encoded unreserved characters are decoded; reserved characters stay encoded;
- paths remain case-sensitive;
- usernames and passwords are rejected.

Examples:

| Input | Normalized result |
| --- | --- |
| `https://Example.com:443/about/#team` | `https://example.com/about` |
| `https://example.com/about/?utm_source=nav&b=2&a=1` | `https://example.com/about?a=1&b=2` |
| `https://example.com/%7Euser` | `https://example.com/~user` |
| `https://example.com/About` | `https://example.com/About` (case preserved) |
| `https://example.com/%2Fpath` | `https://example.com/%2Fpath` (reserved slash stays encoded) |

`www` is **not** rewritten in the displayed URL. Instead, `siteKeyFromUrl` supplies the shared identity used for scope and deduplication, so the original link remains visible in the report.

### Crawl resource key

`crawlResourceKey` is the frontier identity:

```text
siteKey + normalizedPathname + search
```

For `https://example.com`, all of these collapse to the same key:

- `http://www.example.com/about`
- `https://example.com/about/`
- `https://example.com/about#team`
- `https://example.com/about?utm_source=nav`

The first one crawled becomes the canonical page record; aliases and redirect hops map back to it. This prevents protocol, `www`, slash, fragment, and tracking variants from being crawled twice.

### Duplicate accounting

`summary.duplicatesMerged` counts all collapsed duplicate occurrences, not just distinct URL variants:

- queue tasks skipped because the resource key was already visited;
- anchors repeated on the same page;
- repeated source→target relations after alias resolution;
- canonical pages reached through redirects or alternate variants.

This number is intentionally a useful “noise removed” metric rather than a precise count of unique URL spellings. The BashCraft report's value of 84 includes both frontier duplicates and repeated link occurrences.

## Internal and external links

### Internal

An internal URL has the same `siteKey` as the starting URL. Internal anchors are:

- normalized;
- deduplicated per source page;
- checked against robots.txt;
- bounded by depth and page limits;
- queued for crawling when eligible.

During report assembly, each source→target pair becomes one `links.internal` record. The record includes source and target URLs/paths/titles, anchor text, `rel`, target depth, status, HTTP status, reason, redirect usage, and soft-404 state.

### External

External URLs are normalized and grouped by exact destination. The crawler never requests them. Each external target records its host, reference count, and source pages/anchor text. `externalHosts` then aggregates targets and references per host.

Non-page protocols (`mailto:`, `tel:`, `javascript:`, `data:`, `blob:`, `ftp:`, `file:`) and hash-only links are skipped. Invalid `href` values are counted during HTML extraction but do not become link records.

Caveat: external **link destinations** are never fetched. A rendered page may still load third-party scripts or styles that the page itself references; those are browser assets, not link-check requests.

## Broken-link detection and health

### Page health

A page is:

- **broken** if it is a soft 404, returned HTTP 4xx/5xx, or failed at the network level;
- **warning** if it loaded but has an external redirect, unsupported content type, renderer failure, missing/very long title, thin content, truncated HTML, or another metadata warning;
- **ok** otherwise.

A starting URL that is broken, soft-404, non-HTML, or externally redirected aborts the scan with a specific `CrawlError` code instead of producing a misleading report.

### Link status

| Status | Meaning |
| --- | --- |
| `ok` | Target page is healthy |
| `warning` | Target page loaded but has warnings |
| `broken` | HTTP error, network failure, timeout, external redirect, or soft 404 |
| `blocked` | Target skipped because robots.txt disallows it |
| `unchecked` | Target outside the depth/page limit or otherwise not analyzed |

Broken relations are grouped by target URL into `links.broken`, with every discovered source page and anchor text. This gives the UI a “failure card” per destination while preserving all referring pages.

Network failures include DNS errors, connection refusal/reset, TLS failures, redirect loops, and timeouts. The error message is stored in the page record and propagated to referring link reasons.

### Soft 404s

Dynamic sites often return HTTP 200 for unknown routes. `detectSoft404` only runs for HTTP 200 HTML responses and flags:

- a title or first heading containing `404`, “page not found”, “not found”, or “nothing found”;
- a strong body marker such as `RESOURCE_NOT_FOUND`, `THE VOID CLAIMS THIS LINK`, `404_ERROR`, “this page could not be found”, or the GitHub Pages not-found phrase;
- a short body (under 900 characters) containing a fuller phrase such as “page not found” or “nothing found”.

A bare `404` in body copy is intentionally **not** enough, because navigation hubs can contain anchor text like “Soft 404”. This avoids a false positive found during integration testing. Soft 404s are treated as broken pages and broken link targets.

## Report assembly

The report has these top-level sections:

| Section | Contents |
| --- | --- |
| `meta` | Tool name/version, timestamps, input/start URL, site origin, site key, renderer used |
| `config` | Applied page/depth limits, JS/robots choices, timeout, delay, scope |
| `renderer` | Availability, engine, pages rendered, pages using HTTP fallback |
| `robots` | Checked/found flags, URL, status, rule counts, crawl delay, sitemaps, note |
| `summary` | Page health, link/target/reference counts, broken counts, duplicates, depth, limit flag |
| `warnings` | Scan-level warnings |
| `notes` | Methodology notes shown to the user |
| `pages` | Full page records with metadata, health, depth, parent, warnings, redirects, counts, children |
| `links.internal` | Every checked source→target relation |
| `links.external` | Deduplicated external destinations with sources |
| `links.broken` | Failing targets grouped with all source pages |
| `externalHosts` | External host aggregation |

The frontend derives all summaries, filters, sorting, graph layout, and exports from this single report object. There is no server-side session or database.

## Export functionality

Exports are generated client-side from the completed report:

| File | Generator | Contents |
| --- | --- | --- |
| `*.json` | `reportJson` | Full report, pretty-printed |
| `*-pages.csv` | `pagesCsv` | URL, path, title, status, health, depth, parent, link counts, response time, content type, JS flag, soft-404 flag, warnings |
| `*-broken-links.csv` | `brokenLinksCsv` | One row per broken target/source pair |
| `*-internal-links.csv` | `internalLinksCsv` | One row per internal relation |
| `*-sitemap.xml` | `sitemapXml` | 2xx, non-soft-404, non-external-redirect pages |

CSV values that begin with `=`, `+`, `-`, or `@` are prefixed with an apostrophe to reduce spreadsheet formula injection risk. Values containing commas, quotes, or newlines are quoted. XML text is escaped for `&`, `<`, `>`, `"`, and `'`.

The sitemap export is built from pages discovered during the crawl; it is not a copy of the site's `sitemap.xml` and does not include external destinations.

## Design decisions

- **Same-host scope, not subdomain scope.** This keeps the crawl predictable and prevents accidental expansion into docs, status pages, or other properties.
- **Conservative normalization.** Case-sensitive paths and preserved reserved encoding avoid merging resources that a server may distinguish.
- **Separate display URL and crawl identity.** The report shows the URL users recognize while `siteKey`/`crawlResourceKey` merge protocol and `www` variants for scheduling.
- **Sequential crawling.** Simpler, gentler, and easier to observe; the page and depth caps bound runtime.
- **Render first, static fallback second.** BashCraft is a React SPA, so JavaScript rendering is essential, but static parsing keeps the tool useful when no browser is installed.
- **No external link checking.** External link health would multiply requests and turn a site audit into an internet-wide probe. External destinations remain context only.
- **NDJSON over WebSockets/SSE.** A single POST with a streaming response is easy to proxy and parse, and it allows validation errors to remain normal HTTP JSON responses.
- **Client-side exports.** Avoids storing reports on the server and keeps file generation tied to the exact report the user is viewing.
- **Pragmatic robots parser.** It implements the parts that affect a small crawler without claiming full RFC coverage.
- **SSRF guard before crawling.** The service is not intended as an open proxy; private-network resolution is blocked by default.

## Security and operational notes

- Request body limit: 20 KB.
- URL input limit: 2048 characters; path limit: 2048 characters.
- Static HTML response cap: 4 MB; robots.txt cap: 256 KB.
- Redirect cap: 6; page cap: 100; depth cap: 6; scan concurrency: 2.
- Browser contexts are isolated per page; images, fonts, media, and service workers are disabled.
- Response headers include `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, and `Referrer-Policy: strict-origin-when-cross-origin`.
- No credentials, API keys, or tokens are required or stored.
- The analyzer is intended for local/trusted use. There is no authentication, and rendering executes site JavaScript. Do not expose it publicly without network isolation, authentication, and rate limiting.
- DNS rebinding and same-host redirects to private addresses remain theoretical SSRF risks; the preflight check is a guardrail, not a sandbox.

## Related documents

- [README](../README.md) — setup, usage, features, limitations
- [TESTING.md](TESTING.md) — automated/manual test matrix and actual results
- [BASHCRAFT-DEMO.md](BASHCRAFT-DEMO.md) — real BashCraft scan and fallback evidence
- [Sample BashCraft report](sample-output/bashcraftclub.vercel.app-2026-11-04.json)
