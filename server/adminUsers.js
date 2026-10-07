// Admin user directory: every user with their activity stats and Spark
// insights, searchable/sortable/pageable, plus CSV export.
const { ObjectId } = require("mongodb");
const { col } = require("./db");

const CACHE_MS = 60 * 1000;
let statsCache = { at: 0, byUser: null };

// One pass over executions → per-user counters. Cached briefly because it
// scans the whole collection; fine for thousands of users / millions of runs.
async function executionStats() {
  if (statsCache.byUser && Date.now() - statsCache.at < CACHE_MS) return statsCache.byUser;
  const rows = await (await col("executions"))
    .aggregate(
      [
        { $match: { status: { $in: ["success", "error"] } } },
        {
          $group: {
            _id: "$userId",
            runs: { $sum: 1 },
            solved: { $sum: { $cond: ["$hasError", 0, 1] } },
            lastActive: { $max: "$createdAt" },
          },
        },
      ],
      { allowDiskUse: true }
    )
    .toArray();
  const byUser = new Map(rows.map((r) => [String(r._id), r]));
  statsCache = { at: Date.now(), byUser };
  return byUser;
}

async function allUserRows() {
  const [users, insights, stats] = await Promise.all([
    (await col("users")).find({}, { projection: { passwordHash: 0 } }).toArray(),
    (await col("user_insights"))
      .find({}, { projection: { _id: 0, userId: 1, skillScore: 1, level: 1, percentile: 1, topLanguage: 1, currentStreak: 1, trend: 1 } })
      .toArray(),
    executionStats(),
  ]);
  const ins = new Map(insights.map((i) => [i.userId, i]));

  return users.map((u) => {
    const id = String(u._id);
    const st = stats.get(id) || { runs: 0, solved: 0, lastActive: null };
    const i = ins.get(id) || {};
    return {
      id,
      name: u.name,
      email: u.email,
      role: u.role,
      college: u.college || "",
      preferredLanguage: u.preferredLanguage || "en-IN",
      activityTier: u.activityTier || null,
      synthetic: Boolean(u.synthetic),
      createdAt: u.createdAt,
      runs: st.runs,
      solved: st.solved,
      successRate: st.runs ? Math.round((st.solved / st.runs) * 1000) / 10 : 0,
      lastActive: st.lastActive,
      skillScore: i.skillScore ?? null,
      level: i.level ?? null,
      percentile: i.percentile ?? null,
      topLanguage: i.topLanguage ?? null,
      currentStreak: i.currentStreak ?? null,
      trend: i.trend?.direction ?? null,
    };
  });
}

const SORTABLE = new Set(["name", "email", "createdAt", "runs", "solved", "successRate", "lastActive", "skillScore", "percentile", "currentStreak"]);

function filterSort(rows, { q, tier, level, sort = "skillScore", order = "desc" }) {
  let out = rows;
  if (q) {
    const needle = String(q).toLowerCase();
    out = out.filter((r) => r.name?.toLowerCase().includes(needle) || r.email?.toLowerCase().includes(needle) || r.college.toLowerCase().includes(needle));
  }
  if (tier) out = out.filter((r) => r.activityTier === tier);
  if (level) out = out.filter((r) => r.level === level);

  const key = SORTABLE.has(sort) ? sort : "skillScore";
  const dir = order === "asc" ? 1 : -1;
  return [...out].sort((a, b) => {
    const x = a[key];
    const y = b[key];
    if (x == null && y == null) return 0;
    if (x == null) return 1; // nulls last regardless of direction
    if (y == null) return -1;
    if (x instanceof Date || y instanceof Date) return (new Date(x) - new Date(y)) * dir;
    if (typeof x === "string") return x.localeCompare(y) * dir;
    return (x - y) * dir;
  });
}

async function listUsers(query) {
  const rows = filterSort(await allUserRows(), query);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 50, 1), 200);
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const tiers = rows.reduce((acc, r) => ((acc[r.activityTier || "real"] = (acc[r.activityTier || "real"] || 0) + 1), acc), {});
  return {
    total: rows.length,
    page,
    pages: Math.max(1, Math.ceil(rows.length / limit)),
    limit,
    tiers,
    users: rows.slice((page - 1) * limit, page * limit),
  };
}

const CSV_COLUMNS = [
  "id", "name", "email", "role", "college", "preferredLanguage", "activityTier", "createdAt", "runs", "solved",
  "successRate", "lastActive", "skillScore", "level", "percentile", "topLanguage", "currentStreak", "trend",
];

function csvCell(v) {
  if (v == null) return "";
  const s = v instanceof Date ? v.toISOString() : String(v);
  // Quote, and neutralise spreadsheet formula injection.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) || safe !== s ? `"${safe.replace(/"/g, '""')}"` : safe;
}

async function exportCsv(query) {
  const rows = filterSort(await allUserRows(), query);
  return [CSV_COLUMNS.join(","), ...rows.map((r) => CSV_COLUMNS.map((c) => csvCell(r[c])).join(","))].join("\n");
}

async function getUser(id) {
  if (!ObjectId.isValid(id)) return null;
  return (await col("users")).findOne({ _id: new ObjectId(id) }, { projection: { passwordHash: 0 } });
}

module.exports = { listUsers, exportCsv, getUser, filterSort, csvCell };
