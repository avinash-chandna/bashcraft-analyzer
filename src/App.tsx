import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import type {
  ActivityEntry,
  ApiError,
  CrawlProgress,
  Report,
  ScanSettings,
} from "./types";
import { Header } from "./components/Header";
import { LandingView } from "./components/LandingView";
import { ScanningView } from "./components/ScanningView";
import { ErrorView } from "./components/ErrorView";
import { ResultView } from "./components/ResultView";
import { HowItWorksModal } from "./components/HowItWorksModal";

type View = "landing" | "scanning" | "report" | "error";

class ScanRequestError extends Error {
  code: string;
  hint?: string | null;

  constructor(message: string, code = "REQUEST_FAILED", hint: string | null = null) {
    super(message);
    this.name = "ScanRequestError";
    this.code = code;
    this.hint = hint;
  }
}

const DEFAULT_URL = "https://bashcraftclub.vercel.app/";
const DEFAULT_SETTINGS: ScanSettings = {
  maxPages: 25,
  maxDepth: 3,
  renderJs: true,
  respectRobots: true,
};

const DEFAULT_ERROR: ApiError = {
  code: "SCAN_FAILED",
  message: "The scan could not be completed.",
  hint: null,
};

function Footer({ onMethod }: { onMethod: () => void }) {
  return (
    <footer className="site-footer">
      <div className="site-footer__brand">
        <span className="footer-mark" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </span>
        <div>
          <strong>CRAFTSCOPE</strong>
          <p>A clear look at the BashCraft Club website.</p>
        </div>
      </div>
      <div className="site-footer__middle">
        <button type="button" onClick={onMethod}>METHOD</button>
        <a href="https://bashcraftclub.vercel.app/" target="_blank" rel="noreferrer">
          TARGET <ArrowUpRight size={11} />
        </a>
        <span>ROBOTS-AWARE</span>
      </div>
      <div className="site-footer__fine">
        <span className="mono">BUILT FOR BASHCRAFT / 2026</span>
        <span className="mono footer-status"><i /> CRAWLER READY</span>
      </div>
    </footer>
  );
}

