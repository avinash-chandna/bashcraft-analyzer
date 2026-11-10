# CraftScope

A local-first website analyzer built for [BashCraft Club](https://bashcraftclub.vercel.app/). CraftScope crawls a site's internal pages, checks every internal link, catalogs external destinations without requesting them, and turns the result into an interactive map, a searchable report, and portable exports.

![CraftScope report overview](screenshots/report-desktop.png)

## What it does

- **Maps internal pages** from a single starting URL, one request at a time.
- **Checks internal links** and reports HTTP failures, timeouts, connection errors, redirects, and soft 404s.
- **Catalogs external links** for context without fetching those destinations.
- **Handles real-world URL noise**: fragments, tracking parameters, `www`/non-`www`, `http`/`https`, trailing slashes, duplicate query orders, and percent-encoding variants.
- **Renders JavaScript pages** with headless Chromium and falls back to static HTML when needed.
- **Respects robots.txt**, including wildcard rules, `Allow`/`Disallow` precedence, and `Crawl-delay`.
- **Detects soft 404s** that return HTTP 200, including the BashCraft SPA fallback.
- **Exports** full JSON, page inventory CSV, broken-link CSV, internal-link CSV, and sitemap XML.
- **Shows live progress** over an NDJSON stream while the crawl runs.

The UI includes an interactive sitemap graph, page inspector, sortable page inventory, link ledger with search and filters, summary statistics, responsive mobile layouts, and accessible keyboard/focus states.

## Documentation map

- **[Technical documentation](docs/TECHNICAL.md)** — architecture, crawl lifecycle, URL normalization, duplicate handling, link classification, soft 404s, exports, and design decisions.
- **[BashCraft demonstration](docs/BASHCRAFT-DEMO.md)** — the real scan, live soft-404/robots evidence, screenshots, and preserved JSON output.
- **[Testing report](docs/TESTING.md)** — automated/manual test cases, expected vs actual results, edge cases, and known gaps.
- **[Sample BashCraft report](docs/sample-output/bashcraftclub.vercel.app-2026-11-04.json)** — the complete structured output from the demonstrated run.

No credentials, API keys, tokens, or paid services are required. The analyzer only reads public pages you choose.

## Quick start

### Get the code

Clone the submitted repository URL (replace the placeholder below), or extract the delivered project archive and open a terminal in the project root:

```bash
git clone <repository-url>
cd bashcraft-analyzer
```

Then optionally select the supported Node baseline:

```bash
nvm use
```

The project root is the directory containing `package.json`, `server/`, `src/`, and `vite.config.ts`.

### Requirements

- Node.js 20.19+ or 22.12+ (`.nvmrc` pins a Node 22 baseline)
- npm
- Chromium for JavaScript rendering (installed through Playwright)

### Install

```bash
npm install
npx playwright install chromium
```

`npm install` also installs the Express API, React frontend, Cheerio, and Playwright dependencies from `package-lock.json`. No `.env` file or secret is required for a normal public-site scan.

If the bundled Chromium cannot launch, CraftScope automatically tries system Chrome and then system Edge. Static HTTP analysis still works when no browser is available.

### Development

```bash
npm run dev
```

- Frontend: <http://localhost:5173>
- API: <http://localhost:8787>
- Vite proxies `/api` requests to the API server.

### Production build

```bash
npm run build
npm start
```

Open <http://localhost:8787>. Express serves both the API and the built frontend from `dist/`.

### Deploy on Vercel

The repository includes Vercel Functions in `api/`, so the frontend and crawler deploy together:

1. Import the repository at [vercel.com/new](https://vercel.com/new).
2. Keep the detected Vite settings (`npm run build`, output `dist`). `vercel.json` records them explicitly.
3. Deploy. `/api/analyze`, `/api/health`, and `/api/meta` are served by the functions in `api/`.

JavaScript rendering on Vercel uses `@sparticuz/chromium`, which is bundled into the function. The first scan after a cold start can take a few extra seconds. If Chromium cannot start, the crawler automatically falls back to static HTML analysis and records a warning in the report.

A static-only deployment will not work: the frontend needs the API to crawl sites. If the API is missing, CraftScope now reports an `API_UNAVAILABLE` error instead of surfacing a raw host 404.

## Using the app

1. Enter a public `http://` or `https://` URL. A bare domain is upgraded to `https://`.
2. Choose a page limit and crawl depth.
3. Optionally disable JavaScript rendering or robots.txt enforcement.
4. Start the scan and watch live progress.
5. Explore the report:
   - **Sitemap** — interactive hierarchy graph with pan, zoom, search, and page inspection.
   - **Pages** — filter by health, sort by depth/status/link counts/response time, and inspect metadata.
   - **Links** — broken, internal, and external tabs with search, status filters, and sorting.
   - **Export** — download the report in five formats.

The default scan target is BashCraft Club. The demonstrated run and its preserved output are summarized below.

## BashCraft demonstration

**Tested URL:** <https://bashcraftclub.vercel.app/>  
**Scan date:** 4 November 2026  
**Settings:** 25-page limit, depth 3, JavaScript rendering on, robots.txt respected

| Result | Value |
| --- | ---: |
| Pages discovered | 15 |
| Internal links checked | 75 |
| Broken links | 0 |
| External destinations | 43 |
| External hosts | 7 |
| Duplicate occurrences merged | 84 |
| Maximum depth reached | 2 |
| Pages rendered with JavaScript | 15 |
| Scan duration | 28.7 s |

BashCraft returns HTTP 200 for unknown SPA routes. CraftScope rendered an unknown route, observed `h1 = 404` and `RESOURCE_NOT_FOUND // THE VOID CLAIMS THIS LINK`, and correctly classified it as a soft 404. The live evidence and all screenshots are in [docs/BASHCRAFT-DEMO.md](docs/BASHCRAFT-DEMO.md).

![BashCraft rendered soft-404 screen](screenshots/bashcraft-soft404.png)

## Crawl methodology

### Scope

CraftScope crawls **one hostname**. `www` and non-`www` variants and `http`/`https` variants of that hostname are treated as the same site. Subdomains are treated as external. External destinations are recorded in the report but are **never requested**.

Caveat: external link destinations are never fetched. Rendering a page may still load third-party scripts or styles that the page itself references, because those are browser assets rather than link checks.

Redirects are followed only while they remain on the same site. An off-site redirect is reported as a warning and its destination is not crawled.

### URL normalization

Before a URL enters the crawl frontier it is normalized:

- Fragments are removed because they are not sent to the server.
- Hostnames are lowercased and a trailing dot is removed.
- Trailing slashes are removed, except for the root path.
- Known analytics parameters (`utm_*`, `gclid`, `fbclid`, `msclkid`, and similar) are removed.
- Remaining query parameters are sorted, so `?b=2&a=1` and `?a=1&b=2` deduplicate.
- Percent-encoded unreserved characters are decoded; reserved characters stay encoded.
- Paths remain case-sensitive because servers may distinguish `/About` from `/about`.

Deduplication uses a crawl resource key that merges same-site protocol, `www`, trailing-slash, fragment, and query-order variants. The original and final URLs are preserved in page records so redirects remain visible.

### Loops, limits, and duplicates

- Every target is queued at most once.
- Self-links and cycles are safe; they are recorded as relationships rather than re-crawled.
- Pages already visited are merged into the existing record.
- The default limits are **25 pages** and **3 levels**. The API accepts 1–100 pages and 0–6 levels.
- When the page limit is reached, the report includes a banner and marks unvisited targets as not checked.
- Requests are sequential with a minimum 200 ms delay. A larger `Crawl-delay` from robots.txt is honored up to 10 seconds.

### JavaScript rendering

When rendering is enabled, each page is loaded in a fresh isolated Playwright context:

- Images, media, and fonts are blocked because they do not contribute links.
- Service workers are blocked.
- CraftScope waits for DOM content, a short network-idle window, visible body text, and a final settle delay.
- Links added by client-side JavaScript are collected from the rendered DOM.

If the browser is unavailable, navigation fails, or rendering is disabled, CraftScope falls back to a static HTTP request and parses the HTML with Cheerio. Pages that used the fallback are recorded in `renderer.pagesUsingHttpFallback`.

### robots.txt

CraftScope requests `/robots.txt` before crawling and identifies itself as `CraftScopeBot/1.0`.

- Specific user-agent groups take precedence over the `*` group.
- `*` wildcards and `$` end anchors are supported.
- The longest matching rule wins; an `Allow` wins a tie with an equally specific `Disallow`.
- `Crawl-delay` is applied between requests and capped at 10 seconds.
- `Sitemap` directives are reported but are not used to seed the crawl.
- Disallowed links are recorded as **blocked** and are not requested.
- If the starting URL is disallowed, the scan stops with `ROBOTS_DISALLOWED`.

Some hosts return an HTML app shell for `/robots.txt`. CraftScope rejects HTML responses and responses without recognizable robots directives, then treats the site as having no crawl rules. BashCraft's `/robots.txt` fallback is handled this way.

### Broken links and soft 404s

Internal destinations are checked as part of the crawl. A link can be:

- `ok` — resolved successfully
- `warning` — loaded but has metadata or content warnings
- `broken` — HTTP 4xx/5xx, network failure, timeout, TLS failure, external redirect, or soft 404
- `blocked` — deliberately skipped because of robots.txt
- `unchecked` — discovered but outside the depth/page limit

Dynamic sites often return HTTP 200 for unknown routes. CraftScope flags a soft 404 when all of these are true:

- The response is HTTP 200 and HTML.
- The title or first heading contains `404`, "page not found", "not found", or "nothing found"; **or**
- The body contains a strong not-found marker such as `RESOURCE_NOT_FOUND`, `THE VOID CLAIMS THIS LINK`, or "this page could not be found"; **or**
- The body is short (under 900 characters) and contains a fuller phrase such as "page not found" or "nothing found".

A bare `404` in body copy is deliberately not enough, because link hubs often contain anchor text like "Soft 404". A soft 404 at the starting URL stops the scan with `SOFT_404_START`; anywhere else it marks the page and its referring links as broken.

Missing or very long titles, thin server-rendered content, unsupported content types, external redirects, truncated HTML, and renderer failures are reported as warnings rather than failures.

## Report and exports

The full JSON report contains:

- `meta` — tool version, timestamps, input URL, start URL, site, and renderer used
- `config` — applied limits, rendering/robots settings, request delay, and crawl scope
- `renderer` — availability, engine, pages rendered, pages using HTTP fallback
- `robots` — status, rule counts, crawl delay, sitemaps, and an explanatory note
- `summary` — page health, link counts, duplicates, depth, and limit flags
- `pages` — one record per page with status, health, metadata, depth, parent, warnings, redirects, and link counts
- `links.internal` — every checked internal relationship, including failures and robots blocks
- `links.external` — deduplicated external destinations and their source pages
- `links.broken` — failing targets with every source page and anchor text
- `externalHosts` — external host aggregation
- `warnings` and `notes` — scan-level caveats

Export formats:

| Format | File | Contents |
| --- | --- | --- |
| JSON | `*.json` | Complete structured report |
| CSV | `*-pages.csv` | Page inventory and health |
| CSV | `*-broken-links.csv` | One row per broken target/source pair |
| CSV | `*-internal-links.csv` | Every internal relationship |
| XML | `*-sitemap.xml` | Successful, non-soft-404 HTML pages only |

CSV cells neutralize spreadsheet formula injection, and XML values are escaped. Exports are generated in the browser from the completed report.

## API

### `POST /api/analyze`

Accepts JSON and streams newline-delimited JSON (NDJSON):

```bash
curl -N -X POST http://localhost:8787/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"url":"https://bashcraftclub.vercel.app/","maxPages":25,"maxDepth":3}'
```

Request fields:

| Field | Default | Allowed |
| --- | --- | --- |
| `url` | required | Public `http`/`https` URL, max 2048 characters |
| `maxPages` | `25` | Integer 1–100 |
| `maxDepth` | `3` | Integer 0–6 |
| `renderJs` | `true` | Boolean |
| `respectRobots` | `true` | Boolean |
| `timeoutMs` | `15000` | Integer 3000–30000 |

Event types:

```json
{"type":"accepted","data":{"startUrl":"...","options":{}}}
{"type":"stage","stage":"robots","message":"Checking robots.txt…"}
{"type":"progress","data":{"pagesCrawled":3,"pagesQueued":4,"currentPath":"/about"}}
{"type":"warning","message":"..."}
{"type":"complete","data":{"meta":{},"pages":[],"links":{}}}
{"type":"error","error":{"code":"INVALID_URL","message":"...","hint":"..."}}
{"type":"ping","at":1730000000000}
```

Validation errors are returned as normal JSON before the stream starts. Scan-time errors are streamed as an `error` event. At most two scans run concurrently; additional requests receive `429 ANALYZER_BUSY`.

### `GET /api/health`

Returns service status, renderer availability, and the active scan count.

### `GET /api/meta`

Returns the default URL, tool version, renderer status, and hard limits used by the UI.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8787` | API and production frontend port |
| `DEFAULT_ANALYZER_URL` | `https://bashcraftclub.vercel.app/` | URL reported by `/api/meta` |
| `ALLOW_PRIVATE_HOSTS` | unset | Set to `true` to allow localhost/private IP scans on a trusted machine |

PowerShell example for the local fixture:

```powershell
$env:ALLOW_PRIVATE_HOSTS = "true"
$env:PORT = "8790"
npm start
```

## Security

CraftScope is designed for local or trusted self-hosted use.

- **SSRF guard:** the starting hostname is resolved before the scan and blocked if it points to loopback, link-local, private, carrier-grade NAT, multicast, reserved, or documentation ranges. Local hostnames and cloud metadata hostnames are also blocked.
- **Redirect confinement:** redirects are followed only within the same site identity.
- **External request policy:** external links are never fetched.
- **Resource caps:** 20 KB JSON request body, 2048-character URL/path limits, 4 MB static HTML cap, 256 KB robots.txt cap, 6 redirects, 100 pages, and depth 6.
- **Browser isolation:** each rendered page gets a fresh context; images, media, fonts, and service workers are disabled.
- **Output safety:** React renders report text as text; external links use `rel="noreferrer noopener"`; CSV and XML exports are escaped/neutralized.
- **Response headers:** `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, and `Referrer-Policy: strict-origin-when-cross-origin`.

The SSRF check is a guardrail, not a complete sandbox. DNS rebinding and same-host redirects to internal addresses remain theoretical risks, and rendering executes JavaScript from the scanned site. Do not expose this analyzer as an unauthenticated public service without additional network isolation, authentication, and rate limiting.

### Local fixture exception

`ALLOW_PRIVATE_HOSTS=true` disables the private-network guard entirely. Use it only on a local machine you control, and turn it off afterwards.

## Testing and verification

```bash
npm test              # 40 Node tests
npx tsc --noEmit      # TypeScript check
npm run build         # Production bundle
npm run check         # All three in sequence
```

The automated suite covers URL normalization, site identity, robots wildcard and precedence rules, robots response detection, HTML extraction, soft-404 detection, SSRF classification, request validation, timeout handling, off-site redirects, and a full integration crawl against a local HTTP fixture. The detailed test matrix, actual results, and untested gaps are in [docs/TESTING.md](docs/TESTING.md).

### Broken-link UI harness

The repository includes a local fixture site and an end-to-end Playwright check:

```bash
# Terminal 1: fixture site on 127.0.0.1:8899 with an external tripwire on :8898
npm run fixture

# Terminal 2: production build/API with private hosts allowed on port 8790
npm run build
$env:ALLOW_PRIVATE_HOSTS = "true"
$env:PORT = "8790"
npm start

# Terminal 3: drive the real UI, assert broken links, JS links, and zero external requests
npm run verify:ui
```

The check verifies two broken targets (HTTP 404 and soft 404), the JS-generated page, long/missing-title warnings, external "NOT REQUESTED" labeling, absence of horizontal overflow, zero browser console errors, and zero requests to the external tripwire. It writes `screenshots/broken-links-desktop.png`.

`scripts/visual-check.mjs` is an additional screenshot harness that intercepts `/api/analyze` with a saved report JSON and captures desktop/mobile views of the landing page, report, pages, links, and export screens.

## Project layout

```text
api/
  analyze.js               Vercel Function entrypoint for POST /api/analyze
  health.js                Vercel Function entrypoint for GET /api/health
  meta.js                  Vercel Function entrypoint for GET /api/meta

server/
  app.js                   Express API, NDJSON streaming, optional static serving
  index.js                 Self-hosted server entrypoint
  crawler/
    analyzer.js            Crawl orchestration and report aggregation
    browser.js             Playwright rendering with Chrome/Edge fallback
    fetch.js               Manual redirects, timeouts, body limits
    html.js                Cheerio extraction, warnings, soft-404 detection
    robots.js              robots.txt parser and matcher
    ssrf.js                Private-network classification and DNS guard
    url.js                 URL normalization and site identity
    validate.js            Request validation and destination checks
    *.test.js              Node unit and integration tests

src/
  App.tsx                  View orchestration and NDJSON stream parsing
  components/              Landing, scanning, report, graph, tables, exports
  lib/                     Formatting and export helpers
  styles.css               Responsive acid-lime/terminal design system
  types.ts                 Shared report types

docs/
  TECHNICAL.md             Architecture and crawl design
  BASHCRAFT-DEMO.md        Real BashCraft run, evidence, screenshots
  TESTING.md               Test matrix, expected/actual results, gaps
  sample-output/           Preserved JSON, CSV, and XML exports

scripts/
  fixture-site.mjs         Local fixture and external tripwire
  verify-broken-ui.mjs     End-to-end broken-link UI check
  visual-check.mjs         Screenshot and overflow harness
  export-sample.mjs        Rebuilds the documented sample exports
  capture-bashcraft-soft404.mjs  Live BashCraft fallback capture

screenshots/               Reviewed desktop and mobile captures
index.html                 SPA entry document
package.json               Scripts and dependencies
package-lock.json          Reproducible dependency lockfile
vite.config.ts             Vite build and API proxy configuration
tsconfig.json              TypeScript configuration
.nvmrc                     Node 22 baseline for reviewers
.gitignore                 Excludes dependencies, builds, and local secrets
```

## Known limitations

- **Same hostname only.** Subdomains are external and are not crawled.
- **Hash routing is not crawled.** `#section` and `#/route` links are treated as same-document navigation.
- **External links have no status codes by design.** They are catalogued, not checked. Rendering a page may still load third-party assets referenced by that page.
- **Best-effort rendering.** Links revealed only by scrolling, hover, form interaction, or unusual Shadow DOM patterns may be missed. Pages requiring authentication are not supported.
- **Soft 404 detection is heuristic.** Custom not-found copy can be missed, and an unusually phrased short page can be flagged.
- **robots.txt support is pragmatic, not a complete RFC implementation.** Sitemap directives are reported but not used to seed crawls.
- **UTF-8 assumption.** Static response decoding uses UTF-8; non-UTF-8 pages may have garbled text.
- **No persistence.** Reports live in the browser session and exported files; there is no database or scan history.
- **Sequential crawling.** Large sites are intentionally bounded by the page, depth, and concurrency limits.
- **Not a public service.** There is no authentication. See the security notes before deploying it.

The detailed test matrix and untested gaps are documented in [docs/TESTING.md](docs/TESTING.md).

## Stack

React 19, TypeScript, Vite, Express 5, Cheerio, Playwright, and Node's built-in test runner. The visual system uses Anybody, Hanken Grotesk, and Space Mono with an acid-lime terminal palette.
