#!/usr/bin/env node
// Synthetic workload generator — produces realistic, per-user execution
// histories so the Spark jobs and dashboards have big-data volume to chew on.
//
//   node scripts/seed.js --users 500 --events 200000 --days 60
//   node scripts/seed.js --users 50 --events 5000 --jsonl ../data/lake/seed.jsonl   (no Mongo, file only)
//   node scripts/seed.js --users 100 --events 20000 --kafka   (also stream events to Kafka → Spark streaming)
//   node scripts/seed.js --users 1000 --tiers --min-solved 51 --kafka
//       Activity tiers instead of --events: 20% heavy (500-900 runs), 50% medium
//       (180-350), 30% low (90-140). Every user ends with at least --min-solved
//       successful runs (default 51 with --tiers).
//
// Each synthetic user has a persona (skill, favourite languages, active
// hours, typical mistakes) and gets better over time, so the batch job has
// genuine trends to detect.
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { v4: uuidv4 } = require("uuid");

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1]?.startsWith("--") || arr[i + 1] === undefined ? "true" : arr[i + 1]]);
    return acc;
  }, [])
);
const N_USERS = parseInt(args.users || "200", 10);
const N_EVENTS = parseInt(args.events || "50000", 10);
const TIERS = args.tiers === "true";
const MIN_SOLVED = parseInt(args["min-solved"] || (TIERS ? "51" : "0"), 10);
const TIER_RUNS = { heavy: [500, 900], medium: [180, 350], low: [90, 140] };
const DAYS = parseInt(args.days || "60", 10);
const JSONL = args.jsonl;
const DEMO_PASSWORD = args.password || "password123";

let seed = parseInt(args.seed || "42", 10);
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const weighted = (pairs) => {
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [v, w] of pairs) if ((r -= w) <= 0) return v;
  return pairs[pairs.length - 1][0];
};
const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-9)) * Math.cos(2 * Math.PI * rand());

const LANGS = ["python", "cpp", "java", "c", "javascript"];
const ERRORS = {
  python: [["SyntaxError", "syntax_error"], ["IndentationError", "syntax_error"], ["NameError", "runtime_error"], ["TypeError", "runtime_error"], ["IndexError", "runtime_error"], ["KeyError", "runtime_error"], ["ZeroDivisionError", "runtime_error"], ["RecursionError", "runtime_error"], ["TimeLimitExceeded", "timeout"]],
  cpp: [["CSyntaxError", "syntax_error"], ["UndeclaredIdentifier", "compile_error"], ["NoMatchingFunction", "compile_error"], ["SegmentationFault", "runtime_error"], ["UncaughtException", "runtime_error"], ["TimeLimitExceeded", "timeout"], ["MemoryLimitExceeded", "memory_limit"]],
  c: [["CSyntaxError", "syntax_error"], ["UndeclaredIdentifier", "compile_error"], ["UndefinedReference", "compile_error"], ["SegmentationFault", "runtime_error"], ["FloatingPointException", "runtime_error"], ["TimeLimitExceeded", "timeout"]],
  java: [["JavaSyntaxError", "syntax_error"], ["CannotFindSymbol", "compile_error"], ["IncompatibleTypes", "compile_error"], ["NullPointerException", "runtime_error"], ["ArrayIndexOutOfBoundsException", "runtime_error"], ["StackOverflowError", "runtime_error"], ["TimeLimitExceeded", "timeout"]],
  javascript: [["SyntaxError", "syntax_error"], ["ReferenceError", "runtime_error"], ["TypeError", "runtime_error"], ["RangeError", "runtime_error"], ["TimeLimitExceeded", "timeout"]],
};
const BASE_RUNTIME = { python: 60, cpp: 15, c: 12, java: 140, javascript: 45 };
const FIRST = ["Aarav", "Diya", "Ishaan", "Ananya", "Vihaan", "Saanvi", "Arjun", "Meera", "Kabir", "Priya", "Rohan", "Kavya", "Aditya", "Sneha", "Rahul", "Pooja", "Karthik", "Lakshmi", "Siddharth", "Nisha"];
const LAST = ["Sharma", "Patel", "Iyer", "Reddy", "Nair", "Gupta", "Das", "Singh", "Kulkarni", "Banerjee", "Menon", "Joshi", "Rao", "Khan", "Pillai"];
const UI_LANGS = ["en-IN", "hi-IN", "ta-IN", "te-IN", "kn-IN", "mr-IN", "bn-IN", "ml-IN", "gu-IN"];

