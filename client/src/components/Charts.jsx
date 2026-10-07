import { useState } from "react";

// Small, dependency-free chart kit. Every chart has a hover tooltip,
// identity is never colour-only (labels/legends accompany colour), and
// text uses text tokens rather than series colours.

const SEQ = ["#21212e", "#184f95", "#256abf", "#3987e5", "#86b6ef"]; // sequential blue, dark surface
const OK = "#3987e5";
const ERR = "#e66767";

/** YYYY-MM-DD keys for the last n days (local time), oldest first. */
function lastNDays(n) {
  const now = Date.now();
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(now - (n - 1 - i) * 86400000);
    return { key: d.toLocaleDateString("en-CA"), dow: d.getDay() };
  });
}

function useTip() {
  const [tip, setTip] = useState(null);
  const show = (e, content) => {
    const box = e.currentTarget.closest(".chart").getBoundingClientRect();
    setTip({ x: e.clientX - box.left, y: e.clientY - box.top, content });
  };
  const node = tip && (
    <div className="chart-tip" style={{ left: tip.x, top: tip.y }}>
      {tip.content}
    </div>
  );
  return { show, hide: () => setTip(null), node };
}

export function StatTile({ label, value, sub, tone }) {
  return (
    <div className="stat-card">
      <div className={`stat-val ${tone ? "stat-" + tone : ""}`}>{value ?? "—"}</div>
      <div className="stat-label">{label}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export function Legend({ items }) {
  return (
    <div className="legend">
      {items.map((i) => (
        <span key={i.label} className="legend-item">
          <span className="legend-swatch" style={{ background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

/** GitHub-style activity calendar. `daily` = [{date:'YYYY-MM-DD', runs, errors}] */
export function CalendarHeatmap({ daily, days = 91 }) {
  const { show, hide, node } = useTip();
  const byDate = new Map(daily.map((d) => [d.date, d]));
  const cells = lastNDays(days).map(({ key, dow }) => ({
    key,
    dow,
    runs: byDate.get(key)?.runs || 0,
    errors: byDate.get(key)?.errors || 0,
  }));
  // pad the first column so rows line up with weekdays
  const pad = cells[0].dow;
  const max = Math.max(1, ...cells.map((c) => c.runs));
  const level = (r) => (r === 0 ? 0 : Math.min(4, Math.ceil((r / max) * 4)));
  const all = [...Array(pad).fill(null), ...cells];
  const weeks = [];
  for (let i = 0; i < all.length; i += 7) weeks.push(all.slice(i, i + 7));

  return (
    <div className="chart heatmap-wrap">
      <div className="heatmap">
        {weeks.map((w, wi) => (
          <div key={wi} className="heat-col">
            {w.map((c, ci) =>
              c ? (
                <div
                  key={c.key}
                  className="heat-cell"
                  style={{ background: SEQ[level(c.runs)] }}
                  onMouseMove={(e) =>
                    show(e, (
                      <>
                        <b>{c.key}</b>
                        <div>{c.runs} runs · {c.errors} errors</div>
                      </>
                    ))
                  }
                  onMouseLeave={hide}
                />
              ) : (
                <div key={`p${ci}`} className="heat-cell empty" />
              )
            )}
          </div>
        ))}
      </div>
      <div className="heat-scale">
        Less {SEQ.map((c) => <span key={c} className="heat-cell" style={{ background: c }} />)} More
      </div>
      {node}
    </div>
  );
}

/** Stacked daily bars: successful vs failed runs. */
export function DailyBars({ daily, days = 30 }) {
  const { show, hide, node } = useTip();
  const byDate = new Map(daily.map((d) => [d.date, d]));
  const rows = lastNDays(days).map(({ key }) => {
    const d = byDate.get(key) || { runs: 0, errors: 0 };
    return { key, ok: d.runs - d.errors, errors: d.errors, runs: d.runs };
  });
  const max = Math.max(1, ...rows.map((r) => r.runs));
  return (
    <div className="chart">
      <Legend items={[{ label: "Successful", color: OK }, { label: "Errors", color: ERR }]} />
      <div className="bars">
        {rows.map((r) => (
          <div
            key={r.key}
            className="bar-col"
            onMouseMove={(e) =>
              show(e, (
                <>
                  <b>{r.key}</b>
                  <div>{r.ok} successful</div>
                  <div>{r.errors} errors</div>
                </>
              ))
            }
            onMouseLeave={hide}
          >
            <div className="bar-stack" style={{ height: `${(r.runs / max) * 100}%` }}>
              {r.errors > 0 && <div className="bar-seg top" style={{ flex: r.errors, background: ERR }} />}
              {r.ok > 0 && <div className="bar-seg" style={{ flex: r.ok, background: OK }} />}
            </div>
          </div>
        ))}
      </div>
      <div className="bar-axis">
        <span>{rows[0].key.slice(5)}</span>
        <span>today</span>
      </div>
      {node}
    </div>
  );
}

/** Horizontal bar list. rows = [{label, value, color?, note?}] */
export function BarList({ rows, format = (v) => v, empty = "No data yet" }) {
  const { show, hide, node } = useTip();
  if (!rows.length) return <div className="muted small">{empty}</div>;
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="chart barlist">
      {rows.map((r) => (
        <div
          key={r.label}
          className="barlist-row"
          onMouseMove={(e) => show(e, <><b>{r.label}</b><div>{format(r.value)}{r.note ? ` · ${r.note}` : ""}</div></>)}
          onMouseLeave={hide}
        >
          <div className="barlist-label">
            {r.color && <span className="lang-dot" style={{ background: r.color }} />}
            {r.label}
          </div>
          <div className="barlist-track">
            <div className="barlist-fill" style={{ width: `${(r.value / max) * 100}%`, background: r.color || OK }} />
          </div>
          <div className="barlist-val">{format(r.value)}</div>
        </div>
      ))}
      {node}
    </div>
  );
}

/** 24 columns, one per hour of day. data = [{hour, runs}] */
export function HourlyBars({ data, highlight }) {
  const { show, hide, node } = useTip();
  const byHour = new Map(data.map((d) => [d.hour, d.runs]));
  const max = Math.max(1, ...data.map((d) => d.runs));
  return (
    <div className="chart">
      <div className="bars hourly">
        {Array.from({ length: 24 }, (_, h) => {
          const v = byHour.get(h) || 0;
          return (
            <div
              key={h}
              className="bar-col"
              onMouseMove={(e) => show(e, <><b>{String(h).padStart(2, "0")}:00</b><div>{v} runs</div></>)}
              onMouseLeave={hide}
            >
              <div className="bar-stack" style={{ height: `${Math.max((v / max) * 100, 1)}%` }}>
                <div className="bar-seg" style={{ flex: 1, background: h === highlight ? "#86b6ef" : OK }} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="bar-axis">
        <span>00h</span><span>06h</span><span>12h</span><span>18h</span><span>23h</span>
      </div>
      {node}
    </div>
  );
}

/** Single-series line with crosshair tooltip. points = [{label, value}] */
export function LineChart({ points, height = 140, format = (v) => v }) {
  const [hover, setHover] = useState(null);
  if (points.length < 2) return <div className="muted small">Not enough data yet</div>;
  const W = 600;
  const H = height;
  const max = Math.max(1, ...points.map((p) => p.value));
  const x = (i) => (i / (points.length - 1)) * (W - 8) + 4;
  const y = (v) => H - 6 - (v / max) * (H - 18);
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const onMove = (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - box.left) / box.width) * (points.length - 1));
    setHover(Math.max(0, Math.min(points.length - 1, i)));
  };
  const hp = hover !== null ? points[hover] : null;
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} className="line-svg" preserveAspectRatio="none" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <line x1="0" x2={W} y1={H - 6} y2={H - 6} className="grid-line" />
        <line x1="0" x2={W} y1={y(max)} y2={y(max)} className="grid-line" />
        <path d={`${d} L${x(points.length - 1)},${H - 6} L${x(0)},${H - 6} Z`} fill={OK} opacity="0.12" />
        <path d={d} fill="none" stroke={OK} strokeWidth="2" vectorEffect="non-scaling-stroke" />
        {hp && <line x1={x(hover)} x2={x(hover)} y1="0" y2={H} className="crosshair" />}
      </svg>
      <div className="bar-axis">
        <span>{points[0].label}</span>
        <span>max {format(max)}</span>
        <span>{points[points.length - 1].label}</span>
      </div>
      {hp && (
        <div className="chart-tip" style={{ left: `${(hover / (points.length - 1)) * 100}%`, top: 10 }}>
          <b>{hp.label}</b>
          <div>{format(hp.value)}</div>
        </div>
      )}
    </div>
  );
}

/** 0-100 gauge as a ring (single headline number). */
export function ScoreRing({ value, label }) {
  const r = 42;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value || 0));
  return (
    <div className="score-ring">
      <svg viewBox="0 0 100 100" width="120" height="120">
        <circle cx="50" cy="50" r={r} className="ring-track" />
        <circle cx="50" cy="50" r={r} className="ring-fill" strokeDasharray={`${(v / 100) * c} ${c}`} transform="rotate(-90 50 50)" />
        <text x="50" y="50" textAnchor="middle" dominantBaseline="central" className="ring-text">{Math.round(v)}</text>
      </svg>
      <div className="stat-label">{label}</div>
    </div>
  );
}
