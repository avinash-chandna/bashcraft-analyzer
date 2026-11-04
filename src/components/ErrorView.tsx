import { ArrowLeft, ArrowUpRight, CircleAlert, RotateCcw } from "lucide-react";
import type { ApiError } from "../types";

interface ErrorViewProps {
  url: string;
  error: ApiError;
  onTryAgain: () => void;
  onHome: () => void;
}

export function ErrorView({ url, error, onTryAgain, onHome }: ErrorViewProps) {
  return (
    <main id="main" className="error-shell">
      <div className="error-card" role="alert" aria-labelledby="scan-error-title">
        <div className="error-card__graphic" aria-hidden="true">
          <span className="error-ring error-ring--1" />
          <span className="error-ring error-ring--2" />
          <CircleAlert size={44} strokeWidth={1.25} />
          <span className="error-marker">!</span>
        </div>

        <div className="error-card__copy">
          <p className="eyebrow eyebrow--danger">SCAN INTERRUPTED / {error.code}</p>
          <h1 id="scan-error-title">The site stayed out of reach.</h1>
          <p className="error-message">{error.message}</p>
          {error.hint ? <p className="error-hint">{error.hint}</p> : null}

          <div className="error-target">
            <span>TARGET</span>
            <code>{url}</code>
          </div>

          <div className="error-actions">
            <button type="button" className="button" onClick={onTryAgain}>
              <RotateCcw size={15} />
              ADJUST &amp; RETRY
            </button>
            <button type="button" className="button button--ghost" onClick={onHome}>
              <ArrowLeft size={15} />
              BACK TO START
            </button>
          </div>

          <div className="error-tips">
            <p>Try checking:</p>
            <ul>
              <li>The URL is publicly reachable in your own browser.</li>
              <li>The domain uses http:// or https://, not a local address.</li>
              <li>JavaScript rendering is enabled for single-page apps.</li>
              <li>“Respect robots.txt” is on, but the page may be disallowed.</li>
            </ul>
            <a
              href="https://bashcraftclub.vercel.app/"
              target="_blank"
              rel="noreferrer"
              className="text-link"
            >
              Open the BashCraft site
              <ArrowUpRight size={13} />
            </a>
          </div>
        </div>
      </div>
    </main>
  );
}
