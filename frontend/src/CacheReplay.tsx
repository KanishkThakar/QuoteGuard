import { useState } from "react";
import type { Quote } from "./main";

type Receipt = {
  request_trace: { request_id: string; quote_id: number; input_version: number;
    lookup_input_version?: number; cache_key: string | null; result_key: string | null;
    rate_version?: string; rate_cache?: string; decision: string; provider_called: boolean;
    calculation_executed: boolean; cache_written?: boolean; snapshot_sha256?: string };
  gross_price: string; cost: string; margin: string; currency: string;
  duration_ms?: number; calculation_ttl?: number;
};
type Props = { quotes: Quote[]; request: (path: string, method?: string, body?: unknown) => Promise<any>; onChanged: () => Promise<void> };

export function CacheReplay({ quotes, request, onChanged }: Props) {
  const drafts = quotes.filter(q => q.status === "draft" && q.costs.length);
  const frozen = quotes.filter(q => q.status === "finalised");
  const [selected, setSelected] = useState(String(drafts[0]?.id ?? ""));
  const draft = drafts.find(q => String(q.id) === selected) ?? drafts[0];
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [history, setHistory] = useState<Receipt[]>([]);
  const [stage, setStage] = useState(0);
  const [cost, setCost] = useState("");
  const [obsolete, setObsolete] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [snapshotId, setSnapshotId] = useState(String(frozen[0]?.id ?? ""));
  const frozenQuote = frozen.find(q => String(q.id) === snapshotId) ?? frozen[0];
  const [pinned, setPinned] = useState<Receipt | null>(null);
  const [verified, setVerified] = useState(false);
  async function perform(action: () => Promise<void>) {
    setBusy(true); setError("");
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : "Request failed. Please retry."); }
    finally { setBusy(false); }
  }
  function runRequest() {
    if (!draft) return;
    void perform(async () => {
      const next: Receipt = await request(`quotes/${draft.id}/calculate/`, "POST", {});
      if (!next.request_trace) throw new Error("The server does not yet support request replay.");
      setReceipt(next); setHistory(old => [next, ...old].slice(0, 8)); setStage(0);
      setNotice(`Real request completed: ${next.request_trace.decision}. Input version ${next.request_trace.input_version}.`);
      await onChanged();
    });
  }
  function changeCost() {
    if (!draft || !receipt || !cost.trim()) return;
    void perform(async () => {
      const updated: Quote = await request(`quotes/${draft.id}/`, "PATCH", {
        version: draft.version,
        costs: draft.costs.map((item, index) => index === 0 ? { ...item, unit_cost: cost } : item),
      });
      setObsolete(receipt.request_trace.result_key);
      setNotice(`Saved: input version ${draft.version} → ${updated.version}. The previous key is obsolete for this draft. Run the next request to observe the actual decision.`);
      setCost(""); await onChanged();
    });
  }
  function checkSnapshot() {
    if (!frozenQuote) return;
    void perform(async () => {
      const next: Receipt = await request(`quotes/${frozenQuote.id}/calculate/`, "POST", {});
      if (!next.request_trace?.snapshot_sha256) throw new Error("Snapshot fingerprint unavailable.");
      if (pinned && pinned.request_trace.quote_id === frozenQuote.id) {
        if (pinned.request_trace.snapshot_sha256 !== next.request_trace.snapshot_sha256) throw new Error("Snapshot fingerprint changed. Investigate before presenting.");
        setVerified(true);
      } else { setPinned(next); setVerified(false); }
    });
  }
  const trace = receipt?.request_trace;
  const stages = [
    { title: "Request", detail: trace ? `POST /api/quotes/${trace.quote_id}/calculate/ • request ${trace.request_id}` : "Send one authenticated request for the selected draft." },
    { title: "Key / version", detail: trace ? `Input v${trace.lookup_input_version} → v${trace.input_version}. Rate version ${trace.rate_version}. Lookup key: ${trace.cache_key}. Result key: ${trace.result_key}.` : "The owner, quotation, input version, rate version, calculation version and input digest identify this calculation." },
    { title: "Hit or miss", detail: trace ? `${trace.decision.toUpperCase()}. Remaining calculation TTL: ${receipt?.calculation_ttl != null && receipt.calculation_ttl >= 0 ? `${receipt.calculation_ttl} seconds` : "unavailable / expired"}. ${trace.cache_written ? "Calculated result written to Redis." : trace.decision === "hit" ? "Existing calculation reused." : "No cache write confirmed; the next request may miss again."}` : "Redis is checked for a valid calculation under the versioned key." },
    { title: "Provider / calculation", detail: trace ? `Rate cache: ${trace.rate_cache}. External provider called: ${trace.provider_called ? "yes" : "no"}. Pricing calculation executed: ${trace.calculation_executed ? "yes" : "no"}.` : "A calculation miss can still use a cached rate; it does not always call the external provider." },
    { title: "Response", detail: receipt ? `${receipt.currency} ${receipt.gross_price} • cost ${receipt.cost} • margin ${(Number(receipt.margin) * 100).toFixed(2)}% • server ${(receipt.duration_ms ?? 0).toFixed(3)} ms.` : "Inspect the actual price, margin, server duration and response receipt." },
  ];
  return <section className="cache-replay" aria-label="Interactive cache replay">
    <div className="replay-heading"><div><span className="eyebrow">ONE REQUEST, MADE VISIBLE</span><h2>Follow the answer.</h2><p>Change a real draft cost. Watch the version move and the old key lose its relevance.</p></div><span className="badge">Interactive replay</span></div>
    <div className="replay-controls"><label>Draft quotation<select value={draft?.id ?? ""} disabled={busy} onChange={e => { setSelected(e.target.value); setReceipt(null); setHistory([]); setObsolete(null); setNotice(""); setCost(""); }}>
      {!drafts.length && <option value="">Create a draft with a cost first</option>}{drafts.map(q => <option key={q.id} value={q.id}>QG-{String(q.id).padStart(4, "0")} · {q.title} · input v{q.version}</option>)}</select></label>
      <button className="primary" disabled={busy || !draft} onClick={runRequest}>{busy ? "Waiting for server…" : "Run real request"}</button></div>
    <div className="replay-stages">{stages.map((item, index) => <button key={item.title} className={stage === index ? "replay-stage selected" : "replay-stage"} aria-pressed={stage === index} onClick={() => setStage(index)}><span>0{index + 1}</span><strong>{item.title}</strong>{index === 2 && trace && <em>{trace.decision}</em>}</button>)}</div>
    <div className="replay-detail"><span className="eyebrow">STEP {stage + 1} / 5</span><h3>{stages[stage].title}</h3><p>{stages[stage].detail}</p><button disabled={stage === 4} onClick={() => setStage(s => Math.min(s + 1, 4))}>Next stage →</button></div>
    <p className="replay-caption">This is a logical walkthrough of a completed server request. The rate version is resolved before the calculation key; the steps are explanatory, not a streaming trace or benchmark.</p>
    <div className="replay-experiments"><div><h3>Make the old key obsolete</h3><p>{draft ? `${draft.costs[0].description} · current unit cost ${draft.costs[0].unit_cost} ${draft.home_currency}` : "Select a draft to begin."}</p><label>New first-item unit cost<input type="number" min="0" step="0.01" value={cost} onChange={e => setCost(e.target.value)} placeholder="e.g. 72000" disabled={busy || !receipt} /></label><button disabled={busy || !receipt || !cost.trim()} onClick={changeCost}>Save cost & advance version</button><p className="replay-caption">Changes the selected draft. The proposed client price stays fixed for margin review. Old Redis keys can remain until TTL expiry; they are no longer addressed by this draft.</p>{obsolete && <details><summary>Obsolete key</summary><code>{obsolete}</code></details>}</div>
    <div><h3>The signed-off price stays fixed</h3><label>Finalised quotation<select value={frozenQuote?.id ?? ""} disabled={busy} onChange={e => { setSnapshotId(e.target.value); setPinned(null); setVerified(false); }}>{!frozen.length && <option value="">Finalise a quotation first</option>}{frozen.map(q => <option key={q.id} value={q.id}>QG-{String(q.id).padStart(4, "0")} · {q.title}</option>)}</select></label><button disabled={busy || !frozenQuote} onClick={checkSnapshot}>{pinned ? "Verify frozen snapshot" : "Pin finalised snapshot"}</button>{pinned && <div className="snapshot-proof"><strong>{pinned.currency} {pinned.gross_price}</strong><p>{verified ? "Verified unchanged: full snapshot SHA-256 matches." : "Baseline captured. Change the draft cost, then verify again."}</p><code>{pinned.request_trace.snapshot_sha256}</code><p className="replay-caption">Read from PostgreSQL. Redis, provider and pricing calculation skipped.</p></div>}</div></div>
    <p role="status" aria-live="polite">{notice}</p>{error && <div><p role="alert">{error}</p><button disabled={busy} onClick={() => void perform(async () => { await onChanged(); setNotice("Latest quotations loaded. Retry the request or cost edit."); })}>Reload latest quotations</button></div>}
    {!!history.length && <details><summary>Actual request history ({history.length})</summary><ol className="replay-history">{[...history].reverse().map(item => <li key={item.request_trace.request_id}><strong>{item.request_trace.decision.toUpperCase()}</strong> · input v{item.request_trace.input_version} · {item.currency} {item.gross_price}<code>{item.request_trace.result_key}</code></li>)}</ol><details><summary>Latest server receipt</summary><pre>{JSON.stringify(receipt, null, 2)}</pre></details></details>}
  </section>;
}
