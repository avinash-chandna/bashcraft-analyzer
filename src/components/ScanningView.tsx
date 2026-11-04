import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowRight,
  CircleStop,
  Clock3,
  Globe2,
  Radio,
  ScanLine,
  TriangleAlert,
} from "lucide-react";
import type { ActivityEntry, CrawlProgress } from "../types";
import { formatDuration, hostnameOf, pageLabel, truncate } from "../lib/format";

interface ScanningViewProps {
  url: string;
  stage: string;
  progress: CrawlProgress | null;
  activities: ActivityEntry[];
  warnings: string[];
  startedAt: number;
  onCancel: () => void;
}

function stageCopy(stage: string): { eyebrow: string; title: string; body: string } {
  if (stage === "robots") {
    return {
      eyebrow: "STAGE 01 / CRAWL ETIQUETTE",
      title: "Reading the room.",
      body: "Checking robots.txt and crawl directives before the first page request.",
    };
  }
  if (stage === "report") {
    return {
      eyebrow: "STAGE 03 / SYNTHESIS",
      title: "Drawing the map.",
      body: "Resolving relationships, grouping external destinations, and preparing the report.",
    };
  }
  return {
    eyebrow: "STAGE 02 / DISCOVERY",
    title: "Following the wiring.",
    body: "Each internal page is rendered, normalised, and checked before its links join the frontier.",
  };
}

export function ScanningView({
  url,
  stage,
  progress,
  activities,
  warnings,
  startedAt,
  onCancel,
}: ScanningViewProps) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const copy = stageCopy(stage);
  const pagesCrawled = progress?.pagesCrawled ?? 0;
  const maxPages = progress?.maxPages ?? 25;
  const percent = useMemo(() => {
    if (stage === "robots") return 5;
    if (stage === "report") return 94;
    return Math.min(91, Math.max(9, Math.round((pagesCrawled / Math.max(1, maxPages)) * 88)));
  }, [stage, pagesCrawled, maxPages]);

  return (
    <main id="main" className="scanning-shell">
      <div className="scanning-head">
        <div>
          <div className="live-kicker">
            <span className="live-pulse" />
            CRAWL IN PROGRESS
          </div>
          <h1>Mapping <span>{hostnameOf(url)}</span></h1>
          <p>{copy.body}</p>
        </div>
        <div className="scanning-head__meta">
          <span>
            <Clock3 size={14} />
            {formatDuration(now - startedAt)}
          </span>
          <button type="button" className="button button--small button--danger" onClick={onCancel}>
            <CircleStop size={14} />
            CANCEL
          </button>
        </div>
      </div>

      <div className="scan-layout">
        <section className="scan-progress-card" aria-live="polite">
          <div className="scan-progress-card__top">
            <div className="scan-progress-card__stage">
              <ScanLine size={19} strokeWidth={1.8} />
              <div>
                <span className="eyebrow">{copy.eyebrow}</span>
                <h2>{copy.title}</h2>
              </div>
            </div>
            <span className="mono scan-percent">{percent}%</span>
          </div>

          <div className="progress-track">
            <div className="progress-track__fill" style={{ width: `${percent}%` }} />
            <div className="progress-track__scan" style={{ left: `${Math.min(97, percent)}%` }} />
          </div>

          <div className="scan-current">
            <span className="scan-current__icon">
              <Globe2 size={17} />
            </span>
            <div>
              <span className="mono scan-current__label">CURRENT TARGET</span>
              <strong>{progress?.currentPath || (stage === "robots" ? "/robots.txt" : "Awaiting first page")}</strong>
            </div>
            {progress?.statusCode ? (
              <span className="status-pill status-pill--ok">{progress.statusCode}</span>
            ) : null}
          </div>

          <div className="scan-metrics">
            <div>
              <span className="mono">PAGES MAPPED</span>
              <strong>{pagesCrawled}</strong>
              <small>of {maxPages} limit</small>
            </div>
            <div>
              <span className="mono">QUEUED</span>
              <strong>{progress?.pagesQueued ?? 0}</strong>
              <small>internal URLs</small>
            </div>
            <div>
              <span className="mono">LINKS SEEN</span>
              <strong>{(progress?.internalLinks ?? 0) + (progress?.externalLinks ?? 0)}</strong>
              <small>this crawl</small>
            </div>
          </div>

          <div className="scan-visual" aria-hidden="true">
            <div className="radar-ring radar-ring--1" />
            <div className="radar-ring radar-ring--2" />
            <div className="radar-ring radar-ring--3" />
            <div className="radar-cross radar-cross--x" />
            <div className="radar-cross radar-cross--y" />
            <div className="radar-sweep" />
            <span className="radar-node radar-node--1" />
            <span className="radar-node radar-node--2" />
            <span className="radar-node radar-node--3" />
            <span className="radar-node radar-node--4" />
            <div className="radar-label">
              <Radio size={13} />
              LIVE / {pageLabel(progress?.currentPath || "/")}
            </div>
          </div>
        </section>

        <aside className="scan-activity-card">
          <div className="scan-activity-card__header">
            <div>
              <span className="eyebrow">ACTIVITY FEED</span>
              <h2>Page log</h2>
            </div>
            <Activity size={18} strokeWidth={1.8} />
          </div>

          <div className="activity-feed">
            {activities.length ? (
              activities.map((activity, index) => (
                <div className="activity-row" key={`${activity.at}-${activity.path}-${index}`}>
                  <span
                    className={`activity-dot activity-dot--${
                      activity.health === "broken"
                        ? "broken"
                        : activity.health === "warning"
                          ? "warning"
                          : "ok"
                    }`}
                  />
                  <div className="activity-row__main">
                    <span className="activity-row__path">{truncate(activity.path, 36)}</span>
                    <span className="activity-row__title">{truncate(activity.title, 60)}</span>
                  </div>
                  <span className="mono activity-row__status">
                    {activity.statusCode ?? "ERR"}
                  </span>
                </div>
              ))
            ) : (
              <div className="activity-empty">
                <span className="skeleton-line skeleton-line--wide" />
                <span className="skeleton-line" />
                <span className="skeleton-line skeleton-line--short" />
                <p>Waiting for the first page response…</p>
              </div>
            )}
          </div>

          {warnings.length ? (
            <div className="scan-warning">
              <TriangleAlert size={15} />
              <p>{warnings[warnings.length - 1]}</p>
            </div>
          ) : (
            <div className="scan-note">
              <ArrowRight size={14} />
              <p>JavaScript pages can take a moment. The browser waits for the page to settle.</p>
            </div>
          )}
        </aside>
      </div>

      <p className="scan-footnote">
        <span className="status-dot status-dot--live" />
        Requests are sequential and rate-limited. Closing this tab cancels the crawl.
      </p>
    </main>
  );
}
