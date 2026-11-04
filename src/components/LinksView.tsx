import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ArrowUpRight,
  Check,
  CircleSlash2,
  ExternalLink,
  Filter,
  Globe2,
  Link2,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import type { LinkCategory, LinkStatus, Report } from "../types";
import { formatNumber, pageLabel, truncate } from "../lib/format";

interface LinksViewProps {
  report: Report;
  category: LinkCategory;
  onCategoryChange: (category: LinkCategory) => void;
  onSelectPage: (url: string) => void;
}

type InternalSort = "source" | "target" | "status";
type ExternalSort = "destination" | "references" | "host";

const STATUS_ORDER: Record<LinkStatus, number> = {
  broken: 0,
  warning: 1,
  unchecked: 2,
  blocked: 3,
  ok: 4,
};

const STATUS_FILTERS: Array<{ value: "all" | LinkStatus; label: string }> = [
  { value: "all", label: "All statuses" },
  { value: "ok", label: "OK" },
  { value: "warning", label: "Warnings" },
  { value: "broken", label: "Broken" },
  { value: "unchecked", label: "Not checked" },
  { value: "blocked", label: "Blocked" },
];

function StatusPill({ status }: { status: LinkStatus }) {
  return (
    <span className={`link-status link-status--${status}`}>
      <i />
      {status === "ok"
        ? "OK"
        : status === "warning"
          ? "WARNING"
          : status === "broken"
            ? "BROKEN"
            : status === "blocked"
              ? "BLOCKED"
              : "NOT CHECKED"}
    </span>
  );
}

