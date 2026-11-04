/**
 * URL normalisation is deliberately conservative: we only merge variations
 * that are known to identify the same HTTP resource. Paths remain case-sensitive
 * because many servers treat /About and /about differently.
 */

const TRACKING_PARAM_PATTERNS = [
  /^utm_/i,
  /^ga_/i,
  /^mc_(cid|eid)$/i,
  /^(fbclid|gclid|dclid|msclkid|yclid|_ga|_gl|ref_src|igshid)$/i,
];

const HASH_ROUTE_PATTERN = /^#!?\//;

function isTrackingParam(name) {
  return TRACKING_PARAM_PATTERNS.some((pattern) => pattern.test(name));
}

/**
 * Decode only RFC 3986 unreserved characters. Encoded slashes, question marks,
 * and other reserved characters must stay encoded.
 */
function normalizePercentEncoding(pathname) {
  return pathname.replace(/%([0-9a-f]{2})/gi, (match, hex) => {
    const character = String.fromCharCode(Number.parseInt(hex, 16));
    if (/[A-Za-z0-9\-._~]/.test(character)) return character;
    return `%${hex.toUpperCase()}`;
  });
}

function normalizePathname(pathname) {
  const normalized = normalizePercentEncoding(pathname || "/");
  if (normalized === "/") return "/";
  return normalized.replace(/\/+$/, "") || "/";
}

/**
 * Canonical form used for de-duplication and the crawl frontier.
 * Fragments are dropped because they are not sent to the server.
 */
export function normalizeUrl(input, base) {
  if (typeof input !== "string" || !input.trim()) return null;

  let url;
  try {
    url = base ? new URL(input.trim(), base) : new URL(input.trim());
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;

  url.hash = "";
  url.hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  url.pathname = normalizePathname(url.pathname);

  // Remove known analytics parameters, then sort so /?b=2&a=1 and /?a=1&b=2
  // share a frontier entry. Meaningful query parameters are preserved.
  for (const name of [...url.searchParams.keys()]) {
    if (isTrackingParam(name)) url.searchParams.delete(name);
  }
  url.searchParams.sort();

  return url.toString();
}

/** The host identity used to separate internal pages from external links. */
export function siteKeyFromUrl(input) {
  let url;
  try {
    url = typeof input === "string" ? new URL(input) : input;
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  return url.port ? `${host}:${url.port}` : host;
}

export function isInternalUrl(candidate, siteKey) {
  return siteKeyFromUrl(candidate) === siteKey;
}

/**
 * Identity used for the crawl frontier. On the same site, http/https and
 * www/non-www variants almost always resolve to the same resource, so we do not
 * want to schedule both. Link-level records still keep the original URL.
 */
export function crawlResourceKey(input, siteKey = siteKeyFromUrl(input)) {
  try {
    const url = new URL(input);
    return `${siteKey}${normalizePathname(url.pathname)}${url.search}`;
  } catch {
    return null;
  }
}

/** Add https:// for a bare domain so the input is friendlier. */
export function coerceHttpUrl(input) {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
    ? trimmed
    : `https://${trimmed.replace(/^\/\//, "")}`;

  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url;
  } catch {
    return null;
  }
}

/** A human-readable path with the query string retained. */
export function displayPath(input) {
  try {
    const url = new URL(input);
    return `${url.pathname === "/" ? "/" : url.pathname.replace(/\/$/, "")}${url.search}`;
  } catch {
    return input;
  }
}

/** Hash links are same-document navigation, not pages to crawl. */
export function isAnchorOnlyHref(href) {
  return typeof href === "string" && (href.startsWith("#") || HASH_ROUTE_PATTERN.test(href));
}

/**
 * We treat http://example.com and https://example.com as the same site.
 * Cross-host redirects are never followed by the crawler.
 */
export function sameSiteKey(a, b) {
  const keyA = siteKeyFromUrl(a);
  const keyB = siteKeyFromUrl(b);
  return Boolean(keyA && keyB && keyA === keyB);
}

export const URL_LIMITS = {
  maxInputLength: 2048,
  maxPathLength: 2048,
};