function makePersona(i) {
  const skill = Math.min(0.95, Math.max(0.05, 0.45 + 0.22 * gauss())); // 0..1
  const main = pick(LANGS);
  const langWeights = LANGS.map((l) => [l, l === main ? 6 : rand() < 0.4 ? 1.5 : 0.2]);
  const weakErrors = Object.fromEntries(LANGS.map((l) => [l, [pick(ERRORS[l]), pick(ERRORS[l])]]));
  return {
    name: `${pick(FIRST)} ${pick(LAST)}`,
    email: `student${i + 1}@demo.cloudexec.dev`,
    skill,
    learningRate: 0.002 + rand() * 0.01, // per active day
    activity: Math.pow(rand(), 1.6) + 0.05, // heavy-tailed
    tier: weighted([["heavy", 2], ["medium", 5], ["low", 3]]),
    peakHour: weighted([[10, 2], [14, 2], [17, 1], [21, 4], [23, 3], [1, 1]]),
    langWeights,
    weakErrors,
    uiLang: weighted(UI_LANGS.map((l) => [l, l === "en-IN" ? 4 : 1])),
  };
}

function* generateEvents(users) {
  const now = Date.now();
  const totalActivity = users.reduce((s, u) => s + u.persona.activity, 0);
  for (const u of users) {
    const p = u.persona;
    let n = Math.max(1, Math.round((p.activity / totalActivity) * N_EVENTS));
    if (TIERS) {
      const [lo, hi] = TIER_RUNS[p.tier];
      n = lo + Math.floor(rand() * (hi - lo + 1));
    }
    n = Math.max(n, MIN_SOLVED);
    let solved = 0;
    for (let k = 0; k < n; k++) {
      const progress = k / n; // later events → more experience
      const daysAgo = Math.floor(DAYS * (1 - progress) * (0.85 + 0.15 * rand()));
      const hour = (p.peakHour + Math.round(gauss() * 2.5) + 24) % 24;
      const created = new Date(now - daysAgo * 86400000);
      created.setUTCHours((hour - 5 + 24) % 24, Math.floor(rand() * 60), Math.floor(rand() * 60), 0); // IST→UTC
      if (created.getTime() > now) created.setTime(now - Math.floor(rand() * 3600000));

      const language = weighted(p.langWeights);
      const skillNow = Math.min(0.98, p.skill + p.learningRate * progress * DAYS);
      // Guarantee MIN_SOLVED: once the remaining runs equal the solves still
      // needed, the learner gets everything right (reads as late improvement).
      const mustSolve = MIN_SOLVED - solved >= n - k;
      const hasError = !mustSolve && rand() > skillNow * 0.85 + 0.1;
      if (!hasError) solved++;
      let errorType = null;
      let errorCategory = "none";
      if (hasError) {
        const [t, c] = rand() < 0.6 ? pick(p.weakErrors[language]) : pick(ERRORS[language]);
        errorType = t;
        errorCategory = c;
      }
      const compileFail = errorCategory === "compile_error" || errorCategory === "syntax_error";
      const runtime = errorCategory === "timeout"
        ? 10000
        : compileFail
          ? Math.round(5 + rand() * 20)
          : Math.max(1, Math.round(BASE_RUNTIME[language] * Math.exp(gauss() * 0.8) * (1.6 - skillNow)));
      const loc = Math.max(1, Math.round(15 + 60 * skillNow * rand() + gauss() * 8));
      const queueMs = Math.max(1, Math.round(30 * Math.exp(gauss() * 0.9)));

      yield {
        jobId: uuidv4(),
        userId: u.id,
        language,
        source: "seed",
        status: hasError ? "error" : "success",
        exitCode: hasError ? (errorCategory === "timeout" ? 124 : 1) : 0,
        runtime,
        wallTime: runtime + 400 + Math.round(rand() * 300),
        queueMs,
        hasError,
        errorCategory,
        errorType,
        codeBytes: loc * 28,
        linesOfCode: loc,
        workerId: `worker-${Math.floor(rand() * 3) + 1}`,
        createdAt: created,
        completedAt: new Date(created.getTime() + runtime + queueMs + 400),
      };
    }
  }
}

