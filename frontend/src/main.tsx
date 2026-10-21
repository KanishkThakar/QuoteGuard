import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  ShieldCheck,
  LayoutDashboard,
  Users,
  FileText,
  FlaskConical,
  Plus,
  ArrowUpRight,
  ArrowLeft,
  LogOut,
  RefreshCw,
  Check,
  Download,
  Copy,
  Archive,
  X,
  ChevronRight,
} from "lucide-react";
import "./style.css";
import { CacheReplay } from "./CacheReplay";
import { ratioToPercent, percentToRatio } from "./percent";
import { PortfolioInsights, QuickSearch, MarginPlanner } from "./StudioTools";
export type Client = {
  id: number;
  name: string;
  company: string;
  email: string;
  currency: string;
};
type Cost = { description: string; quantity: string; unit_cost: string };
export type Quote = {
  id: number;
  client: number;
  client_name: string;
  title: string;
  description: string;
  notes: string;
  valid_until: string;
  currency: string;
  home_currency: string;
  target_margin: string;
  fee_percent: string;
  fixed_fee: string;
  proposed_price: string | null;
  rate_date: string | null;
  status: string;
  revision: number;
  version: number;
  parent: number | null;
  costs: Cost[];
  snapshot: any;
  last_calculation: any;
  calculation_stale?: boolean;
  stale_reasons?: string[];
};
class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
let csrf = "";
async function api(path: string, method = "GET", body?: unknown) {
  const r = await fetch("/api/" + path, {
    method,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-CSRFToken": csrf },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data: any;
  try {
    data = await r.json();
  } catch {
    throw new Error("The server is unavailable. Please retry shortly.");
  }
  if (!r.ok)
    throw new ApiError(
      typeof data.detail === "string"
        ? data.detail
        : Object.entries(data)
            .map(
              ([key, value]) =>
                `${key}: ${Array.isArray(value) ? value.join(" ") : String(value)}`,
            )
            .join("; "),
      r.status,
    );
  if (data.csrf) csrf = data.csrf;
  return data;
}
const currencies = [
  "USD",
  "EUR",
  "GBP",
  "CAD",
  "AUD",
  "JPY",
  "CHF",
  "SGD",
  "INR",
];
const money = (n: any, c = "INR") =>
  n == null
    ? "—"
    : new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: c,
        maximumFractionDigits: 2,
      }).format(Number(n));
const pct = (n: any) =>
  n == null ? "Undefined" : `${(Number(n) * 100).toFixed(2)}%`;
