import { chromium } from "playwright";
import { DEFAULT_USER_AGENT } from "./fetch.js";

const IS_SERVERLESS = Boolean(
  process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME,
);

let browser = null;
let browserPromise = null;
let rendererInfo = {
  available: null,
  engine: null,
  message: "JavaScript renderer has not been started yet.",
};

function friendlyNavigationError(error, timeoutMs) {
  const message = String(error?.message || error);
  const detail = message.slice(0, 600);
  const withDetail = (result) => ({ ...result, detail });
  if (error?.name === "TimeoutError" || /timeout/i.test(message)) {
    return withDetail({
      code: "TIMEOUT",
      message: `The page did not finish loading within ${Math.round(timeoutMs / 1000)} seconds.`,
    });
  }
  if (/ERR_NAME_NOT_RESOLVED/i.test(message)) {
    return withDetail({ code: "DNS_ERROR", message: "The browser could not resolve this hostname." });
  }
  if (/ERR_CONNECTION_REFUSED/i.test(message)) {
    return withDetail({
      code: "CONNECTION_REFUSED",
      message: "The server refused the browser connection.",
    });
  }
  if (/ERR_CERT|SSL|TLS/i.test(message)) {
    return withDetail({
      code: "TLS_ERROR",
      message: "The site's HTTPS certificate could not be validated.",
    });
  }
  if (/ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED/i.test(message)) {
    return withDetail({
      code: "CONNECTION_RESET",
      message: "The connection closed before the page loaded.",
    });
  }
  if (/ERR_INTERNET_DISCONNECTED/i.test(message)) {
    return withDetail({ code: "OFFLINE", message: "The crawler appears to be offline." });
  }
  if (/ERR_ABORTED/i.test(message)) {
    return withDetail({
      code: "NAVIGATION_ABORTED",
      message: "The browser stopped loading before the page was ready.",
    });
  }
  return withDetail({ code: "BROWSER_ERROR", message: "The page failed to load in the browser." });
}

/**
 * Vercel Functions cannot launch Playwright's bundled browser because the
 * function filesystem is read-only and the browser is not installed. The
 * `@sparticuz/chromium` package ships a Chromium build made for that runtime.
 */
async function launchServerlessBrowser() {
  const chromiumModule = await import("@sparticuz/chromium");
  const puppeteerModule = await import("puppeteer-core");
  const serverlessChromium = chromiumModule.default ?? chromiumModule;
  const puppeteer = puppeteerModule.default ?? puppeteerModule;

  // The crawler never needs WebGL, so skip the graphics stack. This avoids
  // extracting SwiftShader into /tmp and keeps memory use predictable.
  serverlessChromium.setGraphicsMode = false;

  // An explicit path is useful when a host already provides Chromium and for
  // exercising the serverless renderer outside Vercel.
  const overridePath = process.env.CRAFTSCOPE_CHROMIUM_PATH;
  const executablePath = overridePath || (await serverlessChromium.executablePath());

  return puppeteer.launch({
    args: overridePath
      ? ["--disable-dev-shm-usage", "--disable-background-networking"]
      : [
          ...serverlessChromium.args,
          "--disable-dev-shm-usage",
          "--disable-background-networking",
        ],
    defaultViewport: { width: 1440, height: 1000 },
    executablePath,
    // @sparticuz/chromium is a chrome-headless-shell build, so Puppeteer must
    // use its shell mode when it owns the browser process.
    headless: overridePath ? true : "shell",
  });
}

