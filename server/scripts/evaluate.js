// Measure CloudExec and print a results table.
//
//   node scripts/evaluate.js --sandbox                 # runs eval/benchmark.js in the real Docker sandbox
//   node scripts/evaluate.js --ai --langs en-IN,hi-IN  # + Sarvam explain quality/latency (needs SARVAM_API_KEY)
//   node scripts/evaluate.js --db                      # platform usage stats from MongoDB (needs MONGO_URI)
//   node scripts/evaluate.js --all
//
// On the production VM:
//   docker compose -f docker-compose.prod.yml exec api node scripts/evaluate.js --db
//   docker compose -f docker-compose.prod.yml exec worker node scripts/evaluate.js --sandbox --ai --langs en-IN,hi-IN
//
// Every number is computed from a run, never typed in. Results are also saved
// as JSON under eval/results/.
const fs = require("fs");
const path = require("path");
const { runDocker } = require("../executor");
const { classify } = require("../errorClassifier");
const sarvam = require("../sarvam");
const { buildExplainPrompt, stripCodeFence } = require("../aiRoute");
const BENCH = require("../eval/benchmark");

// Accepts --flag, --key=value and --key value.
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const [k, v] = process.argv[i].replace(/^--/, "").split("=");
  const next = process.argv[i + 1];
  args[k] = v ?? (next && !next.startsWith("--") ? (i++, next) : true);
}
const ALL = Boolean(args.all);
const CONCURRENCY = parseInt(args.concurrency || "4", 10);
const AI_CONCURRENCY = parseInt(args["ai-concurrency"] || "2", 10);
const AI_LANGS = String(args.langs || "en-IN").split(",");

// ── helpers ──
const pct = (n, d) => (d ? +((100 * n) / d).toFixed(1) : null);
const round = (x, p = 0) => (x == null || Number.isNaN(x) ? null : +x.toFixed(p));
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
function quantile(xs, q) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * q;
  const lo = Math.floor(i);
  return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo);
}
const dist = (xs, p = 0) => ({ n: xs.length, avg: round(mean(xs), p), p50: round(quantile(xs, 0.5), p), p90: round(quantile(xs, 0.9), p), max: round(xs.length ? Math.max(...xs) : null, p) });

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    })
  );
  return out;
}

const sameOutput = (a, b) => String(a).trim().replace(/\r/g, "") === String(b).trim();

/** Precision / recall / F1 per class, plus macro averages over classes present in truth or predictions. */
function prf(pairs) {
  const classes = [...new Set(pairs.flatMap(([t, p]) => [t, p]))].sort();
  const per = classes.map((c) => {
    const tp = pairs.filter(([t, p]) => t === c && p === c).length;
    const fp = pairs.filter(([t, p]) => t !== c && p === c).length;
    const fn = pairs.filter(([t, p]) => t === c && p !== c).length;
    const precision = tp + fp ? tp / (tp + fp) : 0;
    const recall = tp + fn ? tp / (tp + fn) : 0;
    const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
    return { class: c, support: tp + fn, precision: round(precision, 3), recall: round(recall, 3), f1: round(f1, 3) };
  });
  const m = (k) => round(mean(per.map((x) => x[k])), 3);
  return { perClass: per, macro: { precision: m("precision"), recall: m("recall"), f1: m("f1") } };
}

