import { chromium } from "playwright";
import { DEFAULT_USER_AGENT } from "./fetch.js";

let browser = null;
let browserPromise = null;
let rendererInfo = {
  available: null,
  engine: null,
  message: "JavaScript renderer has not been started yet.",
};

function friendlyNavigationError(error, timeoutMs) {
  const message = String(error?.message || error);
  if (error?.name === "TimeoutError" || /timeout/i.test(message)) {
    return {
      code: "TIMEOUT",
      message: `The page did not finish loading within ${Math.round(timeoutMs / 1000)} seconds.`,
    };
  }
  if (/ERR_NAME_NOT_RESOLVED/i.test(message)) {
    return { code: "DNS_ERROR", message: "The browser could not resolve this hostname." };
  }
  if (/ERR_CONNECTION_REFUSED/i.test(message)) {
    return { code: "CONNECTION_REFUSED", message: "The server refused the browser connection." };
  }
  if (/ERR_CERT|SSL|TLS/i.test(message)) {
    return {
      code: "TLS_ERROR",
      message: "The site's HTTPS certificate could not be validated.",
    };
  }
  if (/ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED/i.test(message)) {
    return { code: "CONNECTION_RESET", message: "The connection closed before the page loaded." };
  }
  if (/ERR_INTERNET_DISCONNECTED/i.test(message)) {
    return { code: "OFFLINE", message: "The crawler appears to be offline." };
  }
  if (/ERR_ABORTED/i.test(message)) {
    return {
      code: "NAVIGATION_ABORTED",
      message: "The browser stopped loading before the page was ready.",
    };
  }
  return { code: "BROWSER_ERROR", message: "The page failed to load in the browser." };
}

async function launchBrowser() {
  const attempts = [
    ["bundled Chromium", {}],
    ["system Chrome", { channel: "chrome" }],
    ["system Edge", { channel: "msedge" }],
  ];

  let lastError = null;
  for (const [label, options] of attempts) {
    try {
      const instance = await chromium.launch({
        headless: true,
        ...options,
        args: ["--disable-dev-shm-usage", "--disable-background-networking"],
      });
      rendererInfo = {
        available: true,
        engine: label,
        message: `JavaScript rendering is available (${label}).`,
      };
      return instance;
    } catch (error) {
      lastError = error;
    }
  }

  rendererInfo = {
    available: false,
    engine: null,
    message:
      "No Chromium browser is available. Static HTML analysis will be used. Run `npx playwright install chromium` to enable JavaScript rendering.",
  };
  console.warn(`[renderer] ${rendererInfo.message}`);
  if (lastError) console.warn(`[renderer] Last launch error: ${lastError.message}`);
  return null;
}

export async function ensureBrowser() {
  if (browser?.isConnected()) return browser;
  if (!browserPromise) {
    browserPromise = launchBrowser()
      .then((instance) => {
        browser = instance;
        return instance;
      })
      .catch(() => null)
      .finally(() => {
        browserPromise = null;
      });
  }
  return browserPromise;
}

export function getRendererInfo() {
  return { ...rendererInfo };
}

export async function closeBrowser() {
  if (browser) {
    try {
      await browser.close();
    } catch {
      // The process may already be shutting down.
    }
    browser = null;
  }
  rendererInfo = {
    available: false,
    engine: null,
    message: "The JavaScript renderer has been shut down.",
  };
}

async function collectRedirects(response) {
  const holes = [];
  let request = response?.request();
  while (request) {
    holes.unshift(request);
    request = request.redirectedFrom();
  }

  const hops = [];
  for (let index = 1; index < holes.length; index += 1) {
    let status = null;
    try {
      status = (await holes[index - 1].response())?.status() ?? null;
    } catch {
      status = null;
    }
    hops.push({ from: holes[index - 1].url(), to: holes[index].url(), status });
  }
  return hops;
}

/**
 * Renders a page in a fresh, isolated browser context. Images, media, and webfonts
 * are blocked because they add cost but do not contribute to link discovery.
 */
