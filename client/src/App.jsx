import { useEffect, useState } from "react";
import api, { getToken, setToken, setUnauthorizedHandler } from "./api";
import Login from "./pages/Login";
import EditorPage from "./pages/Editor";
import Dashboard from "./pages/Dashboard";
import Platform from "./pages/Platform";
import Users from "./pages/Users";
import Profile from "./pages/Profile";
import "./App.css";

export default function App() {
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(Boolean(getToken()));
  const [tab, setTab] = useState("editor");
  const [aiEnabled, setAiEnabled] = useState(false);

  const logout = () => {
    setToken(null);
    setUser(null);
    setTab("editor");
  };

  useEffect(() => {
    setUnauthorizedHandler(logout);
    if (getToken()) {
      api
        .get("/auth/me")
        .then(({ data }) => setUser(data.user))
        .catch(() => setToken(null))
        .finally(() => setBooting(false));
    }
  }, []);

  useEffect(() => {
    if (user) api.get("/ai/status").then(({ data }) => setAiEnabled(data.configured)).catch(() => {});
  }, [user]);

  if (booting) return <div className="boot">Loading…</div>;
  if (!user) return <Login onAuth={setUser} />;

  const tabs = [
    ["editor", "Editor"],
    ["dashboard", "My Dashboard"],
    ...(user.role === "admin" ? [["platform", "Platform"], ["users", "Users"]] : []),
    ["profile", "Profile"],
  ];

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-left">
          <span className="logo">
            <span className="logo-bracket">&lt;</span>CloudExec<span className="logo-bracket">/&gt;</span>
          </span>
          <nav className="tab-nav">
            {tabs.map(([id, label]) => (
              <button key={id} className={`tab-btn ${tab === id ? "active" : ""}`} onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
          </nav>
        </div>
        <div className="topbar-right">
          <span className={`chip ${aiEnabled ? "chip-ok" : ""}`} title="Sarvam AI status">
            {aiEnabled ? "✦ AI on" : "AI off"}
          </span>
          <span className="user-name">{user.name}</span>
          <button className="clear-link" onClick={logout}>sign out</button>
        </div>
      </header>

      <main className="main">
        {tab === "editor" && <EditorPage user={user} aiEnabled={aiEnabled} />}
        {tab === "dashboard" && <Dashboard user={user} aiEnabled={aiEnabled} />}
        {tab === "platform" && user.role === "admin" && <Platform />}
        {tab === "users" && user.role === "admin" && <Users me={user} />}
        {tab === "profile" && <Profile user={user} onUpdate={setUser} />}
      </main>
    </div>
  );
}
