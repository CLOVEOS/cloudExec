import { useEffect, useState } from "react";
import api, { errMsg, LANG_COLORS, LANG_LABELS, UI_LANGUAGES } from "../api";
import { BarList, CalendarHeatmap, DailyBars, HourlyBars, ScoreRing, StatTile } from "../components/Charts";

const CATEGORY_LABELS = {
  syntax_error: "Syntax",
  compile_error: "Compile",
  runtime_error: "Runtime",
  timeout: "Time limit",
  memory_limit: "Memory limit",
  output_limit: "Output limit",
};
const TREND_LABEL = { improving: "▲ Improving", declining: "▼ Declining", steady: "● Steady", new: "New", inactive: "Inactive this week" };
const fmtHour = (h) => (h == null ? "—" : `${String(h).padStart(2, "0")}:00`);

export default function Dashboard({ user, aiEnabled }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [coach, setCoach] = useState(null);
  const [coachLang, setCoachLang] = useState(user.preferredLanguage || "en-IN");

  const load = () =>
    api
      .get("/me/dashboard", { params: { days: 120 } })
      .then(({ data }) => {
        setData(data);
        setError("");
      })
      .catch((e) => setError(errMsg(e)));

  useEffect(() => {
    load();
  }, []);

  async function getCoaching(refresh = false) {
    setCoach({ loading: true });
    try {
      const { data } = await api.post("/ai/coach", { responseLanguage: coachLang, refresh });
      setCoach({ data });
    } catch (e) {
      setCoach({ error: errMsg(e) });
    }
  }

  if (error) return <div className="page"><div className="analytics-error">{error}</div></div>;
  if (!data) return <div className="page"><div className="analytics-loading">Loading your dashboard…</div></div>;

  const s = data.summary;
  const ins = data.insights;

  if (!s.runs) {
    return (
      <div className="page">
        <h2 className="page-title">Welcome, {user.name.split(" ")[0]} 👋</h2>
        <div className="analytics-card empty-state">
          Run your first program in the <b>Editor</b> tab. Every run feeds your personal dashboard: skills per language,
          common mistakes, activity streaks and an AI study plan in {UI_LANGUAGES[user.preferredLanguage] || "English"}.
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="analytics-header">
        <h2 className="page-title">Hi {user.name.split(" ")[0]}, here's your progress</h2>
        <button className="refresh-btn" onClick={load}>↻ Refresh</button>
      </div>

      <div className="analytics-grid">
        <StatTile label="Programs run" value={s.runs.toLocaleString()} sub={`${s.activeDays} active days`} />
        <StatTile label="Success rate" value={`${s.successRate}%`} sub={`${s.errors} errors`} />
        <StatTile label="Current streak" value={`${s.streak.current} 🔥`} sub={`best: ${s.streak.longest} days`} />
        <StatTile label="Median runtime" value={s.p50Runtime != null ? `${s.p50Runtime} ms` : "—"} sub={`p90 ${s.p90Runtime ?? "—"} ms`} />
        <StatTile label="Lines written" value={s.linesWritten.toLocaleString()} sub={`peak hour ${fmtHour(s.peakHour)}`} />

        {/* Spark-computed skill profile */}
        <div className="analytics-card wide skill-card">
          <div className="card-title">Skill profile <span className="muted small">· computed by Spark{ins?.computedAt ? ` on ${new Date(ins.computedAt).toLocaleString()}` : ""}</span></div>
          {ins ? (
            <div className="skill-grid">
              <ScoreRing value={ins.skillScore} label="Skill score" />
              <div className="skill-facts">
                <div className="skill-level">{ins.level}</div>
                <div>Better than <b>{Math.round(ins.percentile)}%</b> of learners on the platform</div>
                {ins.trend && (
                  <div>
                    This week: <b>{TREND_LABEL[ins.trend.direction] || ins.trend.direction}</b>
                    {ins.trend.successDelta != null && <> ({ins.trend.successDelta > 0 ? "+" : ""}{ins.trend.successDelta} pts success rate vs last week)</>}
                  </div>
                )}
                <div className="muted small">Strongest language: {LANG_LABELS[ins.topLanguage] || ins.topLanguage}</div>
              </div>
              <div className="skill-langs">
                <div className="section-label">Proficiency by language (0–100)</div>
                <BarList
                  rows={(ins.languages || []).map((l) => ({
                    label: LANG_LABELS[l.language] || l.language,
                    value: l.proficiency,
                    color: LANG_COLORS[l.language],
                    note: `${l.runs} runs · ${l.successRate}% success`,
                  }))}
                  format={(v) => v.toFixed(0)}
                />
              </div>
            </div>
          ) : (
            <div className="muted small">
              Your skill score, percentile and weekly trend appear after the next Spark batch run
              (<code>spark/batch_insights.py</code>, scheduled hourly in production).
            </div>
          )}
        </div>

        <div className="analytics-card wide">
          <div className="card-title">Activity (last 120 days)</div>
          <CalendarHeatmap daily={data.daily} days={120} />
        </div>

        <div className="analytics-card half">
          <div className="card-title">Runs per day (last 30 days)</div>
          <DailyBars daily={data.daily} days={30} />
        </div>

        <div className="analytics-card half">
          <div className="card-title">When you code</div>
          <HourlyBars data={data.hourly} highlight={s.peakHour} />
        </div>

        <div className="analytics-card half">
          <div className="card-title">Languages</div>
          <BarList
            rows={data.byLanguage.map((l) => ({
              label: LANG_LABELS[l.language] || l.language,
              value: l.runs,
              color: LANG_COLORS[l.language],
              note: `${l.successRate}% success · avg ${l.avgRuntime} ms`,
            }))}
            format={(v) => `${v} runs`}
          />
        </div>

        <div className="analytics-card half">
          <div className="card-title">Your most common mistakes</div>
          <BarList
            rows={data.topErrors.map((e) => ({
              label: `${e.type} · ${LANG_LABELS[e.language] || e.language}`,
              value: e.count,
              color: "#e66767",
              note: `last seen ${new Date(e.last).toLocaleDateString()}`,
            }))}
            format={(v) => `${v}×`}
            empty="No errors yet — nice!"
          />
          {data.errorCategories.length > 0 && (
            <div className="category-chips">
              {data.errorCategories.map((c) => (
                <span key={c.category} className="chip">{CATEGORY_LABELS[c.category] || c.category}: {c.count}</span>
              ))}
            </div>
          )}
        </div>

        {ins?.weakAreas?.length > 0 && (
          <div className="analytics-card half">
            <div className="card-title">Focus areas</div>
            <ul className="focus-list">
              {ins.weakAreas.map((w) => (
                <li key={w.rank}>
                  <b>{w.topic}</b>
                  <div className="muted small">{w.errorType} in {LANG_LABELS[w.language] || w.language} — {w.share}% of your errors</div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {ins?.recommendations?.length > 0 && (
          <div className="analytics-card half">
            <div className="card-title">Recommended next steps</div>
            <ul className="focus-list">
              {ins.recommendations.map((r) => <li key={r}>{r}</li>)}
            </ul>
          </div>
        )}

        {/* Sarvam AI coach */}
        <div className="analytics-card wide coach-card">
          <div className="coach-head">
            <div className="card-title">✦ Personal AI coach <span className="muted small">· Sarvam AI</span></div>
            {aiEnabled ? (
              <div className="coach-controls">
                <select value={coachLang} onChange={(e) => setCoachLang(e.target.value)}>
                  {Object.entries(UI_LANGUAGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <button className="refresh-btn" onClick={() => getCoaching(Boolean(coach?.data))} disabled={coach?.loading}>
                  {coach?.loading ? "Thinking…" : coach?.data ? "Regenerate" : "Get my study plan"}
                </button>
              </div>
            ) : (
              <span className="muted small">Set SARVAM_API_KEY on the server to enable</span>
            )}
          </div>
          {coach?.error && <div className="analytics-error">{coach.error}</div>}
          {coach?.data && (
            <div className="coach-body">
              <div className="coach-headline">{coach.data.headline}</div>
              {coach.data.strengths?.length > 0 && (
                <>
                  <div className="ai-subtitle">Strengths</div>
                  <ul className="focus-list">{coach.data.strengths.map((x, i) => <li key={i}>{x}</li>)}</ul>
                </>
              )}
              {coach.data.focus_areas?.length > 0 && (
                <>
                  <div className="ai-subtitle">Focus areas</div>
                  <ul className="focus-list">
                    {coach.data.focus_areas.map((f, i) => (
                      <li key={i}><b>{f.area}</b> — {f.why}<div className="muted small">→ {f.action}</div></li>
                    ))}
                  </ul>
                </>
              )}
              {coach.data.weekly_plan?.length > 0 && (
                <>
                  <div className="ai-subtitle">This week's plan</div>
                  <div className="plan-grid">
                    {coach.data.weekly_plan.map((p, i) => (
                      <div key={i} className="plan-day"><b>{p.day}</b><span>{p.task}</span></div>
                    ))}
                  </div>
                </>
              )}
              {coach.data.motivation && <div className="ai-chip">💪 {coach.data.motivation}</div>}
              {coach.data.cached && <div className="muted small">Cached plan from {new Date(coach.data.generatedAt).toLocaleString()}</div>}
            </div>
          )}
        </div>

        <div className="analytics-card wide">
          <div className="card-title">Recent runs</div>
          <table className="analytics-table">
            <thead><tr><th>When</th><th>Language</th><th>Lines</th><th>Runtime</th><th>Result</th></tr></thead>
            <tbody>
              {data.recent.map((r) => (
                <tr key={r.jobId}>
                  <td>{new Date(r.createdAt).toLocaleString()}</td>
                  <td><span className="lang-dot" style={{ background: LANG_COLORS[r.language] }} />{LANG_LABELS[r.language] || r.language}</td>
                  <td>{r.linesOfCode}</td>
                  <td>{r.runtime} ms</td>
                  <td>
                    <span className={`status-badge ${r.status === "error" ? "badge-err" : "badge-ok"}`}>
                      {r.status === "error" ? `✕ ${r.errorType || "Error"}` : "✓ OK"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
