import { useMemo, useState } from "react";
import {
  Braces,
  Check,
  Copy,
  Download,
  FileJson,
  FileSpreadsheet,
  FileWarning,
  Map,
  ShieldCheck,
} from "lucide-react";
import type { Report } from "../types";
import {
  approximateBytes,
  brokenLinksCsv,
  copyReportJson,
  downloadBrokenCsv,
  downloadInternalLinksCsv,
  downloadJson,
  downloadPagesCsv,
  downloadSitemapXml,
  fileStem,
  internalLinksCsv,
  pagesCsv,
  reportJson,
  sitemapXml,
} from "../lib/export";
import { formatDateTime } from "../lib/format";

interface ExportViewProps {
  report: Report;
}

export function ExportView({ report }: ExportViewProps) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);

  const artifacts = useMemo(
    () => [
      {
        title: "Complete JSON report",
        file: `${fileStem(report)}.json`,
        description:
          "Everything: metadata, crawl settings, page records, internal relationships, broken links, external targets, robots policy, and warnings.",
        size: approximateBytes(reportJson(report)),
        icon: FileJson,
        accent: "lime",
        action: () => downloadJson(report),
        label: "DOWNLOAD JSON",
      },
      {
        title: "Page inventory CSV",
        file: `${fileStem(report)}-pages.csv`,
        description:
          "One row per discovered page with URL, title, status, depth, parent, link counts, response time, and warnings.",
        size: approximateBytes(pagesCsv(report)),
        icon: FileSpreadsheet,
        accent: "neutral",
        action: () => downloadPagesCsv(report),
        label: "DOWNLOAD CSV",
      },
      {
        title: "Broken links CSV",
        file: `${fileStem(report)}-broken-links.csv`,
        description:
          "A focused failure report: destination, failure reason, HTTP status, and every source page that references it.",
        size: approximateBytes(brokenLinksCsv(report)),
        icon: FileWarning,
        accent: "coral",
        action: () => downloadBrokenCsv(report),
        label: "DOWNLOAD CSV",
      },
      {
        title: "Standard sitemap XML",
        file: `${fileStem(report)}-sitemap.xml`,
        description:
          "A search-engine-compatible urlset containing successfully reached HTML pages. Use the JSON export to retain the link graph.",
        size: approximateBytes(sitemapXml(report)),
        icon: Map,
        accent: "neutral",
        action: () => downloadSitemapXml(report),
        label: "DOWNLOAD XML",
      },
    ],
    [report],
  );

  const copyJson = async () => {
    setCopyError(false);
    try {
      await copyReportJson(report);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopyError(true);
      window.setTimeout(() => setCopyError(false), 2500);
    }
  };

  return (
    <section className="export-view" aria-labelledby="export-title">
      <div className="export-hero">
        <div>
          <p className="eyebrow">EXPORT / PORTABLE OUTPUT</p>
          <h2 id="export-title">Take the map with you.</h2>
          <p>
            The crawl is complete. Choose a structured format for reporting, analysis, or handing
            the job to the next tool.
          </p>
        </div>
        <div className="export-hero__stamp">
          <ShieldCheck size={34} strokeWidth={1.2} />
          <span className="mono">SCAN COMPLETE</span>
          <strong>{formatDateTime(report.meta.generatedAt)}</strong>
        </div>
      </div>

      <div className="export-grid">
        {artifacts.map((artifact) => (
          <article
            key={artifact.title}
            className={`export-card export-card--${artifact.accent}`}
          >
            <div className="export-card__top">
              <span className="export-card__icon">
                <artifact.icon size={23} strokeWidth={1.55} />
              </span>
              <span className="mono export-card__size">{artifact.size}</span>
            </div>
            <h3>{artifact.title}</h3>
            <p>{artifact.description}</p>
            <code>{artifact.file}</code>
            <button type="button" className="export-card__button" onClick={artifact.action}>
              {artifact.label}
              <Download size={15} />
            </button>
          </article>
        ))}
      </div>

      <div className="export-lower">
        <article className="export-contract">
          <div className="export-contract__head">
            <Braces size={19} />
            <div>
              <span className="eyebrow">REPORT CONTRACT</span>
              <h3>What the JSON contains</h3>
            </div>
          </div>
          <ul>
            <li><Check size={13} /> Crawl metadata and exact normalisation settings</li>
            <li><Check size={13} /> Summary counts and page health distribution</li>
            <li><Check size={13} /> Full page records with depth, parent, status, and warnings</li>
            <li><Check size={13} /> Every internal source → target relationship</li>
            <li><Check size={13} /> Broken-link groups with affected source pages</li>
            <li><Check size={13} /> Grouped external destinations and robots.txt status</li>
          </ul>
          <button type="button" className="button button--ghost button--small" onClick={copyJson}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? "COPIED TO CLIPBOARD" : copyError ? "COPY FAILED — TRY DOWNLOAD" : "COPY JSON"}
          </button>
        </article>

        <article className="export-extra">
          <span className="eyebrow">NEED THE RAW EDGES?</span>
          <h3>Internal link ledger</h3>
          <p>
            Export all crawled internal relationships, including healthy links, warnings, blocked
            targets, and unchecked destinations.
          </p>
          <div className="export-extra__meta">
            <span className="mono">{report.links.internal.length} ROWS</span>
            <span className="mono">{approximateBytes(internalLinksCsv(report))}</span>
          </div>
          <button
            type="button"
            className="button button--small button--outline"
            onClick={() => downloadInternalLinksCsv(report)}
          >
            <Download size={14} />
            DOWNLOAD LINK LEDGER
          </button>
        </article>
      </div>

      <div className="export-footnote">
        <ShieldCheck size={15} />
        <p>
          External links are included as intelligence only and were never requested. The XML
          sitemap excludes error pages and soft 404s. All exports are generated locally in your
          browser from the completed crawl.
        </p>
      </div>
    </section>
  );
}