async function main() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const { ObjectId } = require("mongodb");
  const users = Array.from({ length: N_USERS }, (_, i) => {
    const persona = makePersona(i);
    return {
      id: new ObjectId().toHexString(),
      persona,
      doc: {
        email: persona.email,
        name: persona.name,
        passwordHash,
        role: "user",
        preferredLanguage: persona.uiLang,
        college: "Demo Institute of Technology",
        goal: "Crack placements",
        synthetic: true,
        ...(TIERS ? { activityTier: persona.tier } : {}),
        createdAt: new Date(Date.now() - DAYS * 86400000),
      },
    };
  });

  if (JSONL) {
    fs.mkdirSync(path.dirname(path.resolve(JSONL)), { recursive: true });
    const out = fs.createWriteStream(JSONL);
    let n = 0;
    for (const e of generateEvents(users)) {
      out.write(JSON.stringify({ ...e, createdAt: e.createdAt.toISOString(), completedAt: e.completedAt.toISOString() }) + "\n");
      n++;
    }
    out.end();
    fs.writeFileSync(
      path.join(path.dirname(path.resolve(JSONL)), "users.jsonl"),
      users.map((u) => JSON.stringify({ userId: u.id, name: u.doc.name })).join("\n") + "\n"
    );
    console.log(`✅ wrote ${n} events for ${N_USERS} users to ${JSONL}`);
    return;
  }

  const db = require("../db");
  const users_ = await db.col("users");
  const executions = await db.col("executions");

  for (const u of users) {
    const res = await users_.findOneAndUpdate(
      { email: u.doc.email },
      { $setOnInsert: { ...u.doc, _id: new ObjectId(u.id) } },
      { upsert: true, returnDocument: "after" }
    );
    u.id = String(res._id);
  }
  console.log(`👥 ${N_USERS} users ready (password: ${DEMO_PASSWORD})`);

  let producer = null;
  if (args.kafka) {
    const config = require("../config");
    const { kafka, connectProducer } = require("../kafkaProducer");
    await connectProducer();
    producer = kafka.producer();
    await producer.connect();
    producer.topic = config.kafka.eventsTopic;
  }
  const flush = async (rows) => {
    await executions.insertMany(rows, { ordered: false });
    // Kafka caps a record batch at ~1 MB by default, so send in slices.
    for (let i = 0; producer && i < rows.length; i += 1000) {
      await producer.send({
        topic: producer.topic,
        messages: rows.slice(i, i + 1000).map((e) => ({
          key: e.userId,
          value: JSON.stringify({ ...e, _id: undefined, createdAt: e.createdAt.toISOString(), completedAt: e.completedAt.toISOString() }),
        })),
      });
    }
  };

  let batch = [];
  let total = 0;
  const started = Date.now();
  for (const e of generateEvents(users)) {
    batch.push(e);
    if (batch.length === 5000) {
      await flush(batch);
      total += batch.length;
      batch = [];
      process.stdout.write(`\r📦 ${total} events inserted`);
    }
  }
  if (batch.length) {
    await flush(batch);
    total += batch.length;
  }
  if (producer) {
    await producer.disconnect();
    await require("../kafkaProducer").disconnectProducer();
  }
  const secs = (Date.now() - started) / 1000;
  console.log(`\r✅ ${total} events inserted in ${secs.toFixed(1)}s (${Math.round(total / secs)}/s)`);
  await db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
