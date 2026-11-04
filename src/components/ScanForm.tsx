import { useId, useState } from "react";
import {
  ArrowRight,
  Bot,
  ChevronDown,
  Globe2,
  Info,
  MonitorPlay,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import type { ApiError, ScanSettings } from "../types";

interface ScanFormProps {
  url: string;
  onUrlChange: (value: string) => void;
  settings: ScanSettings;
  onSettingsChange: (settings: ScanSettings) => void;
  onSubmit: () => void;
  error?: ApiError | null;
}

const PAGE_OPTIONS = [10, 25, 50, 100];
const DEPTH_OPTIONS = [1, 2, 3, 4, 5];

function normalizeInput(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export function ScanForm({
  url,
  onUrlChange,
  settings,
  onSettingsChange,
  onSubmit,
  error,
}: ScanFormProps) {
  const inputId = useId();
  const errorId = useId();
  const [localError, setLocalError] = useState<string | null>(null);

  const update = <K extends keyof ScanSettings>(key: K, value: ScanSettings[K]) => {
    onSettingsChange({ ...settings, [key]: value });
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLocalError(null);

    if (!url.trim()) {
      setLocalError("Enter a website URL to begin.");
      return;
    }

    let parsed: URL;
    try {
      parsed = new URL(normalizeInput(url));
    } catch {
      setLocalError("That doesn't look like a valid URL. Try https://example.com.");
      return;
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      setLocalError("Only http:// and https:// website URLs are supported.");
      return;
    }
    if (!parsed.hostname || !parsed.hostname.includes(".")) {
      setLocalError("Enter a public domain name, such as https://example.com.");
      return;
    }

    onUrlChange(normalizeInput(url));
    onSubmit();
  };

  const visibleError = localError || error?.message;
  const errorHint = localError ? null : error?.hint;

  return (
    <section className="scanner-card" id="analyzer" aria-labelledby="scanner-title">
      <div className="scanner-card__header">
        <div>
          <p className="eyebrow">NEW CRAWL / INPUT</p>
          <h2 id="scanner-title">Open the map.</h2>
        </div>
        <span className="scanner-ready">
          <span className="status-dot status-dot--live" />
          READY
        </span>
      </div>

      <form onSubmit={handleSubmit} noValidate>
        <label className="field-label" htmlFor={inputId}>
          WEBSITE URL
        </label>
        <div className={`url-field ${visibleError ? "url-field--error" : ""}`}>
          <Globe2 size={19} strokeWidth={1.7} aria-hidden="true" />
          <input
            id={inputId}
            type="text"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={url}
            onChange={(event) => {
              onUrlChange(event.target.value);
              if (localError) setLocalError(null);
            }}
            placeholder="https://bashcraftclub.vercel.app/"
            aria-invalid={Boolean(visibleError)}
            aria-describedby={visibleError ? errorId : undefined}
          />
          <button className="url-field__submit" type="submit" aria-label="Scan website">
            <ArrowRight size={19} strokeWidth={2.2} />
          </button>
        </div>

        {visibleError ? (
          <div className="field-error" id={errorId} role="alert">
            <Info size={14} />
            <span>
              {visibleError}
              {errorHint ? <small>{errorHint}</small> : null}
            </span>
          </div>
        ) : (
          <p className="field-help">
            Public web addresses only. External websites are identified, never crawled.
          </p>
        )}

        <div className="scanner-settings">
          <label className="select-field">
            <span>
              <Bot size={14} />
              PAGE LIMIT
            </span>
            <span className="select-field__control">
              <select
                value={settings.maxPages}
                onChange={(event) => update("maxPages", Number(event.target.value))}
                aria-label="Page limit"
              >
                {PAGE_OPTIONS.map((value) => (
                  <option key={value} value={value}>
                    {value} pages
                  </option>
                ))}
              </select>
              <ChevronDown size={13} aria-hidden="true" />
            </span>
          </label>

          <label className="select-field">
            <span>
              <MonitorPlay size={14} />
              CRAWL DEPTH
            </span>
            <span className="select-field__control">
              <select
                value={settings.maxDepth}
                onChange={(event) => update("maxDepth", Number(event.target.value))}
                aria-label="Crawl depth"
              >
                {DEPTH_OPTIONS.map((value) => (
                  <option key={value} value={value}>
                    {value} {value === 1 ? "level" : "levels"}
                  </option>
                ))}
              </select>
              <ChevronDown size={13} aria-hidden="true" />
            </span>
          </label>
        </div>

        <div className="scanner-toggles">
          <label className="toggle-row">
            <span className="toggle-row__icon">
              <Sparkles size={15} />
            </span>
            <span className="toggle-row__copy">
              <strong>Render JavaScript</strong>
              <small>Required for BashCraft&apos;s React pages</small>
            </span>
            <input
              type="checkbox"
              className="sr-only toggle-input"
              checked={settings.renderJs}
              onChange={(event) => update("renderJs", event.target.checked)}
            />
            <span className={`switch ${settings.renderJs ? "switch--on" : ""}`} aria-hidden="true" />
          </label>

          <label className="toggle-row">
            <span className="toggle-row__icon">
              <ShieldCheck size={15} />
            </span>
            <span className="toggle-row__copy">
              <strong>Respect robots.txt</strong>
              <small>Honour crawl directives and delays</small>
            </span>
            <input
              type="checkbox"
              className="sr-only toggle-input"
              checked={settings.respectRobots}
              onChange={(event) => update("respectRobots", event.target.checked)}
            />
            <span
              className={`switch ${settings.respectRobots ? "switch--on" : ""}`}
              aria-hidden="true"
            />
          </label>
        </div>

        <button className="button button--scan" type="submit">
          <span>SCAN WEBSITE</span>
          <span className="button__arrow">
            <ArrowRight size={18} strokeWidth={2.1} />
          </span>
        </button>
      </form>

      <div className="scanner-card__foot">
        <span>NO SIGN-UP</span>
        <span>INTERNAL LINKS ONLY</span>
        <span>JSON / CSV / XML</span>
      </div>
    </section>
  );
}
