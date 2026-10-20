import { useEffect, useRef, useState } from "react";
import {
  Search,
  X,
  ArrowUpRight,
  Command,
  Target,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import type { Quote, Client } from "./main";
const money = (n: string, c = "INR") =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: c,
    maximumFractionDigits: 2,
  }).format(Number(n));
// Snapshots contain server-rounded amounts: sum integer minor units without float drift.
function total(rows: any[], field: string) {
  const cents = rows.reduce((sum: bigint, r: any) => {
    const s = String(r[field] || "0");
    const match = s.match(/^(-?)(\d+)(?:\.(\d{1,2}))?$/);
    if (!match) return sum;
    const v = BigInt(match[2]) * 100n + BigInt((match[3] || "").padEnd(2, "0"));
    return sum + (match[1] ? -v : v);
  }, 0n);
  const abs = cents < 0n ? -cents : cents;
  return `${cents < 0n ? "-" : ""}${abs / 100n}.${String(abs % 100n).padStart(2, "0")}`;
}
export function PortfolioInsights({ quotes }: { quotes: Quote[] }) {
  const frozen = quotes
    .filter(
      (q) => q.status === "finalised" && q.snapshot?.home_currency === "INR",
    )
    .map((q) => q.snapshot);
  const current = quotes.filter(
    (q) => q.status === "draft" && !q.calculation_stale && q.last_calculation,
  );
  const healthy = current.filter(
    (q) => !q.last_calculation.needs_review,
  ).length;
  const mix = ["draft", "finalised", "archived"].map((status) => ({
    status,
    count: quotes.filter((q) => q.status === status).length,
  }));
  return (
    <section className="studio-insights" aria-label="Portfolio insights">
      <article className="studio-value">
        <div className="eyebrow">
          <TrendingUp size={15} /> YOUR QUOTED VALUE
        </div>
        <h2>{money(total(frozen, "net_revenue"))}</h2>
        <p>Estimated net value in INR</p>
        <div className="value-foot">
          <span>
            Estimated profit <strong>{money(total(frozen, "profit"))}</strong>
          </span>
          <span>{frozen.length} frozen versions</span>
        </div>
        <small>
          Across finalised quotation versions. Estimates, not collected revenue;
          revisions can refer to the same project.
        </small>
      </article>
      <article className="studio-health">
        <div className="section-heading">
          <h2>Workspace pulse</h2>
          <Target size={20} />
        </div>
        <div className="pulse-track" aria-hidden="true">
          {mix
            .filter((m) => m.count > 0)
            .map((m) => (
              <span
                key={m.status}
                className={m.status}
                style={{ flex: m.count }}
              />
            ))}
        </div>
        <div className="pulse-legend">
          {mix
            .filter((m) => m.count > 0)
            .map((m) => (
              <span key={m.status}>
                <i className={m.status} />
                {m.status}
                <strong>{m.count}</strong>
              </span>
            ))}
        </div>
        <div className="health-note">
          <span className="health-number">
            {healthy}
            <small> / {current.length}</small>
          </span>
          <p>
            Calculated, current drafts
            <br />
            <strong>meeting their target margin</strong>
          </p>
        </div>
        <small>
          Uncalculated and stale drafts are excluded from margin health.
        </small>
      </article>
    </section>
  );
}
export function QuickSearch({
  open,
  close,
  quotes,
  clients,
  navigate,
  selectQuote,
  selectClient,
  newQuote,
}: {
  open: boolean;
  close: () => void;
  quotes: Quote[];
  clients: Client[];
  navigate: (page: string) => void;
  selectQuote: (q: Quote) => void;
  selectClient: (c: Client) => void;
  newQuote: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  useEffect(() => {
    if (open) {
      setQuery("");
      setSelected(0);
      dialog.current?.showModal();
      input.current?.focus();
    } else dialog.current?.close();
  }, [open]);
  const needle = query.toLocaleLowerCase().trim();
  const actions = [
    ...["Dashboard", "Quotations", "Clients", "Cache Lab"].map((name) => ({
      key: "page" + name,
      name,
      kind: "Navigate",
      run: () => navigate(name),
    })),
    { key: "new", name: "New quotation", kind: "Create", run: newQuote },
    ...quotes.map((q) => ({
      key: "q" + q.id,
      name: q.title,
      kind: `${q.client_name} · ${q.status} · v${q.revision}`,
      run: () => selectQuote(q),
    })),
    ...clients.map((c) => ({
      key: "c" + c.id,
      name: c.name,
      kind: `Client · ${c.company || c.currency}`,
      run: () => selectClient(c),
    })),
  ]
    .filter((a) => `${a.name} ${a.kind}`.toLocaleLowerCase().includes(needle))
    .slice(0, 10);
  useEffect(() => {
    if (open)
      dialog.current
        ?.querySelector(`[data-search-index="${selected}"]`)
        ?.scrollIntoView({ block: "nearest" });
  }, [selected, open]);
  const choose = (index: number) => {
    const action = actions[index];
    if (action) {
      close();
      action.run();
    }
  };
  return (
    <dialog
      className="command-dialog"
      ref={dialog}
      aria-labelledby="search-title"
      onClose={close}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = dialog.current?.querySelectorAll<HTMLElement>(
          'button:not([tabindex="-1"]), input',
        );
        if (!controls?.length) return;
        const first = controls[0],
          last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
      onClick={(e) => {
        if (e.target === dialog.current) close();
      }}
    >
      <div className="command-head">
        <h2 id="search-title">
          <Command size={18} /> Jump anywhere
        </h2>
        <button aria-label="Close quick search" onClick={close}>
          <X size={19} />
        </button>
      </div>
      <div className="command-input">
        <Search size={21} />
        <input
          ref={input}
          aria-label="Search workspace"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls="workspace-results"
          aria-activedescendant={
            actions[selected] ? `search-option-${selected}` : undefined
          }
          placeholder="Find a quote, client, or action…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSelected((i) =>
                Math.max(0, Math.min(i + 1, actions.length - 1)),
              );
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setSelected((i) => Math.max(i - 1, 0));
            }
            if (e.key === "Enter") {
              e.preventDefault();
              choose(selected);
            }
          }}
        />
      </div>
      <div
        className="command-results"
        id="workspace-results"
        role="listbox"
        aria-label="Workspace results"
      >
        {actions.map((a, index) => (
          <button
            role="option"
            id={`search-option-${index}`}
            data-search-index={index}
            aria-selected={index === selected}
            tabIndex={-1}
            onMouseMove={() => setSelected(index)}
            className={index === selected ? "selected" : ""}
            key={a.key}
            onClick={() => choose(index)}
          >
            <span>
              <strong>{a.name}</strong>
              <small>{a.kind}</small>
            </span>
            <ArrowUpRight size={18} />
          </button>
        ))}
        {!actions.length && (
          <p className="command-empty" role="status">
            No results. Try a project title or client name.
          </p>
        )}
      </div>
      <div className="command-foot">
        <span>↑ ↓ select · Enter open</span>
        <span>Esc close</span>
      </div>
    </dialog>
  );
}
export function MarginPlanner({
  quote,
  request,
  apply,
  pending,
}: {
  quote: Quote;
  pending: boolean;
  request: (margin: string) => Promise<any>;
  apply: (result: any) => Promise<any>;
}) {
  const [margin, setMargin] = useState(
    String(Math.min(90, Math.round(Number(quote.target_margin) * 100))),
  );
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  useEffect(() => {
    generation.current++;
    setBusy(false);
    setResult(null);
    setError("");
    setMargin(
      String(Math.min(90, Math.round(Number(quote.target_margin) * 100))),
    );
  }, [
    quote.id,
    quote.version,
    quote.last_calculation?.rate_provenance?.version,
  ]);
  async function preview() {
    const epoch = ++generation.current;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const r = await request(String(Number(margin) / 100));
      if (epoch === generation.current) setResult(r);
    } catch (e) {
      if (epoch === generation.current) setError((e as Error).message);
    } finally {
      if (epoch === generation.current) setBusy(false);
    }
  }
  return (
    <section className="margin-planner" aria-label="Margin planner">
      <div>
        <div className="eyebrow">
          <Sparkles size={14} /> PRICE EXPLORER
        </div>
        <h2>Find your sweet spot.</h2>
        <p>Compare a new target using this quote’s recorded rate and fees.</p>
        <small>Previewing keeps this quotation unchanged.</small>
      </div>
      <div className="planner-controls">
        <label className="planner-label" htmlFor="planner-target">
          Target margin <strong>{margin}%</strong>
        </label>
        <input
          id="planner-target"
          aria-label="Planned target margin"
          type="range"
          min="0"
          max="90"
          step="1"
          disabled={busy || pending}
          value={margin}
          onChange={(e) => {
            generation.current++;
            setBusy(false);
            setMargin(e.target.value);
            setResult(null);
            setError("");
          }}
        />
        <div className="range-ends">
          <span>0%</span>
          <span>90%</span>
        </div>
        <button
          className="secondary"
          disabled={busy || pending}
          onClick={preview}
        >
          {busy ? "Comparing…" : "Preview target price"}
          <ArrowUpRight size={17} />
        </button>
        {error && <p role="alert">{error}</p>}
        {result && (
          <div className="planner-result" role="status">
            <small>HYPOTHETICAL CLIENT PRICE</small>
            <strong>{money(result.gross_price, quote.currency)}</strong>
            <span>
              Current {money(result.current_price, quote.currency)} · Estimated
              profit {money(result.profit)}
            </span>
            {quote.status === "draft" && (
              <button
                className="primary"
                disabled={busy || pending}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    await apply(result);
                    setResult(null);
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Use this price in draft
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
