import { useState } from "react";
import api, { errMsg, setToken, UI_LANGUAGES } from "../api";

export default function Login({ onAuth }) {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ email: "", password: "", name: "", preferredLanguage: "en-IN", college: "", goal: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { data } = await api.post(`/auth/${mode}`, form);
      setToken(data.token);
      onAuth(data.user);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-hero">
        <span className="logo big">
          <span className="logo-bracket">&lt;</span>CloudExec<span className="logo-bracket">/&gt;</span>
        </span>
        <p>
          Write code in your browser, run it on cloud sandboxes, and get a personal coach that explains your errors in
          <b> your own language</b> — Hindi, Tamil, Telugu, Kannada, Bengali and more, powered by Sarvam AI.
        </p>
        <ul>
          <li>⚡ Run code in C, C++, Java, Python and JavaScript</li>
          <li>📊 Your own skills dashboard, built from every program you run</li>
          <li>🗣️ Error explanations and a weekly study plan in 11 Indian languages</li>
        </ul>
      </div>

      <form className="auth-card" onSubmit={submit}>
        <div className="auth-tabs">
          <button type="button" className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>Sign in</button>
          <button type="button" className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>Create account</button>
        </div>

        {mode === "register" && (
          <label>Name<input value={form.name} onChange={set("name")} required autoComplete="name" /></label>
        )}
        <label>Email<input type="email" value={form.email} onChange={set("email")} required autoComplete="email" /></label>
        <label>
          Password
          <input type="password" value={form.password} onChange={set("password")} required minLength={8}
            autoComplete={mode === "login" ? "current-password" : "new-password"} />
        </label>

        {mode === "register" && (
          <>
            <label>
              Language for explanations
              <select value={form.preferredLanguage} onChange={set("preferredLanguage")}>
                {Object.entries(UI_LANGUAGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label>College (optional)<input value={form.college} onChange={set("college")} /></label>
            <label>Your goal (optional)<input value={form.goal} onChange={set("goal")} placeholder="e.g. crack placements, learn DSA" /></label>
          </>
        )}

        {error && <div className="form-error">{error}</div>}
        <button className="run-btn" disabled={busy}>{busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}</button>
      </form>
    </div>
  );
}
