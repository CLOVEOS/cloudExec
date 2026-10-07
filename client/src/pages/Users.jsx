import { useEffect, useState } from "react";
import api, { errMsg, LANG_COLORS, LANG_LABELS } from "../api";
import Dashboard from "./Dashboard";

const COLUMNS = [
  ["name", "Name"],
  ["runs", "Runs"],
  ["solved", "Solved"],
  ["successRate", "Success"],
  ["skillScore", "Skill"],
  ["percentile", "Pctl"],
  ["currentStreak", "Streak"],
  ["lastActive", "Last active"],
];
const TIER_LABEL = { heavy: "Heavy", medium: "Medium", low: "Low" };
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString() : "—");

export default function Users({ me }) {
  const [query, setQuery] = useState({ q: "", tier: "", level: "", sort: "skillScore", order: "desc", page: 1 });
  const [search, setSearch] = useState("");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [viewing, setViewing] = useState(null); // user row being inspected
  const [exporting, setExporting] = useState(false);

  // Debounce the search box.
  useEffect(() => {
    const t = setTimeout(() => setQuery((q) => (q.q === search ? q : { ...q, q: search, page: 1 })), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    let alive = true;
    api
      .get("/admin/users", { params: { ...query, limit: 50 } })
      .then(({ data }) => {
        if (!alive) return;
        setData(data);
        setError("");
      })
      .catch((e) => alive && setError(errMsg(e)));
    return () => {
      alive = false;
    };
  }, [query]);

  const set = (patch) => setQuery((q) => ({ ...q, page: 1, ...patch }));
  const sortBy = (key) =>
    setQuery((q) => ({ ...q, page: 1, sort: key, order: q.sort === key && q.order === "desc" ? "asc" : "desc" }));

  async function exportCsv() {
    setExporting(true);
    try {
      const { q, tier, level, sort, order } = query;
      const res = await api.get("/admin/users.csv", { params: { q, tier, level, sort, order }, responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cloudexec-users-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setExporting(false);
    }
  }

  if (viewing) {
    return <Dashboard user={me} viewUser={viewing} onBack={() => setViewing(null)} />;
  }

  return (
    <div className="page">
      <div className="analytics-header">
        <h2 className="page-title">
          Users {data && <span className="muted small">· {data.total.toLocaleString()} matching</span>}
        </h2>
        <button className="refresh-btn" onClick={exportCsv} disabled={exporting}>
          {exporting ? "Exporting…" : "⬇ Export CSV"}
        </button>
      </div>

      <div className="users-filters">
        <input
          className="users-search"
          placeholder="Search name, email or college…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={query.tier} onChange={(e) => set({ tier: e.target.value })}>
          <option value="">All activity tiers</option>
          <option value="heavy">Heavy</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <select value={query.level} onChange={(e) => set({ level: e.target.value })}>
          <option value="">All levels</option>
          <option>Expert</option>
          <option>Advanced</option>
          <option>Intermediate</option>
          <option>Beginner</option>
        </select>
        {data?.tiers && (
          <span className="muted small">
            {Object.entries(data.tiers).map(([k, v]) => `${TIER_LABEL[k] || "Real users"}: ${v}`).join(" · ")}
          </span>
        )}
      </div>

      {error && <div className="analytics-error">{error}</div>}
      {!data && !error && <div className="analytics-loading">Loading users…</div>}

      {data && (
        <div className="analytics-card wide users-card">
          <table className="analytics-table users-table">
            <thead>
              <tr>
                {COLUMNS.map(([key, label]) => (
                  <th key={key} className="sortable" onClick={() => sortBy(key)}>
                    {label}
                    {query.sort === key ? (query.order === "desc" ? " ▼" : " ▲") : ""}
                  </th>
                ))}
                <th>Level</th>
                <th>Tier</th>
                <th>Top lang</th>
              </tr>
            </thead>
            <tbody>
              {data.users.map((u) => (
                <tr key={u.id} className="clickable" onClick={() => setViewing(u)} title="Open dashboard">
                  <td>
                    <div>{u.name}{u.role === "admin" && <span className="chip chip-ok admin-chip">admin</span>}</div>
                    <div className="muted small">{u.email}</div>
                  </td>
                  <td>{u.runs.toLocaleString()}</td>
                  <td>{u.solved.toLocaleString()}</td>
                  <td>{u.runs ? `${u.successRate}%` : "—"}</td>
                  <td>{u.skillScore ?? "—"}</td>
                  <td>{u.percentile ?? "—"}</td>
                  <td>{u.currentStreak ?? "—"}</td>
                  <td>{fmtDate(u.lastActive)}</td>
                  <td>{u.level || "—"}</td>
                  <td>{TIER_LABEL[u.activityTier] || "—"}</td>
                  <td>
                    {u.topLanguage ? (
                      <>
                        <span className="lang-dot" style={{ background: LANG_COLORS[u.topLanguage] }} />
                        {LANG_LABELS[u.topLanguage] || u.topLanguage}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
              {!data.users.length && (
                <tr>
                  <td colSpan={COLUMNS.length + 3} className="muted">No users match these filters.</td>
                </tr>
              )}
            </tbody>
          </table>

          <div className="pager">
            <button className="refresh-btn" disabled={data.page <= 1} onClick={() => setQuery((q) => ({ ...q, page: q.page - 1 }))}>
              ← Prev
            </button>
            <span className="muted small">Page {data.page} of {data.pages}</span>
            <button className="refresh-btn" disabled={data.page >= data.pages} onClick={() => setQuery((q) => ({ ...q, page: q.page + 1 }))}>
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
