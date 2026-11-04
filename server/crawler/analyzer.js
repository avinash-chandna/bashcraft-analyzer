import { STATUS_CODES } from "node:http";
import { fetchTextResource } from "./fetch.js";
import {
  detectSoft404,
  extractPageFromHtml,
  hasUnsupportedContentType,
  pageWarnings,
} from "./html.js";
import { isUsableRobotsResponse, parseRobotsTxt } from "./robots.js";
import {
  crawlResourceKey,
  displayPath,
  isAnchorOnlyHref,
  normalizeUrl,
  sameSiteKey,
  siteKeyFromUrl,
} from "./url.js";
import { getRendererInfo, renderPage } from "./browser.js";

const TOOL = {
  name: "CraftScope",
  version: "1.0.0",
};

const NON_PAGE_PROTOCOLS = /^(mailto|tel|javascript|data|blob|ftp|file):/i;

export class CrawlError extends Error {
  constructor(message, { code = "CRAWL_FAILED", hint = null, status = 422 } = {}) {
    super(message);
    this.name = "CrawlError";
    this.code = code;
    this.hint = hint;
    this.status = status;
  }
}

function delay(ms, signal) {
  if (!ms) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new CrawlError("The scan was cancelled.", { code: "SCAN_CANCELLED", status: 499 }));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new CrawlError("The scan was cancelled.", { code: "SCAN_CANCELLED", status: 499 }));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function assertNotAborted(signal) {
  if (signal?.aborted) {
    throw new CrawlError("The scan was cancelled.", { code: "SCAN_CANCELLED", status: 499 });
  }
}

function statusDescription(status) {
  if (!status) return "No HTTP response";
  const label = STATUS_CODES[status] || "Unknown status";
  return `HTTP ${status} ${label}`;
}

function normalizeTitle(title, titleLength) {
  const stored = String(title ?? "").trim();
  return {
    title: stored.slice(0, 2000),
    titleLength: Number.isFinite(titleLength) ? titleLength : stored.length,
  };
}

function mergeUniqueWarnings(warnings, newWarnings) {
  for (const warning of newWarnings) {
    if (warning && !warnings.includes(warning)) warnings.push(warning);
  }
  return warnings;
}

function makeFailurePage(task, error, { depth }) {
  return {
    url: task.url,
    requestedUrl: task.url,
    path: displayPath(task.url),
    title: "",
    titleLength: 0,
    description: "",
    h1: "",
    lang: "",
    depth,
    parent: task.parentUrl
      ? { url: task.parentUrl, title: task.parentTitle || "", linkText: task.discoveredText || "" }
      : null,
    statusCode: null,
    health: "broken",
    soft404: false,
    contentType: "",
    rendered: false,
    responseTimeMs: 0,
    htmlBytes: 0,
    redirects: [],
    externalRedirect: false,
    error,
    warnings: [],
    counts: { internalLinks: 0, externalLinks: 0, incomingInternalLinks: 0 },
    children: [],
  };
}

/**
 * Main crawl orchestration. It is intentionally sequential: a small site can
 * be mapped quickly, and serial requests are kinder to origin servers. External
 * URLs become report data only; they are never requested during the crawl.
 */
