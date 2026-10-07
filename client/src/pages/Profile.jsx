import { useState } from "react";
import api, { errMsg, UI_LANGUAGES } from "../api";

export default function Profile({ user, onUpdate }) {
  const [form, setForm] = useState({
    name: user.name,
    preferredLanguage: user.preferredLanguage,
    college: user.college,
    goal: user.goal,
  });
  const [msg, setMsg] = useState("");
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save(e) {
    e.preventDefault();
    try {
      const { data } = await api.patch("/auth/me", form);
      onUpdate(data.user);
      setMsg("Saved ✓");
    } catch (err) {
      setMsg(errMsg(err));
    }
  }

  return (
    <div className="page narrow">
      <h2 className="page-title">Profile</h2>
      <form className="auth-card" onSubmit={save}>
        <label>Email<input value={user.email} disabled /></label>
        <label>Name<input value={form.name} onChange={set("name")} /></label>
        <label>
          Language for AI explanations & coaching
          <select value={form.preferredLanguage} onChange={set("preferredLanguage")}>
            {Object.entries(UI_LANGUAGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label>College<input value={form.college} onChange={set("college")} /></label>
        <label>Goal<input value={form.goal} onChange={set("goal")} placeholder="Used by the AI coach to tailor your plan" /></label>
        {msg && <div className="muted small">{msg}</div>}
        <button className="run-btn">Save</button>
      </form>
    </div>
  );
}