// ── 1. sandbox + classifier ──
async function evalSandbox() {
  console.error(`sandbox: running ${BENCH.length} programs, concurrency ${CONCURRENCY}…`);
  const t0 = Date.now();
  const runs = await pool(BENCH, CONCURRENCY, async (c) => {
    const r = await runDocker(c.language, c.code, c.input).catch((e) => ({ error: e.message }));
    const pred = r.error ? { errorCategory: "sandbox_failure", errorType: null } : classify(r);
    return { case: c, r, pred };
  });
  const elapsedMs = Date.now() - t0;

  const okCases = runs.filter((x) => x.case.label.category === "none");
  const bugCases = runs.filter((x) => x.case.label.category !== "none");
  const correctOk = okCases.filter((x) => x.r.exitCode === 0 && sameOutput(x.r.stdout, x.case.expectOutput));
  const completed = runs.filter((x) => !x.r.error);
  const limitCases = runs.filter((x) => ["timeout", "memory_limit", "output_limit"].includes(x.case.label.category));
  const contained = limitCases.filter((x) => !x.r.error && x.r.exitCode !== 0 && x.r.wallTime <= 15000);

  const catPairs = runs.map((x) => [x.case.label.category, x.pred.errorCategory]);
  const detPairs = runs.map((x) => [x.case.label.category === "none" ? "ok" : "error", x.pred.errorCategory === "none" ? "ok" : "error"]);
  const category = prf(catPairs);
  const detection = prf(detPairs).perClass.find((c) => c.class === "error");
  const catCorrect = catPairs.filter(([t, p]) => t === p).length;
  const typeCorrect = bugCases.filter((x) => x.pred.errorType === x.case.label.type).length;

  const nonLimit = completed.filter((x) => !x.r.timedOut);
  const byLang = {};
  for (const x of nonLimit) (byLang[x.case.language] ||= []).push(x.r.wallTime);

  const misses = runs
    .filter((x) => x.case.label.category !== x.pred.errorCategory || (x.case.label.type && x.case.label.type !== x.pred.errorType))
    .map((x) => ({ id: x.case.id, expected: x.case.label, got: x.pred }));

  return {
    benchmark: { programs: runs.length, correctPrograms: okCases.length, buggyPrograms: bugCases.length, languages: [...new Set(runs.map((x) => x.case.language))].length },
    executionCorrectness: pct(correctOk.length, okCases.length),
    completionRate: pct(completed.length, runs.length),
    limitContainment: { contained: contained.length, of: limitCases.length, pct: pct(contained.length, limitCases.length) },
    detection: { precision: detection.precision, recall: detection.recall, f1: detection.f1 },
    categoryAccuracy: pct(catCorrect, runs.length),
    categoryMacro: category.macro,
    categoryPerClass: category.perClass,
    typeAccuracy: pct(typeCorrect, bugCases.length),
    programRuntimeMs: dist(correctOk.map((x) => x.r.runtime)),
    wallTimeMs: dist(nonLimit.map((x) => x.r.wallTime)),
    wallTimeByLanguageMs: Object.fromEntries(Object.entries(byLang).map(([k, v]) => [k, round(mean(v))])),
    timeoutKillMs: dist(completed.filter((x) => x.r.timedOut).map((x) => x.r.wallTime)),
    throughput: { concurrency: CONCURRENCY, elapsedSec: round(elapsedMs / 1000, 1), jobsPerMin: round((runs.length / elapsedMs) * 60000, 1) },
    misses,
    _runs: runs,
  };
}

// ── 2. Sarvam explain quality ──
const SCRIPTS = {
  "hi-IN": /[ऀ-ॿ]/g, "mr-IN": /[ऀ-ॿ]/g, "bn-IN": /[ঀ-৿]/g, "pa-IN": /[਀-੿]/g,
  "gu-IN": /[઀-૿]/g, "od-IN": /[଀-୿]/g, "ta-IN": /[஀-௿]/g, "te-IN": /[ఀ-౿]/g,
  "kn-IN": /[ಀ-೿]/g, "ml-IN": /[ഀ-ൿ]/g,
};
function nativeShare(text, lang) {
  const re = SCRIPTS[lang];
  if (!re) return null;
  const native = (text.match(re) || []).length;
  const latin = (text.match(/[A-Za-z]/g) || []).length;
  return native + latin ? native / (native + latin) : 0;
}

