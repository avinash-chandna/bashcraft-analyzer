/**
 * A small, dependency-free robots.txt parser covering the directives that
 * matter to a polite crawler: user-agent groups, Allow/Disallow wildcards,
 * Crawl-delay and Sitemap discovery.
 */

function escapeRegex(value) {
  return value.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

function patternToRegex(pattern) {
  let anchoredAtEnd = false;
  let source = pattern;
  if (source.endsWith("$")) {
    anchoredAtEnd = true;
    source = source.slice(0, -1);
  }
  const body = source
    .split("*")
    .map(escapeRegex)
    .join(".*");
  return new RegExp(`^${body}${anchoredAtEnd ? "$" : ""}`);
}

function parseInteger(value) {
  if (!/^\d+(?:\.\d+)?$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function looksLikeRobotsTxt(text) {
  if (typeof text !== "string") return false;
  return /^\s*(user-agent|sitemap)\s*:/im.test(text);
}

export function parseRobotsTxt(text, userAgent = "CraftScopeBot") {
  const groups = [];
  const sitemaps = [];
  let current = null;
  let readingAgents = false;

  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (field === "user-agent") {
      if (!current || !readingAgents) {
        current = { agents: [], rules: [] };
        groups.push(current);
        readingAgents = true;
      }
      current.agents.push(value.toLowerCase());
      continue;
    }

    if (field === "sitemap") {
      if (value) sitemaps.push(value);
      continue;
    }

    if (!current) continue;
    readingAgents = false;

    if (field === "allow" || field === "disallow") {
      if (!value) continue;
      current.rules.push({
        type: field,
        pattern: value,
        specificity: value.replace(/\$$/, "").length,
        regex: patternToRegex(value),
      });
      continue;
    }

    if (field === "crawl-delay") {
      const delay = parseInteger(value);
      if (delay !== null) current.crawlDelaySeconds = delay;
    }
  }

  const ourAgent = String(userAgent).toLowerCase();
  const matchingGroups = groups.filter((group) =>
    group.agents.some((agent) => agent !== "*" && ourAgent.includes(agent)),
  );
  const selectedGroups = matchingGroups.length
    ? matchingGroups
    : groups.filter((group) => group.agents.includes("*"));

  const rules = selectedGroups.flatMap((group) => group.rules);
  const delays = selectedGroups
    .map((group) => group.crawlDelaySeconds)
    .filter((value) => Number.isFinite(value));
  const crawlDelaySeconds = delays.length ? Math.max(...delays) : 0;

  return {
    userAgent,
    matchedSpecificGroup: matchingGroups.length > 0,
    rules,
    crawlDelaySeconds,
    sitemaps: [...new Set(sitemaps)],
    /**
     * RFC 9309 says the most specific matching rule wins. If an Allow and a
     * Disallow are equally specific, Allow wins.
     */
    isAllowed(pathname) {
      let best = null;
      for (const rule of rules) {
        if (!rule.regex.test(pathname)) continue;
        if (
          !best ||
          rule.specificity > best.specificity ||
          (rule.specificity === best.specificity && rule.type === "allow")
        ) {
          best = rule;
        }
      }
      return best ? best.type === "allow" : true;
    },
  };
}

/**
 * BashCraft's host returns the SPA shell with HTTP 200 for /robots.txt. The
 * content-type and shape checks prevent us from treating that HTML as rules.
 */
export function isUsableRobotsResponse({ status, contentType, body }) {
  if (status !== 200) return false;
  const type = String(contentType ?? "").toLowerCase();
  if (type.includes("text/html")) return false;
  return looksLikeRobotsTxt(body);
}
