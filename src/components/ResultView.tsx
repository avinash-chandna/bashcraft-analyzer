import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  CircleSlash2,
  Download,
  ExternalLink,
  FileSearch,
  Files,
  GitMerge,
  Globe2,
  Link2,
  Network,
  Settings2,
  ShieldCheck,
  Sparkles,
  Timer,
  Waypoints,
} from "lucide-react";
import type { LinkCategory, Report, ResultsTab } from "../types";
import {
  formatDateTime,
  formatDuration,
  formatNumber,
  hostnameOf,
  truncate,
} from "../lib/format";
import { ExportView } from "./ExportView";
import { LinksView } from "./LinksView";
import { PagesView } from "./PagesView";
import { PageInspector } from "./PageInspector";
import { SitemapGraph } from "./SitemapGraph";

interface ResultViewProps {
  report: Report;
  onNewScan: () => void;
}

const TABS: Array<{
  id: ResultsTab;
  label: string;
  icon: typeof Network;
  count?: (report: Report) => string;
}> = [
  { id: "overview", label: "SITEMAP", icon: Network },
  { id: "pages", label: "PAGES", icon: Files, count: (report) => String(report.pages.length) },
  {
    id: "links",
    label: "LINKS",
    icon: Link2,
    count: (report) => String(report.links.internal.length + report.links.external.length),
  },
  { id: "export", label: "EXPORT", icon: Download },
];

function SummaryCard({
  label,
  value,
  detail,
  icon: Icon,
  tone = "neutral",
  onClick,
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof Network;
  tone?: "neutral" | "ok" | "warning" | "broken" | "external";
  onClick: () => void;
}) {
  return (
    <button type="button" className={`summary-card summary-card--${tone}`} onClick={onClick}>
      <div className="summary-card__top">
        <span className="summary-card__label mono">{label}</span>
        <Icon size={17} strokeWidth={1.7} />
      </div>
      <strong>{value}</strong>
      <span className="summary-card__detail">{detail}</span>
      <span className="summary-card__link">
        {tone === "broken" && value !== "0" ? "REVIEW FAILURES" : "VIEW DETAIL"}
        <ArrowRight size={12} />
      </span>
    </button>
  );
}