export async function analyzeSite(input, { onEvent = () => {}, signal } = {}) {
  const { startUrl, siteKey, options, originalUrl } = input;
  const startedAt = new Date();
  const startedMs = Date.now();
  const warnings = [];
  const emit = (event) => {
    try {
      onEvent(event);
    } catch {
      // A disconnected SSE/NDJSON consumer should not crash the crawl.
    }
  };
  const warn = (message) => {
    mergeUniqueWarnings(warnings, [message]);
    emit({ type: "warning", message });
  };

  emit({
    type: "stage",
    stage: "robots",
    message: options.respectRobots ? "Checking robots.txt…" : "Robots.txt checks are disabled.",
  });

  let robotsParser = null;
  let robotsSummary = {
    checked: options.respectRobots,
    found: false,
    url: new URL("/robots.txt", startUrl).toString(),
    status: null,
    allowRuleCount: 0,
    disallowRuleCount: 0,
    crawlDelaySeconds: 0,
    sitemaps: [],
    note: options.respectRobots ? "Not checked yet." : "Robots.txt enforcement was disabled for this scan.",
  };

  if (options.respectRobots) {
    const robotsUrl = new URL("/robots.txt", startUrl).toString();
    const robotsResponse = await fetchTextResource(robotsUrl, {
      timeoutMs: Math.min(options.timeoutMs, 10000),
      maxBytes: 256 * 1024,
      allowedSiteKey: siteKey,
      signal,
    });

    robotsSummary.status = robotsResponse.status;
    if (robotsResponse.error) {
      robotsSummary.note = "robots.txt could not be read; no robots rules were applied.";
      warn(`robots.txt could not be read (${robotsResponse.error.message}).`);
    } else if (isUsableRobotsResponse({
      status: robotsResponse.status,
      contentType: robotsResponse.contentType,
      body: robotsResponse.body,
    })) {
      robotsParser = parseRobotsTxt(robotsResponse.body);
      robotsSummary = {
        checked: true,
        found: true,
        url: robotsUrl,
        status: robotsResponse.status,
        allowRuleCount: robotsParser.rules.filter((rule) => rule.type === "allow").length,
        disallowRuleCount: robotsParser.rules.filter((rule) => rule.type === "disallow").length,
        crawlDelaySeconds: robotsParser.crawlDelaySeconds,
        sitemaps: robotsParser.sitemaps,
        note: robotsParser.matchedSpecificGroup
          ? "A robots.txt group specific to CraftScopeBot was applied."
          : "The wildcard robots.txt group was applied.",
      };
    } else if (robotsResponse.status === 200) {
      const lookedLikeHtml = /html/i.test(robotsResponse.contentType);
      robotsSummary.note = lookedLikeHtml
        ? "The site returned an HTML page for /robots.txt, so it was treated as having no crawl rules."
        : "The response contained no usable robots directives.";
    } else if (robotsResponse.status === 404) {
      robotsSummary.note = "No robots.txt was found. Crawling is allowed by default.";
    } else {
      robotsSummary.note = `robots.txt returned ${statusDescription(robotsResponse.status)}; no crawl rules were applied.`;
    }
  }

  if (robotsParser) {
    const startPath = new URL(startUrl).pathname + new URL(startUrl).search;
    if (!robotsParser.isAllowed(startPath)) {
      throw new CrawlError(
        "The starting URL is disallowed by this site's robots.txt.",
        {
          code: "ROBOTS_DISALLOWED",
          hint: "Disable “Respect robots.txt” to request this URL anyway, or choose another starting page.",
          status: 403,
        },
      );
    }
  }

  const crawlDelaySeconds = robotsSummary.crawlDelaySeconds || 0;
  let requestDelayMs = Math.max(200, Math.round(crawlDelaySeconds * 1000));
  if (requestDelayMs > 10000) {
    requestDelayMs = 10000;
    warn(
      `robots.txt asks for a ${crawlDelaySeconds}s crawl delay. The delay was capped at 10 seconds so the scan can finish.`,
    );
  }

  emit({
    type: "stage",
    stage: "crawl",
    message: "Starting the crawl. Internal pages will be visited sequentially.",
    robots: robotsSummary,
  });

  const pages = [];
  const pagesByCanonical = new Map();
  const pagesByResource = new Map();
  const aliasToCanonical = new Map();
  const skippedTargets = new Map();
  const queuedResources = new Set();
  const startResourceKey = crawlResourceKey(startUrl, siteKey);

  const queue = [
    {
      url: startUrl,
      resourceKey: startResourceKey,
      depth: 0,
      parentUrl: null,
      parentTitle: "",
      discoveredText: "",
    },
  ];
  queuedResources.add(startResourceKey);

  let pageLimitReached = false;
  let rendererEnabled = options.renderJs;
  let pagesRendered = 0;
  let fallbackPages = 0;
  let duplicatesMerged = 0;
  let queueDuplicatesMerged = 0;
  let internalLinkInstances = 0;
  let externalLinkInstances = 0;
  let maxDepthReached = 0;

  const emitPageProgress = (page, extra = {}) => {
    emit({
      type: "progress",
      data: {
        pagesCrawled: pages.length,
        pagesQueued: queue.length,
        maxPages: options.maxPages,
        maxDepth: options.maxDepth,
        currentUrl: page.url,
        currentPath: page.path,
        title: page.title || page.path,
        statusCode: page.statusCode,
        health: page.health,
        internalLinks: internalLinkInstances,
        externalLinks: externalLinkInstances,
        lastPage: {
          url: page.url,
          path: page.path,
          title: page.title,
          statusCode: page.statusCode,
          health: page.health,
        },
        message:
          page.health === "broken"
            ? `Issue found on ${page.path}`
            : `Mapped ${page.path}`,
        ...extra,
      },
    });
  };

  while (queue.length && pages.length < options.maxPages) {
    assertNotAborted(signal);
    if (pages.length > 0 || queue[0]?.depth > 0) {
      await delay(requestDelayMs, signal);
      assertNotAborted(signal);
    }

    const task = queue.shift();
    const taskResourceKey = task.resourceKey || crawlResourceKey(task.url, siteKey);
    const requestedKey = normalizeUrl(task.url);
    if (!requestedKey) {
      queueDuplicatesMerged += 1;
      continue;
    }

    if (pagesByResource.has(taskResourceKey)) {
      const existing = pagesByResource.get(taskResourceKey);
      aliasToCanonical.set(requestedKey, existing.url);
      queueDuplicatesMerged += 1;
      continue;
    }

    const pageStartedMs = Date.now();
    let renderFailure = null;

    emit({
      type: "stage",
      stage: "page",
      message: `Loading ${displayPath(task.url)}`,
      url: task.url,
      depth: task.depth,
      pagesCrawled: pages.length,
    });

    let raw = null;
    let usedRenderer = false;

    if (rendererEnabled) {
      const rendered = await renderPage(task.url, {
        timeoutMs: options.timeoutMs,
        signal,
      });

      if (rendered.error?.code === "ABORTED") {
        throw new CrawlError("The scan was cancelled.", { code: "SCAN_CANCELLED", status: 499 });
      }

      if (rendered.rendered && !rendered.error) {
        raw = rendered;
        usedRenderer = true;
        pagesRendered += 1;
      } else {
        renderFailure = rendered.error || {
          code: "RENDER_FAILED",
          message: "The browser could not render this page.",
        };

        if (rendered.error?.code === "RENDERER_UNAVAILABLE") {
          rendererEnabled = false;
          warn(rendered.error.message);
        }
      }
    }

    if (!raw) {
      // A static request acts as both the intentional HTTP-only mode and a
      // fallback when browser rendering fails. It can still reveal status codes.
      const fetched = await fetchTextResource(task.url, {
        timeoutMs: options.timeoutMs,
        allowedSiteKey: siteKey,
        signal,
      });

      if (fetched.error && !fetched.externalRedirect) {
        const failure = makeFailurePage(task, fetched.error, { depth: task.depth });
        failure.responseTimeMs = Date.now() - pageStartedMs;
        if (renderFailure) {
          failure.renderError = renderFailure;
        }
        pages.push(failure);
        pagesByResource.set(taskResourceKey, failure);
        pagesByCanonical.set(requestedKey, failure);
        maxDepthReached = Math.max(maxDepthReached, task.depth);

        if (task.depth === 0) {
          throw new CrawlError(`The starting page could not be reached. ${fetched.error.message}`, {
            code: fetched.error.code || "UNREACHABLE_SITE",
            hint: "Check that the site is publicly accessible and try again.",
            status: 422,
          });
        }

        emitPageProgress(failure);
        continue;
      }

      if (fetched.externalRedirect) {
        raw = {
          rendered: false,
          finalUrl: fetched.finalUrl,
          externalRedirect: true,
          status: fetched.status,
          contentType: fetched.contentType,
          redirects: fetched.redirects,
          title: "",
          titleLength: 0,
          description: "",
          h1: "",
          bodyText: "",
          anchors: [],
          rawAnchorCount: 0,
          htmlBytes: 0,
          responseTimeMs: fetched.responseTimeMs,
          error: fetched.error,
        };
        fallbackPages += 1;
      } else {
        fallbackPages += renderFailure ? 1 : 0;
        const unsupported = hasUnsupportedContentType(fetched.contentType);
        const htmlData = unsupported
          ? {
              title: "",
              titleLength: 0,
              description: "",
              h1: "",
              bodyText: "",
              anchors: [],
              rawAnchorCount: 0,
              invalidHrefCount: 0,
              canonicalUrl: null,
              lang: "",
              htmlBytes: fetched.bodyBytes,
            }
          : extractPageFromHtml(fetched.body, fetched.finalUrl);

        raw = {
          ...htmlData,
          rendered: false,
          finalUrl: fetched.finalUrl,
          status: fetched.status,
          contentType: fetched.contentType,
          redirects: fetched.redirects,
          truncated: fetched.truncated,
          responseTimeMs: fetched.responseTimeMs,
          error: null,
        };
      }
    }

    const responseTimeMs = raw.responseTimeMs ?? Date.now() - pageStartedMs;
    const contentType = raw.contentType || "";
    const unsupported = !raw.externalRedirect && hasUnsupportedContentType(contentType);
    const normalizedFinal = normalizeUrl(raw.finalUrl);
    const finalIsInternal = normalizedFinal && sameSiteKey(normalizedFinal, startUrl);
    const isExternalRedirect = Boolean(raw.externalRedirect || (normalizedFinal && !finalIsInternal));

    const pageWarningsList = [];
    const normalizedTitle = normalizeTitle(raw.title, raw.titleLength);

    if (renderFailure && !raw.externalRedirect) {
      mergeUniqueWarnings(pageWarningsList, [
        `JavaScript rendering failed (${renderFailure.message}); server-rendered HTML was analyzed instead.`,
      ]);
    }

    if (isExternalRedirect) {
      mergeUniqueWarnings(pageWarningsList, [
        "This URL redirects to another website. The redirect destination was not crawled.",
      ]);
    } else if (unsupported) {
      mergeUniqueWarnings(pageWarningsList, [
        `This resource is ${contentType || "not HTML"} rather than an HTML page, so its links were not crawled.`,
      ]);
    } else {
      mergeUniqueWarnings(
        pageWarningsList,
        pageWarnings({
          title: normalizedTitle.title,
          titleLength: normalizedTitle.titleLength,
          contentType,
          bodyText: raw.bodyText,
          rendered: usedRenderer,
        }),
      );
      if (raw.truncated) {
        mergeUniqueWarnings(pageWarningsList, [
          "The HTML response was truncated at the 4 MB safety limit; links near the end may be missing.",
        ]);
      }
    }

    const soft404 = unsupported
      ? { isSoft404: false, reason: null }
      : detectSoft404({
          statusCode: raw.status,
          title: normalizedTitle.title,
          h1: raw.h1,
          bodyText: raw.bodyText,
          contentType,
        });

    let health = "ok";
    let failureReason = null;
    if (soft404.isSoft404) {
      health = "broken";
      failureReason = soft404.reason;
    } else if (raw.status && raw.status >= 400) {
      health = "broken";
      failureReason = `${statusDescription(raw.status)}.`;
    } else if (isExternalRedirect || unsupported) {
      health = "warning";
      failureReason = pageWarningsList[0] || null;
    } else if (pageWarningsList.length) {
      health = "warning";
    }

    if (task.depth === 0) {
      if (health === "broken") {
        if (soft404.isSoft404) {
          throw new CrawlError(
            "The starting URL returned HTTP 200 but rendered a not-found page.",
            {
              code: "SOFT_404_START",
              hint: "Confirm the site's home URL is correct, or try another page.",
              status: 422,
            },
          );
        }
        throw new CrawlError(
          `The starting page returned ${statusDescription(raw.status)}.`,
          {
            code: raw.status >= 400 ? "START_PAGE_HTTP_ERROR" : "START_PAGE_BROKEN",
            hint: "Open the URL in a browser to confirm it is publicly available.",
            status: 422,
          },
        );
      }
      if (isExternalRedirect) {
        throw new CrawlError(
          "The starting URL redirects to a different website, which this analyzer does not crawl.",
          {
            code: "EXTERNAL_START_REDIRECT",
            hint: "Enter the final destination URL instead.",
            status: 422,
          },
        );
      }
      if (unsupported) {
        throw new CrawlError("The starting URL is not an HTML page.", {
          code: "UNSUPPORTED_START_PAGE",
          hint: "Enter the address of a website page rather than an image, PDF, or other file.",
          status: 422,
        });
      }
    }

    const pageKey = finalIsInternal ? normalizedFinal : requestedKey;
    const pageResourceKey = crawlResourceKey(pageKey, siteKey);
    const existingPage = pagesByResource.get(pageResourceKey);
    if (existingPage) {
      aliasToCanonical.set(requestedKey, existingPage.url);
      for (const hop of raw.redirects || []) {
        const from = normalizeUrl(hop.from);
        if (from) aliasToCanonical.set(from, existingPage.url);
      }
      duplicatesMerged += 1;
      queueDuplicatesMerged += 1;
      emit({
        type: "progress",
        data: {
          pagesCrawled: pages.length,
          pagesQueued: queue.length,
          maxPages: options.maxPages,
          maxDepth: options.maxDepth,
          currentUrl: existingPage.url,
          currentPath: existingPage.path,
          internalLinks: internalLinkInstances,
          externalLinks: externalLinkInstances,
          message: "Merged a duplicate URL into an already mapped page.",
        },
      });
      continue;
    }

    const page = {
      url: pageKey,
      requestedUrl: requestedKey,
      path: displayPath(pageKey),
      title: normalizedTitle.title,
      titleLength: normalizedTitle.titleLength,
      description: raw.description || "",
      h1: raw.h1 || "",
      lang: raw.lang || "",
      depth: task.depth,
      parent: task.parentUrl
        ? {
            url: task.parentUrl,
            title: task.parentTitle || "",
            linkText: task.discoveredText || "",
          }
        : null,
      statusCode: raw.status ?? null,
      health,
      soft404: soft404.isSoft404,
      failureReason,
      contentType,
      rendered: usedRenderer,
      responseTimeMs,
      htmlBytes: raw.htmlBytes || 0,
      redirects: raw.redirects || [],
      externalRedirect: isExternalRedirect,
      truncated: Boolean(raw.truncated),
      error: raw.error || null,
      renderError: renderFailure || null,
      warnings: pageWarningsList,
      counts: { internalLinks: 0, externalLinks: 0, incomingInternalLinks: 0 },
      children: [],
      internalLinks: [],
      externalLinks: [],
    };

    pages.push(page);
    pagesByResource.set(pageResourceKey, page);
    pagesByCanonical.set(pageKey, page);
    maxDepthReached = Math.max(maxDepthReached, task.depth);

    if (requestedKey !== pageKey) aliasToCanonical.set(requestedKey, pageKey);
    for (const hop of raw.redirects || []) {
      const from = normalizeUrl(hop.from);
      if (from) aliasToCanonical.set(from, pageKey);
    }

    // Broken and non-HTML responses are recorded, but we do not spider links
    // out of an error page (or a PDF) as if it were a valid site page.
    const canExtractLinks =
      !unsupported &&
      !soft404.isSoft404 &&
      !(raw.status && raw.status >= 400) &&
      !isExternalRedirect;

    if (canExtractLinks) {
      const seenTargets = new Set();
      for (const anchor of raw.anchors || []) {
        const rawHref = String(anchor.rawHref ?? anchor.href ?? "").trim();
        if (!rawHref || isAnchorOnlyHref(rawHref) || NON_PAGE_PROTOCOLS.test(rawHref)) {
          continue;
        }

        const target = normalizeUrl(anchor.href || rawHref, raw.finalUrl || page.url);
        if (!target) continue;

        const internal = siteKeyFromUrl(target) === siteKey;
        const perPageKey = `${internal ? "i" : "e"}:${target}`;
        if (seenTargets.has(perPageKey)) {
          duplicatesMerged += 1;
          continue;
        }
        seenTargets.add(perPageKey);

        const link = {
          url: target,
          text: String(anchor.text || "").slice(0, 180),
          rel: String(anchor.rel || "").slice(0, 100),
        };

        if (internal) {
          page.internalLinks.push(link);
          internalLinkInstances += 1;

          const targetResourceKey = crawlResourceKey(target, siteKey);
          if (!targetResourceKey) continue;
          if (
            pagesByResource.has(targetResourceKey) ||
            queuedResources.has(targetResourceKey)
          ) {
            continue;
          }

          const targetPath = new URL(target).pathname + new URL(target).search;
          if (robotsParser && !robotsParser.isAllowed(targetPath)) {
            skippedTargets.set(targetResourceKey, {
              reasonCode: "robots",
              message: "Not checked because robots.txt disallows this URL for CraftScopeBot.",
            });
            continue;
          }

          if (task.depth + 1 > options.maxDepth) {
            skippedTargets.set(targetResourceKey, {
              reasonCode: "depth",
              message: `Not checked because it is deeper than the ${options.maxDepth}-level crawl limit.`,
            });
            continue;
          }

          if (pages.length + queue.length >= options.maxPages) {
            pageLimitReached = true;
            skippedTargets.set(targetResourceKey, {
              reasonCode: "page_limit",
              message: `Not checked because the ${options.maxPages}-page limit was reached.`,
            });
            continue;
          }

          queuedResources.add(targetResourceKey);
          queue.push({
            url: target,
            resourceKey: targetResourceKey,
            depth: task.depth + 1,
            parentUrl: page.url,
            parentTitle: page.title,
            discoveredText: link.text,
          });
        } else {
          page.externalLinks.push(link);
          externalLinkInstances += 1;
        }
      }
    }

    page.counts.internalLinks = page.internalLinks.length;
    page.counts.externalLinks = page.externalLinks.length;
    emitPageProgress(page);
  }

  if (pages.length >= options.maxPages) {
    pageLimitReached = true;
  }

  for (const task of queue) {
    if (!task.resourceKey) continue;
    skippedTargets.set(task.resourceKey, {
      reasonCode: "page_limit",
      message: `Not checked because the ${options.maxPages}-page limit was reached.`,
    });
  }

  assertNotAborted(signal);
  emit({
    type: "stage",
    stage: "report",
    message: "Building sitemap, link checks, and summary statistics…",
  });

  const resolvePage = (target) => {
    const canonical = pagesByCanonical.get(target);
    if (canonical) return canonical;
    const alias = aliasToCanonical.get(target);
    if (alias) return pagesByCanonical.get(alias) || null;
    const resourceKey = crawlResourceKey(target, siteKey);
    return resourceKey ? pagesByResource.get(resourceKey) || null : null;
  };

  const internalRelations = [];
  const relationKeys = new Set();
  const sourceInternalCounts = new Map();
  const sourceExternalCounts = new Map();

  for (const page of pages) {
    for (const link of page.internalLinks) {
      const targetPage = resolvePage(link.url);
      const targetResourceKey = crawlResourceKey(link.url, siteKey);
      const relationTarget = targetPage?.url || targetResourceKey || link.url;
      const relationKey = `${page.url}=>${relationTarget}`;
      if (relationKeys.has(relationKey)) {
        duplicatesMerged += 1;
        continue;
      }
      relationKeys.add(relationKey);

      let status = "unchecked";
      let statusCode = null;
      let reason = null;
      let targetTitle = null;

      if (targetPage) {
        targetTitle = targetPage.title || null;
        statusCode = targetPage.statusCode;
        if (targetPage.health === "broken") {
          status = "broken";
          reason =
            targetPage.failureReason ||
            targetPage.error?.message ||
            "This internal link points to a page that failed its check.";
        } else if (targetPage.health === "warning") {
          status = "warning";
          reason =
            targetPage.failureReason ||
            targetPage.warnings[0] ||
            "The destination loaded with a warning.";
        } else {
          status = "ok";
        }
        if (!statusCode) statusCode = targetPage.statusCode;
      } else {
        const skipped = targetResourceKey ? skippedTargets.get(targetResourceKey) : null;
        if (skipped?.reasonCode === "robots") {
          status = "blocked";
        } else {
          status = "unchecked";
        }
        reason =
          skipped?.message ||
          "This target was discovered but was not analyzed by this scan.";
        statusCode = null;
      }

      internalRelations.push({
        sourceUrl: page.url,
        sourcePath: page.path,
        sourceTitle: page.title || null,
        sourceHealth: page.health,
        targetUrl: targetPage?.url || link.url,
        targetPath: displayPath(targetPage?.url || link.url),
        targetTitle,
        text: link.text,
        rel: link.rel,
        depth: targetPage?.depth ?? null,
        status,
        statusCode,
        reason,
        viaRedirect: Boolean(targetPage?.redirects?.length),
        soft404: Boolean(targetPage?.soft404),
      });
      sourceInternalCounts.set(page.url, (sourceInternalCounts.get(page.url) || 0) + 1);
    }
  }

  // Recompute displayed counts after alias-level de-duplication.
  for (const page of pages) {
    page.counts.internalLinks = sourceInternalCounts.get(page.url) || 0;
    page.counts.externalLinks = page.externalLinks.length;
    sourceExternalCounts.set(page.url, page.externalLinks.length);
  }

  const targetIncomingCounts = new Map();
  for (const relation of internalRelations) {
    const targetPage = resolvePage(relation.targetUrl);
    if (!targetPage) continue;
    targetIncomingCounts.set(targetPage.url, (targetIncomingCounts.get(targetPage.url) || 0) + 1);
  }

  const childMap = new Map();
  for (const page of pages) {
    if (!page.parent?.url) continue;
    if (!childMap.has(page.parent.url)) childMap.set(page.parent.url, []);
    childMap.get(page.parent.url).push(page.url);
  }

  for (const page of pages) {
    page.counts.incomingInternalLinks = targetIncomingCounts.get(page.url) || 0;
    page.children = childMap.get(page.url) || [];
  }

  const brokenGroups = new Map();
  for (const relation of internalRelations) {
    if (relation.status !== "broken") continue;
    const key = relation.targetUrl;
    if (!brokenGroups.has(key)) {
      brokenGroups.set(key, {
        url: relation.targetUrl,
        path: relation.targetPath,
        statusCode: relation.statusCode,
        reason: relation.reason,
        soft404: relation.soft404,
        sources: [],
      });
    }
    const group = brokenGroups.get(key);
    group.sources.push({
      url: relation.sourceUrl,
      path: relation.sourcePath,
      title: relation.sourceTitle,
      text: relation.text,
    });
  }
  const brokenLinks = [...brokenGroups.values()].sort((a, b) =>
    a.url.localeCompare(b.url),
  );

  const externalMap = new Map();
  for (const page of pages) {
    for (const link of page.externalLinks) {
      let entry = externalMap.get(link.url);
      if (!entry) {
        let host = "";
        try {
          host = new URL(link.url).hostname;
        } catch {
          host = "unknown";
        }
        entry = {
          url: link.url,
          host,
          sourceCount: 0,
          sources: [],
        };
        externalMap.set(link.url, entry);
      }
      entry.sourceCount += 1;
      entry.sources.push({
        url: page.url,
        path: page.path,
        title: page.title || null,
        text: link.text,
      });
    }
  }
  const externalLinks = [...externalMap.values()].sort(
    (a, b) => b.sourceCount - a.sourceCount || a.url.localeCompare(b.url),
  );

  const externalHostMap = new Map();
  for (const target of externalLinks) {
    const entry = externalHostMap.get(target.host) || {
      host: target.host,
      targets: 0,
      sourceCount: 0,
    };
    entry.targets += 1;
    entry.sourceCount += target.sourceCount;
    externalHostMap.set(target.host, entry);
  }
  const externalHosts = [...externalHostMap.values()].sort(
    (a, b) => b.sourceCount - a.sourceCount || b.targets - a.targets,
  );

  const publicPages = pages.map((page) => {
    const {
      internalLinks: _internalLinks,
      externalLinks: _externalLinks,
      ...publicPage
    } = page;
    return publicPage;
  });

  const healthyPages = pages.filter((page) => page.health === "ok").length;
  const warningPages = pages.filter((page) => page.health === "warning").length;
  const brokenPages = pages.filter((page) => page.health === "broken").length;
  const relationsBroken = internalRelations.filter((relation) => relation.status === "broken").length;
  const relationsChecked = internalRelations.filter((relation) => relation.status !== "unchecked" && relation.status !== "blocked").length;
  const relationsBlocked = internalRelations.filter((relation) => relation.status === "blocked").length;
  const relationsUnchecked = internalRelations.filter((relation) => relation.status === "unchecked").length;
  const internalTargets = new Set(internalRelations.map((relation) => relation.targetUrl));
  const duplicatesMergedTotal = duplicatesMerged + queueDuplicatesMerged;

  const summary = {
    pagesDiscovered: publicPages.length,
    healthyPages,
    warningPages,
    brokenPages,
    internalLinks: internalRelations.length,
    uniqueInternalTargets: internalTargets.size,
    externalLinks: externalLinks.length,
    externalLinkOccurrences: externalLinks.reduce((total, link) => total + link.sourceCount, 0),
    externalHosts: externalHosts.length,
    brokenLinks: brokenLinks.length,
    brokenLinkRelations: relationsBroken,
    linksChecked: relationsChecked,
    linksBlockedByRobots: relationsBlocked,
    linksNotChecked: relationsUnchecked,
    duplicatesMerged: duplicatesMergedTotal,
    maxDepthReached,
    pageLimitReached,
  };

  const finishedAt = new Date();
  const report = {
    meta: {
      tool: TOOL,
      generatedAt: finishedAt.toISOString(),
      startedAt: startedAt.toISOString(),
      durationMs: Date.now() - startedMs,
      inputUrl: originalUrl,
      startUrl,
      site: new URL(startUrl).origin,
      siteKey,
      crawledWith: pagesRendered > 0 ? "playwright" : "http",
    },
    config: {
      maxPages: options.maxPages,
      maxDepth: options.maxDepth,
      renderJsRequested: options.renderJs,
      respectRobots: options.respectRobots,
      timeoutMs: options.timeoutMs,
      delayBetweenRequestsMs: requestDelayMs,
      scope: "Same hostname only (www and http/https variants are treated as the same site).",
    },
    renderer: {
      ...getRendererInfo(),
      pagesRendered,
      pagesUsingHttpFallback: Math.max(0, fallbackPages),
    },
    robots: robotsSummary,
    summary,
    warnings,
    notes: [
      "External links are reported for context but are never requested or crawled.",
      "Redirects are followed only within the same site; off-site redirects are reported as warnings.",
      "JavaScript is rendered in an isolated headless browser when available. Images, fonts, and media are blocked.",
      "Hash-only links are treated as in-page anchors and are not separate pages.",
    ],
    pages: publicPages,
    links: {
      internal: internalRelations,
      external: externalLinks,
      broken: brokenLinks,
    },
    externalHosts,
  };

  return report;
}
