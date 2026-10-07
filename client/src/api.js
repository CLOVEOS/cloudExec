import axios from "axios";

// In dev, Vite proxies /api → http://localhost:8000 (see vite.config.js).
// In docker-compose / k8s, nginx proxies /api to the API service.
const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || "/api", timeout: 60000 });

const TOKEN_KEY = "cloudexec.token";

export const getToken = () => {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};
export const setToken = (t) => {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable */
  }
};

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => (onUnauthorized = fn);

api.interceptors.request.use((cfg) => {
  const t = getToken();
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401 && !err.config.url.startsWith("/auth/")) onUnauthorized();
    return Promise.reject(err);
  }
);

export const errMsg = (e) => e.response?.data?.error || e.message || "Something went wrong";

export const LANG_LABELS = { python: "Python", cpp: "C++", java: "Java", c: "C", javascript: "JavaScript" };
// Fixed categorical order (validated palette, dark surface). Colour follows the language, never its rank.
export const LANG_COLORS = {
  python: "#3987e5",
  cpp: "#d95926",
  java: "#199e70",
  c: "#c98500",
  javascript: "#d55181",
};

export const UI_LANGUAGES = {
  "en-IN": "English",
  "hi-IN": "हिन्दी (Hindi)",
  "bn-IN": "বাংলা (Bengali)",
  "ta-IN": "தமிழ் (Tamil)",
  "te-IN": "తెలుగు (Telugu)",
  "kn-IN": "ಕನ್ನಡ (Kannada)",
  "ml-IN": "മലയാളം (Malayalam)",
  "mr-IN": "मराठी (Marathi)",
  "gu-IN": "ગુજરાતી (Gujarati)",
  "pa-IN": "ਪੰਜਾਬੀ (Punjabi)",
  "od-IN": "ଓଡ଼ିଆ (Odia)",
};

export default api;