export function ResultView({ report, onNewScan }: ResultViewProps) {
  const rootUrl = report.pages.find((page) => page.depth === 0)?.url ?? report.pages[0]?.url ?? null;
  const [tab, setTab] = useState<ResultsTab>("overview");
  const [linkCategory, setLinkCategory] = useState<LinkCategory>("broken");
  const [selectedUrl, setSelectedUrl] = useState<string | null>(rootUrl);
  const { summary } = report;
  const selectedPage = report.pages.find((page) => page.url === selectedUrl) ?? null;

  const healthStyle = useMemo(() => {
    const total = Math.max(1, report.pages.length);
    const healthy = (summary.healthyPages / total) * 100;
    const warning = (summary.warningPages / total) * 100;
    return {
      background: `conic-gradient(
        var(--green) 0 ${healthy}%,
        var(--amber) ${healthy}% ${healthy + warning}%,
        var(--coral) ${healthy + warning}% 100%
      )`,
    };
  }, [report.pages.length, summary.healthyPages, summary.warningPages]);

  const openLinks = (category: LinkCategory) => {
    setLinkCategory(category);
    setTab("links");
  };

  const inspectPage = (url: string) => {
    if (!report.pages.some((page) => page.url === url)) return;
    setSelectedUrl(url);
    setTab("pages");
  };

  const topHosts = [...report.externalHosts].sort((a, b) => b.sourceCount - a.sourceCount).slice(0, 5);
  const maxHostCount = Math.max(1, ...topHosts.map((host) => host.sourceCount));
  const siteUrl = report.meta.site;
  const siteHost = hostnameOf(siteUrl);
  const hasBroken = summary.brokenLinks > 0;

  return (
    <main id="main" className="results-main">
      <section className="results-hero" aria-labelledby="results-title">
        <div className="results-hero__main">
          <p className="results-breadcrumb">
            <span>ANALYSIS</span>
            <i>/</i>
            <span>{report.meta.startUrl === siteUrl + "/" ? "ROOT" : "SITE"}</span>
            <i>/</i>
            <span className="is-accent">COMPLETE</span>
          </p>
          <div className="results-title-row">
            <span className="site-avatar">{siteHost.slice(0, 2).toUpperCase()}</span>
            <div>
              <h1 id="results-title">{siteHost}</h1>
              <div className="results-title-meta">
                <span className="complete-badge">
                  <CheckCircle2 size={13} />
                  SCAN COMPLETE
                </span>
                <span>{formatDateTime(report.meta.generatedAt)}</span>
                <span className="meta-divider" />
                <span>{formatDuration(report.meta.durationMs)}</span>
                <span className="meta-divider" />
                <span>{report.meta.crawledWith === "playwright" ? "JS RENDERED" : "HTTP ONLY"}</span>
              </div>
            </div>
          </div>
          <p className="results-summary-line">
            {hasBroken ? (
              <>
                <strong>{summary.brokenLinks}</strong> broken internal destination
                {summary.brokenLinks === 1 ? "" : "s"} need attention.
              </>
            ) : (
              <>
                All <strong>{formatNumber(summary.pagesDiscovered)} pages</strong> are reachable and the
                internal link graph is clean.
              </>
            )}{" "}
            <span>{summary.duplicatesMerged} duplicate URL variations were collapsed during the crawl.</span>
          </p>
        </div>

        <div className="results-hero__actions">
          <a className="button button--ghost button--small" href={siteUrl} target="_blank" rel="noreferrer">
            OPEN SITE
            <ArrowUpRight size={14} />
          </a>
          <button
            type="button"
            className="button button--small"
            onClick={() => {
              setTab("export");
            }}
          >
            EXPORT REPORT
            <Download size={14} />
          </button>
        </div>
      </section>

      {summary.pageLimitReached ? (
        <div className="results-banner results-banner--warning">
          <AlertTriangle size={16} />
          <p>
            The {report.config.maxPages}-page limit was reached. Some discovered links remain
            unchecked — increase the page limit and rescan for full coverage.
          </p>
          <button type="button" className="text-button" onClick={onNewScan}>
            RESCAN
          </button>
        </div>
      ) : null}

      {report.warnings.length ? (
        <div className="results-banner results-banner--subtle">
          <AlertTriangle size={16} />
          <p>{report.warnings[0]}</p>
          <span className="mono">{report.warnings.length} WARNING{report.warnings.length === 1 ? "" : "S"}</span>
        </div>
      ) : null}

      <section className="summary-grid" aria-label="Scan summary">
        <SummaryCard
          label="PAGES DISCOVERED"
          value={formatNumber(summary.pagesDiscovered)}
          detail={`${summary.healthyPages} healthy · ${summary.warningPages} warnings · ${summary.brokenPages} broken`}
          icon={FileSearch}
          tone={summary.brokenPages > 0 ? "warning" : "ok"}
          onClick={() => setTab("pages")}
        />
        <SummaryCard
          label="INTERNAL LINKS"
          value={formatNumber(summary.internalLinks)}
          detail={`${summary.uniqueInternalTargets} unique targets · ${summary.linksChecked} checked`}
          icon={Link2}
          tone="neutral"
          onClick={() => openLinks("internal")}
        />
        <SummaryCard
          label="EXTERNAL LINKS"
          value={formatNumber(summary.externalLinks)}
          detail={`${summary.externalLinkOccurrences} references · ${summary.externalHosts} hosts · not fetched`}
          icon={ExternalLink}
          tone="external"
          onClick={() => openLinks("external")}
        />
        <SummaryCard
          label="BROKEN LINKS"
          value={formatNumber(summary.brokenLinks)}
          detail={
            summary.brokenLinks
              ? `${summary.brokenLinkRelations} failing relationships`
              : "No errors, timeouts, or soft 404s"
          }
          icon={hasBroken ? CircleSlash2 : ShieldCheck}
          tone={hasBroken ? "broken" : "ok"}
          onClick={() => openLinks("broken")}
        />
      </section>

      <div className="scan-facts">
        <span><Timer size={13} /> {formatDuration(report.meta.durationMs)} total</span>
        <span><Globe2 size={13} /> Depth {summary.maxDepthReached} / {report.config.maxDepth} max</span>
        <span>
          <GitMerge size={13} /> {summary.duplicatesMerged} URL variants merged
        </span>
        <span>
          <Sparkles size={13} /> {report.renderer.pagesRendered > 0 ? `${report.renderer.pagesRendered} pages JS rendered` : "HTTP mode"}
        </span>
        <span>
          <ShieldCheck size={13} />{" "}
          {report.robots.checked
            ? report.robots.found
              ? "robots.txt applied"
              : "no robots rules"
            : "robots.txt disabled"}
        </span>
        {summary.linksNotChecked > 0 ? (
          <span className="scan-facts__warning">
            <AlertTriangle size={13} /> {summary.linksNotChecked} links not checked
          </span>
        ) : null}
      </div>

      <div className="result-tabbar" role="tablist" aria-label="Report sections">
        {TABS.map((tabDef) => (
          <button
            key={tabDef.id}
            type="button"
            role="tab"
            aria-selected={tab === tabDef.id}
            className={tab === tabDef.id ? "is-active" : ""}
            onClick={() => setTab(tabDef.id)}
          >
            <tabDef.icon size={15} />
            {tabDef.label}
            {tabDef.count ? <span>{tabDef.count(report)}</span> : null}
          </button>
        ))}
        <div className="result-tabbar__aside">
          <span className="mono">{report.meta.tool.name.toUpperCase()} / {report.meta.tool.version}</span>
        </div>
      </div>

      <div className="results-body">
        {tab === "overview" ? (
          <div className="tab-panel" role="tabpanel" aria-label="Sitemap overview">
            <div className="overview-grid">
              <SitemapGraph
                pages={report.pages}
                links={report.links.internal}
                selectedUrl={selectedUrl}
                onSelect={setSelectedUrl}
              />
              <PageInspector page={selectedPage} pages={report.pages} onSelect={setSelectedUrl} />
            </div>

            <div className="overview-lower">
              <section className="insight-card" aria-labelledby="health-title">
                <div className="insight-card__header">
                  <div>
                    <p className="eyebrow">PAGE HEALTH</p>
                    <h2 id="health-title">Surface integrity</h2>
                  </div>
                  <CheckCircle2 size={18} />
                </div>
                <div className="health-content">
                  <div className="health-ring" style={healthStyle}>
                    <div>
                      <strong>{report.pages.length}</strong>
                      <span>PAGES</span>
                    </div>
                  </div>
                  <div className="health-legend">
                    <div>
                      <i className="legend-dot legend-dot--ok" />
                      <span>Healthy</span>
                      <strong>{summary.healthyPages}</strong>
                    </div>
                    <div>
                      <i className="legend-dot legend-dot--warning" />
                      <span>Warnings</span>
                      <strong>{summary.warningPages}</strong>
                    </div>
                    <div>
                      <i className="legend-dot legend-dot--broken" />
                      <span>Broken</span>
                      <strong>{summary.brokenPages}</strong>
                    </div>
                  </div>
                </div>
                <div className="insight-stats">
                  <div>
                    <span className="mono">LINKS VERIFIED</span>
                    <strong>{summary.linksChecked}</strong>
                  </div>
                  <div>
                    <span className="mono">SOFT 404S</span>
                    <strong>{report.pages.filter((page) => page.soft404).length}</strong>
                  </div>
                  <div>
                    <span className="mono">UNCHECKED</span>
                    <strong>{summary.linksNotChecked}</strong>
                  </div>
                </div>
              </section>

              <section className="insight-card" aria-labelledby="external-title">
                <div className="insight-card__header">
                  <div>
                    <p className="eyebrow">EXTERNAL GRAVITY</p>
                    <h2 id="external-title">Where links leave</h2>
                  </div>
                  <Globe2 size={18} />
                </div>
                <div className="host-list">
                  {topHosts.map((host) => (
                    <div className="host-row" key={host.host}>
                      <div className="host-row__label">
                        <span title={host.host}>{truncate(host.host, 28)}</span>
                        <strong>{host.sourceCount}</strong>
                      </div>
                      <div className="host-bar">
                        <span style={{ width: `${(host.sourceCount / maxHostCount) * 100}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
                <button type="button" className="text-button" onClick={() => openLinks("external")}>
                  VIEW ALL {summary.externalLinks} EXTERNAL TARGETS
                  <ArrowUpRight size={13} />
                </button>
              </section>

              <section className="insight-card" aria-labelledby="method-title">
                <div className="insight-card__header">
                  <div>
                    <p className="eyebrow">CRAWL TELEMETRY</p>
                    <h2 id="method-title">How it moved</h2>
                  </div>
                  <Settings2 size={18} />
                </div>
                <dl className="telemetry-list">
                  <div>
                    <dt><Waypoints size={13} /> Scope</dt>
                    <dd>{report.meta.siteKey}</dd>
                  </div>
                  <div>
                    <dt><Settings2 size={13} /> Limits</dt>
                    <dd>{report.config.maxPages} pages · depth {report.config.maxDepth}</dd>
                  </div>
                  <div>
                    <dt><Sparkles size={13} /> Renderer</dt>
                    <dd>
                      {report.renderer.pagesRendered
                        ? `${report.renderer.pagesRendered} pages via ${report.renderer.engine || "Chromium"}`
                        : report.renderer.message}
                    </dd>
                  </div>
                  <div>
                    <dt><ShieldCheck size={13} /> Robots</dt>
                    <dd>{report.robots.note}</dd>
                  </div>
                  <div>
                    <dt><Globe2 size={13} /> Request delay</dt>
                    <dd>{report.config.delayBetweenRequestsMs} ms between pages</dd>
                  </div>
                </dl>
                {report.warnings.length ? (
                  <div className="telemetry-warning">
                    <AlertTriangle size={14} />
                    <span>{report.warnings.length} scan warning{report.warnings.length === 1 ? "" : "s"} recorded</span>
                  </div>
                ) : null}
              </section>
            </div>

            <div className="sitemap-footnote">
              <p>
                <span className="mono">READING THE MAP</span>
                The tree view shows first-discovery relationships. Switch to “All links” to reveal every
                internal source → target edge, including navigation and cross-links.
              </p>
              <button type="button" className="text-button" onClick={() => openLinks("broken")}>
                INSPECT BROKEN LINKS
                <ArrowRight size={13} />
              </button>
            </div>
          </div>
        ) : null}

        {tab === "pages" ? (
          <div className="tab-panel" role="tabpanel" aria-label="Discovered pages">
            <PagesView pages={report.pages} selectedUrl={selectedUrl} onSelect={setSelectedUrl} />
          </div>
        ) : null}

        {tab === "links" ? (
          <div className="tab-panel" role="tabpanel" aria-label="Link ledger">
            <LinksView
              report={report}
              category={linkCategory}
              onCategoryChange={setLinkCategory}
              onSelectPage={inspectPage}
            />
          </div>
        ) : null}

        {tab === "export" ? (
          <div className="tab-panel" role="tabpanel" aria-label="Export report">
            <ExportView report={report} />
          </div>
        ) : null}
      </div>
    </main>
  );
}