export async function renderPage(inputUrl, { timeoutMs = 15000, signal } = {}) {
  const instance = await ensureBrowser();
  if (!instance) {
    return {
      rendered: false,
      error: {
        code: "RENDERER_UNAVAILABLE",
        message:
          "JavaScript rendering is unavailable. Install Playwright Chromium to render client-side pages.",
      },
    };
  }

  if (signal?.aborted) {
    return {
      rendered: false,
      error: { code: "ABORTED", message: "The scan was cancelled." },
    };
  }

  let context;
  try {
    context = await instance.newContext({
      userAgent: DEFAULT_USER_AGENT,
      viewport: { width: 1440, height: 1000 },
      locale: "en-US",
      reducedMotion: "reduce",
      serviceWorkers: "block",
      ignoreHTTPSErrors: false,
    });
    const page = await context.newPage();

    await page.route("**/*", async (route) => {
      const type = route.request().resourceType();
      if (["image", "media", "font"].includes(type)) {
        await route.abort().catch(() => {});
        return;
      }
      await route.continue().catch(() => {});
    });

    let response;
    try {
      response = await page.goto(inputUrl, {
        waitUntil: "domcontentloaded",
        timeout: timeoutMs,
      });
    } catch (error) {
      return {
        rendered: false,
        finalUrl: page.url(),
        redirects: [],
        error: friendlyNavigationError(error, timeoutMs),
      };
    }

    if (!response) {
      return {
        rendered: false,
        finalUrl: page.url(),
        redirects: [],
        error: { code: "NO_RESPONSE", message: "The browser received no document response." },
      };
    }

    // Let client-side routers settle, but cap the wait so analytics or polling
    // traffic cannot stall the crawl forever.
    await page
      .waitForLoadState("networkidle", { timeout: Math.min(2400, timeoutMs) })
      .catch(() => {});
    await page
      .waitForFunction(
        () => Boolean(document.body && document.body.innerText && document.body.innerText.trim()),
        undefined,
        { timeout: Math.min(1800, timeoutMs) },
      )
      .catch(() => {});
    await page.waitForTimeout(180);

    const data = await page.evaluate(() => {
      const textOf = (element) => {
        const value =
          element?.innerText ||
          element?.textContent ||
          element?.getAttribute?.("aria-label") ||
          element?.getAttribute?.("title") ||
          "";
        return String(value).replace(/\s+/g, " ").trim();
      };

      const anchors = [];
      for (const element of document.querySelectorAll("a[href], area[href]")) {
        const rawHref = (element.getAttribute("href") || "").trim();
        if (!rawHref) continue;
        const imageAlt = element.querySelector?.("img[alt]")?.getAttribute("alt") || "";
        anchors.push({
          href: element.href || rawHref,
          rawHref,
          text:
            textOf(element).slice(0, 180) ||
            String(element.getAttribute("aria-label") || imageAlt || "")
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 180),
          rel: String(element.getAttribute("rel") || "").toLowerCase().slice(0, 100),
        });
      }

      const metadata = (name) =>
        document.querySelector(`meta[name="${name}"]`)?.getAttribute("content")?.trim() || "";

      const canonicalHref = document.querySelector('link[rel="canonical"]')?.getAttribute("href");
      let canonicalUrl = null;
      if (canonicalHref) {
        try {
          canonicalUrl = new URL(canonicalHref, location.href).toString();
        } catch {
          canonicalUrl = null;
        }
      }

      return {
        url: location.href,
        title: String(document.title || "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 2000),
        titleLength: String(document.title || "").replace(/\s+/g, " ").trim().length,
        description: metadata("description").slice(0, 500),
        h1: textOf(document.querySelector("h1")).slice(0, 240),
        bodyText: textOf(document.body).slice(0, 12000),
        anchors,
        canonicalUrl,
        lang: String(document.documentElement.lang || "").slice(0, 30),
        htmlChars: document.documentElement.outerHTML.length,
      };
    });

    const headers = response.headers();
    return {
      rendered: true,
      finalUrl: data.url || page.url(),
      status: response.status(),
      contentType: headers["content-type"] || "",
      redirects: await collectRedirects(response),
      title: data.title,
      titleLength: data.titleLength,
      description: data.description,
      h1: data.h1,
      bodyText: data.bodyText,
      anchors: data.anchors,
      rawAnchorCount: data.anchors.length,
      invalidHrefCount: 0,
      canonicalUrl: data.canonicalUrl,
      lang: data.lang,
      htmlBytes: Math.max(0, data.htmlChars),
      error: null,
    };
  } catch (error) {
    return {
      rendered: false,
      finalUrl: inputUrl,
      redirects: [],
      error: friendlyNavigationError(error, timeoutMs),
    };
  } finally {
    if (context) await context.close().catch(() => {});
  }
}

for (const event of ["SIGINT", "SIGTERM", "exit"]) {
  process.once(event, () => {
    closeBrowser().catch(() => {});
  });
}
