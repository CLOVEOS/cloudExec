// Real-time analytics served straight from MongoDB aggregations.
// Heavier, cross-user features (skill scores, percentiles, trends) are
// computed in batch by Spark and read back from `user_insights`.
const { ObjectId } = require("mongodb");
const { col } = require("./db");

const TZ = process.env.ANALYTICS_TZ || "Asia/Kolkata";
const DAY = 24 * 60 * 60 * 1000;

const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : 0);

/** Current + longest streak from a sorted list of YYYY-MM-DD strings. */
function computeStreaks(days, today = new Date()) {
  if (!days.length) return { current: 0, longest: 0 };
  const toNum = (s) => Math.round(Date.parse(s + "T00:00:00Z") / DAY);
  const nums = [...new Set(days.map(toNum))].sort((a, b) => a - b);

  let longest = 1;
  let run = 1;
  for (let i = 1; i < nums.length; i++) {
    run = nums[i] === nums[i - 1] + 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
  }

  const todayStr = today.toLocaleDateString("en-CA", { timeZone: TZ });
  const todayNum = toNum(todayStr);
  const last = nums[nums.length - 1];
  let current = 0;
  if (last === todayNum || last === todayNum - 1) {
    current = 1;
    for (let i = nums.length - 1; i > 0 && nums[i] === nums[i - 1] + 1; i--) current++;
  }
  return { current, longest };
}

async function getUserDashboard(userId, { days = 90 } = {}) {
  const executions = await col("executions");
  const since = new Date(Date.now() - days * DAY);
  const done = { userId, status: { $in: ["success", "error"] } };

  const [facets] = await executions
    .aggregate([
      { $match: done },
      {
        $facet: {
          totals: [
            {
              $group: {
                _id: null,
                runs: { $sum: 1 },
                errors: { $sum: { $cond: ["$hasError", 1, 0] } },
                avgRuntime: { $avg: "$runtime" },
                p50: { $percentile: { input: "$runtime", p: [0.5], method: "approximate" } },
                p90: { $percentile: { input: "$runtime", p: [0.9], method: "approximate" } },
                linesWritten: { $sum: "$linesOfCode" },
                firstRun: { $min: "$createdAt" },
                lastRun: { $max: "$createdAt" },
              },
            },
          ],
          byLanguage: [
            {
              $group: {
                _id: "$language",
                runs: { $sum: 1 },
                errors: { $sum: { $cond: ["$hasError", 1, 0] } },
                avgRuntime: { $avg: "$runtime" },
              },
            },
            { $sort: { runs: -1 } },
          ],
          errorCategories: [
            { $match: { hasError: true } },
            { $group: { _id: "$errorCategory", count: { $sum: 1 } } },
            { $sort: { count: -1 } },
          ],
          errorTypes: [
            { $match: { hasError: true } },
            { $group: { _id: { type: "$errorType", language: "$language" }, count: { $sum: 1 }, last: { $max: "$createdAt" } } },
            { $sort: { count: -1 } },
            { $limit: 8 },
          ],
          daily: [
            { $match: { createdAt: { $gte: since } } },
            {
              $group: {
                _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: TZ } },
                runs: { $sum: 1 },
                errors: { $sum: { $cond: ["$hasError", 1, 0] } },
              },
            },
            { $sort: { _id: 1 } },
          ],
          allDays: [
            { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: TZ } } } },
            { $sort: { _id: 1 } },
          ],
          hourly: [
            { $group: { _id: { $hour: { date: "$createdAt", timezone: TZ } }, runs: { $sum: 1 } } },
            { $sort: { _id: 1 } },
          ],
          recent: [
            { $sort: { createdAt: -1 } },
            { $limit: 15 },
            { $project: { _id: 0, jobId: 1, language: 1, status: 1, runtime: 1, errorType: 1, errorCategory: 1, createdAt: 1, linesOfCode: 1 } },
          ],
        },
      },
    ])
    .toArray();

  const [insights, aiUsage] = await Promise.all([
    (await col("user_insights")).findOne({ userId }, { projection: { _id: 0 } }),
    (await col("ai_interactions"))
      .aggregate([{ $match: { userId } }, { $group: { _id: "$feature", count: { $sum: 1 } } }])
      .toArray(),
  ]);

  const t = facets.totals[0] || { runs: 0, errors: 0 };
  const peak = facets.hourly.reduce((a, b) => (b.runs > (a?.runs || 0) ? b : a), null);

  return {
    summary: {
      runs: t.runs,
      errors: t.errors,
      successRate: pct(t.runs - t.errors, t.runs),
      avgRuntime: t.avgRuntime ? Math.round(t.avgRuntime) : null,
      p50Runtime: t.p50 ? Math.round(t.p50[0]) : null,
      p90Runtime: t.p90 ? Math.round(t.p90[0]) : null,
      linesWritten: t.linesWritten || 0,
      firstRun: t.firstRun || null,
      lastRun: t.lastRun || null,
      activeDays: facets.allDays.length,
      peakHour: peak ? peak._id : null,
      streak: computeStreaks(facets.allDays.map((d) => d._id)),
    },
    byLanguage: facets.byLanguage.map((l) => ({
      language: l._id,
      runs: l.runs,
      errors: l.errors,
      successRate: pct(l.runs - l.errors, l.runs),
      avgRuntime: Math.round(l.avgRuntime || 0),
    })),
    errorCategories: facets.errorCategories.map((e) => ({ category: e._id, count: e.count })),
    topErrors: facets.errorTypes.map((e) => ({ type: e._id.type, language: e._id.language, count: e.count, last: e.last })),
    daily: facets.daily.map((d) => ({ date: d._id, runs: d.runs, errors: d.errors })),
    hourly: facets.hourly.map((h) => ({ hour: h._id, runs: h.runs })),
    recent: facets.recent,
    aiUsage: Object.fromEntries(aiUsage.map((a) => [a._id, a.count])),
    insights, // null until the Spark batch job has run
    windowDays: days,
  };
}