async function launchBrowser() {
  if (IS_SERVERLESS) {
    try {
      const instance = await launchServerlessBrowser();
      rendererInfo = {
        available: true,
        engine: "serverless Chromium",
        message: "JavaScript rendering is available (serverless Chromium).",
      };
      return instance;
    } catch (error) {
      rendererInfo = {
        available: false,
        engine: null,
        message:
          "The serverless Chromium renderer could not start. Static HTML analysis will be used.",
      };
      console.warn(`[renderer] ${rendererInfo.message} ${error?.message || error}`);
      return null;
    }
  }

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

async function collectPuppeteerRedirects(response) {
  const chain = [...response.request().redirectChain(), response.request()];
  const hops = [];
  for (let index = 0; index < chain.length - 1; index += 1) {
    let status = null;
    try {
      status = (await chain[index].response())?.status() ?? null;
    } catch {
      status = null;
    }
    hops.push({ from: chain[index].url(), to: chain[index + 1].url(), status });
  }
  return hops;
}

/**
 * Extracts the same page data in every renderer. The function is serialized
 * and executed inside the browser, so it must stay self-contained.
 */
function extractRenderedPage() {
  const textOf = (element) => {
    const value =
      element?.innerText ||
      element?.textContent ||
      element?.getAttribute?.("aria-label") ||
      element?.getAttribute?.("title") ||
      "";
    return String(value)
      .replace(/\s+/g, " ")
      .trim();
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
}

function renderedResult(data, { finalUrl, status, contentType, redirects }) {
  return {
    rendered: true,
    finalUrl: data.url || finalUrl,
    status,
    contentType,
    redirects,
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
}

/**
 * Renders a page in a fresh, isolated browser context. Images, media, and webfonts
 * are blocked because they add cost but do not contribute to link discovery.
 */
async function renderPageWithPlaywright(inputUrl, { timeoutMs = 15000, signal } = {}) {
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

    const data = await page.evaluate(extractRenderedPage);
    const headers = response.headers();

    return renderedResult(data, {
      finalUrl: page.url(),
      status: response.status(),
      contentType: headers["content-type"] || "",
      redirects: await collectRedirects(response),
    });
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

async function renderPageWithPuppeteer(inputUrl, { timeoutMs = 15000, signal } = {}) {
  const instance = await ensureBrowser();
  if (!instance) {
    return {
      rendered: false,
      error: {
        code: "RENDERER_UNAVAILABLE",
        message:
          "JavaScript rendering is unavailable in this deployment. Static HTML analysis was used instead.",
      },
    };
  }

  if (signal?.aborted) {
    return {
      rendered: false,
      error: { code: "ABORTED", message: "The scan was cancelled." },
    };
  }

  let page;
  let onAbort = null;
  try {
    // @sparticuz/chromium does not support creating a separate browser
    // context: createBrowserContext()/context.newPage() closes the target.
    // A fresh page in the default context is still isolated enough here.
    page = await instance.newPage();
    await page.setUserAgent(DEFAULT_USER_AGENT);
    await page.setViewport({ width: 1440, height: 1000 });

    if (signal) {
      onAbort = () => {
        page.close().catch(() => {});
      };
      signal.addEventListener("abort", onAbort, { once: true });
    }

    await page.setRequestInterception(true);
    page.on("request", (request) => {
      const type = request.resourceType();
      if (["image", "media", "font"].includes(type)) {
        request.abort().catch(() => {});
        return;
      }
      request.continue().catch(() => {});
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
        error: signal?.aborted
          ? { code: "ABORTED", message: "The scan was cancelled." }
          : friendlyNavigationError(error, timeoutMs),
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

    await page
      .waitForNetworkIdle({ idleTime: 500, timeout: Math.min(2400, timeoutMs) })
      .catch(() => {});
    await page
      .waitForFunction(
        () => Boolean(document.body && document.body.innerText && document.body.innerText.trim()),
        { timeout: Math.min(1800, timeoutMs) },
      )
      .catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 180));

    const data = await page.evaluate(extractRenderedPage);
    const headers = response.headers();

    return renderedResult(data, {
      finalUrl: page.url(),
      status: response.status(),
      contentType: headers["content-type"] || "",
      redirects: await collectPuppeteerRedirects(response),
    });
  } catch (error) {
    return {
      rendered: false,
      finalUrl: page?.url?.() || inputUrl,
      redirects: [],
      error: signal?.aborted
        ? { code: "ABORTED", message: "The scan was cancelled." }
        : friendlyNavigationError(error, timeoutMs),
    };
  } finally {
    if (signal && onAbort) signal.removeEventListener("abort", onAbort);
    if (page) await page.close().catch(() => {});
  }
}

export async function renderPage(inputUrl, options = {}) {
  return IS_SERVERLESS
    ? renderPageWithPuppeteer(inputUrl, options)
    : renderPageWithPlaywright(inputUrl, options);
}

for (const event of ["SIGINT", "SIGTERM", "exit"]) {
  process.once(event, () => {
    closeBrowser().catch(() => {});
  });
}