export default function App() {
  const [view, setView] = useState<View>("landing");
  const [url, setUrl] = useState(DEFAULT_URL);
  const [settings, setSettings] = useState<ScanSettings>(DEFAULT_SETTINGS);
  const [report, setReport] = useState<Report | null>(null);
  const [apiError, setApiError] = useState<ApiError | null>(null);
  const [methodOpen, setMethodOpen] = useState(false);
  const [stage, setStage] = useState("robots");
  const [progress, setProgress] = useState<CrawlProgress | null>(null);
  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [scanWarnings, setScanWarnings] = useState<string[]>([]);
  const [startedAt, setStartedAt] = useState(Date.now());
  const abortRef = useRef<AbortController | null>(null);
  const cancelledRef = useRef(false);
  const scanActiveRef = useRef(false);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [view]);

  const closeMethod = useCallback(() => setMethodOpen(false), []);

  const cancelScan = () => {
    cancelledRef.current = true;
    scanActiveRef.current = false;
    abortRef.current?.abort();
    abortRef.current = null;
    setView("landing");
    setProgress(null);
    setActivities([]);
    setScanWarnings([]);
    setApiError(null);
  };

  const goHome = () => {
    if (scanActiveRef.current) {
      cancelScan();
      return;
    }
    setView("landing");
    setApiError(null);
  };

  const startScan = async () => {
    cancelledRef.current = false;
    scanActiveRef.current = true;
    setApiError(null);
    setReport(null);
    setProgress(null);
    setActivities([]);
    setScanWarnings([]);
    setStage("robots");
    setStartedAt(Date.now());
    setView("scanning");

    const controller = new AbortController();
    abortRef.current = controller;
    let sawTerminalEvent = false;

    const handleEvent = (payload: {
      type: string;
      stage?: string;
      message?: string;
      data?: CrawlProgress | Report;
      error?: ApiError;
    }) => {
      if (payload.type === "accepted") {
        setStage("robots");
        return;
      }
      if (payload.type === "stage" && payload.stage) {
        setStage(payload.stage);
        return;
      }
      if (payload.type === "warning") {
        const message = payload.message || "The scan recorded a warning.";
        setScanWarnings((current) => (current.includes(message) ? current : [...current, message]));
        return;
      }
      if (payload.type === "progress" && payload.data) {
        const next = payload.data as CrawlProgress;
        setStage("crawl");
        setProgress(next);
        if (next.lastPage) {
          const entry: ActivityEntry = {
            ...next.lastPage,
            message: next.message,
            at: Date.now(),
          };
          setActivities((current) => {
            if (current[0]?.url === entry.url) return current;
            return [entry, ...current].slice(0, 7);
          });
        }
        return;
      }
      if (payload.type === "complete" && payload.data) {
        sawTerminalEvent = true;
        setReport(payload.data as Report);
        setView("report");
        return;
      }
      if (payload.type === "error") {
        sawTerminalEvent = true;
        setApiError(payload.error || DEFAULT_ERROR);
        setView("error");
      }
    };

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
        body: JSON.stringify({ url, ...settings }),
        signal: controller.signal,
      });

      if (!response.ok) {
        let errorPayload: { error?: ApiError } = {};
        try {
          errorPayload = await response.json();
        } catch {
          // A non-JSON proxy error should still yield a useful fallback.
        }

        const apiMessage = errorPayload.error?.message;
        const missingApi =
          response.status === 404 && (!apiMessage || /page could not be found/i.test(apiMessage));
        if (missingApi) {
          throw new ScanRequestError(
            "The analyzer API is not available on this deployment.",
            "API_UNAVAILABLE",
            "Deploy the included serverless API (the `api/` directory) or run `npm start` locally. A static frontend alone cannot crawl websites.",
          );
        }

        throw new ScanRequestError(
          apiMessage || `The analyzer returned HTTP ${response.status}.`,
          errorPayload.error?.code || "API_ERROR",
          errorPayload.error?.hint || null,
        );
      }

      if (!response.body) {
        throw new ScanRequestError(
          "The analyzer returned an unreadable response.",
          "EMPTY_RESPONSE",
          "Make sure the API server is running.",
        );
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const processLine = (line: string) => {
        if (!line.trim()) return;
        try {
          handleEvent(JSON.parse(line));
        } catch {
          // Ignore a malformed progress frame rather than discarding a good scan.
        }
      };

      while (!sawTerminalEvent) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newlineIndex = buffer.indexOf("\n");
        while (newlineIndex !== -1) {
          const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
          buffer = buffer.slice(newlineIndex + 1);
          processLine(line);
          newlineIndex = buffer.indexOf("\n");
        }
      }
      buffer += decoder.decode();
      processLine(buffer);

      if (!sawTerminalEvent && !controller.signal.aborted) {
        throw new ScanRequestError(
          "The crawl stream ended before a report was produced.",
          "INCOMPLETE_STREAM",
          "The server may have restarted. Run the scan again.",
        );
      }
    } catch (error) {
      if (cancelledRef.current || controller.signal.aborted) {
        return;
      }
      if (error instanceof ScanRequestError) {
        setApiError({ code: error.code, message: error.message, hint: error.hint });
      } else {
        setApiError({
          code: "SERVICE_UNREACHABLE",
          message:
            "The analyzer could not be reached. Check that the API server is running, then try again.",
          hint: "Run `npm run dev` and open http://localhost:5173.",
        });
      }
      setView("error");
    } finally {
      scanActiveRef.current = false;
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  return (
    <>
      <Header
        onHome={goHome}
        onMethod={() => setMethodOpen(true)}
        onNewScan={view === "report" ? goHome : undefined}
      />

      {view === "landing" ? (
        <LandingView
          url={url}
          onUrlChange={setUrl}
          settings={settings}
          onSettingsChange={setSettings}
          onScan={startScan}
          error={null}
        />
      ) : null}

      {view === "scanning" ? (
        <ScanningView
          url={url}
          stage={stage}
          progress={progress}
          activities={activities}
          warnings={scanWarnings}
          startedAt={startedAt}
          onCancel={cancelScan}
        />
      ) : null}

      {view === "report" && report ? (
        <ResultView
          key={report.meta.generatedAt}
          report={report}
          onNewScan={goHome}
        />
      ) : null}

      {view === "error" ? (
        <ErrorView
          url={url}
          error={apiError || DEFAULT_ERROR}
          onTryAgain={() => setView("landing")}
          onHome={goHome}
        />
      ) : null}

      <Footer onMethod={() => setMethodOpen(true)} />
      {methodOpen ? <HowItWorksModal onClose={closeMethod} /> : null}
    </>
  );
}