async function getPlatformAnalytics() {
  const executions = await col("executions");
  const now = Date.now();
  const done = { status: { $in: ["success", "error"] } };

  const [facets] = await executions
    .aggregate([
      { $match: done },
      {
        $facet: {
          totals: [
            {
              $group: {
                _id: null,
                runs: { $sum: 1 },
                errors: { $sum: { $cond: ["$hasError", 1, 0] } },
                avgQueueMs: { $avg: "$queueMs" },
                p95: { $percentile: { input: "$runtime", p: [0.95], method: "approximate" } },
              },
            },
          ],
          byLanguage: [
            {
              $group: {
                _id: "$language",
                runs: { $sum: 1 },
                errors: { $sum: { $cond: ["$hasError", 1, 0] } },
                p50: { $percentile: { input: "$runtime", p: [0.5], method: "approximate" } },
                p95: { $percentile: { input: "$runtime", p: [0.95], method: "approximate" } },
              },
            },
            { $sort: { runs: -1 } },
          ],
          topErrors: [
            { $match: { hasError: true } },
            { $group: { _id: { type: "$errorType", language: "$language" }, count: { $sum: 1 }, users: { $addToSet: "$userId" } } },
            { $project: { count: 1, users: { $size: "$users" } } },
            { $sort: { count: -1 } },
            { $limit: 10 },
          ],
          hourly: [
            { $match: { createdAt: { $gte: new Date(now - DAY) } } },
            { $group: { _id: { $hour: { date: "$createdAt", timezone: TZ } }, runs: { $sum: 1 } } },
            { $sort: { _id: 1 } },
          ],
          dau: [
            { $match: { createdAt: { $gte: new Date(now - DAY) } } },
            { $group: { _id: "$userId" } },
            { $count: "n" },
          ],
          wau: [
            { $match: { createdAt: { $gte: new Date(now - 7 * DAY) } } },
            { $group: { _id: "$userId" } },
            { $count: "n" },
          ],
          workers: [
            { $match: { createdAt: { $gte: new Date(now - DAY) }, workerId: { $exists: true } } },
            { $group: { _id: "$workerId", jobs: { $sum: 1 } } },
            { $sort: { jobs: -1 } },
          ],
        },
      },
    ])
    .toArray();

  const [users, leaderboard, daily, live] = await Promise.all([
    (await col("users")).countDocuments(),
    (await col("user_insights"))
      .find({}, { projection: { _id: 0, userId: 1, skillScore: 1, percentile: 1, level: 1, totalRuns: 1, topLanguage: 1 } })
      .sort({ skillScore: -1 })
      .limit(10)
      .toArray(),
    (await col("platform_daily")).find({}, { projection: { _id: 0 } }).sort({ date: -1 }).limit(30).toArray(),
    // Spark Structured Streaming output: last hour of 1-minute windows.
    (await col("live_metrics"))
      .aggregate([
        { $match: { windowStart: { $gte: new Date(now - 60 * 60 * 1000) } } },
        { $group: { _id: "$windowStart", runs: { $sum: "$runs" }, errors: { $sum: "$errors" } } },
        { $sort: { _id: 1 } },
      ])
      .toArray(),
  ]);

  // Attach display names to the leaderboard.
  const ids = leaderboard.map((l) => l.userId).filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));
  const names = new Map(
    (await (await col("users")).find({ _id: { $in: ids } }, { projection: { name: 1 } }).toArray()).map((u) => [String(u._id), u.name])
  );
  for (const row of leaderboard) row.name = names.get(row.userId) || "Unknown";

  const t = facets.totals[0] || { runs: 0, errors: 0 };
  return {
    summary: {
      users,
      runs: t.runs,
      errors: t.errors,
      errorRate: pct(t.errors, t.runs),
      avgQueueMs: t.avgQueueMs ? Math.round(t.avgQueueMs) : null,
      p95Runtime: t.p95 ? Math.round(t.p95[0]) : null,
      dau: facets.dau[0]?.n || 0,
      wau: facets.wau[0]?.n || 0,
    },
    byLanguage: facets.byLanguage.map((l) => ({
      language: l._id,
      runs: l.runs,
      errorRate: pct(l.errors, l.runs),
      p50: Math.round(l.p50?.[0] || 0),
      p95: Math.round(l.p95?.[0] || 0),
    })),
    topErrors: facets.topErrors.map((e) => ({ type: e._id.type, language: e._id.language, count: e.count, users: e.users })),
    hourly: facets.hourly.map((h) => ({ hour: h._id, runs: h.runs })),
    workers: facets.workers.map((w) => ({ workerId: w._id, jobs: w.jobs })),
    leaderboard,
    daily: daily.reverse(),
    live: live.map((w) => ({ t: w._id, runs: w.runs, errors: w.errors })),
  };
}

module.exports = { getUserDashboard, getPlatformAnalytics, computeStreaks };
