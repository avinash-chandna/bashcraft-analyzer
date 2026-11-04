import { useMemo, useRef, useState } from "react";
import {
  Focus,
  GitBranch,
  Link2,
  Minus,
  Plus,
  Search,
  X,
} from "lucide-react";
import type { InternalLinkRecord, PageRecord } from "../types";
import { formatNumber, pageLabel, truncate } from "../lib/format";

interface SitemapGraphProps {
  pages: PageRecord[];
  links: InternalLinkRecord[];
  selectedUrl: string | null;
  onSelect: (url: string) => void;
}

interface PositionedPage {
  page: PageRecord;
  x: number;
  y: number;
}

const NODE_WIDTH = 186;
const NODE_HEIGHT = 46;
const VERTICAL_GAP = 12;
const COLUMN_GAP = 246;
const PADDING_X = 26;
const PADDING_Y = 26;

function useGraphLayout(pages: PageRecord[]) {
  return useMemo(() => {
    const pageByUrl = new Map(pages.map((page) => [page.url, page]));
    const pageOrder = new Map(pages.map((page, index) => [page.url, index]));
    const roots = pages.filter((page) => !page.parent?.url || !pageByUrl.has(page.parent.url));
    const visited = new Set<string>();
    const positioned: PositionedPage[] = [];
    let cursorY = PADDING_Y;

    const layoutNode = (page: PageRecord): number => {
      if (visited.has(page.url)) {
        return cursorY + NODE_HEIGHT / 2;
      }
      visited.add(page.url);

      const children = page.children
        .map((url) => pageByUrl.get(url))
        .filter((child): child is PageRecord => Boolean(child))
        .filter((child) => !visited.has(child.url))
        .sort((a, b) => (pageOrder.get(a.url) ?? 0) - (pageOrder.get(b.url) ?? 0));

      let centerY;
      if (!children.length) {
        centerY = cursorY + NODE_HEIGHT / 2;
        cursorY += NODE_HEIGHT + VERTICAL_GAP;
      } else {
        const childCenters = children.map((child) => layoutNode(child));
        centerY = (Math.min(...childCenters) + Math.max(...childCenters)) / 2;
      }

      positioned.push({
        page,
        x: PADDING_X + page.depth * COLUMN_GAP,
        y: centerY - NODE_HEIGHT / 2,
      });
      return centerY;
    };

    for (const root of roots) {
      if (!visited.has(root.url)) {
        layoutNode(root);
        cursorY += 16;
      }
    }

    // Defensive fallback for orphaned/cyclic records: every page must stay visible.
    for (const page of pages) {
      if (visited.has(page.url)) continue;
      visited.add(page.url);
      positioned.push({
        page,
        x: PADDING_X + page.depth * COLUMN_GAP,
        y: cursorY,
      });
      cursorY += NODE_HEIGHT + VERTICAL_GAP;
    }

    const maxDepth = Math.max(0, ...positioned.map((item) => item.page.depth));
    const width = PADDING_X * 2 + maxDepth * COLUMN_GAP + NODE_WIDTH;
    const height = Math.max(420, cursorY + PADDING_Y);

    return {
      nodes: positioned,
      nodeByUrl: new Map(positioned.map((item) => [item.page.url, item])),
      pageByUrl,
      width,
      height,
    };
  }, [pages]);
}

function edgePath(x1: number, y1: number, x2: number, y2: number): string {
  const bend = Math.max(36, (x2 - x1) * 0.48);
  return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
}

function initialZoom(): number {
  if (typeof window === "undefined") return 1;
  return window.matchMedia("(max-width: 760px)").matches ? 1.6 : 1;
}

