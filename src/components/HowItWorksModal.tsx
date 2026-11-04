import { useEffect, useRef } from "react";
import { ArrowDown, Braces, Compass, Network, ShieldCheck, X } from "lucide-react";

interface HowItWorksModalProps {
  onClose: () => void;
}

const steps = [
  {
    icon: Compass,
    number: "01",
    title: "Discover",
    body: "Start from one public URL, then follow connected internal links breadth-first. Page and depth limits keep the crawl finite.",
  },
  {
    icon: Network,
    title: "Normalise",
    number: "02",
    body: "Fragments, tracking parameters, default ports, trailing slashes, and www/http variants are reconciled so one resource is checked once.",
  },
  {
    icon: ShieldCheck,
    title: "Verify",
    number: "03",
    body: "Internal links are checked for HTTP errors, timeouts, unreachable hosts, redirects, and soft 404 pages hidden behind HTTP 200.",
  },
  {
    icon: Braces,
    title: "Export",
    number: "04",
    body: "Explore the relationship graph, inspect pages, filter every link, then take the report away as JSON, CSV, or a sitemap XML.",
  },
];

export function HowItWorksModal({ onClose }: HowItWorksModalProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section
        className="method-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="method-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="method-modal__top">
          <div>
            <p className="eyebrow">CRAFT / METHOD</p>
            <h2 id="method-title">How the map gets made.</h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Close method dialog"
          >
            <X size={19} />
          </button>
        </div>

        <div className="method-steps">
          {steps.map((step, index) => (
            <article className="method-step" key={step.number}>
              <div className="method-step__icon">
                <step.icon size={20} strokeWidth={1.7} />
              </div>
              <div className="method-step__copy">
                <span className="mono method-step__number">{step.number}</span>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </div>
              {index < steps.length - 1 ? (
                <ArrowDown className="method-step__arrow" size={16} aria-hidden="true" />
              ) : null}
            </article>
          ))}
        </div>

        <div className="method-modal__foot">
          <p>
            <strong>Polite by default.</strong> Links that leave the site are identified but never
            requested. Robots rules and crawl delays are read when available.
          </p>
          <button type="button" className="button button--small" onClick={onClose}>
            GOT IT
          </button>
        </div>
      </section>
    </div>
  );
}
