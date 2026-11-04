import { sameSiteKey, siteKeyFromUrl } from "./url.js";

export const DEFAULT_USER_AGENT =
  "CraftScopeBot/1.0 (+website analyzer; respectful, single-request crawl)";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 6;

function describeNetworkError(error, { timedOut = false, aborted = false } = {}) {
  if (aborted) {
    return { code: "ABORTED", message: "The request was cancelled." };
  }
  if (timedOut) {
    return {
      code: "TIMEOUT",
      message: "The request timed out before the server responded.",
    };
  }

  const code = error?.cause?.code || error?.code || error?.name || "NETWORK_ERROR";
  const messages = {
    ENOTFOUND: "DNS lookup failed. The host could not be found.",
    EAI_AGAIN: "DNS lookup temporarily failed.",
    ECONNREFUSED: "The server refused the connection.",
    ECONNRESET: "The connection was reset by the server.",
    ETIMEDOUT: "The network request timed out.",
    UND_ERR_CONNECT_TIMEOUT: "Connecting to the server timed out.",
    UND_ERR_HEADERS_TIMEOUT: "The server took too long to send a response.",
    UND_ERR_BODY_TIMEOUT: "The server took too long to send the page body.",
    CERT_HAS_EXPIRED: "The site's TLS certificate has expired.",
    DEPTH_ZERO_SELF_SIGNED_CERT: "The site uses an untrusted TLS certificate.",
    ERR_TLS_CERT_ALTNAME_INVALID: "The TLS certificate does not match this host.",
    ENETUNREACH: "The network is unreachable.",
    ABORT_ERR: "The request was aborted.",
  };

  return {
    code: /CERT|TLS|SSL/i.test(String(code)) ? "TLS_ERROR" : code,
    message: messages[code] || "The page could not be reached.",
  };
}

async function readResponseBody(response, maxBytes) {
  if (!response.body) return { text: "", truncated: false, bytes: 0 };

  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  let truncated = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      const remaining = maxBytes - bytes;
      if (remaining <= 0) {
        truncated = true;
        await reader.cancel();
        break;
      }
      if (value.byteLength > remaining) {
        chunks.push(value.subarray(0, remaining));
        bytes += remaining;
        truncated = true;
        await reader.cancel();
        break;
      }
      chunks.push(value);
      bytes += value.byteLength;
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // The stream may already have been cancelled by an abort.
    }
  }

  const merged = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return {
    text: new TextDecoder("utf-8", { fatal: false }).decode(merged),
    truncated,
    bytes,
  };
}

/**
 * Fetch a text resource with manual redirect handling. Redirects are only
 * followed while they remain on the same site, which is another guard against
 * accidentally crawling an external property.
 */
export async function fetchTextResource(
  inputUrl,
  {
    timeoutMs = 15000,
    maxBytes = 4 * 1024 * 1024,
    userAgent = DEFAULT_USER_AGENT,
    signal,
    allowedSiteKey = siteKeyFromUrl(inputUrl),
  } = {},
) {
  const startedAt = Date.now();
  const redirects = [];
  let current = new URL(inputUrl);
  let timedOut = false;
  let currentStatus = null;
  let currentContentType = "";

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  timeout.unref?.();

  const onCallerAbort = () => controller.abort();
  signal?.addEventListener("abort", onCallerAbort, { once: true });

  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      let response;
      try {
        response = await fetch(current, {
          redirect: "manual",
          signal: controller.signal,
          headers: {
            "user-agent": userAgent,
            accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.4",
            "accept-language": "en",
          },
        });
      } catch (error) {
        return {
          url: inputUrl,
          finalUrl: current.toString(),
          status: currentStatus,
          contentType: currentContentType,
          body: "",
          bodyBytes: 0,
          truncated: false,
          redirects,
          responseTimeMs: Date.now() - startedAt,
          error: describeNetworkError(error, {
            timedOut,
            aborted: Boolean(signal?.aborted && !timedOut),
          }),
        };
      }

      currentStatus = response.status;
      currentContentType = response.headers.get("content-type") || "";
      const location = response.headers.get("location");

      if (REDIRECT_STATUSES.has(currentStatus) && location) {
        let next;
        try {
          next = new URL(location, current);
        } catch {
          return {
            url: inputUrl,
            finalUrl: current.toString(),
            status: currentStatus,
            contentType: currentContentType,
            body: "",
            bodyBytes: 0,
            truncated: false,
            redirects,
            responseTimeMs: Date.now() - startedAt,
            error: { code: "BAD_REDIRECT", message: "The server returned an invalid redirect." },
          };
        }

        redirects.push({ from: current.toString(), to: next.toString(), status: currentStatus });
        const externalRedirect = Boolean(
          !siteKeyFromUrl(next) ||
            !allowedSiteKey ||
            !sameSiteKey(current, next),
        );

        try {
          await response.body?.cancel();
        } catch {
          // Redirect responses generally have no meaningful body.
        }

        if (externalRedirect) {
          return {
            url: inputUrl,
            finalUrl: next.toString(),
            status: currentStatus,
            contentType: currentContentType,
            body: "",
            bodyBytes: 0,
            truncated: false,
            redirects,
            responseTimeMs: Date.now() - startedAt,
            externalRedirect: true,
            error: {
              code: "EXTERNAL_REDIRECT",
              message: "The page redirects to a different website and was not followed.",
            },
          };
        }

        current = next;
        continue;
      }

      let bodyInfo;
      try {
        bodyInfo = await readResponseBody(response, maxBytes);
      } catch (error) {
        return {
          url: inputUrl,
          finalUrl: current.toString(),
          status: currentStatus,
          contentType: currentContentType,
          body: "",
          bodyBytes: 0,
          truncated: false,
          redirects,
          responseTimeMs: Date.now() - startedAt,
          error: describeNetworkError(error, {
            timedOut,
            aborted: Boolean(signal?.aborted && !timedOut),
          }),
        };
      }

      return {
        url: inputUrl,
        finalUrl: current.toString(),
        status: currentStatus,
        contentType: currentContentType,
        body: bodyInfo.text,
        bodyBytes: bodyInfo.bytes,
        truncated: bodyInfo.truncated,
        redirects,
        responseTimeMs: Date.now() - startedAt,
        error: null,
      };
    }

    return {
      url: inputUrl,
      finalUrl: current.toString(),
      status: null,
      contentType: "",
      body: "",
      bodyBytes: 0,
      truncated: false,
      redirects,
      responseTimeMs: Date.now() - startedAt,
      error: {
        code: "REDIRECT_LOOP",
        message: `The page exceeded ${MAX_REDIRECTS} redirects.`,
      },
    };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", onCallerAbort);
  }
}
