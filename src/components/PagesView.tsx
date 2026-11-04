import { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronRight,
  ExternalLink,
  Search,
  X,
} from "lucide-react";
import type { PageHealth, PageRecord } from "../types";
import { formatDuration, pageLabel, truncate } from "../lib/format";
import { PageInspector } from "./PageInspector";

interface PagesViewProps {
  pages: PageRecord[];
  selectedUrl: string | null;
  onSelect: (url: string) => void;
}

type SortKey = "path" | "status" | "depth" | "internal" | "external" | "response";
type HealthFilter = "all" | PageHealth;

const HEALTH_FILTERS: Array<{ value: HealthFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "ok", label: "Healthy" },
  { value: "warning", label: "Warnings" },
  { value: "broken", label: "Broken" },
];

const HEALTH_ORDER: Record<PageHealth, number> = { broken: 0, warning: 1, ok: 2 };

export function PagesView({ pages, selectedUrl, onSelect }: PagesViewProps) {
  const [query, setQuery] = useState("");
  const [healthFilter, setHealthFilter] = useState<HealthFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("depth");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  const counts = useMemo(
    () => ({
      all: pages.length,
      ok: pages.filter((page) => page.health === "ok").length,
      warning: pages.filter((page) => page.health === "warning").length,
      broken: pages.filter((page) => page.health === "broken").length,
    }),
    [pages],
  );

  const filteredPages = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const matching = pages.filter((page) => {
      if (healthFilter !== "all" && page.health !== healthFilter) return false;
      if (!normalized) return true;
      return [page.path, page.title, page.h1, page.description, page.url]
        .join(" ")
        .toLowerCase()
        .includes(normalized);
    });

    const direction = sortDirection === "asc" ? 1 : -1;
    return [...matching].sort((a, b) => {
      let result = 0;
      if (sortKey === "path") result = a.path.localeCompare(b.path);
      if (sortKey === "status") {
        result =
          HEALTH_ORDER[a.health] - HEALTH_ORDER[b.health] ||
          (a.statusCode ?? 999) - (b.statusCode ?? 999);
      }
      if (sortKey === "depth") result = a.depth - b.depth || a.path.localeCompare(b.path);
      if (sortKey === "internal") result = a.counts.internalLinks - b.counts.internalLinks;
      if (sortKey === "external") result = a.counts.externalLinks - b.counts.externalLinks;
      if (sortKey === "response") result = a.responseTimeMs - b.responseTimeMs;
      return result * direction;
    });
  }, [healthFilter, pages, query, sortDirection, sortKey]);

  const selectedPage = pages.find((page) => page.url === selectedUrl) ?? null;

  const changeSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDirection(key === "depth" || key === "path" ? "asc" : "desc");
    }
  };

  const sortIcon = (key: SortKey) => {
    if (sortKey !== key) return <ArrowUpDown size={12} />;
    return sortDirection === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />;
  };

  return (
    <div className="pages-layout">
      <section className="data-card" aria-labelledby="pages-title">
        <div className="data-card__header">
          <div>
            <p className="eyebrow">INVENTORY / {pages.length} PAGES</p>
            <h2 id="pages-title">Every internal page.</h2>
          </div>
          <a
            className="text-link"
            href={pages.find((page) => page.depth === 0)?.url || pages[0]?.url}
            target="_blank"
            rel="noreferrer"
          >
            OPEN ROOT
            <ExternalLink size={13} />
          </a>
        </div>

        <div className="data-toolbar">
          <div className="table-search">
            <Search size={15} aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search path, title, or URL…"
              aria-label="Search pages"
            />
            {query ? (
              <button type="button" onClick={() => setQuery("")} aria-label="Clear page search">
                <X size={13} />
              </button>
            ) : null}
          </div>
          <div className="filter-pills" role="group" aria-label="Filter by page health">
            {HEALTH_FILTERS.map((filter) => (
              <button
                key={filter.value}
                type="button"
                className={healthFilter === filter.value ? "is-active" : ""}
                onClick={() => setHealthFilter(filter.value)}
                aria-pressed={healthFilter === filter.value}
              >
                {filter.label}
                <span>{counts[filter.value]}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="table-scroll">
          <table className="data-table pages-table">
            <thead>
              <tr>
                <th scope="col" aria-sort={sortKey === "path" ? sortDirection === "asc" ? "ascending" : "descending" : "none"}>
                  <button type="button" onClick={() => changeSort("path")}>
                    PAGE {sortIcon("path")}
                  </button>
                </th>
                <th scope="col" aria-sort={sortKey === "status" ? sortDirection === "asc" ? "ascending" : "descending" : "none"}>
                  <button type="button" onClick={() => changeSort("status")}>
                    STATUS {sortIcon("status")}
                  </button>
                </th>
                <th scope="col" aria-sort={sortKey === "depth" ? sortDirection === "asc" ? "ascending" : "descending" : "none"}>
                  <button type="button" onClick={() => changeSort("depth")}>
                    DEPTH {sortIcon("depth")}
                  </button>
                </th>
                <th scope="col" aria-sort={sortKey === "internal" ? sortDirection === "asc" ? "ascending" : "descending" : "none"}>
                  <button type="button" onClick={() => changeSort("internal")}>
                    INTERNAL {sortIcon("internal")}
                  </button>
                </th>
                <th scope="col" aria-sort={sortKey === "external" ? sortDirection === "asc" ? "ascending" : "descending" : "none"}>
                  <button type="button" onClick={() => changeSort("external")}>
                    EXTERNAL {sortIcon("external")}
                  </button>
                </th>
                <th scope="col" aria-sort={sortKey === "response" ? sortDirection === "asc" ? "ascending" : "descending" : "none"}>
                  <button type="button" onClick={() => changeSort("response")}>
                    RESPONSE {sortIcon("response")}
                  </button>
                </th>
                <th scope="col"><span className="sr-only">Inspect</span></th>
              </tr>
            </thead>
            <tbody>
              {filteredPages.map((page) => (
                <tr
                  key={page.url}
                  className={page.url === selectedUrl ? "is-selected" : ""}
                  onClick={() => onSelect(page.url)}
                >
                  <th scope="row">
                    <div className="page-cell">
                      <span className={`page-cell__marker page-cell__marker--${page.health}`} />
                      <span>
                        <strong>{pageLabel(page.path)}</strong>
                        <small>{truncate(page.h1 || page.title || "Untitled", 64)}</small>
                      </span>
                    </div>
                  </th>
                  <td>
                    <span className={`table-status table-status--${page.health}`}>
                      <i />
                      {page.statusCode ?? "ERR"}
                    </span>
                  </td>
                  <td><span className="table-mono">L{page.depth}</span></td>
                  <td>
                    <span className="table-mono">{page.counts.internalLinks}</span>
                    <small className="table-sub">in {page.counts.incomingInternalLinks}</small>
                  </td>
                  <td><span className="table-mono">{page.counts.externalLinks}</span></td>
                  <td><span className="table-mono">{formatDuration(page.responseTimeMs)}</span></td>
                  <td>
                    <button
                      type="button"
                      className="row-action"
                      aria-label={`Inspect ${page.path}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onSelect(page.url);
                      }}
                    >
                      <ChevronRight size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!filteredPages.length ? (
          <div className="table-empty">
            <Search size={22} strokeWidth={1.4} />
            <h3>No pages match this view.</h3>
            <p>Clear the search or switch the health filter.</p>
            <button
              type="button"
              className="button button--small button--ghost"
              onClick={() => {
                setQuery("");
                setHealthFilter("all");
              }}
            >
              RESET FILTERS
            </button>
          </div>
        ) : (
          <div className="data-card__foot">
            <span className="mono">
              SHOWING {filteredPages.length} OF {pages.length}
            </span>
            <span className="mono">CLICK A ROW TO INSPECT</span>
          </div>
        )}
      </section>

      <PageInspector page={selectedPage} pages={pages} onSelect={onSelect} />
    </div>
  );
}
