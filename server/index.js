import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeSite, CrawlError } from "./crawler/analyzer.js";
import { getRendererInfo } from "./crawler/browser.js";
import { InputError, validateDestination, validateScanPayload } from "./crawler/validate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const app = express();
const PORT = Number(process.env.PORT) || 8787;
const MAX_CONCURRENT_SCANS = 2;
let activeScans = 0;

app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  next();
});
app.use(express.json({ limit: "20kb" }));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    tool: "CraftScope",
    renderer: getRendererInfo(),
    activeScans,
  });
});

app.get("/api/meta", (_req, res) => {
  res.json({
    tool: "CraftScope",
    version: "1.0.0",
    defaultUrl: process.env.DEFAULT_ANALYZER_URL || "https://bashcraftclub.vercel.app/",
    renderer: getRendererInfo(),
    limits: {
      maxPages: 100,
      maxDepth: 6,
      timeoutMs: 30000,
    },
  });
});

function sendError(res, error) {
  const isKnown = error instanceof InputError || error instanceof CrawlError;
  const status = isKnown ? error.status : 500;
  const body = {
    error: {
      code: isKnown ? error.code : "INTERNAL_ERROR",
      message: isKnown
        ? error.message
        : "The analyzer hit an unexpected error. Please try again.",
      hint: isKnown ? error.hint || null : null,
    },
  };
  if (!isKnown) console.error("[api] unexpected error", error);
  return res.status(status).json(body);
}

app.post("/api/analyze", async (req, res) => {
  if (activeScans >= MAX_CONCURRENT_SCANS) {
    return res.status(429).json({
      error: {
        code: "ANALYZER_BUSY",
        message: "Two scans are already running. Please wait a moment and try again.",
        hint: "Scans are limited to keep the browser workload predictable.",
      },
    });
  }

  let validated;
  try {
    validated = validateScanPayload(req.body || {});
    await validateDestination(validated.startUrl);
  } catch (error) {
    return sendError(res, error);
  }

  activeScans += 1;
  const controller = new AbortController();
  let finished = false;
  let wroteHeaders = false;

  const cleanup = () => {
    if (finished) return;
    finished = true;
    clearInterval(heartbeat);
    activeScans = Math.max(0, activeScans - 1);
  };

  const writeEvent = (payload) => {
    if (finished || res.writableEnded || res.destroyed) return;
    try {
      res.write(`${JSON.stringify(payload)}\n`);
    } catch {
      // The client went away mid-scan.
    }
  };

  res.on("close", () => {
    if (!res.writableEnded) {
      controller.abort();
      cleanup();
    }
  });

  // Headers are only sent after validation, so malformed requests still receive
  // a normal JSON error response with an actionable status code.
  res.status(200);
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  wroteHeaders = true;

  const heartbeat = setInterval(() => {
    writeEvent({ type: "ping", at: Date.now() });
  }, 15000);
  heartbeat.unref?.();

  writeEvent({
    type: "accepted",
    data: {
      startUrl: validated.startUrl,
      options: validated.options,
      message: "Scan accepted. Checking the site's crawl rules first.",
    },
  });

  try {
    const report = await analyzeSite(validated, {
      signal: controller.signal,
      onEvent: (event) => writeEvent(event),
    });
    writeEvent({ type: "complete", data: report });
  } catch (error) {
    if (controller.signal.aborted) {
      // No one is listening; just release the scan slot.
    } else if (error instanceof CrawlError || error instanceof InputError) {
      writeEvent({
        type: "error",
        error: {
          code: error.code,
          message: error.message,
          hint: error.hint || null,
        },
      });
    } else {
      console.error("[scan] unexpected error", error);
      writeEvent({
        type: "error",
        error: {
          code: "SCAN_FAILED",
          message: "The scan ended unexpectedly. Please try again.",
          hint: null,
        },
      });
    }
  } finally {
    cleanup();
    if (!res.writableEnded) res.end();
  }
});

app.use("/api", (_req, res) => {
  res.status(404).json({
    error: { code: "NOT_FOUND", message: "That API endpoint does not exist.", hint: null },
  });
});

if (fs.existsSync(path.join(distDir, "index.html"))) {
  app.use(express.static(distDir, { index: false, maxAge: "1h" }));
  app.get(/.*/, (_req, res) => {
    res.sendFile(path.join(distDir, "index.html"));
  });
} else {
  app.get(/.*/, (_req, res) => {
    res
      .status(503)
      .type("text/plain")
      .send(
        "CraftScope's frontend has not been built. Run `npm run dev` for development or `npm run build` first.",
      );
  });
}

app.use((error, _req, res, _next) => {
  if (error?.type === "entity.parse.failed") {
    return res.status(400).json({
      error: {
        code: "INVALID_JSON",
        message: "The request body must be valid JSON.",
        hint: null,
      },
    });
  }
  return sendError(res, error);
});

const server = app.listen(PORT, () => {
  console.log(`[craftscope] API listening on http://localhost:${PORT}`);
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

export { app };
