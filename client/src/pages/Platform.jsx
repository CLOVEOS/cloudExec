import { useEffect, useState } from "react";
import api, { errMsg, LANG_COLORS, LANG_LABELS } from "../api";
import { BarList, HourlyBars, LineChart, StatTile } from "../components/Charts";

export default function Platform() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = () =>
      api
        .get("/admin/analytics")
        .then(({ data }) => {
          setData(data);
          setError("");
        })
        .catch((e) => setError(errMsg(e)));
    load();
    const t = setInterval(load, 15000); // live view
    return () => clearInterval(t);
  }, []);

  if (error) return <div className="page"><div className="analytics-error">{error}</div></div>;
  if (!data) return <div className="page"><div className="analytics-loading">Loading platform analytics…</div></div>;
  const s = data.summary;

  return (
    <div className="page">
      <div className="analytics-header">
        <h2 className="page-title">Platform analytics</h2>
        <span className="muted small">auto-refreshes every 15 s</span>
      </div>

      <div className="analytics-grid">
        <StatTile label="Registered users" value={s.users.toLocaleString()} sub={`DAU ${s.dau} · WAU ${s.wau}`} />
        <StatTile label="Total executions" value={s.runs.toLocaleString()} />
        <StatTile label="Error rate" value={`${s.errorRate}%`} tone="err" />
        <StatTile label="p95 runtime" value={s.p95Runtime != null ? `${s.p95Runtime} ms` : "—"} />
        <StatTile label="Avg Kafka queue wait" value={s.avgQueueMs != null ? `${s.avgQueueMs} ms` : "—"} />

        <div className="analytics-card wide">
          <div className="card-title">Live throughput · runs per minute <span className="muted small">· Spark Structured Streaming, last 60 min</span></div>
          {data.live.length ? (
            <LineChart
              points={data.live.map((w) => ({ label: new Date(w.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), value: w.runs }))}
              format={(v) => `${v} runs`}
            />
          ) : (
            <div className="muted small">Start the <code>spark-streaming</code> service to see live metrics.</div>
          )}
        </div>

        <div className="analytics-card wide">
          <div className="card-title">Daily volume <span className="muted small">· Spark batch (platform_daily)</span></div>
          {data.daily.length ? (
            <LineChart points={data.daily.map((d) => ({ label: d.date.slice(5), value: d.runs }))} format={(v) => `${v.toLocaleString()} runs`} />
          ) : (
            <div className="muted small">Run <code>spark/batch_insights.py</code> to populate.</div>
          )}
        </div>

        <div className="analytics-card half">
          <div className="card-title">Executions by language</div>
          <BarList
            rows={data.byLanguage.map((l) => ({
              label: LANG_LABELS[l.language] || l.language,
              value: l.runs,
              color: LANG_COLORS[l.language],
              note: `${l.errorRate}% errors · p50 ${l.p50} ms · p95 ${l.p95} ms`,
            }))}
            format={(v) => v.toLocaleString()}
          />
        </div>

        <div className="analytics-card half">
          <div className="card-title">Submissions per hour (last 24 h)</div>
          <HourlyBars data={data.hourly} />
        </div>

        <div className="analytics-card half">
          <div className="card-title">Most common errors platform-wide</div>
          <BarList
            rows={data.topErrors.map((e) => ({
              label: `${e.type} · ${LANG_LABELS[e.language] || e.language}`,
              value: e.count,
              color: "#e66767",
              note: `${e.users} learners affected`,
            }))}
            format={(v) => v.toLocaleString()}
          />
        </div>

        <div className="analytics-card half">
          <div className="card-title">Worker load (last 24 h)</div>
          <BarList rows={data.workers.map((w) => ({ label: w.workerId, value: w.jobs }))} format={(v) => `${v} jobs`} empty="No worker activity (sync mode?)" />
        </div>

        <div className="analytics-card wide">
          <div className="card-title">Top learners by skill score</div>
          <table className="analytics-table">
            <thead><tr><th>#</th><th>Name</th><th>Level</th><th>Skill</th><th>Percentile</th><th>Runs</th><th>Top language</th></tr></thead>
            <tbody>
              {data.leaderboard.map((l, i) => (
                <tr key={l.userId}>
                  <td>{i + 1}</td>
                  <td>{l.name}</td>
                  <td>{l.level}</td>
                  <td>{l.skillScore}</td>
                  <td>{l.percentile}</td>
                  <td>{l.totalRuns}</td>
                  <td><span className="lang-dot" style={{ background: LANG_COLORS[l.topLanguage] }} />{LANG_LABELS[l.topLanguage] || l.topLanguage}</td>
                </tr>
              ))}
              {!data.leaderboard.length && (
                <tr><td colSpan={7} className="muted">Run the Spark batch job to compute skill scores.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
