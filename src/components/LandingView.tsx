import {
  ArrowDownRight,
  ArrowUpRight,
  Braces,
  GitBranch,
  Layers3,
  ShieldCheck,
} from "lucide-react";
import type { ApiError, ScanSettings } from "../types";
import { ScanForm } from "./ScanForm";

interface LandingViewProps {
  url: string;
  onUrlChange: (value: string) => void;
  settings: ScanSettings;
  onSettingsChange: (settings: ScanSettings) => void;
  onScan: () => void;
  error: ApiError | null;
}

const capabilities = [
  {
    icon: GitBranch,
    label: "LOOP-SAFE",
    title: "A finite frontier",
    copy: "Visited resources and normalised URL keys stop circular crawls before they start.",
  },
  {
    icon: ShieldCheck,
    label: "LINK-AWARE",
    title: "Truth, not just status",
    copy: "HTTP errors, dead hosts, timeouts, redirects, and soft 404s all surface with a reason.",
  },
  {
    icon: Braces,
    label: "PORTABLE",
    title: "A map you can keep",
    copy: "Export the full graph as JSON, plus page, link, and broken-link reports as CSV and XML.",
  },
];

export function LandingView({
  url,
  onUrlChange,
  settings,
  onSettingsChange,
  onScan,
  error,
}: LandingViewProps) {
  return (
    <main id="main">
      <section className="hero-shell">
        <div className="hero-grid" aria-hidden="true" />
        <div className="hero-orbit hero-orbit--one" aria-hidden="true" />
        <div className="hero-orbit hero-orbit--two" aria-hidden="true" />

        <div className="hero">
          <div className="hero-copy">
            <div className="hero-kicker">
              <span className="hero-kicker__line" />
              <span>PUBLIC-WEB CRAWLER</span>
              <span className="mono">/ V1.0</span>
            </div>

            <h1>
              MAP THE SITE.
              <br />
              FIND THE <span className="acid-text">FRACTURES.</span>
            </h1>

            <p className="hero-intro">
              A focused website analyzer for the BashCraft Club site. It explores connected pages,
              separates the outside web from the inside, verifies every internal link, and turns
              the whole structure into a sitemap you can inspect.
            </p>

            <div className="hero-target">
              <span className="hero-target__icon">
                <Layers3 size={18} strokeWidth={1.8} />
              </span>
              <div>
                <span className="mono hero-target__label">BUILT TO EXPLORE</span>
                <a
                  href="https://bashcraftclub.vercel.app/"
                  target="_blank"
                  rel="noreferrer"
                  className="hero-target__link"
                >
                  bashcraftclub.vercel.app
                  <ArrowUpRight size={15} />
                </a>
              </div>
              <span className="hero-target__tag">REACT / VERCEL</span>
            </div>

            <div className="hero-aside">
              <ArrowDownRight size={20} className="hero-aside__arrow" aria-hidden="true" />
              <p>
                Enter any public site below.
                <br />
                BashCraft is pre-loaded, ready to map.
              </p>
            </div>
          </div>

          <div className="hero-scanner">
            <ScanForm
              url={url}
              onUrlChange={onUrlChange}
              settings={settings}
              onSettingsChange={onSettingsChange}
              onSubmit={onScan}
              error={error}
            />
          </div>
        </div>
      </section>

      <section className="capabilities-section" aria-labelledby="capabilities-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">CRAWL / VERIFY / EXPORT</p>
            <h2 id="capabilities-title">Built for the shape of a real site.</h2>
          </div>
          <p className="section-heading__aside">
            Not a link checker in a trench coat. The crawl is normalised, finite, and observable.
          </p>
        </div>

        <div className="capability-grid">
          {capabilities.map((capability, index) => (
            <article className="capability-card" key={capability.label}>
              <div className="capability-card__top">
                <span className="capability-card__icon">
                  <capability.icon size={20} strokeWidth={1.7} />
                </span>
                <span className="mono capability-card__index">0{index + 1}</span>
              </div>
              <span className="mono capability-card__label">{capability.label}</span>
              <h3>{capability.title}</h3>
              <p>{capability.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="signal-strip" aria-label="Analyzer capabilities">
        <div>
          <span className="signal-strip__value">01</span>
          <p>Pages, titles, depth, status &amp; timings</p>
        </div>
        <div>
          <span className="signal-strip__value">02</span>
          <p>Internal vs. external link intelligence</p>
        </div>
        <div>
          <span className="signal-strip__value">03</span>
          <p>Interactive graph with all-link overlay</p>
        </div>
        <div>
          <span className="signal-strip__value">04</span>
          <p>Robots-aware, JavaScript-capable crawl</p>
        </div>
      </section>
    </main>
  );
}
