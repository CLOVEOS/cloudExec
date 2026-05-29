import React, { useState, useEffect, useCallback, useRef } from "react";
import Editor from "@monaco-editor/react";
import axios from "axios";
import "./App.css";

const API_BASE ='http://localhost:8000';

const CODE_TEMPLATES = {
  cpp: `#include <iostream>
using namespace std;

int main() {
  cout << "Hello, CloudExec!" << endl;
  return 0;
}`,
  c: `#include <stdio.h>

int main() {
  printf("Hello, CloudExec!\\n");
  return 0;
}`,
  python: `print("Hello, CloudExec!")`,
  java: `public class Main {
  public static void main(String[] args) {
    System.out.println("Hello, CloudExec!");
  }
}`,
};

const LANG_LABELS = { cpp: "C++", c: "C", python: "Python", java: "Java" };
const LANG_COLORS = {
  cpp: "#00b4d8",
  c: "#90e0ef",
  python: "#f6c90e",
  java: "#f4845f",
};

export default function App() {
  const [activeTab, setActiveTab] = useState("editor"); // editor | analytics
  const [userLang, setUserLang] = useState("python");
  const [userTheme, setUserTheme] = useState("vs-dark");
  const [fontSize, setFontSize] = useState(15);
  const [codeByLang, setCodeByLang] = useState(() => ({ ...CODE_TEMPLATES }));
  const [userInput, setUserInput] = useState("");
  const [userOutput, setUserOutput] = useState("");
  const [outputMeta, setOutputMeta] = useState(null); // { runtime, exitCode }
  const [loading, setLoading] = useState(false);
  const [aiPanel, setAiPanel] = useState(null); // null | { loading } | { data }
  const [analytics, setAnalytics] = useState(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const pollRef = useRef(null);

  const handleCodeChange = useCallback(
    (value) => {
      setCodeByLang((prev) => ({ ...prev, [userLang]: value || "" }));
    },
    [userLang]
  );

  const compile = useCallback(async () => {
    const code = codeByLang[userLang];
    if (!code?.trim()) return;

    setLoading(true);
    setUserOutput("");
    setOutputMeta(null);
    setAiPanel(null);

    try {
      const res = await axios.post(
        `${API_BASE}/compile`,
        { code, language: userLang, input: userInput },
        { timeout: 45000 }
      );

      const { stdout = "", stderr = "", exitCode, runtime, jobId, status } = res.data;

      // Kafka async mode: poll for result
      if (jobId && status === "queued") {
        pollForResult(jobId);
        setUserOutput("__QUEUED__\nJob queued, executing...");
        return;
      }

      handleResult({ stdout, stderr, exitCode, runtime });
    } catch (err) {
      setUserOutput(`__ERROR__\n${err.response?.data?.error || err.message}`);
      setLoading(false);
    }
  }, [codeByLang, userLang, userInput]);

  function pollForResult(jobId) {
    let attempts = 0;
    pollRef.current = setInterval(async () => {
      attempts++;
      if (attempts > 60) {
        clearInterval(pollRef.current);
        setUserOutput("__ERROR__\nExecution timeout");
        setLoading(false);
        return;
      }
      try {
        const res = await axios.get(`${API_BASE}/job/${jobId}`);
        if (res.data.status !== "pending") {
          clearInterval(pollRef.current);
          handleResult(res.data);
        }
      } catch {}
    }, 500);
  }

  function handleResult({ stdout, stderr, exitCode, runtime }) {
    setOutputMeta({ runtime, exitCode });

    if (stderr?.trim()) {
      setUserOutput(`__ERROR__\n${stderr.trim()}`);
      // Auto-trigger AI on error
      explainError(codeByLang[userLang], stderr.trim());
    } else if (stdout?.trim()) {
      setUserOutput(`__OUTPUT__\n${stdout.trim()}`);
    } else {
      setUserOutput("__EMPTY__\n(No output)");
    }
    setLoading(false);
  }

  async function explainError(code, error) {
    setAiPanel({ loading: true });
    try {
      const res = await axios.post(`${API_BASE}/ai/explain`, {
        code,
        error,
        language: userLang,
      });
      setAiPanel({ data: res.data });
    } catch {
      setAiPanel({ data: { title: "AI Unavailable", explanation: "Could not reach AI service.", fix: "", fixed_code: "" } });
    }
  }

  function applyFix() {
    if (aiPanel?.data?.fixed_code) {
      setCodeByLang((prev) => ({ ...prev, [userLang]: aiPanel.data.fixed_code }));
      setAiPanel(null);
    }
  }

  async function loadAnalytics() {
    setAnalyticsLoading(true);
    try {
      const res = await axios.get(`${API_BASE}/analytics`);
      setAnalytics(res.data);
    } catch {
      setAnalytics({ error: true });
    } finally {
      setAnalyticsLoading(false);
    }
  }

  useEffect(() => {
    if (activeTab === "analytics") loadAnalytics();
  }, [activeTab]);

  const outputType = userOutput.startsWith("__ERROR__")
    ? "error"
    : userOutput.startsWith("__OUTPUT__")
    ? "success"
    : userOutput.startsWith("__QUEUED__")
    ? "queued"
    : "empty";

  const displayOutput = userOutput.replace(
    /^__ERROR__\n|^__OUTPUT__\n|^__EMPTY__\n|^__QUEUED__\n/,
    ""
  );

  return (
    <div className="app">
      {/* ── TOP BAR ── */}
      <header className="topbar">
        <div className="topbar-left">
          <span className="logo">
            <span className="logo-bracket">&lt;</span>
            CodeSage
            <span className="logo-bracket">/&gt;</span>
          </span>
          <nav className="tab-nav">
            <button
              className={`tab-btn ${activeTab === "editor" ? "active" : ""}`}
              onClick={() => setActiveTab("editor")}
            >
              Editor
            </button>
            <button
              className={`tab-btn ${activeTab === "analytics" ? "active" : ""}`}
              onClick={() => setActiveTab("analytics")}
            >
              Analytics
            </button>
          </nav>
        </div>

        <div className="topbar-right">
          {activeTab === "editor" && (
            <>
              <div className="lang-pills">
                {Object.keys(LANG_LABELS).map((lang) => (
                  <button
                    key={lang}
                    className={`lang-pill ${userLang === lang ? "active" : ""}`}
                    style={userLang === lang ? { borderColor: LANG_COLORS[lang], color: LANG_COLORS[lang] } : {}}
                    onClick={() => setUserLang(lang)}
                  >
                    {LANG_LABELS[lang]}
                  </button>
                ))}
              </div>

              <div className="settings-wrap">
                <button className="icon-btn" onClick={() => setSettingsOpen((s) => !s)} title="Settings">
                  ⚙
                </button>
                {settingsOpen && (
                  <div className="settings-dropdown">
                    <label>
                      Theme
                      <select value={userTheme} onChange={(e) => setUserTheme(e.target.value)}>
                        <option value="vs-dark">Dark</option>
                        <option value="light">Light</option>
                        <option value="hc-black">High Contrast</option>
                      </select>
                    </label>
                    <label>
                      Font size: {fontSize}px
                      <input
                        type="range"
                        min={11}
                        max={24}
                        value={fontSize}
                        onChange={(e) => setFontSize(+e.target.value)}
                      />
                    </label>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </header>

      {/* ── EDITOR TAB ── */}
      {activeTab === "editor" && (
        <div className="workspace">
          {/* LEFT: Editor */}
          <div className="editor-pane">
            <div className="pane-header">
              <span className="file-label">
                main.{userLang === "cpp" ? "cpp" : userLang}
              </span>
              <span className="lang-badge" style={{ color: LANG_COLORS[userLang] }}>
                {LANG_LABELS[userLang]}
              </span>
            </div>
            <Editor
              height="calc(100vh - 120px)"
              theme={userTheme}
              language={userLang === "cpp" ? "cpp" : userLang}
              value={codeByLang[userLang]}
              options={{ fontSize, minimap: { enabled: false }, scrollBeyondLastLine: false }}
              onChange={handleCodeChange}
            />
          </div>

          {/* RIGHT: IO + AI */}
          <div className="io-pane">
            {/* Input */}
            <div className="io-section">
              <div className="section-label">stdin</div>
              <textarea
                className="io-textarea"
                value={userInput}
                onChange={(e) => setUserInput(e.target.value)}
                placeholder="Input for your program..."
                spellCheck={false}
              />
            </div>

            {/* Run button */}
            <button className="run-btn" onClick={compile} disabled={loading}>
              {loading ? (
                <span className="run-spinner">
                  <span className="dot" />
                  <span className="dot" />
                  <span className="dot" />
                </span>
              ) : (
                "▶  Run"
              )}
            </button>

            {/* Output */}
            <div className="io-section output-section">
              <div className="section-label-row">
                <span className="section-label">stdout</span>
                {outputMeta && (
                  <span className="meta-chips">
                    <span className="chip">{outputMeta.runtime}ms</span>
                    <span className={`chip ${outputMeta.exitCode === 0 ? "chip-ok" : "chip-err"}`}>
                      exit {outputMeta.exitCode}
                    </span>
                  </span>
                )}
                {userOutput && (
                  <button className="clear-link" onClick={() => { setUserOutput(""); setOutputMeta(null); setAiPanel(null); }}>
                    clear
                  </button>
                )}
              </div>
              <pre className={`io-output ${outputType}`}>{displayOutput}</pre>
            </div>

            {/* AI Panel */}
            {aiPanel && (
              <div className="ai-panel">
                <div className="ai-header">
                  <span className="ai-badge">✦ AI</span>
                  <button className="ai-close" onClick={() => setAiPanel(null)}>✕</button>
                </div>

                {aiPanel.loading ? (
                  <div className="ai-loading">Analyzing error...</div>
                ) : (
                  <div className="ai-content">
                    <div className="ai-title">{aiPanel.data.title}</div>
                    <p className="ai-text">{aiPanel.data.explanation}</p>
                    {aiPanel.data.fix && (
                      <>
                        <div className="ai-subtitle">How to fix</div>
                        <p className="ai-text">{aiPanel.data.fix}</p>
                      </>
                    )}
                    {aiPanel.data.complexity && (
                      <div className="ai-chip">Complexity: {aiPanel.data.complexity}</div>
                    )}
                    {aiPanel.data.fixed_code && (
                      <button className="apply-fix-btn" onClick={applyFix}>
                        Apply fix →
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Manual AI trigger */}
            {!aiPanel && userOutput.startsWith("") && codeByLang[userLang] && (
              <button
                className="ask-ai-btn"
                onClick={() => explainError(codeByLang[userLang], displayOutput)}
              >
                ✦ Ask AI to explain output
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── ANALYTICS TAB ── */}
      {activeTab === "analytics" && (
        <div className="analytics-page">
          <div className="analytics-header">
            <h2>Execution Analytics</h2>
            <button className="refresh-btn" onClick={loadAnalytics} disabled={analyticsLoading}>
              {analyticsLoading ? "Loading..." : "↻ Refresh"}
            </button>
          </div>

          {analyticsLoading && <div className="analytics-loading">Loading analytics...</div>}

          {analytics?.error && (
            <div className="analytics-error">
              Could not load analytics. Make sure MongoDB is running.
            </div>
          )}

          {analytics && !analytics.error && (
            <div className="analytics-grid">
              {/* Summary cards */}
              <div className="stat-card">
                <div className="stat-val">{analytics.errorRate?.total ?? 0}</div>
                <div className="stat-label">Total Runs</div>
              </div>
              <div className="stat-card">
                <div className="stat-val stat-err">{analytics.errorRate?.errors ?? 0}</div>
                <div className="stat-label">Errors</div>
              </div>
              <div className="stat-card">
                <div className="stat-val">
                  {analytics.errorRate?.total
                    ? Math.round((analytics.errorRate.errors / analytics.errorRate.total) * 100)
                    : 0}%
                </div>
                <div className="stat-label">Error Rate</div>
              </div>

              {/* Language table */}
              <div className="analytics-card wide">
                <div className="card-title">Submissions by Language</div>
                <table className="analytics-table">
                  <thead>
                    <tr>
                      <th>Language</th>
                      <th>Submissions</th>
                      <th>Avg Runtime</th>
                      <th>Error Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(analytics.langStats || []).map((row) => (
                      <tr key={row._id}>
                        <td>
                          <span
                            className="lang-dot"
                            style={{ background: LANG_COLORS[row._id] || "#888" }}
                          />
                          {LANG_LABELS[row._id] || row._id}
                        </td>
                        <td>{row.count}</td>
                        <td>{row.avgRuntime ? Math.round(row.avgRuntime) + "ms" : "—"}</td>
                        <td>—</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Recent runs */}
              <div className="analytics-card wide">
                <div className="card-title">Recent Executions</div>
                <table className="analytics-table">
                  <thead>
                    <tr>
                      <th>Job ID</th>
                      <th>Language</th>
                      <th>Runtime</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(analytics.recent || []).map((r) => (
                      <tr key={r.jobId}>
                        <td className="mono">{r.jobId?.slice(0, 8)}...</td>
                        <td>
                          <span
                            className="lang-dot"
                            style={{ background: LANG_COLORS[r.language] || "#888" }}
                          />
                          {LANG_LABELS[r.language] || r.language}
                        </td>
                        <td>{r.runtime}ms</td>
                        <td>
                          <span className={`status-badge ${r.hasError ? "badge-err" : "badge-ok"}`}>
                            {r.hasError ? "Error" : "OK"}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {!analytics.recent?.length && (
                      <tr>
                        <td colSpan={4} style={{ textAlign: "center", opacity: 0.5 }}>
                          No executions yet. Run some code!
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Hourly chart */}
              {analytics.hourly?.length > 0 && (
                <div className="analytics-card wide">
                  <div className="card-title">Submissions per Hour (last 24h)</div>
                  <HourlyChart data={analytics.hourly} />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Inline bar chart component ── */
function HourlyChart({ data }) {
  const max = Math.max(...data.map((d) => d.count), 1);
  return (
    <div className="hourly-chart">
      {Array.from({ length: 24 }, (_, h) => {
        const entry = data.find((d) => d._id === h);
        const count = entry?.count || 0;
        const pct = (count / max) * 100;
        return (
          <div key={h} className="hour-col" title={`${h}:00 — ${count} runs`}>
            <div className="hour-bar-wrap">
              <div className="hour-bar" style={{ height: `${Math.max(pct, 2)}%` }} />
            </div>
            {h % 6 === 0 && <div className="hour-label">{h}h</div>}
          </div>
        );
      })}
    </div>
  );
}
