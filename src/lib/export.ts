import type { Report } from "../types";

function downloadBlob(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Allow Safari and Chromium to start the download before revoking.
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  // Neutralize spreadsheet formula injection while keeping values readable.
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers.map(csvCell).join(","), ...rows.map((row) => row.map(csvCell).join(","))].join(
    "\r\n",
  );
}

function escapeXml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function fileStem(report: Report): string {
  const host = report.meta.siteKey.replace(/[^a-z0-9.-]+/gi, "-");
  const stamp = report.meta.generatedAt.slice(0, 19).replace(/[:T]/g, "-");
  return `${host}-${stamp}`;
}

export function reportJson(report: Report): string {
  return JSON.stringify(report, null, 2);
}

export function pagesCsv(report: Report): string {
  const headers = [
    "url",
    "path",
    "title",
    "http_status",
    "health",
    "depth",
    "parent_url",
    "internal_links",
    "external_links",
    "incoming_internal_links",
    "response_ms",
    "content_type",
    "rendered_with_javascript",
    "soft_404",
    "warnings",
  ];
  const rows = report.pages.map((page) => [
    page.url,
    page.path,
    page.title,
    page.statusCode ?? "",
    page.health,
    page.depth,
    page.parent?.url ?? "",
    page.counts.internalLinks,
    page.counts.externalLinks,
    page.counts.incomingInternalLinks,
    page.responseTimeMs,
    page.contentType,
    page.rendered ? "yes" : "no",
    page.soft404 ? "yes" : "no",
    page.warnings.join(" | "),
  ]);
  return toCsv(headers, rows);
}

export function brokenLinksCsv(report: Report): string {
  const headers = [
    "target_url",
    "target_path",
    "http_status",
    "failure_reason",
    "soft_404",
    "source_url",
    "source_path",
    "link_text",
  ];
  const rows = report.links.broken.flatMap((broken) =>
    broken.sources.map((source) => [
      broken.url,
      broken.path,
      broken.statusCode ?? "",
      broken.reason ?? "",
      broken.soft404 ? "yes" : "no",
      source.url,
      source.path,
      source.text,
    ]),
  );
  return toCsv(headers, rows);
}

export function internalLinksCsv(report: Report): string {
  const headers = [
    "source_url",
    "source_path",
    "target_url",
    "target_path",
    "status",
    "http_status",
    "failure_reason",
    "link_text",
  ];
  const rows = report.links.internal.map((link) => [
    link.sourceUrl,
    link.sourcePath,
    link.targetUrl,
    link.targetPath,
    link.status,
    link.statusCode ?? "",
    link.reason ?? "",
    link.text,
  ]);
  return toCsv(headers, rows);
}

export function sitemapXml(report: Report): string {
  const included = report.pages.filter(
    (page) =>
      !page.soft404 &&
      !page.externalRedirect &&
      page.statusCode !== null &&
      page.statusCode >= 200 &&
      page.statusCode < 300,
  );
  const entries = included
    .map(
      (page) =>
        `  <url>\n    <loc>${escapeXml(page.url)}</loc>\n  </url>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`;
}

export function downloadJson(report: Report) {
  downloadBlob(`${fileStem(report)}.json`, reportJson(report), "application/json");
}

export function downloadPagesCsv(report: Report) {
  downloadBlob(`${fileStem(report)}-pages.csv`, pagesCsv(report), "text/csv");
}

export function downloadBrokenCsv(report: Report) {
  downloadBlob(
    `${fileStem(report)}-broken-links.csv`,
    brokenLinksCsv(report),
    "text/csv",
  );
}

export function downloadInternalLinksCsv(report: Report) {
  downloadBlob(
    `${fileStem(report)}-internal-links.csv`,
    internalLinksCsv(report),
    "text/csv",
  );
}

export function downloadSitemapXml(report: Report) {
  downloadBlob(`${fileStem(report)}-sitemap.xml`, sitemapXml(report), "application/xml");
}

export async function copyReportJson(report: Report): Promise<void> {
  await navigator.clipboard.writeText(reportJson(report));
}

export function approximateBytes(value: string): string {
  const bytes = new Blob([value]).size;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
