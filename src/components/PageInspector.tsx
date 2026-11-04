import { useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  CalendarClock,
  Check,
  ChevronRight,
  Clock3,
  Code2,
  Copy,
  FileWarning,
  GitFork,
  Globe2,
  Info,
  Link2,
  MousePointerClick,
  TriangleAlert,
} from "lucide-react";
import type { PageRecord } from "../types";
import { formatDuration, formatNumber, pageLabel, truncate } from "../lib/format";

interface PageInspectorProps {
  page: PageRecord | null;
  pages: PageRecord[];
  onSelect: (url: string) => void;
}

function HealthPill({ page }: { page: PageRecord }) {
  const label =
    page.health === "ok" ? "HEALTHY" : page.health === "warning" ? "WARNING" : "BROKEN";
  return (
    <span className={`status-pill status-pill--${page.health}`}>
      <span className="status-pill__dot" />
      {label}
    </span>
  );
}

export function PageInspector({ page, pages, onSelect }: PageInspectorProps) {
  const [copied, setCopied] = useState(false);

  if (!page) {
    return (
      <aside className="inspector-card inspector-card--empty">
        <MousePointerClick size={26} strokeWidth={1.4} />
        <h2>Select a page</h2>
        <p>Choose any node in the sitemap to inspect its title, status, link counts, and issues.</p>
      </aside>
    );
  }

  const pageByUrl = new Map(pages.map((entry) => [entry.url, entry]));
  const parentPage = page.parent ? pageByUrl.get(page.parent.url) : null;
  const childPages = page.children.map((url) => pageByUrl.get(url)).filter(Boolean);

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(page.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <aside className="inspector-card" aria-labelledby="inspector-title">
      <div className="inspector-card__top">
        <div>
          <p className="eyebrow">PAGE INSPECTOR</p>
          <h2 id="inspector-title">{pageLabel(page.path)}</h2>
        </div>
        <HealthPill page={page} />
      </div>

      <div className="inspector-url">
        <Globe2 size={14} aria-hidden="true" />
        <span title={page.url}>{truncate(page.url, 68)}</span>
        <button type="button" onClick={copyUrl} aria-label="Copy page URL" title="Copy URL">
          {copied ? <Check size={14} /> : <Copy size={13} />}
        </button>
        <a
          href={page.url}
          target="_blank"
          rel="noreferrer"
          aria-label="Open page in a new tab"
          title="Open page"
        >
          <ArrowUpRight size={14} />
        </a>
      </div>

      <div className="inspector-title-block">
        <span className="mono">DOCUMENT TITLE</span>
        <p className={!page.title ? "is-missing" : ""}>
          {page.title || "No title supplied"}
        </p>
        {page.titleLength > 120 ? (
          <small>
            {formatNumber(page.titleLength)} characters — long titles may be truncated in browser
            tabs.
          </small>
        ) : null}
      </div>

      {page.failureReason ? (
        <div className={`inspector-alert inspector-alert--${page.health}`}>
          {page.health === "broken" ? <FileWarning size={16} /> : <TriangleAlert size={16} />}
          <p>{page.failureReason}</p>
        </div>
      ) : null}

      <div className="inspector-metrics">
        <div>
          <span className="mono">HTTP</span>
          <strong className={`metric-value metric-value--${page.health}`}>
            {page.statusCode ?? "ERR"}
          </strong>
        </div>
        <div>
          <span className="mono">DEPTH</span>
          <strong className="metric-value">{page.depth}</strong>
        </div>
        <div>
          <span className="mono">INBOUND</span>
          <strong className="metric-value">{page.counts.incomingInternalLinks}</strong>
        </div>
        <div>
          <span className="mono">RESPONSE</span>
          <strong className="metric-value metric-value--small">
            {formatDuration(page.responseTimeMs)}
          </strong>
        </div>
      </div>

      <div className="inspector-link-counts">
        <div>
          <Link2 size={15} />
          <span>
            <strong>{page.counts.internalLinks}</strong> internal out
          </span>
        </div>
        <div>
          <ArrowUpRight size={15} />
          <span>
            <strong>{page.counts.externalLinks}</strong> external out
          </span>
        </div>
        <div>
          <ArrowDownLeft size={15} />
          <span>
            <strong>{page.counts.incomingInternalLinks}</strong> inbound
          </span>
        </div>
      </div>

      <dl className="inspector-facts">
        <div>
          <dt><Code2 size={13} /> CRAWL METHOD</dt>
          <dd>{page.rendered ? "Headless browser" : "HTTP request"}</dd>
        </div>
        <div>
          <dt><Clock3 size={13} /> HTML SIZE</dt>
          <dd>
            {page.htmlBytes > 0
              ? `${formatNumber(Math.round(page.htmlBytes / 1024))} KB`
              : "Unknown"}
          </dd>
        </div>
        <div>
          <dt><Info size={13} /> CONTENT TYPE</dt>
          <dd>{page.contentType?.split(";")[0] || "Not provided"}</dd>
        </div>
        {page.redirects.length ? (
          <div>
            <dt><GitFork size={13} /> REDIRECTS</dt>
            <dd>{page.redirects.length} hop{page.redirects.length === 1 ? "" : "s"}</dd>
          </div>
        ) : null}
        {page.soft404 ? (
          <div>
            <dt><FileWarning size={13} /> SOFT 404</dt>
            <dd>Detected despite HTTP 200</dd>
          </div>
        ) : null}
      </dl>

      {page.description ? (
        <div className="inspector-description">
          <span className="mono">DESCRIPTION</span>
          <p>{page.description}</p>
        </div>
      ) : null}

      {page.warnings.length ? (
        <div className="inspector-warnings">
          <span className="mono"><TriangleAlert size={12} /> PAGE NOTES</span>
          <ul>
            {page.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {parentPage ? (
        <div className="inspector-relations">
          <span className="mono"><ArrowDownLeft size={12} /> DISCOVERED THROUGH</span>
          <button type="button" className="relation-chip" onClick={() => onSelect(parentPage.url)}>
            <span>{pageLabel(parentPage.path)}</span>
            <ChevronRight size={13} />
          </button>
          {page.parent?.linkText ? (
            <small>via “{truncate(page.parent.linkText, 54)}”</small>
          ) : null}
        </div>
      ) : (
        <div className="inspector-relations">
          <span className="mono"><CalendarClock size={12} /> ENTRY POINT</span>
          <p className="inspector-relations__muted">This is where the crawl began.</p>
        </div>
      )}

      {childPages.length ? (
        <div className="inspector-relations">
          <span className="mono"><ChevronRight size={12} /> DISCOVERED FROM HERE</span>
          <div className="relation-chip-list">
            {childPages.slice(0, 8).map((child) =>
              child ? (
                <button
                  type="button"
                  key={child.url}
                  className="relation-chip relation-chip--small"
                  onClick={() => onSelect(child.url)}
                >
                  {pageLabel(child.path)}
                </button>
              ) : null,
            )}
          </div>
        </div>
      ) : null}
    </aside>
  );
}
