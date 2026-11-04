import { coerceHttpUrl, normalizeUrl, siteKeyFromUrl, URL_LIMITS } from "./url.js";
import { assertPublicDestination } from "./ssrf.js";

export class InputError extends Error {
  constructor(message, { code = "INVALID_INPUT", hint = null, status = 400 } = {}) {
    super(message);
    this.name = "InputError";
    this.code = code;
    this.hint = hint;
    this.status = status;
  }
}

function integerOption(value, field, { min, max, fallback }) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new InputError(`${field} must be an integer between ${min} and ${max}.`, {
      code: "INVALID_OPTION",
    });
  }
  return parsed;
}

function booleanOption(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "boolean") {
    throw new InputError("Boolean scan options must be true or false.", {
      code: "INVALID_OPTION",
    });
  }
  return value;
}

export function validateScanPayload(payload = {}) {
  if (typeof payload.url !== "string" || !payload.url.trim()) {
    throw new InputError("Enter a website URL to analyze.", {
      code: "URL_REQUIRED",
      hint: "For example: https://bashcraftclub.vercel.app/",
    });
  }

  if (payload.url.length > URL_LIMITS.maxInputLength) {
    throw new InputError("The website URL is too long.", { code: "URL_TOO_LONG" });
  }

  const coerced = coerceHttpUrl(payload.url);
  if (!coerced) {
    throw new InputError("That doesn't look like a valid website URL.", {
      code: "INVALID_URL",
      hint: "Use an http:// or https:// address, such as https://bashcraftclub.vercel.app/.",
    });
  }

  if (coerced.username || coerced.password) {
    throw new InputError("URLs containing credentials are not supported.", {
      code: "URL_CREDENTIALS",
    });
  }

  const normalized = normalizeUrl(coerced.toString());
  if (!normalized) {
    throw new InputError("Only public http:// and https:// websites can be analyzed.", {
      code: "UNSUPPORTED_PROTOCOL",
    });
  }

  if (new URL(normalized).pathname.length > URL_LIMITS.maxPathLength) {
    throw new InputError("That URL path is too long to analyze.", { code: "URL_TOO_LONG" });
  }

  const maxPages = integerOption(payload.maxPages, "Page limit", {
    min: 1,
    max: 100,
    fallback: 25,
  });
  const maxDepth = integerOption(payload.maxDepth, "Crawl depth", {
    min: 0,
    max: 6,
    fallback: 3,
  });
  const renderJs = booleanOption(payload.renderJs, true);
  const respectRobots = booleanOption(payload.respectRobots, true);
  const timeoutMs = integerOption(payload.timeoutMs, "Timeout", {
    min: 3000,
    max: 30000,
    fallback: 15000,
  });

  return {
    originalUrl: payload.url.trim(),
    startUrl: normalized,
    siteKey: siteKeyFromUrl(normalized),
    options: {
      maxPages,
      maxDepth,
      renderJs,
      respectRobots,
      timeoutMs,
    },
  };
}

export async function validateDestination(normalizedUrl) {
  const url = new URL(normalizedUrl);
  const result = await assertPublicDestination(url);
  if (!result.allowed) {
    throw new InputError(result.reason, {
      code: result.code || "PRIVATE_DESTINATION",
      hint:
        result.code === "DNS_LOOKUP_FAILED"
          ? "Double-check the spelling or try the site's main domain."
          : undefined,
      status: result.code === "DNS_LOOKUP_FAILED" ? 422 : 403,
    });
  }
  return result;
}
