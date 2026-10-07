import { useCallback, useEffect, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import api, { errMsg, LANG_COLORS, LANG_LABELS, UI_LANGUAGES } from "../api";

const CODE_TEMPLATES = {
  python: `n = int(input())\nprint(f"Sum of 1..{n} =", sum(range(1, n + 1)))`,
  cpp: `#include <iostream>\nusing namespace std;\n\nint main() {\n  int n; cin >> n;\n  long long s = 0;\n  for (int i = 1; i <= n; i++) s += i;\n  cout << "Sum = " << s << endl;\n  return 0;\n}`,
  c: `#include <stdio.h>\n\nint main() {\n  printf("Hello, CloudExec!\\n");\n  return 0;\n}`,
  java: `public class Main {\n  public static void main(String[] args) {\n    System.out.println("Hello, CloudExec!");\n  }\n}`,
  javascript: `const nums = [3, 1, 4, 1, 5, 9];\nconsole.log("sorted:", [...nums].sort((a, b) => a - b).join(", "));`,
};
const MONACO_LANG = { cpp: "cpp", c: "c", python: "python", java: "java", javascript: "javascript" };
const FILE_EXT = { cpp: "cpp", c: "c", python: "py", java: "java", javascript: "js" };
const STORE_KEY = "cloudexec.code";

function loadCode() {
  try {
    return { ...CODE_TEMPLATES, ...JSON.parse(localStorage.getItem(STORE_KEY) || "{}") };
  } catch {
    return { ...CODE_TEMPLATES };
  }
}

export default function EditorPage({ user, aiEnabled }) {
  const [lang, setLang] = useState("python");
  const [theme, setTheme] = useState("vs-dark");
  const [fontSize, setFontSize] = useState(15);
  const [codeByLang, setCodeByLang] = useState(loadCode);
  const [input, setInput] = useState("");
  const [result, setResult] = useState(null); // {kind, text, runtime, exitCode, errorType, jobId}
  const [loading, setLoading] = useState(false);
  const [ai, setAi] = useState(null); // {loading} | {data} | {error}
  const [aiLang, setAiLang] = useState(user.preferredLanguage || "en-IN");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const pollRef = useRef(null);

  useEffect(() => () => clearTimeout(pollRef.current), []);
  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(codeByLang));
    } catch {
      /* ignore */
    }
  }, [codeByLang]);

  const code = codeByLang[lang];

  const explain = useCallback(
    async ({ jobId, error }) => {
      setAi({ loading: true });
      try {
        const { data } = await api.post("/ai/explain", { jobId, code, error, language: lang, responseLanguage: aiLang });
        setAi({ data });
      } catch (e) {
        setAi({ error: errMsg(e) });
      }
    },
    [code, lang, aiLang]
  );

  function show(job) {
    const failed = job.status === "error";
    const text = failed ? (job.stderr || job.stdout || "").trim() : (job.stdout || "").trim();
    setResult({
      kind: failed ? "error" : text ? "success" : "empty",
      text: text || "(No output)",
      runtime: job.runtime,
      exitCode: job.exitCode,
      errorType: job.errorType,
      jobId: job.jobId,
    });
    setLoading(false);
    if (failed && aiEnabled) explain({ jobId: job.jobId, error: job.stderr });
  }

  function poll(jobId, attempt = 0) {
    if (attempt > 120) {
      setResult({ kind: "error", text: "Timed out waiting for a worker." });
      setLoading(false);
      return;
    }
    pollRef.current = setTimeout(async () => {
      try {
        const { data } = await api.get(`/jobs/${jobId}`);
        if (data.status === "success" || data.status === "error") return show(data);
        setResult({ kind: "queued", text: data.status === "running" ? "Running on a worker…" : "Queued in Kafka…" });
      } catch {
        /* transient, keep polling */
      }
      poll(jobId, attempt + 1);
    }, Math.min(250 + attempt * 50, 1000));
  }

  async function run() {
    if (!code?.trim() || loading) return;
    clearTimeout(pollRef.current);
    setLoading(true);
    setAi(null);
    setResult({ kind: "queued", text: "Submitting…" });
    try {
      const { data } = await api.post("/compile", { code, language: lang, input });
      if (data.status === "queued") poll(data.jobId);
      else show(data);
    } catch (e) {
      setResult({ kind: "error", text: errMsg(e) });
      setLoading(false);
    }
  }

  // Ctrl/Cmd + Enter runs the program.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") run();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <>
      <div className="subbar">
        <div className="lang-pills">
          {Object.keys(LANG_LABELS).map((l) => (
            <button
              key={l}
              className={`lang-pill ${lang === l ? "active" : ""}`}
              style={lang === l ? { borderColor: LANG_COLORS[l] } : {}}
              onClick={() => setLang(l)}
            >
              <span className="lang-dot" style={{ background: LANG_COLORS[l] }} />
              {LANG_LABELS[l]}
            </button>
          ))}
        </div>
        <div className="subbar-right">
          <button className="clear-link" onClick={() => setCodeByLang((p) => ({ ...p, [lang]: CODE_TEMPLATES[lang] }))}>
            reset template
          </button>
          <div className="settings-wrap">
            <button className="icon-btn" onClick={() => setSettingsOpen((s) => !s)} title="Editor settings">⚙</button>
            {settingsOpen && (
              <div className="settings-dropdown">
                <label>
                  Theme
                  <select value={theme} onChange={(e) => setTheme(e.target.value)}>
                    <option value="vs-dark">Dark</option>
                    <option value="light">Light</option>
                    <option value="hc-black">High contrast</option>
                  </select>
                </label>
                <label>
                  Font size: {fontSize}px
                  <input type="range" min={11} max={24} value={fontSize} onChange={(e) => setFontSize(+e.target.value)} />
                </label>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="workspace">
        <div className="editor-pane">
          <div className="pane-header">
            <span className="file-label">{lang === "java" ? "Main.java" : `main.${FILE_EXT[lang]}`}</span>
            <span className="muted small">Ctrl + Enter to run</span>
          </div>
          <Editor
            height="100%"
            theme={theme}
            language={MONACO_LANG[lang]}
            value={code}
            options={{ fontSize, minimap: { enabled: false }, scrollBeyondLastLine: false, automaticLayout: true }}
            onChange={(v) => setCodeByLang((p) => ({ ...p, [lang]: v || "" }))}
          />
        </div>

        <div className="io-pane">
          <div className="io-section">
            <div className="section-label">stdin</div>
            <textarea className="io-textarea" value={input} onChange={(e) => setInput(e.target.value)}
              placeholder="Input for your program…" spellCheck={false} />
          </div>

          <button className="run-btn" onClick={run} disabled={loading}>
            {loading ? <span className="run-spinner"><span className="dot" /><span className="dot" /><span className="dot" /></span> : "▶  Run"}
          </button>

          <div className="io-section output-section">
            <div className="section-label-row">
              <span className="section-label">output</span>
              {result?.runtime != null && (
                <span className="meta-chips">
                  <span className="chip">{result.runtime} ms</span>
                  <span className={`chip ${result.exitCode === 0 ? "chip-ok" : "chip-err"}`}>exit {result.exitCode}</span>
                  {result.errorType && <span className="chip chip-err">{result.errorType}</span>}
                </span>
              )}
              {result && <button className="clear-link" onClick={() => { setResult(null); setAi(null); }}>clear</button>}
            </div>
            <pre className={`io-output ${result?.kind || "empty"}`}>{result?.text || ""}</pre>
          </div>

          {aiEnabled && (
            <div className="ai-lang-row">
              <span className="section-label">AI language</span>
              <select value={aiLang} onChange={(e) => setAiLang(e.target.value)}>
                {Object.entries(UI_LANGUAGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          )}

          {ai && (
            <div className="ai-panel">
              <div className="ai-header">
                <span className="ai-badge">✦ Sarvam AI mentor</span>
                <button className="ai-close" onClick={() => setAi(null)}>✕</button>
              </div>
              {ai.loading && <div className="ai-loading">Analysing your code…</div>}
              {ai.error && <div className="ai-text">{ai.error}</div>}
              {ai.data && (
                <div className="ai-content">
                  <div className="ai-title">{ai.data.title}</div>
                  <p className="ai-text">{ai.data.explanation}</p>
                  {ai.data.fix && (<><div className="ai-subtitle">How to fix</div><p className="ai-text">{ai.data.fix}</p></>)}
                  {ai.data.concept && (<><div className="ai-subtitle">Concept</div><p className="ai-text">{ai.data.concept}</p></>)}
                  {ai.data.practice_tip && <div className="ai-chip">💡 {ai.data.practice_tip}</div>}
                  {ai.data.fixed_code && (
                    <button className="apply-fix-btn" onClick={() => { setCodeByLang((p) => ({ ...p, [lang]: ai.data.fixed_code })); setAi(null); }}>
                      Apply fix →
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {aiEnabled && !ai && result && result.kind !== "queued" && (
            <button className="ask-ai-btn" onClick={() => explain({ jobId: result.jobId, error: result.text })}>
              ✦ Ask AI to explain this {result.kind === "error" ? "error" : "output"}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