export function SitemapGraph({ pages, links, selectedUrl, onSelect }: SitemapGraphProps) {
  const layout = useGraphLayout(pages);
  const [mode, setMode] = useState<"tree" | "all">("tree");
  const [zoom, setZoom] = useState(initialZoom);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [query, setQuery] = useState("");
  const [dragging, setDragging] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  const visibleWidth = layout.width / zoom;
  const visibleHeight = layout.height / zoom;
  const viewBox = `${pan.x} ${pan.y} ${visibleWidth} ${visibleHeight}`;

  const normalizedQuery = query.trim().toLowerCase();
  const matchingUrls = useMemo(() => {
    if (!normalizedQuery) return null;
    return new Set(
      pages
        .filter((page) =>
          [page.path, page.title, page.h1, page.url].join(" ").toLowerCase().includes(normalizedQuery),
        )
        .map((page) => page.url),
    );
  }, [normalizedQuery, pages]);

  const activeLinks = useMemo(() => {
    if (!selectedUrl) return [] as InternalLinkRecord[];
    return links.filter(
      (link) => link.sourceUrl === selectedUrl || link.targetUrl === selectedUrl,
    );
  }, [links, selectedUrl]);
  const activeConnected = useMemo(() => {
    const set = new Set<string>();
    for (const link of activeLinks) {
      set.add(link.sourceUrl);
      set.add(link.targetUrl);
    }
    return set;
  }, [activeLinks]);

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const updateZoom = (nextZoom: number) => {
    const clamped = Math.min(2.4, Math.max(1, Number(nextZoom.toFixed(2))));
    const centerX = pan.x + visibleWidth / 2;
    const centerY = pan.y + visibleHeight / 2;
    const nextWidth = layout.width / clamped;
    const nextHeight = layout.height / clamped;
    setZoom(clamped);
    setPan({
      x: Math.min(layout.width - nextWidth, Math.max(0, centerX - nextWidth / 2)),
      y: Math.min(layout.height - nextHeight, Math.max(0, centerY - nextHeight / 2)),
    });
  };

  const handlePointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if ((event.target as Element).closest(".graph-node")) return;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    dragStart.current = {
      x: event.clientX,
      y: event.clientY,
      panX: pan.x,
      panY: pan.y,
    };
  };

  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!dragging) return;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const dx = ((event.clientX - dragStart.current.x) / rect.width) * visibleWidth;
    const dy = ((event.clientY - dragStart.current.y) / rect.height) * visibleHeight;
    setPan({
      x: Math.min(
        Math.max(0, layout.width - visibleWidth),
        Math.max(0, dragStart.current.panX - dx),
      ),
      y: Math.min(
        Math.max(0, layout.height - visibleHeight),
        Math.max(0, dragStart.current.panY - dy),
      ),
    });
  };

  const finishDrag = (event: React.PointerEvent<SVGSVGElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragging(false);
  };

  const treeEdges: Array<{ source: PositionedPage; target: PositionedPage }> = [];
  for (const node of layout.nodes) {
    for (const childUrl of node.page.children) {
      const child = layout.nodeByUrl.get(childUrl);
      if (child) treeEdges.push({ source: node, target: child });
    }
  }

  const allEdges: Array<{
    link: InternalLinkRecord;
    source: PositionedPage;
    target: PositionedPage;
  }> = [];
  for (const link of links) {
    const source = layout.nodeByUrl.get(link.sourceUrl);
    const target = layout.nodeByUrl.get(link.targetUrl);
    if (source && target && source.page.url !== target.page.url) {
      allEdges.push({ link, source, target });
    }
  }

  return (
    <section className="graph-card" aria-labelledby="graph-title">
      <div className="graph-card__header">
        <div>
          <p className="eyebrow">STRUCTURE / INTERACTIVE</p>
          <h2 id="graph-title">Crawl topology</h2>
        </div>
        <div className="graph-modes" role="group" aria-label="Graph edge mode">
          <button
            type="button"
            className={mode === "tree" ? "is-active" : ""}
            onClick={() => setMode("tree")}
            aria-pressed={mode === "tree"}
          >
            <GitBranch size={13} />
            TREE
          </button>
          <button
            type="button"
            className={mode === "all" ? "is-active" : ""}
            onClick={() => setMode("all")}
            aria-pressed={mode === "all"}
          >
            <Link2 size={13} />
            ALL LINKS
          </button>
        </div>
      </div>

      <div className="graph-toolbar">
        <div className="graph-search">
          <Search size={14} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a page…"
            aria-label="Find a page in the sitemap"
          />
          {query ? (
            <button type="button" onClick={() => setQuery("")} aria-label="Clear sitemap search">
              <X size={13} />
            </button>
          ) : null}
        </div>
        <div className="graph-toolbar__meta">
          <span className="mono">{formatNumber(pages.length)} NODES</span>
          <span className="mono">{mode === "all" ? `${formatNumber(links.length)} EDGES` : `${formatNumber(treeEdges.length)} EDGES`}</span>
        </div>
        <div className="graph-zoom" role="group" aria-label="Graph zoom controls">
          <button
            type="button"
            onClick={() => updateZoom(zoom - 0.2)}
            aria-label="Zoom out"
            disabled={zoom <= 1}
          >
            <Minus size={14} />
          </button>
          <span className="mono">{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            onClick={() => updateZoom(zoom + 0.2)}
            aria-label="Zoom in"
            disabled={zoom >= 2.4}
          >
            <Plus size={14} />
          </button>
          <button type="button" onClick={resetView} aria-label="Fit graph to view" title="Fit to view">
            <Focus size={14} />
          </button>
        </div>
      </div>

      <div className={`graph-stage ${dragging ? "graph-stage--dragging" : ""}`}>
        <svg
          ref={svgRef}
          className="sitemap-svg"
          viewBox={viewBox}
          role="group"
          aria-label={`Interactive sitemap graph with ${pages.length} internal pages`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishDrag}
          onPointerCancel={finishDrag}
        >
          <defs>
            <pattern id="graph-grid" width="28" height="28" patternUnits="userSpaceOnUse">
              <circle cx="1" cy="1" r="1" fill="#31382b" opacity="0.55" />
            </pattern>
            <marker
              id="arrow-head"
              viewBox="0 0 8 8"
              refX="7"
              refY="4"
              markerWidth="5"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 8 4 L 0 8 z" fill="#5d6952" />
            </marker>
          </defs>

          <rect x="0" y="0" width={layout.width} height={layout.height} fill="url(#graph-grid)" />

          <g className="graph-edges" aria-hidden="true">
            {mode === "tree"
              ? treeEdges.map(({ source, target }) => (
                  <path
                    key={`tree-${source.page.url}-${target.page.url}`}
                    d={edgePath(
                      source.x + NODE_WIDTH,
                      source.y + NODE_HEIGHT / 2,
                      target.x,
                      target.y + NODE_HEIGHT / 2,
                    )}
                    className={`graph-edge ${
                      activeConnected.has(source.page.url) &&
                      activeConnected.has(target.page.url)
                        ? "graph-edge--active"
                        : ""
                    }`}
                  />
                ))
              : allEdges.map(({ link, source, target }) => (
                  <path
                    key={`all-${link.sourceUrl}-${link.targetUrl}-${link.text}`}
                    d={edgePath(
                      source.x + NODE_WIDTH,
                      source.y + NODE_HEIGHT / 2,
                      target.x,
                      target.y + NODE_HEIGHT / 2,
                    )}
                    className={`graph-edge graph-edge--all ${
                      link.status === "broken" ? "graph-edge--broken" : ""
                    } ${
                      activeConnected.has(source.page.url) &&
                      activeConnected.has(target.page.url)
                        ? "graph-edge--active"
                        : ""
                    }`}
                    markerEnd="url(#arrow-head)"
                  />
                ))}
          </g>

          <g className="graph-nodes">
            {layout.nodes.map(({ page, x, y }) => {
              const isSelected = page.url === selectedUrl;
              const isDimmed = matchingUrls ? !matchingUrls.has(page.url) : false;
              const title = page.title || page.h1 || "Untitled page";
              return (
                <g
                  key={page.url}
                  className={`graph-node graph-node--${page.health} ${
                    isSelected ? "graph-node--selected" : ""
                  } ${isDimmed ? "graph-node--dimmed" : ""}`}
                  transform={`translate(${x}, ${y})`}
                  onClick={() => onSelect(page.url)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelect(page.url);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  aria-label={`${page.path}, ${page.health}${isSelected ? ", selected" : ""}`}
                >
                  <title>{`${title}\n${page.path}\nHTTP ${page.statusCode ?? "error"} · ${page.counts.internalLinks} internal / ${page.counts.externalLinks} external links`}</title>
                  <rect
                    width={NODE_WIDTH}
                    height={NODE_HEIGHT}
                    rx={9}
                    className="graph-node__box"
                  />
                  <rect
                    x={0}
                    y={0}
                    width={4}
                    height={NODE_HEIGHT}
                    rx={2}
                    className="graph-node__stripe"
                  />
                  <circle cx={16} cy={16} r={3.5} className="graph-node__dot" />
                  <text x={26} y={19} className="graph-node__label">
                    {truncate(pageLabel(page.path), 22)}
                  </text>
                  <text x={16} y={34} className="graph-node__meta">
                    {page.depth === 0
                      ? "ENTRY POINT"
                      : `${page.counts.internalLinks} out / ${page.counts.incomingInternalLinks} in`}
                  </text>
                  <text
                    x={NODE_WIDTH - 12}
                    y={19}
                    textAnchor="end"
                    className={`graph-node__status graph-node__status--${page.health}`}
                  >
                    {page.statusCode ?? "ERR"}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>

        {matchingUrls && matchingUrls.size === 0 ? (
          <div className="graph-empty">
            <Search size={18} />
            <p>No pages match “{query}”.</p>
          </div>
        ) : null}

        <div className="graph-legend" aria-label="Graph legend">
          <span><i className="legend-dot legend-dot--ok" /> healthy</span>
          <span><i className="legend-dot legend-dot--warning" /> warning</span>
          <span><i className="legend-dot legend-dot--broken" /> broken</span>
          <span className="graph-legend__hint">
            {mode === "tree" ? "drag to pan · click a node" : "all crawled relationships"}
          </span>
        </div>
      </div>
    </section>
  );
}
