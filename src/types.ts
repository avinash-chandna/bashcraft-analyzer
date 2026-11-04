export type PageHealth = "ok" | "warning" | "broken";
export type LinkStatus = "ok" | "warning" | "broken" | "blocked" | "unchecked";

export interface RedirectHop {
  from: string;
  to: string;
  status: number | null;
}

export interface PageRecord {
  url: string;
  requestedUrl: string;
  path: string;
  title: string;
  titleLength: number;
  description: string;
  h1: string;
  lang: string;
  depth: number;
  parent: { url: string; title: string; linkText: string } | null;
  statusCode: number | null;
  health: PageHealth;
  soft404: boolean;
  failureReason?: string | null;
  contentType: string;
  rendered: boolean;
  responseTimeMs: number;
  htmlBytes: number;
  redirects: RedirectHop[];
  externalRedirect: boolean;
  truncated: boolean;
  error: { code: string; message: string } | null;
  renderError: { code: string; message: string } | null;
  warnings: string[];
  counts: {
    internalLinks: number;
    externalLinks: number;
    incomingInternalLinks: number;
  };
  children: string[];
}

export interface InternalLinkRecord {
  sourceUrl: string;
  sourcePath: string;
  sourceTitle: string | null;
  sourceHealth: PageHealth;
  targetUrl: string;
  targetPath: string;
  targetTitle: string | null;
  text: string;
  rel: string;
  depth: number | null;
  status: LinkStatus;
  statusCode: number | null;
  reason: string | null;
  viaRedirect: boolean;
  soft404: boolean;
}

export interface ExternalLinkTarget {
  url: string;
  host: string;
  sourceCount: number;
  sources: Array<{
    url: string;
    path: string;
    title: string | null;
    text: string;
  }>;
}

export interface BrokenLink {
  url: string;
  path: string;
  statusCode: number | null;
  reason: string | null;
  soft404: boolean;
  sources: Array<{
    url: string;
    path: string;
    title: string | null;
    text: string;
  }>;
}

export interface ExternalHost {
  host: string;
  targets: number;
  sourceCount: number;
}

export interface ScanSummary {
  pagesDiscovered: number;
  healthyPages: number;
  warningPages: number;
  brokenPages: number;
  internalLinks: number;
  uniqueInternalTargets: number;
  externalLinks: number;
  externalLinkOccurrences: number;
  externalHosts: number;
  brokenLinks: number;
  brokenLinkRelations: number;
  linksChecked: number;
  linksBlockedByRobots: number;
  linksNotChecked: number;
  duplicatesMerged: number;
  maxDepthReached: number;
  pageLimitReached: boolean;
}

export interface RobotsSummary {
  checked: boolean;
  found: boolean;
  url: string;
  status: number | null;
  allowRuleCount: number;
  disallowRuleCount: number;
  crawlDelaySeconds: number;
  sitemaps: string[];
  note: string;
}

export interface Report {
  meta: {
    tool: { name: string; version: string };
    generatedAt: string;
    startedAt: string;
    durationMs: number;
    inputUrl: string;
    startUrl: string;
    site: string;
    siteKey: string;
    crawledWith: "playwright" | "http";
  };
  config: {
    maxPages: number;
    maxDepth: number;
    renderJsRequested: boolean;
    respectRobots: boolean;
    timeoutMs: number;
    delayBetweenRequestsMs: number;
    scope: string;
  };
  renderer: {
    available: boolean | null;
    engine: string | null;
    message: string;
    pagesRendered: number;
    pagesUsingHttpFallback: number;
  };
  robots: RobotsSummary;
  summary: ScanSummary;
  warnings: string[];
  notes: string[];
  pages: PageRecord[];
  links: {
    internal: InternalLinkRecord[];
    external: ExternalLinkTarget[];
    broken: BrokenLink[];
  };
  externalHosts: ExternalHost[];
}

export interface ScanSettings {
  maxPages: number;
  maxDepth: number;
  renderJs: boolean;
  respectRobots: boolean;
}

export interface CrawlProgress {
  pagesCrawled: number;
  pagesQueued: number;
  maxPages: number;
  maxDepth: number;
  currentUrl?: string;
  currentPath?: string;
  title?: string;
  statusCode?: number | null;
  health?: PageHealth;
  internalLinks?: number;
  externalLinks?: number;
  message: string;
  lastPage?: {
    url: string;
    path: string;
    title: string;
    statusCode: number | null;
    health: PageHealth;
  };
}

export interface ActivityEntry {
  url: string;
  path: string;
  title: string;
  statusCode: number | null;
  health: PageHealth;
  message: string;
  at: number;
}

export interface ApiError {
  code: string;
  message: string;
  hint?: string | null;
}

export type ResultsTab = "overview" | "pages" | "links" | "export";
export type LinkCategory = "broken" | "internal" | "external";
