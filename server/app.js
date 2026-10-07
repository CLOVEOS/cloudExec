// Express application (no listen()) so tests can mount it directly.
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const config = require("./config");
const db = require("./db");
const auth = require("./auth");
const aiRoute = require("./aiRoute");
const metrics = require("./metrics");
const { SUPPORTED, LANGUAGES } = require("./languages");
const { createJob, processJob, publicJob } = require("./jobs");
const { getUserDashboard, getPlatformAnalytics } = require("./analytics");

const app = express();
app.set("trust proxy", 1);
app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN?.split(",") || true }));
app.use(express.json({ limit: "256kb" }));
app.use(metrics.httpMiddleware);

const perUser = (limit) =>
  rateLimit({
    windowMs: 60 * 1000,
    limit,
    keyGenerator: (req) => req.user?.id || rateLimit.ipKeyGenerator(req.ip),
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many requests, slow down a little." },
  });

// ── Ops ─────────────────────────────────────────────────────────
app.get("/healthz", (req, res) => res.json({ ok: true }));
app.get("/readyz", async (req, res) => {
  try {
    await db.ping();
    res.json({ ok: true, mode: config.kafka.enabled ? "kafka" : "sync" });
  } catch (e) {
    res.status(503).json({ ok: false, error: e.message });
  }
});
app.get("/metrics", async (req, res) => {
  res.set("Content-Type", metrics.register.contentType);
  res.end(await metrics.register.metrics());
});

// ── Public API ──────────────────────────────────────────────────
const api = express.Router();
api.use("/auth", rateLimit({ windowMs: 15 * 60 * 1000, limit: 50 }), auth.router);
api.get("/languages", (req, res) =>
  res.json(SUPPORTED.map((id) => ({ id, label: LANGUAGES[id].label })))
);

// Everything below requires a logged-in user.
api.use(auth.requireAuth);

api.post("/compile", perUser(config.rateLimit.compilePerMinute), async (req, res) => {
  const code = typeof req.body.code === "string" ? req.body.code : "";
  const language = req.body.language || "python";
  const input = typeof req.body.input === "string" ? req.body.input : "";

  if (!SUPPORTED.includes(language)) return res.status(400).json({ error: "Unsupported language" });
  if (!code.trim()) return res.status(400).json({ error: "Code is empty" });
  if (Buffer.byteLength(code) > config.sandbox.maxCodeBytes) return res.status(413).json({ error: "Code too large" });
  if (Buffer.byteLength(input) > config.sandbox.maxInputBytes) return res.status(413).json({ error: "Input too large" });

  const job = await createJob({ userId: req.user.id, language, code, input });

  if (config.kafka.enabled) {
    const { publishJob } = require("./kafkaProducer");
    await publishJob({ jobId: job.jobId, userId: job.userId, language, code, input, createdAt: job.createdAt });
    return res.status(202).json({ jobId: job.jobId, status: "queued" });
  }

  // Sync mode (local dev without Kafka): execute inline.
  const result = await processJob({ ...job, input });
  res.json(publicJob(result));
});

api.get("/jobs/:jobId", async (req, res) => {
  const job = await (await db.col("executions")).findOne({ jobId: req.params.jobId, userId: req.user.id });
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json(publicJob(job));
});

api.get("/me/dashboard", async (req, res) => {
  const days = Math.min(Math.max(parseInt(req.query.days || "90", 10) || 90, 7), 365);
  res.json(await getUserDashboard(req.user.id, { days }));
});

api.get("/me/history", async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || "50", 10) || 50, 200);
  const filter = { userId: req.user.id };
  if (SUPPORTED.includes(req.query.language)) filter.language = req.query.language;
  if (req.query.status === "error") filter.hasError = true;
  if (req.query.status === "success") filter.hasError = false;
  const rows = await (await db.col("executions"))
    .find(filter, { projection: { _id: 0, stdout: 0, stderr: 0, userId: 0 } })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
  res.json(rows);
});

api.use("/ai", perUser(config.rateLimit.aiPerMinute), aiRoute);

api.get("/admin/analytics", auth.requireAdmin, async (req, res) => {
  res.json(await getPlatformAnalytics());
});

app.use("/api", api);

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

module.exports = app;
