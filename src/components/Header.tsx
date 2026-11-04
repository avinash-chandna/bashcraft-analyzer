import { ArrowUpRight, BookOpenText, RotateCcw } from "lucide-react";

interface HeaderProps {
  onHome: () => void;
  onMethod: () => void;
  onNewScan?: () => void;
  minimal?: boolean;
}

export function Header({ onHome, onMethod, onNewScan, minimal = false }: HeaderProps) {
  return (
    <header className={`site-header ${minimal ? "site-header--minimal" : ""}`}>
      <button className="brand" type="button" onClick={onHome} aria-label="CraftScope home">
        <span className="brand-mark" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </span>
        <span className="brand-name">
          CRAFT<span>SCOPE</span>
        </span>
        <span className="brand-divider" aria-hidden="true" />
        <span className="brand-subtitle">SITE ANALYZER</span>
      </button>

      <nav className="header-nav" aria-label="Primary navigation">
        <button type="button" className="header-link" onClick={onMethod}>
          <BookOpenText size={14} strokeWidth={1.8} />
          METHOD
        </button>
        <a
          className="header-link header-link--external"
          href="https://bashcraftclub.vercel.app/"
          target="_blank"
          rel="noreferrer"
        >
          BASHCRAFT SITE
          <ArrowUpRight size={14} strokeWidth={2} />
        </a>
        {onNewScan ? (
          <button type="button" className="button button--small button--outline" onClick={onNewScan}>
            <RotateCcw size={13} strokeWidth={2} />
            NEW SCAN
          </button>
        ) : (
          <a className="header-live" href="#analyzer">
            <span className="status-dot status-dot--live" />
            ANALYZER ONLINE
          </a>
        )}
      </nav>
    </header>
  );
}
