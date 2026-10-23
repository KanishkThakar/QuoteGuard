import { useEffect, useRef, useState } from "react";
import { Activity, ArrowUpRight, ShieldCheck } from "lucide-react";
import type { Quote } from "./main";
const money = (value: string, currency = "INR") =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(Number(value));

type StressResult = {
  status: "protected" | "below_target" | "loss";
  margin: string | null;
  gross_price: string;
  profit: string;
  cost: string;
  net_revenue: string;
  minimum_price: string;
  price_increase_needed: string;
  maximum_cost_budget: string;
  cost_reduction_needed: string;
  cost_option_available: boolean;
  input_version: number;
  rate: string;
  rate_provenance: { source: string; actual_date: string };
  trace: {
    request_id: string;
    cache_key: string;
    decision: "hit" | "miss";
    duration_ms: number;
    calculation_executed: boolean;
    cache_written: boolean;
  };
};

export function DealStressTest({
  quote,
  request,
}: {
  quote: Quote;
  request: (values: Record<string, string>) => Promise<StressResult>;
}) {
  const [discount, setDiscount] = useState("0");
  const [cost, setCost] = useState("0");
  const [fx, setFx] = useState("0");
  const [result, setResult] = useState<StressResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  useEffect(() => {
    generation.current++;
    setResult(null);
    setError("");
    setBusy(false);
    setDiscount("0");
    setCost("0");
    setFx("0");
  }, [
    quote.id,
    quote.version,
    quote.last_calculation?.rate_provenance?.version,
    quote.calculation_stale,
  ]);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  function change(set: (v: string) => void, value: string) {
    generation.current++;
    set(value);
    setResult(null);
    setError("");
    setBusy(false);
  }
  async function run() {
    const token = ++generation.current;
    setBusy(true);
    setError("");
    try {
      const value = await request({
        discount_percent: discount,
        cost_increase_percent: cost,
        rate_change_percent: fx,
      });
      if (token === generation.current) setResult(value);
    } catch (err: unknown) {
      if (token === generation.current) {
        setResult(null);
        setError(
          err instanceof Error ? err.message : "Unable to run scenario.",
        );
      }
    } finally {
      if (token === generation.current) setBusy(false);
    }
  }
  const stale = quote.status === "draft" && quote.calculation_stale;
  const controls = [
    {
      name: "Client discount",
      value: discount,
      set: setDiscount,
      min: 0,
      max: 100,
      suffix: "%",
    },
    {
      name: "Cost increase",
      value: cost,
      set: setCost,
      min: 0,
      max: 100,
      suffix: "%",
    },
    {
      name: "Exchange-rate change",
      value: fx,
      set: setFx,
      min: -50,
      max: 50,
      suffix: "%",
    },
  ];
  const label =
    result?.status === "protected"
      ? "Margin protected"
      : result?.status === "loss"
        ? "Deal not viable"
        : "Below target margin";
  return (
    <section className="deal-stress" aria-label="Deal stress test">
      <header>
        <div>
          <span className="eyebrow">
            <Activity size={15} /> NEGOTIATION DESK
          </span>
          <h2>How far can this deal bend?</h2>
          <p>
            Push the numbers. Find the point where your profit stops working.
          </p>
        </div>
        <span className="stress-preview">
          <ShieldCheck size={15} /> Preview only
        </span>
      </header>
      <div className="stress-layout">
        <div className="stress-controls">
          {controls.map((control) => (
            <label key={control.name}>
              <span>
                {control.name}
                <strong>
                  {Number(control.value) > 0 && control.min < 0 ? "+" : ""}
                  {control.value}
                  {control.suffix}
                </strong>
              </span>
              <input
                type="range"
                aria-label={control.name}
                disabled={
                  control.min < 0 && quote.currency === quote.home_currency
                }
                min={control.min}
                max={control.max}
                step="1"
                value={control.value}
                onChange={(e) => change(control.set, e.target.value)}
              />
            </label>
          ))}
          <p className="stress-hint">
            Costs rise together. A positive rate change means more{" "}
            {quote.currency} per INR; for a fixed client price, that reduces
            your INR revenue.
          </p>
          <button className="primary" disabled={busy || !!stale} onClick={run}>
            <Activity size={16} />
            {busy
              ? "Testing deal…"
              : result
                ? "Run again · check cache"
                : "Run stress test"}
          </button>
          {stale && <p role="status">Calculate the latest draft first.</p>}
          {error && (
            <p role="alert" className="red">
              {error}
            </p>
          )}
        </div>
        <div
          className={`stress-outcome ${result ? result.status : ""}`}
          aria-live="polite"
          aria-busy={busy}
        >
          {result ? (
            <>
              <span className="eyebrow">{label}</span>
              <strong className="stress-margin">
                {result.margin === null
                  ? "Undefined"
                  : `${(Number(result.margin) * 100).toFixed(2)}%`}
              </strong>
              <p>
                Net margin · target{" "}
                {(Number(quote.target_margin) * 100).toFixed(2)}%
              </p>
              <div className="stress-numbers">
                <div>
                  <small>Client pays</small>
                  <strong>{money(result.gross_price, quote.currency)}</strong>
                </div>
                <div>
                  <small>You keep as profit</small>
                  <strong>{money(result.profit)}</strong>
                </div>
                <div>
                  <small>Project costs</small>
                  <strong>{money(result.cost)}</strong>
                </div>
                <div>
                  <small>Net revenue after fees</small>
                  <strong>{money(result.net_revenue)}</strong>
                </div>
              </div>
            </>
          ) : (
            <div className="stress-empty">
              <Activity size={32} />
              <h3>Your next negotiation, rehearsed.</h3>
              <p>
                Choose a scenario and run it to see the impact before committing
                to a price.
              </p>
            </div>
          )}
        </div>
      </div>
      {result && (
        <>
          <div className="stress-rescue">
            <div>
              <span className="eyebrow">
                <ArrowUpRight size={15} /> FIND A WORKABLE DEAL
              </span>
              <h3>Two ways back to your target</h3>
            </div>
            <div>
              <small>Charge at least</small>
              <strong>{money(result.minimum_price, quote.currency)}</strong>
              <span>
                Raise this scenario’s price by{" "}
                {money(result.price_increase_needed, quote.currency)}
              </span>
            </div>
            <div>
              <small>Or keep costs within</small>
              <strong>
                {result.cost_option_available
                  ? money(result.maximum_cost_budget)
                  : "Raise the price first"}
              </strong>
              <span>
                {result.cost_option_available
                  ? `Reduce scenario costs by ${money(result.cost_reduction_needed)}`
                  : "Net revenue must be positive before a cost-only recovery can work."}
              </span>
            </div>
          </div>
          <details className="stress-engine">
            <summary>
              Show the engine · Redis {result.trace.decision.toUpperCase()} ·{" "}
              {result.trace.duration_ms} ms
            </summary>
            <p>
              This scenario uses the quotation’s recorded reference rate,
              adjusted by your slider. No rate-provider request was made.{" "}
              {result.trace.calculation_executed
                ? "Django calculated this scenario."
                : "Redis returned the stored scenario."}{" "}
              {result.trace.cache_written
                ? "The result was stored in Redis."
                : ""}
            </p>
            <dl>
              <dt>Request ID</dt>
              <dd>{result.trace.request_id}</dd>
              <dt>Input version</dt>
              <dd>{result.input_version}</dd>
              <dt>Actual cache key</dt>
              <dd>{result.trace.cache_key}</dd>
              <dt>Scenario rate ({quote.currency} per INR)</dt>
              <dd>{result.rate}</dd>
              <dt>Reference source</dt>
              <dd>
                {result.rate_provenance.source} ·{" "}
                {result.rate_provenance.actual_date}
              </dd>
            </dl>
          </details>
        </>
      )}
      <footer>
        Saved quotation unchanged. Hypothetical rates are scenarios, not
        forecasts. Payment fees are included; taxes are excluded.
      </footer>
    </section>
  );
}