async function evalAi(sandboxRuns) {
  if (!sarvam.isConfigured()) {
    console.error("ai: SARVAM_API_KEY not set, skipping");
    return { skipped: "SARVAM_API_KEY not set" };
  }
  const runs = sandboxRuns || (await evalSandbox())._runs;
  const buggy = runs.filter((x) => x.case.label.category !== "none" && !x.r.error);
  const out = {};

  for (const lang of AI_LANGS) {
    console.error(`ai: explaining ${buggy.length} failing programs in ${lang}, concurrency ${AI_CONCURRENCY}…`);
    const results = await pool(buggy, AI_CONCURRENCY, async (x) => {
      const { system, user } = buildExplainPrompt({
        code: x.case.code,
        error: x.r.stderr || x.r.stdout,
        language: x.case.language,
        target: lang,
      });
      const started = Date.now();
      try {
        const { data, usage } = await sarvam.chatJson({ system, user });
        const latencyMs = Date.now() - started;
        const keysOk = ["title", "explanation", "fix", "fixed_code"].every((k) => typeof data[k] === "string" && data[k].trim());
        const prose = [data.title, data.explanation, data.fix, data.concept].join(" ");
        const identified = x.case.keywords.some((k) => prose.toLowerCase().includes(k.toLowerCase()));

        let fixRuns = false;
        let fixCorrect = null;
        if (keysOk) {
          const fr = await runDocker(x.case.language, stripCodeFence(data.fixed_code), x.case.input).catch(() => null);
          fixRuns = Boolean(fr && fr.exitCode === 0 && !fr.timedOut && !fr.outputTruncated);
          if (x.case.fixOutput != null) fixCorrect = fixRuns && sameOutput(fr.stdout, x.case.fixOutput);
        }
        return { id: x.case.id, ok: true, keysOk, latencyMs, tokens: usage?.total_tokens ?? null, identified, fixRuns, fixCorrect, native: nativeShare(prose, lang) };
      } catch (e) {
        return { id: x.case.id, ok: false, latencyMs: Date.now() - started, error: e.message };
      }
    });

    const okR = results.filter((r) => r.ok);
    const withExpected = okR.filter((r) => r.fixCorrect !== null);
    out[lang] = {
      requests: results.length,
      successRate: pct(okR.length, results.length),
      validJsonRate: pct(okR.filter((r) => r.keysOk).length, results.length),
      // Keyword check only meaningful when the prose is in English.
      identificationAccuracy: lang === "en-IN" ? pct(okR.filter((r) => r.identified).length, results.length) : null,
      fixRunsRate: pct(okR.filter((r) => r.fixRuns).length, results.length),
      fixCorrectRate: pct(withExpected.filter((r) => r.fixCorrect).length, withExpected.length),
      fixCorrectOf: withExpected.length,
      nativeScriptShare: lang === "en-IN" ? null : round(100 * mean(okR.map((r) => r.native ?? 0)), 1),
      latencyMs: dist(okR.map((r) => r.latencyMs)),
      tokens: dist(okR.map((r) => r.tokens).filter((t) => t != null)),
      failures: results.filter((r) => !r.ok || !r.identified || !r.fixRuns).map((r) => ({ id: r.id, error: r.error, identified: r.identified, fixRuns: r.fixRuns })),
    };
  }
  return out;
}