function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {React.isValidElement(children)
        ? React.cloneElement(children as React.ReactElement<any>, {
            "aria-label":
              (children as React.ReactElement<any>).props["aria-label"] ||
              label,
          })
        : children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
function App() {
  const [user, setUser] = useState<any>(null),
    [boot, setBoot] = useState(true),
    [page, setPage] = useState("Dashboard"),
    [quotes, setQuotes] = useState<Quote[]>([]),
    [clients, setClients] = useState<Client[]>([]),
    [active, setActive] = useState<Quote | null>(null),
    [editing, setEditing] = useState(false),
    [error, setError] = useState(""),
    [conflict, setConflict] = useState(false),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [sort, setSort] = useState("recent"),
    [lab, setLab] = useState<any>({}),
    [labResult, setLabResult] = useState<any>(null),
    [showClient, setShowClient] = useState(false),
    [editClient, setEditClient] = useState<Client | null>(null),
    [commandOpen, setCommandOpen] = useState(false);
  const workspaceEpoch = useRef(0);
  const run = async (fn: () => Promise<any>) => {
    setError("");
    setConflict(false);
    setNotice("");
    setBusy(true);
    try {
      return await fn();
    } catch (e) {
      setError((e as Error).message);
      setConflict(e instanceof ApiError && e.status === 409);
    } finally {
      setBusy(false);
    }
  };
  const load = async () => {
    const epoch = workspaceEpoch.current;
    const [q, c] = await Promise.all([api("quotes/"), api("clients/")]);
    if (epoch !== workspaceEpoch.current) return;
    setQuotes(q);
    setClients(c);
  };
  useEffect(() => {
    api("auth/session/")
      .then(async (d) => {
        if (d.user) await load();
        setUser(d.user);
      })
      .catch((e) => setError(e.message))
      .finally(() => setBoot(false));
  }, []);
  useEffect(() => {
    let alive = true;
    if (user && page === "Cache Lab")
      api("lab/")
        .then((d) => {
          if (alive) setLab(d);
        })
        .catch((e) => {
          if (alive) setError(e.message);
        });
    return () => {
      alive = false;
    };
  }, [page, user]);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (
        user &&
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "k"
      ) {
        event.preventDefault();
        setCommandOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [user]);
  const open = (q: Quote) => {
    setActive(q);
    setEditing(false);
    setPage("Quotations");
    setError("");
  };
  const fresh = () => {
    if (!clients.length) {
      setPage("Clients");
      setShowClient(true);
      setNotice("Add a client to start your first quotation.");
      return;
    }
    setActive({
      id: 0,
      client: clients[0].id,
      client_name: clients[0].name,
      title: "",
      description: "",
      notes: "",
      valid_until: new Date(Date.now() + 30 * 86400000)
        .toISOString()
        .slice(0, 10),
      currency: clients[0].currency,
      home_currency: "INR",
      target_margin: "0.30",
      fee_percent: "0.029",
      fixed_fee: "0.30",
      proposed_price: null,
      rate_date: null,
      status: "draft",
      revision: 1,
      version: 1,
      parent: null,
      costs: [
        { description: "Design & development", quantity: "1", unit_cost: "0" },
      ],
      snapshot: null,
      last_calculation: null,
    });
    setEditing(true);
    setPage("Quotations");
  };
  const action = async (q: Quote, verb: string) =>
    run(async () => {
      const d = await api(`quotes/${q.id}/${verb}/`, "POST", {});
      await load();
      if (verb === "duplicate") {
        setActive(d);
        setEditing(true);
      } else {
        setActive(d);
        setEditing(false);
      }
      setNotice(
        verb === "finalise"
          ? "Version finalised. Your inputs and reference rate are now locked."
          : verb === "duplicate"
            ? "New draft revision created."
            : "Draft archived.",
      );
    });
  if (boot) return <div className="loading">Opening your workspace…</div>;
  if (!user)
    return (
      <Login
        error={error}
        busy={busy}
        onSubmit={(name, password, register) =>
          run(async () => {
            const d = await api(
              `auth/${register ? "register" : "login"}/`,
              "POST",
              { username: name, password },
            );
            await load();
            setUser(d.user);
          })
        }
      />
    );
  const reviews = quotes.filter(
    (q) =>
      q.status === "draft" &&
      (q.calculation_stale || q.last_calculation?.needs_review),
  );
  const nextDraft = quotes.find((q) => q.status === "draft");
  const visible = quotes.filter(
    (q) =>
      (filter === "all" ||
        (filter === "review"
          ? q.status === "draft" &&
            (q.calculation_stale || q.last_calculation?.needs_review)
          : q.status === filter)) &&
      `${q.title} ${q.client_name} QG-${String(q.id).padStart(4, "0")} ${q.currency}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  );
  visible.sort((a, b) =>
    sort === "title"
      ? a.title.localeCompare(b.title)
      : sort === "client"
        ? a.client_name.localeCompare(b.client_name) || b.id - a.id
        : b.id - a.id,
  );
  return (
    <div className="shell">
      <a className="skip-link" href="#workspace-content">
        Skip to workspace
      </a>
      <QuickSearch
        open={commandOpen}
        close={() => setCommandOpen(false)}
        quotes={quotes}
        clients={clients}
        newQuote={fresh}
        navigate={(name) => {
          setPage(name);
          setActive(null);
          setError("");
        }}
        selectQuote={open}
        selectClient={(client) => {
          setPage("Clients");
          setEditClient(client);
          setShowClient(true);
          setError("");
        }}
      />
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={() => {
            setPage("Dashboard");
            setActive(null);
          }}
        >
          <span className="brand-icon">
            <ShieldCheck size={23} />
          </span>
          QuoteGuard<span className="brand-dot">.</span>
        </a>
        <div className="workspace-label">FREELANCER WORKSPACE</div>
        <nav>
          {[
            ["Dashboard", LayoutDashboard],
            ["Quotations", FileText],
            ["Clients", Users],
            ["Cache Lab", FlaskConical],
          ].map(([name, Icon]: any) => (
            <button
              key={name}
              aria-current={page === name ? "page" : undefined}
              className={page === name ? "nav active" : "nav"}
              onClick={() => {
                setPage(name);
                setActive(null);
                setError("");
              }}
            >
              <Icon size={19} />
              {name}
              {name === "Quotations" && (
                <span className="nav-count">{quotes.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="reference-card">
            <span className="live-dot" />
            Reference rates
            <p>
              Quote thoughtfully.
              <br />
              Keep your margin in view.
            </p>
            <small>Powered by Frankfurter / ECB</small>
          </div>
          <div className="profile">
            <span className="avatar">
              {user.username.slice(0, 2).toUpperCase()}
            </span>
            <div>
              <strong>{user.username}</strong>
              <small>INR home currency</small>
            </div>
            <button
              aria-label="Sign out"
              onClick={() =>
                run(async () => {
                  workspaceEpoch.current += 1;
                  await api("auth/logout/", "POST", {});
                  setUser(null);
                  setActive(null);
                  setQuotes([]);
                  setClients([]);
                  setLab({});
                  setLabResult(null);
                  setPage("Dashboard");
                  setSearch("");
                  setFilter("all");
                  setShowClient(false);
                  setEditClient(null);
                  setCommandOpen(false);
                })
              }
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <main id="workspace-content" tabIndex={-1}>
        <header className="topbar">
          <span>
            Workspace <ChevronRight size={14} /> <strong>{page}</strong>
          </span>
          <button
            className="quick-search-trigger"
            aria-label="Open quick search"
            onClick={() => setCommandOpen(true)}
          >
            <span>Find anything</span>
            <kbd>⌘ K</kbd>
          </button>
          <span className="tag">INR → Global</span>
          <button
            className="mobile-signout"
            aria-label="Sign out"
            onClick={() =>
              run(async () => {
                workspaceEpoch.current += 1;
                await api("auth/logout/", "POST", {});
                setUser(null);
                setActive(null);
                setQuotes([]);
                setClients([]);
                setLab({});
                setLabResult(null);
                setPage("Dashboard");
                setSearch("");
                setFilter("all");
                setShowClient(false);
                setEditClient(null);
                setCommandOpen(false);
              })
            }
          >
            <LogOut size={16} />
          </button>
        </header>
        <div className="content">
          {error && (
            <div className="message error" role="alert">
              <span>{error}</span>
              {conflict && active?.id && (
                <button className="secondary" disabled={busy} onClick={() => run(async () => {
                  setActive(await api(`quotes/${active.id}/`));
                  setEditing(false);
                  await load();
                  setNotice("Latest draft loaded. Review it before retrying your action.");
                })}>{editing ? "Discard edits and reload" : "Reload latest draft"}</button>
              )}
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <X size={17} />
              </button>
            </div>
          )}
          {notice && (
            <div className="message success" role="status">
              {notice}
            </div>
          )}
          {page === "Dashboard" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">YOUR BUSINESS, IN BALANCE</div>
                  <h1>Price with confidence.</h1>
                  <p>Better quotations. Clearer margins. No guesswork.</p>
                </div>
                <button className="primary" onClick={fresh}>
                  <Plus size={18} />
                  New quotation
                </button>
              </div>
              <div className="stats">
                <Stat
                  label="TOTAL QUOTATIONS"
                  value={String(quotes.length)}
                  note="Every project, one workspace"
                />
                <Stat
                  label="ACTIVE DRAFTS"
                  value={String(
                    quotes.filter((q) => q.status === "draft").length,
                  )}
                  note="Room to refine before you send"
                />
                <Stat
                  label="FINALISED VERSIONS"
                  value={String(
                    quotes.filter((q) => q.status === "finalised").length,
                  )}
                  note="Locked prices & reference rates"
                />
                <Stat
                  label="NEED YOUR REVIEW"
                  value={String(reviews.length)}
                  note="Drafts to recalculate or reprice"
                  alert={reviews.length > 0}
                />
              </div>
              <section className="focus-board" aria-label="Next steps">
                <div className="focus-story">
                  <span className="eyebrow">THE NEXT GOOD MOVE</span>
                  <h2>
                    {!quotes.length
                      ? "Your next chapter starts here."
                      : reviews.length
                        ? "Good work. Stronger margins."
                        : "A little clarity. A lot of possibility."}
                  </h2>
                  <p>
                    {!quotes.length
                      ? "Add a client, build your costs, and turn your next project into a considered price."
                      : reviews.length
                        ? `${reviews.length} draft${reviews.length === 1 ? " needs" : "s need"} a fresh look. Revisit the numbers before you share a price.`
                        : "Your workspace is ready. Pick up a draft or put your next idea into motion."}
                  </p>
                  <button
                    className="focus-action"
                    onClick={
                      reviews.length
                        ? () => open(reviews[0])
                        : nextDraft
                          ? () => open(nextDraft)
                          : fresh
                    }
                  >
                    {reviews.length
                      ? "Review a margin"
                      : nextDraft
                        ? "Continue latest draft"
                        : "Build a quotation"}{" "}
                    <ArrowUpRight size={19} />
                  </button>
                  <div className="focus-caption">
                    <ShieldCheck size={16} /> Your costs stay private. Your
                    pricing stays considered.
                  </div>
                </div>
                <div className="workflow-steps">
                  <span className="eyebrow">FROM IDEA TO SEND-READY</span>
                  <div>
                    <span className="step-index">01</span>
                    <div>
                      <strong>Know your costs</strong>
                      <p>Scope, time and expenses. All in INR.</p>
                    </div>
                  </div>
                  <div>
                    <span className="step-index">02</span>
                    <div>
                      <strong>Find your price</strong>
                      <p>Account for margin, fees and reference rates.</p>
                    </div>
                  </div>
                  <div>
                    <span className="step-index">03</span>
                    <div>
                      <strong>Make it yours. Lock it in.</strong>
                      <p>Review, finalise and export a client PDF.</p>
                    </div>
                  </div>
                </div>
              </section>
              <PortfolioInsights quotes={quotes} />
              <div className="section-heading">
                <h2>Recent quotations</h2>
                <button
                  className="text-button"
                  onClick={() => setPage("Quotations")}
                >
                  View all <ArrowUpRight size={17} />
                </button>
              </div>
              <QuoteTable quotes={quotes.slice(0, 6)} open={open} />
              {reviews.length > 0 && (
                <section className="review-box">
                  <h2>Margins to revisit</h2>
                  {reviews.map((q) => (
                    <button key={q.id} onClick={() => open(q)}>
                      {q.title} ·{" "}
                      {q.calculation_stale
                        ? "Recalculation needed"
                        : `${pct(q.last_calculation.margin)} actual / ${pct(q.target_margin)} target`}{" "}
                      <ArrowUpRight size={16} />
                    </button>
                  ))}
                </section>
              )}
              <p className="footnote">
                Reference rates are not guaranteed bank settlement rates. Fees
                are estimates; taxes are not included.
              </p>
            </>
          )}
          {page === "Quotations" && !active && (
            <>
              <div className="page-heading">
                <div className="heading">
                  <div className="eyebrow">FROM DRAFT TO DELIVERY</div>
                  <h1>Quotations</h1>
                  <p>Every price, with its reasoning intact.</p>
                </div>
                <button className="primary" onClick={fresh}>
                  <Plus size={18} />
                  New quotation
                </button>
              </div>
              <div className="toolbar">
                <input
                  aria-label="Search quotations"
                  placeholder="Search projects, clients, IDs or currencies…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <select
                  aria-label="Filter status"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  <option value="all">All statuses</option>
                  <option value="draft">Draft</option>
                  <option value="finalised">Finalised</option>
                  <option value="archived">Archived</option>
                  <option value="review">Needs review</option>
                </select>
              </div>
              <div className="collection-meta">
                <span aria-live="polite">
                  {visible.length} of {quotes.length} quotations
                </span>
                <label>
                  Sort by{" "}
                  <select
                    aria-label="Sort quotations"
                    value={sort}
                    onChange={(e) => setSort(e.target.value)}
                  >
                    <option value="recent">Newest first</option>
                    <option value="title">Project name</option>
                    <option value="client">Client name</option>
                  </select>
                </label>
                {(search || filter !== "all") && (
                  <button
                    className="text-button"
                    onClick={() => {
                      setSearch("");
                      setFilter("all");
                    }}
                  >
                    Clear filters <X size={14} />
                  </button>
                )}
              </div>
              {visible.length ? (
                <QuoteTable quotes={visible} open={open} />
              ) : (
                <section className="collection-empty">
                  <FileText size={32} />
                  <h2>
                    {quotes.length
                      ? "No matching quotations"
                      : "Make room for your next project."}
                  </h2>
                  <p>
                    {quotes.length
                      ? "Try another client, project title, currency or status."
                      : "Start with your project costs. Build a price you can explain."}
                  </p>
                  <button
                    className="primary"
                    onClick={
                      quotes.length
                        ? () => {
                            setSearch("");
                            setFilter("all");
                          }
                        : fresh
                    }
                  >
                    {quotes.length
                      ? "Reset search and filters"
                      : "Create your first quotation"}
                    <ArrowUpRight size={17} />
                  </button>
                </section>
              )}
            </>
          )}
          {page === "Quotations" &&
            active &&
            (editing ? (
              <Editor
                quote={active}
                clients={clients}
                busy={busy}
                onCancel={() =>
                  run(async () => {
                    if (active.id) setActive(await api(`quotes/${active.id}/`));
                    else setActive(null);
                    setEditing(false);
                  })
                }
                onSave={(q) =>
                  run(async () => {
                    const d = await api(
                      q.id ? `quotes/${q.id}/` : "quotes/",
                      q.id ? "PATCH" : "POST",
                      q,
                    );
                    setActive(d);
                    setEditing(false);
                    await load();
                    setNotice(
                      "Draft saved. Calculate to review the latest pricing.",
                    );
                  })
                }
              />
            ) : (
              <Detail
                quote={active}
                quotes={quotes}
                busy={busy}
                back={() => setActive(null)}
                edit={() => setEditing(true)}
                action={action}
                applyPlan={async (result) => {
                  const patched = await api(`quotes/${active.id}/`, "PATCH", {
                    version: result.input_version,
                    target_margin: result.target_margin,
                    proposed_price: result.gross_price,
                  });
                  setActive(patched);
                  await load();
                  await api(`quotes/${active.id}/calculate/`, "POST", {});
                  setActive(await api(`quotes/${active.id}/`));
                  await load();
                  setNotice("Planned target and price applied to this draft.");
                }}
                calculate={(refresh) =>
                  run(async () => {
                    const d = await api(
                      `quotes/${active.id}/calculate/`,
                      "POST",
                      { refresh },
                    );
                    const q = await api(`quotes/${active.id}/`);
                    setActive({ ...q, last_calculation: d });
                    await load();
                  })
                }
              />
            ))}
          {page === "Clients" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">GOOD WORK STARTS WITH PEOPLE</div>
                  <h1>Your clients</h1>
                  <p>A home for the people you work with.</p>
                </div>
                <button
                  className="primary"
                  onClick={() => {
                    setEditClient(null);
                    setShowClient(true);
                    setError("");
                  }}
                >
                  <Plus size={18} />
                  Add client
                </button>
              </div>
              {showClient && (
                <ClientForm
                  key={editClient?.id || "new"}
                  initial={editClient}
                  busy={busy}
                  close={() => {
                    setShowClient(false);
                    setEditClient(null);
                  }}
                  save={(d) =>
                    run(async () => {
                      await api(
                        editClient ? `clients/${editClient.id}/` : "clients/",
                        editClient ? "PATCH" : "POST",
                        d,
                      );
                      await load();
                      setShowClient(false);
                      setNotice(
                        editClient
                          ? "Client updated. Finalised quotes keep their original client details."
                          : "Client added. You can now create their quotation.",
                      );
                    })
                  }
                />
              )}
              <div className="client-grid">
                {clients.map((c) => (
                  <article className="client-card" key={c.id}>
                    <span className="client-avatar">
                      {c.name
                        .split(" ")
                        .map((n) => n[0])
                        .slice(0, 2)
                        .join("")}
                    </span>
                    <span className="tag">{c.currency}</span>
                    <h2>{c.name}</h2>
                    <p>{c.company || "Independent client"}</p>
                    <small>{c.email || "No email supplied"}</small>
                    <hr />
                    <span>
                      {quotes.filter((q) => q.client === c.id).length}{" "}
                      quotations
                    </span>
                    <button
                      className="text-button client-edit"
                      aria-label={`Edit client ${c.name}`}
                      onClick={() => {
                        setEditClient(c);
                        setShowClient(true);
                        setError("");
                      }}
                    >
                      Edit details <ArrowUpRight size={15} />
                    </button>
                  </article>
                ))}
              </div>
              {!clients.length && (
                <div className="empty">
                  Add your first client to start building quotations.
                </div>
              )}
            </>
          )}
          {page === "Cache Lab" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">
                    TOPIC 6 · REDIS CACHING & INVALIDATION
                  </div>
                  <h1>Inside the cache.</h1>
                  <p>Observe the real work behind a faster lookup.</p>
                </div>
                <span className="badge">
                  {lab.redis_available
                    ? "Redis connected"
                    : "Redis unavailable"}
                </span>
              </div>
              <CacheReplay quotes={quotes} request={api} onChanged={async () => {
                const epoch = workspaceEpoch.current;
                await Promise.all([load(), api("lab/").then(data => {
                  if (epoch === workspaceEpoch.current) setLab(data);
                })]);
              }} />
              <section className="cache-guide" aria-label="Cache experiment guide">
                <div><span className="eyebrow">WATCH THE LIFECYCLE</span><h2>One lookup. Four things to learn.</h2>
                <p>Run one step at a time. Each result comes from the server.</p></div>
                <ol><li><strong>01 / Miss</strong>Cold lookup fetches the reference response.</li>
                <li><strong>02 / Hit</strong>Warm lookup reuses the isolated cached value.</li>
                <li><strong>03 / Expire</strong>Start the three-second key, then inspect it.</li>
                <li><strong>04 / Invalidate</strong>Edit a draft cost, save, and recalculate.</li></ol>
              </section>
              <div className="stats">
                <Stat
                  label="CACHE HITS"
                  value={String(lab.hits || 0)}
                  note="Rate lookups served from Redis"
                />
                <Stat
                  label="CACHE MISSES"
                  value={String(lab.misses || 0)}
                  note="Rate lookups without a cached value"
                />
                <Stat
                  label="HIT RATIO"
                  value={pct(lab.hit_ratio || 0)}
                  note="Owner-scoped · last 24 hours"
                />
                <Stat
                  label="UPSTREAM REQUESTS"
                  value={String(lab.upstream || 0)}
                  note="Requests initiated by this owner"
                />
              </div>
              <section className="panel">
                <h2>Calculation telemetry</h2>
                <div className="lab-result">
                  <div>
                    <small>CALCULATION HITS</small>
                    <strong>{lab.calculation_hit || 0}</strong>
                  </div>
                  <div>
                    <small>CALCULATION MISSES</small>
                    <strong>{lab.calculation_miss || 0}</strong>
                  </div>
                  <div>
                    <small>LAST CALCULATION / CACHE WORK</small>
                    <strong>
                      {lab.last_calculation_duration_ms == null ? "Not measured" : `${Number(lab.last_calculation_duration_ms).toFixed(3)} ms`}
                    </strong>
                  </div>
                </div>
                <p className="footnote">
                  Calculation/cache timing includes key construction, Redis
                  work, and any calculation or price adoption. It excludes the
                  reference-rate lookup.
                </p>
              </section>
              <section className="panel">
                <h2>Lookup experiment</h2>
                <p>
                  Choose Cold lookup once, then Warm lookup to reuse that value.
                  Repeating Cold lookup fetches again. Refresh replaces the shared rate
                  observation used by drafts; dependent calculations use its version.
                </p>
                <div className="button-row">
                  {[
                    ["cold", "Cold lookup"],
                    ["warm", "Warm lookup"],
                    ["refresh", "Refresh rate"],
                  ].map(([operation, title]) => (
                    <button
                      disabled={busy}
                      key={operation}
                      className="secondary"
                      onClick={() =>
                        run(async () => {
                          setLabResult(
                            await api("lab/", "POST", {
                              operation,
                              currency: "USD",
                            }),
                          );
                          setLab(await api("lab/"));
                          await load();
                        })
                      }
                    >
                      {title}
                    </button>
                  ))}
                  <button
                    disabled={busy}
                    className="secondary"
                    onClick={() =>
                      run(async () =>
                        setLabResult(
                          await api("lab/", "POST", {
                            operation: "expiry",
                            start: true,
                          }),
                        ),
                      )
                    }
                  >
                    Start 3s expiry
                  </button>
                  <button
                    disabled={busy}
                    className="secondary"
                    onClick={() =>
                      run(async () =>
                        setLabResult(
                          await api("lab/", "POST", { operation: "expiry" }),
                        ),
                      )
                    }
                  >
                    Inspect expiry
                  </button>
                </div>
                {busy && <p role="status" className="footnote">Running the request…</p>}
                {labResult && (
                  <div className="cache-observation" role="status" aria-live="polite" aria-label="Latest cache observation">
                    <div className="lab-result">
                      <div><small>RESULT</small><strong>{labResult.cache || (labResult.value ? "Demo key exists" : "Demo key expired / missing")}</strong></div>
                      <div><small>TTL</small><strong>{labResult.ttl == null ? "Not stored" : labResult.ttl === -2 ? "Expired or missing" : labResult.ttl === -1 ? "No expiry" : `${labResult.ttl} seconds`}</strong></div>
                      <div><small>SERVER LOOKUP TIME</small><strong>{labResult.cache && typeof labResult.duration_ms === "number" ? `${labResult.duration_ms.toFixed(3)} ms` : "Not measured"}</strong></div>
                      <div className="wide"><small>RATE VERSION</small><code>{labResult.version || "Isolated expiry namespace"}</code></div>
                    </div>
                    {labResult.source && <p className="observation-source">{labResult.source} · Observation date: {labResult.actual_date || "Not supplied"}</p>}
                    <p className="footnote">Server timing is one observation, not browser round-trip latency or a benchmark. Missing measurements are not zero.</p>
                  </div>
                )}
              </section>
              <section className="panel">
                <h2>Invalidation journal</h2>
                <p>
                  Save a changed cost or fee on a draft, then calculate again to
                  inspect the new input version.
                </p>
                <button className="text-button" onClick={() => { setPage("Quotations"); setActive(null); }}>Open drafts to change a source input <ArrowUpRight size={16} /></button>
                {!lab.events?.length && <p className="journal-empty">No changes recorded yet. Save a draft to start its audit trail.</p>}
                {(lab.events || []).map((e: any, i: number) => (
                  <div className="event" key={i}>
                    <span className="event-dot" />
                    <div>
                      <strong>{e.cause}</strong>
                      <small>
                        {new Date(e.created_at).toLocaleString()}
                        {e.quote_id &&
                          ` · QG-${String(e.quote_id).padStart(4, "0")}`}
                      </small>
                    </div>
                  </div>
                ))}
              </section>
              <p className="footnote">
                Misses include lock waiters; upstream requests count attempts.
                Historical reference rates use a longer TTL. Redis failure falls
                back to bounded upstream work, with no invented rates.
              </p>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
function Stat({
  label,
  value,
  note,
  alert = false,
}: {
  label: string;
  value: string;
  note: string;
  alert?: boolean;
}) {
  return (
    <div className={"stat " + (alert ? "warning" : "")}>
      <small>{label}</small>
      <strong>{value}</strong>
      <span>{note}</span>
    </div>
  );
}
function QuoteTable({
  quotes,
  open,
}: {
  quotes: Quote[];
  open: (q: Quote) => void;
}) {
  return (
    <div className="table-wrap quotation-table">
      <table>
        <thead>
          <tr>
            <th>PROJECT / CLIENT</th>
            <th>PRICE</th>
            <th>MARGIN</th>
            <th>STATUS</th>
            <th aria-label="Open" />
          </tr>
        </thead>
        <tbody>
          {quotes.map((q) => {
            const c =
              q.snapshot || (q.calculation_stale ? null : q.last_calculation);
            return (
              <tr key={q.id}>
                <td>
                  <button className="project-link" onClick={() => open(q)}>
                    {q.title}
                  </button>
                  <small>
                    {q.client_name} · QG-{String(q.id).padStart(4, "0")} / v
                    {q.revision}
                  </small>
                </td>
                <td data-label="Price">
                  {c ? (
                    money(c.gross_price, q.currency)
                  ) : (
                    <span className="muted">
                      {q.calculation_stale ? "Recalculate" : "Not calculated"}
                    </span>
                  )}
                  <small>{q.currency}</small>
                </td>
                <td data-label="Margin">
                  {c ? pct(c.margin) : "—"}
                  <small>Target {pct(q.target_margin)}</small>
                </td>
                <td data-label="Status">
                  <span className={"badge " + q.status}>{q.status}</span>
                </td>
                <td>
                  <button
                    aria-label={`Open ${q.title}`}
                    onClick={() => open(q)}
                  >
                    <ArrowUpRight size={19} />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!quotes.length && (
        <div className="empty">
          No quotations here yet. Create one to get started.
        </div>
      )}
    </div>
  );
}
function Login({
  error,
  busy,
  onSubmit,
}: {
  error: string;
  busy: boolean;
  onSubmit: (u: string, p: string, r: boolean) => void;
}) {
  const [reg, setReg] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  return (
    <div className="login">
      <section className="login-story">
        <a className="brand">
          <ShieldCheck />
          QuoteGuard.
        </a>
        <div>
          <span className="eyebrow">
            YOUR CRAFT. YOUR CURRENCY. YOUR MARGIN.
          </span>
          <h1>
            Great work.
            <br />
            Thoughtful pricing.
          </h1>
          <p>
            A calmer way to quote international projects.
            <br />
            Built for independent professionals.
          </p>
        </div>
        <small>INR costs · International clients · Clear decisions</small>
      </section>
      <section className="login-form">
        <div>
          <span className="eyebrow">WELCOME TO YOUR WORKSPACE</span>
          <h2>{reg ? "Create your account" : "Good to have you here."}</h2>
          <p>
            {reg
              ? "Start pricing your work with confidence."
              : "Sign in to keep your next project in balance."}
          </p>
          {error && (
            <div className="message error" role="alert">
              {error}
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const d = new FormData(e.currentTarget);
              onSubmit(
                String(d.get("username")),
                String(d.get("password")),
                reg,
              );
            }}
          >
            <Field label="Username">
              <input name="username" autoComplete="username" required />
            </Field>
            <Field label="Password">
              <input
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete={reg ? "new-password" : "current-password"}
                required
                minLength={reg ? 8 : undefined}
              />
            </Field>
            <button
              type="button"
              className="password-toggle"
              aria-pressed={showPassword}
              onClick={() => setShowPassword(!showPassword)}
            >
              {showPassword ? "Hide password" : "Show password"}
            </button>
            <button disabled={busy} className="primary full">
              {busy ? "Opening…" : reg ? "Create account" : "Sign in"}
              <ArrowUpRight size={18} />
            </button>
          </form>
          <button className="text-button" onClick={() => setReg(!reg)}>
            {reg
              ? "Already have an account? Sign in"
              : "New here? Create an account"}
          </button>
          <div className="demo-note">
            <strong>Explore the demonstration</strong>
            <p>
              Synthetic records only.
              <br />
              <code>demo</code> / <code>DemoQuoteGuard!2026</code>
            </p>
            <button type="button" className="secondary full" disabled={busy}
              onClick={() => onSubmit("demo", "DemoQuoteGuard!2026", false)}>
              Explore demo workspace <ArrowUpRight size={18} />
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
function ClientForm({
  initial,
  save,
  close,
  busy,
}: {
  initial?: Client | null;
  save: (v: any) => void;
  close: () => void;
  busy: boolean;
}) {
  return (
    <form
      className="panel"
      onSubmit={(e) => {
        e.preventDefault();
        save(Object.fromEntries(new FormData(e.currentTarget)));
      }}
    >
      <h2>{initial ? "Edit client" : "Add a client"}</h2>
      <div className="form-grid">
        <Field label="Client name">
          <input
            required
            name="name"
            maxLength={160}
            defaultValue={initial?.name || ""}
          />
        </Field>
        <Field label="Company">
          <input name="company" defaultValue={initial?.company || ""} />
        </Field>
        <Field label="Email">
          <input
            name="email"
            type="email"
            defaultValue={initial?.email || ""}
          />
        </Field>
        <Field label="Billing currency">
          <select name="currency" defaultValue={initial?.currency || "USD"}>
            {currencies.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
      </div>
      <div className="button-row">
        <button disabled={busy} className="primary">
          Save client
        </button>
        <button type="button" className="secondary" onClick={close}>
          Cancel
        </button>
      </div>
    </form>
  );
}
function Editor({
  quote,
  clients,
  busy,
  onSave,
  onCancel,
}: {
  quote: Quote;
  clients: Client[];
  busy: boolean;
  onSave: (q: Quote) => void;
  onCancel: () => void;
}) {
  const [q, setQ] = useState(quote);
  const update = (k: string, v: any) => setQ({ ...q, [k]: v });
  return (
    <>
      <button className="text-button" onClick={onCancel}>
        <ArrowLeft size={16} />
        Back to quotation
      </button>
      <div className="page-heading">
        <div>
          <div className="eyebrow">DRAFT · VERSION {q.revision}</div>
          <h1>
            {q.id ? "Refine your quotation." : "Start with the essentials."}
          </h1>
          <p>Set your scope and costs. We’ll take care of the numbers.</p>
        </div>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave(q);
        }}
      >
        <div className="editor-grid">
          <div>
            <section className="panel">
              <h2>Project details</h2>
              <div className="form-grid">
                <Field label="Project title">
                  <input
                    required
                    value={q.title}
                    onChange={(e) => update("title", e.target.value)}
                  />
                </Field>
                <Field label="Client">
                  <select
                    value={q.client}
                    onChange={(e) => {
                      const c = clients.find(
                        (c) => c.id === Number(e.target.value),
                      )!;
                      setQ({ ...q, client: c.id, currency: c.currency });
                    }}
                  >
                    {clients.map((c) => (
                      <option value={c.id} key={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Valid until">
                  <input
                    required
                    type="date"
                    value={q.valid_until}
                    onChange={(e) => update("valid_until", e.target.value)}
                  />
                </Field>
                <Field label="Billing currency">
                  <select
                    value={q.currency}
                    onChange={(e) => update("currency", e.target.value)}
                  >
                    {currencies.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field label="Scope of work">
                <textarea
                  value={q.description}
                  onChange={(e) => update("description", e.target.value)}
                />
              </Field>
              <Field label="Client-facing notes / payment terms">
                <textarea
                  value={q.notes}
                  onChange={(e) => update("notes", e.target.value)}
                />
              </Field>
            </section>
            <section className="panel">
              <h2>
                Project costs <span className="tag">INR</span>
              </h2>
              <p>
                Internal only. These costs never appear on the client quotation.
              </p>
              {q.costs.map((c, i) => (
                <div className="cost-row" key={i}>
                  <Field label="Description">
                    <input
                      required
                      aria-label={`Cost description ${i + 1}`}
                      value={c.description}
                      onChange={(e) =>
                        update(
                          "costs",
                          q.costs.map((v, j) =>
                            j === i ? { ...v, description: e.target.value } : v,
                          ),
                        )
                      }
                    />
                  </Field>
                  <Field label="Quantity">
                    <input
                      type="number"
                      step=".001"
                      min="0"
                      required
                      aria-label={`Quantity ${i + 1}`}
                      value={c.quantity}
                      onChange={(e) =>
                        update(
                          "costs",
                          q.costs.map((v, j) =>
                            j === i ? { ...v, quantity: e.target.value } : v,
                          ),
                        )
                      }
                    />
                  </Field>
                  <Field label="Unit cost (INR)">
                    <input
                      type="number"
                      step=".0001"
                      min="0"
                      required
                      aria-label={`Unit cost ${i + 1}`}
                      value={c.unit_cost}
                      onChange={(e) =>
                        update(
                          "costs",
                          q.costs.map((v, j) =>
                            j === i ? { ...v, unit_cost: e.target.value } : v,
                          ),
                        )
                      }
                    />
                  </Field>
                  <button
                    type="button"
                    aria-label={`Remove cost ${i + 1}`}
                    onClick={() =>
                      update(
                        "costs",
                        q.costs.filter((_, j) => i !== j),
                      )
                    }
                  >
                    <X size={16} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="text-button"
                onClick={() =>
                  update("costs", [
                    ...q.costs,
                    { description: "", quantity: "1", unit_cost: "0" },
                  ])
                }
              >
                <Plus size={16} />
                Add cost item
              </button>
            </section>
          </div>
          <div>
            <section className="panel pricing-panel">
              <h2>Protect your margin.</h2>
              <Field
                label="Target margin (%)"
                hint="Margin = profit ÷ net revenue. Markup = profit ÷ cost."
              >
                <input
                  title="Margin uses net revenue; markup uses cost."
                  required
                  type="number"
                  min="0"
                  max="99.9999"
                  step=".0001"
                  value={ratioToPercent(q.target_margin)}
                  onChange={(e) =>
                    update(
                      "target_margin",
                      percentToRatio(e.target.value),
                    )
                  }
                />
              </Field>
              <Field label="Estimated payment fee (%)">
                <input
                  required
                  type="number"
                  min="0"
                  max="99.9999"
                  step=".0001"
                  value={ratioToPercent(q.fee_percent)}
                  onChange={(e) =>
                    update("fee_percent", percentToRatio(e.target.value))
                  }
                />
              </Field>
              <Field label={`Fixed payment fee (${q.currency})`}>
                <input
                  required
                  type="number"
                  min="0"
                  step=".0001"
                  value={q.fixed_fee}
                  onChange={(e) => update("fixed_fee", e.target.value)}
                />
              </Field>
              <Field
                label={`Your proposed price (${q.currency})`}
                hint="Leave blank to use the upward-rounded suggestion."
              >
                <input
                  type="number"
                  min="0"
                  step=".0001"
                  value={q.proposed_price || ""}
                  onChange={(e) =>
                    update("proposed_price", e.target.value || null)
                  }
                />
              </Field>
              <Field
                label="Reference rate date"
                hint="Leave blank for latest available. Earlier returned dates are shown explicitly."
              >
                <input
                  type="date"
                  max={new Date().toISOString().slice(0, 10)}
                  value={q.rate_date || ""}
                  onChange={(e) => update("rate_date", e.target.value || null)}
                />
              </Field>
              <hr />
              <p className="footnote">
                No taxes are included. Payment fees are estimates. Final
                calculations use Decimal arithmetic on the server.
              </p>
              <button disabled={busy} className="primary full">
                {busy ? "Saving…" : "Save draft"}
                <Check size={17} />
              </button>
            </section>
          </div>
        </div>
      </form>
    </>
  );
}
function Detail({
  quote: q,
  quotes,
  busy,
  back,
  edit,
  action,
  calculate,
  applyPlan,
}: {
  quote: Quote;
  quotes: Quote[];
  busy: boolean;
  back: () => void;
  edit: () => void;
  action: (q: Quote, a: string) => void;
  calculate: (r: boolean) => void;
  applyPlan: (result: any) => Promise<any>;
}) {
  const c = q.snapshot || (q.calculation_stale ? null : q.last_calculation);
  const [scenario, setScenario] = useState("10");
  const [extra, setExtra] = useState<any>(null);
  const [scenarioError, setScenarioError] = useState("");
  const [scenarioBusy, setScenarioBusy] = useState(false);
  useEffect(() => {
    setExtra(null);
    setScenarioError("");
  }, [q.id, q.version, c?.rate_provenance?.version, c?.gross_price]);
  const provenance = c?.rate_provenance;
  return (
    <>
      <button className="text-button" onClick={back}>
        <ArrowLeft size={16} />
        All quotations
      </button>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            QG-{String(q.id).padStart(4, "0")} · VERSION {q.revision}
          </div>
          <h1>{q.title}</h1>
          <p>
            {q.client_name} · Valid until {q.valid_until}
          </p>
        </div>
        <span className={"badge " + q.status}>{q.status}</span>
      </div>
      {q.calculation_stale && (
        <p role="status" className="notice">
          Draft inputs or reference rate changed. Recalculate before reviewing
          this price.
        </p>
      )}
      <div className="button-row">
        {q.status === "draft" && (
          <>
            <button
              disabled={busy}
              className="primary"
              onClick={() => calculate(false)}
            >
              <RefreshCw size={17} />
              Calculate price
            </button>
            <button className="secondary" onClick={edit}>
              Edit draft
            </button>
            <button
              disabled={busy}
              className="secondary"
              onClick={() => calculate(true)}
            >
              Refresh reference rate
            </button>
            <button
              disabled={busy}
              className="secondary"
              onClick={() => action(q, "finalise")}
            >
              <Check size={16} />
              Finalise version
            </button>
            <button
              disabled={busy}
              className="secondary"
              onClick={() => action(q, "archive")}
            >
              <Archive size={16} />
              Archive
            </button>
          </>
        )}
        <button
          disabled={busy}
          className="secondary"
          onClick={() => action(q, "duplicate")}
        >
          <Copy size={16} />
          Create revision
        </button>
        {q.status === "finalised" && (
          <>
            <a className="primary" href={`/api/quotes/${q.id}/export/`}>
              <Download size={16} />
              Client PDF
            </a>
            <a
              className="secondary"
              href={`/api/quotes/${q.id}/export/?kind=csv`}
            >
              Internal CSV
            </a>
          </>
        )}
      </div>
      {q.status === "finalised" && (
        <div className="message success">
          <ShieldCheck size={19} />
          Finalised snapshot. Future rate changes leave this version untouched.
        </div>
      )}
      {c ? (
        <>
          {q.status !== "archived" && (
            <MarginPlanner
              pending={busy}
              quote={q}
              request={(margin) =>
                api(`quotes/${q.id}/plan/`, "POST", { target_margin: margin })
              }
              apply={applyPlan}
            />
          )}
          <div className="pricing-summary">
            <div>
              <small>CLIENT-FACING PROJECT PRICE</small>
              <strong>{money(c.gross_price, q.currency)}</strong>
              <span>
                Suggested {money(c.suggested_price, q.currency)} · Fees{" "}
                {money(c.fees, q.currency)}
              </span>
            </div>
            <div>
              <small>ESTIMATED NET REVENUE</small>
              <strong>{money(c.net_revenue)}</strong>
              <span>After estimated payment fees</span>
            </div>
            <div>
              <small>ESTIMATED PROFIT MARGIN</small>
              <strong className={c.needs_review ? "red" : ""}>
                {pct(c.margin)}
              </strong>
              <span>Target {pct(q.target_margin)}</span>
            </div>
          </div>
          {c.needs_review && (
            <div className="message error">
              Review this price: the estimated margin is below target or
              undefined because net revenue is not positive.
            </div>
          )}
          <div className="two-columns">
            <section className="panel">
              <h2>The pricing breakdown</h2>
              {[
                ["Project costs", money(c.cost)],
                ["Net revenue", money(c.net_revenue)],
                ["Estimated profit", money(c.profit)],
                [
                  "Payment fee",
                  `${pct(q.fee_percent)} + ${money(q.fixed_fee, q.currency)}`,
                ],
                ["Target margin", pct(q.target_margin)],
              ].map(([k, v]) => (
                <div className="breakdown" key={k}>
                  <span>{k}</span>
                  <strong>{v}</strong>
                </div>
              ))}
              <p className="footnote">
                Home currency: INR. Billing: {q.currency}. Margin is profit
                divided by net revenue, after fees. Taxes are not included.
              </p>
              {c.change && (
                <div className="change-note">
                  Previous calculation: margin {pct(c.change.old_margin)} →{" "}
                  {pct(c.change.new_margin)}; profit{" "}
                  {money(c.change.old_profit)} → {money(c.change.new_profit)};
                  rate {c.change.old_rate} → {c.change.new_rate}.
                </div>
              )}
            </section>
            <section className="panel">
              <h2>Reference rate provenance</h2>
              <strong className="rate-value">
                1 INR = {c.rate} {q.currency}
              </strong>
              <p>{provenance?.source}</p>
              <div className="breakdown">
                <span>Requested date</span>
                <strong>{provenance?.requested_date}</strong>
              </div>
              <div className="breakdown">
                <span>Actual rate date</span>
                <strong>{provenance?.actual_date}</strong>
              </div>
              <div className="breakdown">
                <span>Fetched</span>
                <strong>
                  {provenance?.fetched_at
                    ? new Date(provenance.fetched_at).toLocaleString()
                    : "No external request"}
                </strong>
              </div>
              {provenance?.previous_available_date && (
                <div className="message success">
                  The provider returned the previous available date (
                  {provenance.actual_date}).
                </div>
              )}
              <p className="footnote">
                Reference rate only; bank settlement rates may differ.
              </p>
            </section>
          </div>
          <section className="panel">
            <div className="section-heading">
              <div>
                <h2>What if the rate changes?</h2>
                <p>
                  Hypothetical scenarios. The gross client price stays fixed at{" "}
                  {money(c.gross_price, q.currency)}.
                </p>
              </div>
            </div>
            <div className="scenario-chart">
              {c.scenarios.map((s: any) => (
                <div key={s.change_percent}>
                  <strong>{money(s.profit)}</strong>
                  <div
                    className={
                      "bar " + (Number(s.profit) < 0 ? "negative" : "")
                    }
                    style={{
                      height: Math.max(
                        8,
                        Math.min(
                          110,
                          (Math.abs(Number(s.profit)) /
                            Math.max(
                              ...c.scenarios.map((x: any) =>
                                Math.abs(Number(x.profit)),
                              ),
                              1,
                            )) *
                            110,
                        ),
                      ),
                    }}
                  />
                  <span>
                    {s.change_percent > 0 ? "+" : ""}
                    {s.change_percent}% rate
                  </span>
                </div>
              ))}
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>RATE CHANGE</th>
                    <th>BILLING UNITS / INR</th>
                    <th>NET REVENUE (INR)</th>
                    <th>PROFIT (INR)</th>
                    <th>MARGIN</th>
                  </tr>
                </thead>
                <tbody>
                  {[...c.scenarios, ...(extra ? [extra] : [])].map(
                    (s: any, i: number) => (
                      <tr key={i}>
                        <td>
                          {s.change_percent > 0 ? "+" : ""}
                          {s.change_percent}%
                        </td>
                        <td>{s.rate}</td>
                        <td>{money(s.net_revenue)}</td>
                        <td>{money(s.profit)}</td>
                        <td>{pct(s.margin)}</td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
            <div className="button-row">
              <label className="field">
                Custom change (%)
                <input
                  aria-label="Custom scenario change"
                  type="number"
                  min="-99"
                  max="100"
                  value={scenario}
                  onChange={(e) => setScenario(e.target.value)}
                />
              </label>
              <button
                className="secondary"
                disabled={busy || scenarioBusy}
                onClick={async () => {
                  setScenarioBusy(true);
                  setScenarioError("");
                  try {
                    setExtra(
                      await api(`quotes/${q.id}/scenario/`, "POST", {
                        change_percent: scenario,
                      }),
                    );
                  } catch (e) {
                    setScenarioError((e as Error).message);
                  } finally {
                    setScenarioBusy(false);
                  }
                }}
              >
                Compare scenario
              </button>
              {scenarioError && <p role="alert">{scenarioError}</p>}
            </div>
            <p className="footnote">
              A higher billing-units-per-INR rate converts a fixed foreign price
              into fewer INR. These scenarios are not forecasts.
            </p>
          </section>
        </>
      ) : (
        <section className="empty">
          <h2>Your pricing breakdown will appear here.</h2>
          <p>
            Calculate the price to fetch a reference rate and review your
            margin.
          </p>
        </section>
      )}
      <section className="panel">
        <h2>Scope & revision history</h2>
        <p className="preserve">{q.description || "No scope supplied."}</p>
        <p className="preserve">{q.notes}</p>
        <div className="button-row">
          <span className="badge">Current: v{q.revision}</span>
          {q.parent && <span>Revised from QG-{q.parent}</span>}
          {quotes
            .filter((x) => x.parent === q.id)
            .map((x) => (
              <span className="badge" key={x.id}>
                QG-{x.id} / v{x.revision} · {x.status}
              </span>
            ))}
        </div>
      </section>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