export function LinksView({
  report,
  category,
  onCategoryChange,
  onSelectPage,
}: LinksViewProps) {
  const [queries, setQueries] = useState<Record<LinkCategory, string>>({
    broken: "",
    internal: "",
    external: "",
  });
  const [statusFilter, setStatusFilter] = useState<"all" | LinkStatus>("all");
  const [internalSort, setInternalSort] = useState<InternalSort>("status");
  const [internalDirection, setInternalDirection] = useState<"asc" | "desc">("asc");
  const [externalSort, setExternalSort] = useState<ExternalSort>("references");
  const [externalDirection, setExternalDirection] = useState<"asc" | "desc">("desc");

  const query = queries[category];
  const setQuery = (value: string) => setQueries((current) => ({ ...current, [category]: value }));

  const internal = report.links.internal;
  const external = report.links.external;
  const broken = report.links.broken;

  const internalStatusCounts = useMemo(() => {
    const counts: Record<LinkStatus, number> = {
      ok: 0,
      warning: 0,
      broken: 0,
      blocked: 0,
      unchecked: 0,
    };
    for (const link of internal) counts[link.status] += 1;
    return counts;
  }, [internal]);

  const filteredInternal = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const matches = internal.filter((link) => {
      if (statusFilter !== "all" && link.status !== statusFilter) return false;
      if (!normalized) return true;
      return [
        link.sourcePath,
        link.targetPath,
        link.sourceTitle,
        link.targetTitle,
        link.text,
        link.reason,
        link.targetUrl,
        link.sourceUrl,
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalized);
    });
    const direction = internalDirection === "asc" ? 1 : -1;
    return [...matches].sort((a, b) => {
      let value = 0;
      if (internalSort === "source") value = a.sourcePath.localeCompare(b.sourcePath);
      if (internalSort === "target") value = a.targetPath.localeCompare(b.targetPath);
      if (internalSort === "status") {
        value = STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.sourcePath.localeCompare(b.sourcePath);
      }
      return value * direction;
    });
  }, [internal, internalDirection, internalSort, query, statusFilter]);

  const filteredExternal = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const matches = external.filter((link) => {
      if (!normalized) return true;
      return [link.url, link.host, ...link.sources.map((source) => `${source.path} ${source.title}`)]
        .join(" ")
        .toLowerCase()
        .includes(normalized);
    });
    const direction = externalDirection === "asc" ? 1 : -1;
    return [...matches].sort((a, b) => {
      let value = 0;
      if (externalSort === "destination") value = a.url.localeCompare(b.url);
      if (externalSort === "host") value = a.host.localeCompare(b.host);
      if (externalSort === "references") value = a.sourceCount - b.sourceCount;
      return value * direction;
    });
  }, [external, externalDirection, externalSort, query]);

  const filteredBroken = useMemo(() => {
    const normalized = queries.broken.trim().toLowerCase();
    if (!normalized) return broken;
    return broken.filter((entry) =>
      [
        entry.url,
        entry.path,
        entry.reason,
        ...entry.sources.map((source) => `${source.path} ${source.title} ${source.text}`),
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalized),
    );
  }, [broken, queries.broken]);

  const changeInternalSort = (key: InternalSort) => {
    if (internalSort === key) {
      setInternalDirection((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setInternalSort(key);
      setInternalDirection("asc");
    }
  };

  const changeExternalSort = (key: ExternalSort) => {
    if (externalSort === key) {
      setExternalDirection((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setExternalSort(key);
      setExternalDirection(key === "references" ? "desc" : "asc");
    }
  };

  const internalSortIcon = (key: InternalSort) => {
    if (internalSort !== key) return <ArrowUpDown size={12} />;
    return internalDirection === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />;
  };

  const externalSortIcon = (key: ExternalSort) => {
    if (externalSort !== key) return <ArrowUpDown size={12} />;
    return externalDirection === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />;
  };

  return (
    <section className="links-card" aria-labelledby="links-title">
      <div className="links-card__header">
        <div>
          <p className="eyebrow">RELATIONSHIPS / LINK LEDGER</p>
          <h2 id="links-title">Follow every thread.</h2>
        </div>
        <p className="links-card__note">
          Internal targets are checked. External destinations are catalogued but never requested.
        </p>
      </div>

      <div className="link-tabs" role="tablist" aria-label="Link categories">
        <button
          type="button"
          role="tab"
          aria-selected={category === "broken"}
          className={category === "broken" ? "is-active" : ""}
          onClick={() => onCategoryChange("broken")}
        >
          <AlertTriangle size={14} />
          BROKEN
          <span className={broken.length ? "is-danger" : ""}>{broken.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={category === "internal"}
          className={category === "internal" ? "is-active" : ""}
          onClick={() => onCategoryChange("internal")}
        >
          <Link2 size={14} />
          INTERNAL
          <span>{internal.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={category === "external"}
          className={category === "external" ? "is-active" : ""}
          onClick={() => onCategoryChange("external")}
        >
          <Globe2 size={14} />
          EXTERNAL
          <span>{external.length}</span>
        </button>
      </div>

      <div className="link-toolbar">
        <div className="table-search">
          <Search size={15} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={
              category === "broken"
                ? "Search broken destinations or sources…"
                : category === "internal"
                  ? "Search source, target, or anchor text…"
                  : "Search host, URL, or source page…"
            }
            aria-label={`Search ${category} links`}
          />
          {query ? (
            <button type="button" onClick={() => setQuery("")} aria-label="Clear link search">
              <X size={13} />
            </button>
          ) : null}
        </div>

        {category === "internal" ? (
          <label className="filter-select">
            <Filter size={13} />
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as "all" | LinkStatus)}
              aria-label="Filter internal links by status"
            >
              {STATUS_FILTERS.map((filter) => (
                <option key={filter.value} value={filter.value}>
                  {filter.label}
                  {filter.value !== "all" ? ` (${internalStatusCounts[filter.value]})` : ""}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <span className="link-toolbar__count mono">
          {category === "internal"
            ? `${filteredInternal.length} shown`
            : category === "external"
              ? `${filteredExternal.length} destinations`
              : `${filteredBroken.length} targets`}
        </span>
      </div>

      {category === "broken" ? (
        broken.length === 0 ? (
          <div className="links-clear">
            <div className="links-clear__icon">
              <ShieldCheck size={38} strokeWidth={1.25} />
            </div>
            <p className="eyebrow">LINK HEALTH / CLEAR</p>
            <h3>No broken internal links.</h3>
            <p>
              Every internal destination discovered in this scan resolved without an HTTP error,
              timeout, dead host, or soft 404.
            </p>
            <div className="links-clear__stats">
              <div>
                <strong>{formatNumber(internal.length)}</strong>
                <span>internal relationships</span>
              </div>
              <div>
                <strong>{formatNumber(report.summary.linksChecked)}</strong>
                <span>targets checked</span>
              </div>
              <div>
                <strong>{formatNumber(report.summary.linksNotChecked)}</strong>
                <span>left unchecked</span>
              </div>
            </div>
          </div>
        ) : filteredBroken.length ? (
          <div className="broken-grid">
            {filteredBroken.map((entry) => (
              <article className="broken-card" key={entry.url}>
                <div className="broken-card__top">
                  <span className="broken-card__icon">
                    <CircleSlash2 size={17} />
                  </span>
                  <span className="status-pill status-pill--broken">
                    {entry.statusCode ?? "ERR"}
                  </span>
                </div>
                <h3>{pageLabel(entry.path)}</h3>
                <code>{truncate(entry.url, 64)}</code>
                <p>{entry.reason || "This internal link failed its check."}</p>
                <div className="broken-card__sources">
                  <span className="mono">FOUND ON {entry.sources.length} PAGE{entry.sources.length === 1 ? "" : "S"}</span>
                  <ul>
                    {entry.sources.slice(0, 5).map((source, index) => (
                      <li key={`${source.url}-${index}`}>
                        <button type="button" onClick={() => onSelectPage(source.url)}>
                          {source.path}
                        </button>
                        {source.text ? <span>“{truncate(source.text, 36)}”</span> : null}
                      </li>
                    ))}
                  </ul>
                  {entry.sources.length > 5 ? (
                    <small>+ {entry.sources.length - 5} more source pages</small>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="table-empty">
            <Search size={22} strokeWidth={1.4} />
            <h3>No broken links match “{query}”.</h3>
            <button type="button" className="button button--small button--ghost" onClick={() => setQuery("")}>
              CLEAR SEARCH
            </button>
          </div>
        )
      ) : null}

      {category === "internal" ? (
        <>
          <div className="status-summary">
            {(["ok", "warning", "broken", "unchecked", "blocked"] as LinkStatus[]).map((status) => (
              <button
                type="button"
                key={status}
                className={`status-summary__item status-summary__item--${status} ${
                  statusFilter === status ? "is-active" : ""
                }`}
                onClick={() => setStatusFilter(statusFilter === status ? "all" : status)}
              >
                <strong>{internalStatusCounts[status]}</strong>
                <span>{status === "ok" ? "verified" : status === "warning" ? "warnings" : status}</span>
              </button>
            ))}
          </div>

          <div className="table-scroll">
            <table className="data-table links-table">
              <thead>
                <tr>
                  <th scope="col">
                    <button type="button" onClick={() => changeInternalSort("source")}>
                      SOURCE {internalSortIcon("source")}
                    </button>
                  </th>
                  <th scope="col">
                    <button type="button" onClick={() => changeInternalSort("target")}>
                      TARGET {internalSortIcon("target")}
                    </button>
                  </th>
                  <th scope="col">
                    <button type="button" onClick={() => changeInternalSort("status")}>
                      STATUS {internalSortIcon("status")}
                    </button>
                  </th>
                  <th scope="col">HTTP</th>
                  <th scope="col">NOTE</th>
                </tr>
              </thead>
              <tbody>
                {filteredInternal.map((link, index) => (
                  <tr key={`${link.sourceUrl}-${link.targetUrl}-${index}`}>
                    <td>
                      <button
                        type="button"
                        className="table-page-link"
                        onClick={() => onSelectPage(link.sourceUrl)}
                      >
                        {pageLabel(link.sourcePath)}
                      </button>
                      {link.text ? <small className="link-anchor">“{truncate(link.text, 32)}”</small> : null}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="table-page-link"
                        onClick={() => onSelectPage(link.targetUrl)}
                      >
                        {pageLabel(link.targetPath)}
                      </button>
                      <small className="table-sub" title={link.targetUrl}>
                        {truncate(link.targetUrl, 44)}
                      </small>
                    </td>
                    <td><StatusPill status={link.status} /></td>
                    <td><span className="table-mono">{link.statusCode ?? "—"}</span></td>
                    <td>
                      <span className={`table-reason ${link.status === "broken" ? "is-broken" : ""}`}>
                        {link.reason ? truncate(link.reason, 66) : "Resolved normally."}
                      </span>
                      {link.viaRedirect ? <small className="table-sub">via redirect</small> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!filteredInternal.length ? (
            <div className="table-empty">
              <Filter size={22} strokeWidth={1.4} />
              <h3>No internal links match this filter.</h3>
              <button
                type="button"
                className="button button--small button--ghost"
                onClick={() => {
                  setQuery("");
                  setStatusFilter("all");
                }}
              >
                RESET FILTERS
              </button>
            </div>
          ) : null}
        </>
      ) : null}

      {category === "external" ? (
        <>
          <div className="external-note">
            <Globe2 size={16} />
            <p>
              <strong>{external.length}</strong> external destination{external.length === 1 ? "" : "s"} across{" "}
              <strong>{report.summary.externalHosts}</strong> host{report.summary.externalHosts === 1 ? "" : "s"}. These
              links are recorded for context and were deliberately not requested.
            </p>
          </div>
          <div className="table-scroll">
            <table className="data-table links-table external-table">
              <thead>
                <tr>
                  <th scope="col">
                    <button type="button" onClick={() => changeExternalSort("destination")}>
                      DESTINATION {externalSortIcon("destination")}
                    </button>
                  </th>
                  <th scope="col">
                    <button type="button" onClick={() => changeExternalSort("host")}>
                      HOST {externalSortIcon("host")}
                    </button>
                  </th>
                  <th scope="col">
                    <button type="button" onClick={() => changeExternalSort("references")}>
                      REFERENCES {externalSortIcon("references")}
                    </button>
                  </th>
                  <th scope="col">FOUND ON</th>
                  <th scope="col"><span className="sr-only">Open</span></th>
                </tr>
              </thead>
              <tbody>
                {filteredExternal.map((link) => (
                  <tr key={link.url}>
                    <td>
                      <span className="external-destination" title={link.url}>
                        {truncate(
                          link.url.replace(/^https?:\/\//, "").replace(/\/$/, ""),
                          58,
                        )}
                      </span>
                      <small className="table-sub">NOT REQUESTED</small>
                    </td>
                    <td><span className="host-pill">{link.host}</span></td>
                    <td><span className="table-mono">{link.sourceCount}</span></td>
                    <td>
                      <div className="source-list">
                        {link.sources.slice(0, 2).map((source, index) => (
                          <button
                            type="button"
                            key={`${source.url}-${index}`}
                            onClick={() => onSelectPage(source.url)}
                          >
                            {source.path}
                          </button>
                        ))}
                        {link.sources.length > 2 ? (
                          <span>+{link.sources.length - 2}</span>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="row-action"
                        aria-label={`Open ${link.host}`}
                      >
                        <ArrowUpRight size={15} />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!filteredExternal.length ? (
            <div className="table-empty">
              <Search size={22} strokeWidth={1.4} />
              <h3>No external links match this search.</h3>
              <button type="button" className="button button--small button--ghost" onClick={() => setQuery("")}>
                CLEAR SEARCH
              </button>
            </div>
          ) : null}
        </>
      ) : null}

      <div className="links-card__foot">
        <span className="mono">
          {category === "broken" ? <Check size={12} /> : <ExternalLink size={12} />}
          {category === "external"
            ? "EXTERNAL REQUEST POLICY: OFF"
            : "CHECKS FOLLOW INTERNAL DESTINATIONS ONLY"}
        </span>
        <span className="mono">HTTP + JS RENDERED</span>
      </div>
    </section>
  );
}