// ── 3. platform data in MongoDB ──
async function evalDb() {
  const { col, close } = require("../db");
  const users = await col("users");
  const ex = await col("executions");
  const ai = await col("ai_interactions");
  const ins = await col("user_insights");

  const p = (field) => ({ $percentile: { input: field, p: [0.5, 0.9, 0.99], method: "approximate" } });
  const execStats = async (match) => {
    const [r] = await ex
      .aggregate([
        { $match: match },
        {
          $group: {
            _id: null,
            submissions: { $sum: 1 },
            students: { $addToSet: "$userId" },
            success: { $sum: { $cond: ["$hasError", 0, 1] } },
            runtimeAvg: { $avg: "$runtime" },
            runtimeP: p("$runtime"),
            queueAvg: { $avg: "$queueMs" },
            queueP: p("$queueMs"),
            e2eP: p({ $subtract: ["$completedAt", "$createdAt"] }),
            first: { $min: "$createdAt" },
            last: { $max: "$createdAt" },
          },
        },
        { $project: { _id: 0, submissions: 1, students: { $size: "$students" }, success: 1, runtimeAvg: 1, runtimeP: 1, queueAvg: 1, queueP: 1, e2eP: 1, first: 1, last: 1 } },
      ])
      .toArray();
    if (!r) return { submissions: 0 };
    return {
      submissions: r.submissions,
      students: r.students,
      successRate: pct(r.success, r.submissions),
      runtimeMs: { avg: round(r.runtimeAvg), p50: round(r.runtimeP[0]), p90: round(r.runtimeP[1]), p99: round(r.runtimeP[2]) },
      queueMs: { avg: round(r.queueAvg), p50: round(r.queueP[0]), p90: round(r.queueP[1]) },
      endToEndMs: { p50: round(r.e2eP[0]), p90: round(r.e2eP[1]) },
      period: { from: r.first, to: r.last },
    };
  };

  const real = { source: { $ne: "seed" } };
  const [all, live, byLang, cats, topErrors] = await Promise.all([
    execStats({}),
    execStats(real),
    ex.aggregate([{ $group: { _id: "$language", n: { $sum: 1 }, ok: { $sum: { $cond: ["$hasError", 0, 1] } }, rt: { $avg: "$runtime" } } }, { $sort: { n: -1 } }]).toArray(),
    ex.aggregate([{ $match: { hasError: true } }, { $group: { _id: "$errorCategory", n: { $sum: 1 } } }, { $sort: { n: -1 } }]).toArray(),
    ex.aggregate([{ $match: { hasError: true } }, { $group: { _id: "$errorType", n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 5 }]).toArray(),
  ]);

  const [uTotal, uSynthetic, uAdmins] = await Promise.all([
    users.countDocuments({}),
    users.countDocuments({ synthetic: true }),
    users.countDocuments({ role: "admin" }),
  ]);
  const tiers = await users.aggregate([{ $match: { activityTier: { $exists: true } } }, { $group: { _id: "$activityTier", n: { $sum: 1 } } }]).toArray();
  const solved = await ex
    .aggregate([{ $match: { hasError: false } }, { $group: { _id: "$userId", n: { $sum: 1 } } }, { $group: { _id: null, avg: { $avg: "$n" }, min: { $min: "$n" } } }])
    .toArray();

  const aiByFeature = await ai
    .aggregate([
      { $group: { _id: "$feature", n: { $sum: 1 }, users: { $addToSet: "$userId" }, langs: { $addToSet: "$responseLanguage" }, lat: { $push: "$latencyMs" } } },
      { $project: { n: 1, users: { $size: "$users" }, langs: 1, lat: { $filter: { input: "$lat", cond: { $ne: ["$$this", null] } } } } },
    ])
    .toArray();

  const [insightStats] = await ins
    .aggregate([{ $group: { _id: null, users: { $sum: 1 }, avgScore: { $avg: "$skillScore" }, last: { $max: "$computedAt" } } }])
    .toArray();
  const levels = await ins.aggregate([{ $group: { _id: "$level", n: { $sum: 1 } } }, { $sort: { n: -1 } }]).toArray();
  const [lake] = await (await col("platform_daily")).aggregate([{ $group: { _id: null, days: { $sum: 1 } } }]).toArray();

  await close();
  return {
    users: { total: uTotal, synthetic: uSynthetic, real: uTotal - uSynthetic, admins: uAdmins, tiers: Object.fromEntries(tiers.map((t) => [t._id, t.n])) },
    solvedPerStudent: solved[0] ? { avg: round(solved[0].avg, 1), min: solved[0].min } : null,
    executions: { all, realOnly: live },
    byLanguage: byLang.map((l) => ({ language: l._id, submissions: l.n, successRate: pct(l.ok, l.n), avgRuntimeMs: round(l.rt) })),
    errorCategories: cats.map((c) => ({ category: c._id, count: c.n })),
    topErrorTypes: topErrors.map((c) => ({ type: c._id, count: c.n })),
    ai: aiByFeature.map((f) => ({ feature: f._id, requests: f.n, users: f.users, languages: f.langs.length, latencyMs: dist(f.lat) })),
    insights: insightStats ? { profiles: insightStats.users, avgSkillScore: round(insightStats.avgScore, 1), lastComputed: insightStats.last, levels: Object.fromEntries(levels.map((l) => [l._id, l.n])) } : null,
    platformDailyDocs: lake?.days ?? 0,
  };
}

// ── report ──
function table(rows) {
  const lines = ["| Evaluation parameter | Result | How it was measured |", "|---|---|---|"];
  for (const [k, v, how] of rows) if (v != null && v !== "") lines.push(`| ${k} | ${v} | ${how} |`);
  return lines.join("\n");
}
const ms = (d) => (d && d.n ? `avg ${d.avg} ms · p50 ${d.p50} · p90 ${d.p90}` : null);
const sec = (d) => (d && d.n ? `avg ${(d.avg / 1000).toFixed(1)} s · p50 ${(d.p50 / 1000).toFixed(1)} s · p90 ${(d.p90 / 1000).toFixed(1)} s` : null);

function report({ sandbox, ai, db }) {
  const rows = [];
  if (db) {
    const a = db.executions.all;
    const r = db.executions.realOnly;
    rows.push(
      ["Total students (registered)", `${db.users.total} (${db.users.real} real, ${db.users.synthetic} synthetic)`, "MongoDB `users`; seeded accounts carry `synthetic: true`"],
      ["Students with ≥1 submission", a.students, "distinct userId in `executions`"],
      ["Total code submissions", `${a.submissions?.toLocaleString()} (${r.submissions} from the live editor)`, "MongoDB `executions`; seeded rows have `source: seed`"],
      ["Avg solved programs per student", db.solvedPerStudent && `${db.solvedPerStudent.avg} (min ${db.solvedPerStudent.min})`, "successful runs per userId"],
      ["Submission success rate (all)", a.successRate != null ? `${a.successRate}%` : null, "runs without error / all runs"],
      ["Submission success rate (live editor)", r.successRate != null ? `${r.successRate}%` : null, "same, real runs only"],
      ["Program runtime (live)", r.runtimeMs && `avg ${r.runtimeMs.avg} ms · p50 ${r.runtimeMs.p50} · p90 ${r.runtimeMs.p90}`, "time inside the sandbox, real runs"],
      ["Kafka queue wait (live)", r.queueMs && `avg ${r.queueMs.avg} ms · p50 ${r.queueMs.p50} · p90 ${r.queueMs.p90}`, "job created → worker picks it up"],
      ["End-to-end latency (live)", r.endToEndMs && `p50 ${r.endToEndMs.p50} ms · p90 ${r.endToEndMs.p90} ms`, "submit → result stored"],
      ["Most common error types", db.topErrorTypes.map((t) => `${t.type} (${t.count})`).join(", "), "classifier output across all runs"],
      ["Personalised skill profiles", db.insights && `${db.insights.profiles} (avg score ${db.insights.avgSkillScore})`, "Spark batch → `user_insights`"],
      ...db.ai.map((f) => [`AI ${f.feature} requests (live)`, `${f.requests} by ${f.users} students in ${f.languages} languages${f.latencyMs.n ? ` · ${sec(f.latencyMs)}` : ""}`, "MongoDB `ai_interactions`"])
    );
  }
  if (sandbox) {
    const s = sandbox;
    rows.push(
      ["Benchmark programs", `${s.benchmark.programs} (${s.benchmark.correctPrograms} correct, ${s.benchmark.buggyPrograms} buggy, ${s.benchmark.languages} languages)`, "labelled set in `server/eval/benchmark.js`"],
      ["Code execution correctness", `${s.executionCorrectness}%`, "correct programs that printed the expected output"],
      ["Sandbox completion rate", `${s.completionRate}%`, "runs that returned a result (no crash/hang)"],
      ["Resource-limit containment", `${s.limitContainment.pct}% (${s.limitContainment.contained}/${s.limitContainment.of})`, "infinite loops, memory bombs, output floods stopped within 15 s"],
      ["Error detection (error vs no error)", `P ${s.detection.precision} · R ${s.detection.recall} · F1 ${s.detection.f1}`, "binary, over all programs"],
      ["Error category accuracy", `${s.categoryAccuracy}%`, "7 classes incl. none"],
      ["Error category macro P / R / F1", `${s.categoryMacro.precision} / ${s.categoryMacro.recall} / ${s.categoryMacro.f1}`, "averaged over classes"],
      ["Exact error-type accuracy", `${s.typeAccuracy}%`, "e.g. IndexError, SegmentationFault, over buggy programs"],
      ["Program execution time", ms(s.programRuntimeMs), "inside the container, correct programs"],
      ["Sandbox turnaround per run", ms(s.wallTimeMs), "incl. container start + compile, excl. timeouts"],
      ["Turnaround by language", Object.entries(s.wallTimeByLanguageMs).map(([k, v]) => `${k} ${v} ms`).join(" · "), "avg wall time"],
      ["Infinite-loop kill time", s.timeoutKillMs.n ? `avg ${(s.timeoutKillMs.avg / 1000).toFixed(1)} s` : null, "10 s limit + 3 s start-up allowance"],
      ["Sandbox throughput", `${s.throughput.jobsPerMin} runs/min at concurrency ${s.throughput.concurrency}`, `${s.benchmark.programs} runs in ${s.throughput.elapsedSec} s`]
    );
  }
  if (ai && !ai.skipped) {
    for (const [lang, a] of Object.entries(ai)) {
      rows.push(
        [`AI feedback: identification accuracy (${lang})`, a.identificationAccuracy != null ? `${a.identificationAccuracy}%` : null, "explanation names the real cause (keyword check)"],
        [`AI feedback: valid structured reply (${lang})`, `${a.validJsonRate}%`, "JSON with title/explanation/fix/fixed_code"],
        [`AI fix: code runs cleanly (${lang})`, `${a.fixRunsRate}%`, "AI's fixed_code re-run in the sandbox, exit 0"],
        [`AI fix: correct output (${lang})`, `${a.fixCorrectRate}% (of ${a.fixCorrectOf})`, "fixed program prints the intended output"],
        [`AI reply in native script (${lang})`, a.nativeScriptShare != null ? `${a.nativeScriptShare}%` : null, "share of letters in the target script"],
        [`AI feedback generation time (${lang})`, sec(a.latencyMs), `${a.latencyMs.n} Sarvam calls`],
        [`AI tokens per reply (${lang})`, a.tokens.n ? `avg ${a.tokens.avg}` : null, "usage.total_tokens"]
      );
    }
  } else if (ai?.skipped) rows.push(["AI feedback metrics", "not run", ai.skipped]);
  return table(rows);
}

async function main() {
  const res = {};
  if (ALL || args.db) res.db = await evalDb();
  if (ALL || args.sandbox || args.ai) res.sandbox = await evalSandbox();
  if (ALL || args.ai) res.ai = await evalAi(res.sandbox._runs);

  const md = report(res);
  console.log(md);
  if (res.sandbox?.misses.length) {
    console.log("\nClassifier disagreements (expected → got):");
    for (const m of res.sandbox.misses) console.log(`  ${m.id}: ${m.expected.category}/${m.expected.type} → ${m.got.errorCategory}/${m.got.errorType}`);
  }

  if (res.sandbox) delete res.sandbox._runs;
  const dir = path.join(__dirname, "..", "eval", "results");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `eval-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(file, JSON.stringify({ at: new Date(), args, ...res, table: md }, null, 2));
  console.error(`\nsaved ${file}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
