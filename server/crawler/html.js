import { load } from "cheerio";

export const TITLE_WARN_LENGTH = 120;
const TITLE_STORE_LIMIT = 2000;
const BODY_TEXT_LIMIT = 12000;

export function collapseWhitespace(value, maxLength = 1000) {
  const normalized = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "";
  return normalized.slice(0, maxLength);
}

function getLinkText($, element) {
  const node = $(element);
  const candidates = [
    node.attr("aria-label"),
    node.attr("title"),
    node.find("img[alt]").first().attr("alt"),
    node.text(),
  ];
  return collapseWhitespace(candidates.find((value) => collapseWhitespace(value)), 180);
}

function collectAnchorsFromHtml($, documentUrl) {
  let baseUrl = documentUrl;
  const baseHref = $("base[href]").first().attr("href");
  if (baseHref) {
    try {
      baseUrl = new URL(baseHref, documentUrl).toString();
    } catch {
      // Invalid <base> tags should not break the rest of the document.
    }
  }

  const anchors = [];
  const invalidHrefCount = { value: 0 };
  $("a[href], area[href]").each((_, element) => {
    const rawHref = ($(element).attr("href") || "").trim();
    if (!rawHref) return;

    let resolved;
    try {
      resolved = new URL(rawHref, baseUrl).toString();
    } catch {
      invalidHrefCount.value += 1;
      return;
    }

    anchors.push({
      href: resolved,
      rawHref,
      text: getLinkText($, element),
      rel: collapseWhitespace($(element).attr("rel"), 100).toLowerCase(),
    });
  });

  return { anchors, invalidHrefCount: invalidHrefCount.value };
}

export function extractPageFromHtml(html, pageUrl) {
  const $ = load(String(html ?? ""));
  $("script, style, noscript, template, svg").remove();

  const fullTitle = collapseWhitespace($("title").first().text(), 20000);
  const rawTitle = fullTitle.slice(0, TITLE_STORE_LIMIT);
  const description = collapseWhitespace($('meta[name="description"]').attr("content"), 500);
  const h1 = collapseWhitespace($("h1").first().text(), 240);
  const bodyText = collapseWhitespace($("body").text(), BODY_TEXT_LIMIT);
  const canonicalHref = $('link[rel="canonical"]').first().attr("href");
  let canonicalUrl = null;
  if (canonicalHref) {
    try {
      canonicalUrl = new URL(canonicalHref, pageUrl).toString();
    } catch {
      canonicalUrl = null;
    }
  }

  const { anchors, invalidHrefCount } = collectAnchorsFromHtml($, pageUrl);

  return {
    title: rawTitle,
    titleLength: fullTitle.length,
    description,
    h1,
    bodyText,
    anchors,
    rawAnchorCount: anchors.length + invalidHrefCount,
    invalidHrefCount,
    canonicalUrl,
    lang: collapseWhitespace($("html").attr("lang"), 30),
    htmlBytes: Buffer.byteLength(String(html ?? "")),
  };
}

/**
 * Dynamic apps often return their SPA shell for unknown routes with HTTP 200.
 * These narrow signals catch the common "soft 404" pattern without flagging a
 * normal article that merely mentions the number 404 somewhere.
 */
export function detectSoft404({ statusCode, title, h1, bodyText, contentType = "text/html" }) {
  if (statusCode !== 200) return { isSoft404: false, reason: null };
  if (contentType && !String(contentType).toLowerCase().includes("html")) {
    return { isSoft404: false, reason: null };
  }

  const titleAndHeading = `${title ?? ""} ${h1 ?? ""}`.toLowerCase();
  const compactBody = String(bodyText ?? "").replace(/\s+/g, " ").trim();
  const lowerBody = compactBody.toLowerCase();

  const strongPhrases = [
    "resource_not_found",
    "the void claims this link",
    "404_error",
    "this page could not be found",
    "there isn't a github pages site here",
  ];
  // A bare "404" is meaningful in a title or heading, but not in body copy:
  // link hubs routinely contain anchor text such as "Soft 404". Require a
  // fuller not-found phrase before treating short body text as a signal.
  const headingPhrases = [
    /\b404\b/,
    /\bpage not found\b/,
    /\bnot found\b/,
    /\bnothing (?:was )?found\b/,
  ];
  const bodyPhrases = [
    /\bpage not found\b/,
    /\bnot found\b/,
    /\bnothing (?:was )?found\b/,
  ];

  const headingMatch = headingPhrases.some((pattern) => pattern.test(titleAndHeading));
  const strongBodyMatch = strongPhrases.some((phrase) => lowerBody.includes(phrase));
  const compactMatch = compactBody.length < 900 && bodyPhrases.some((pattern) => pattern.test(lowerBody));

  if (strongBodyMatch || headingMatch || compactMatch) {
    return {
      isSoft404: true,
      reason: "The page returned HTTP 200 but rendered a not-found response.",
    };
  }
  return { isSoft404: false, reason: null };
}

export function pageWarnings({ title, titleLength, contentType, bodyText, rendered }) {
  const warnings = [];
  if (!title) {
    warnings.push("This page has no <title> element.");
  } else if (titleLength > TITLE_WARN_LENGTH) {
    warnings.push(`The page title is very long (${titleLength.toLocaleString()} characters).`);
  }
  if (!rendered && (!bodyText || bodyText.length < 40)) {
    warnings.push(
      "Very little server-rendered content was found. Enable JavaScript rendering to inspect this app.",
    );
  }
  if (!contentType) {
    warnings.push("The response did not include a content-type header.");
  }
  return warnings;
}

export function hasUnsupportedContentType(contentType) {
  if (!contentType) return false;
  const type = contentType.toLowerCase();
  return !type.includes("text/html") && !type.includes("application/xhtml+xml");
}
