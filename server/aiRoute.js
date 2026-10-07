// AI features powered by Sarvam AI (sarvam-105b), answering in the
// learner's own Indian language and grounded in their personal history.
const express = require("express");
const { ObjectId } = require("mongodb");
const { col } = require("./db");
const sarvam = require("./sarvam");
const metrics = require("./metrics");
const { getUserDashboard } = require("./analytics");
const { LANGUAGES } = require("./languages");

const router = express.Router();
const COACH_CACHE_MS = 6 * 60 * 60 * 1000;

async function userLanguage(userId, requested) {
  if (sarvam.UI_LANGUAGES[requested]) return requested;
  const user = await (await col("users")).findOne({ _id: new ObjectId(userId) }, { projection: { preferredLanguage: 1 } });
  return user?.preferredLanguage || "en-IN";
}

async function logInteraction(doc) {
  try {
    await (await col("ai_interactions")).insertOne({ ...doc, createdAt: new Date() });
  } catch (e) {
    console.warn("ai_interactions log failed:", e.message);
  }
}

function aiError(res, feature, err) {
  metrics.aiRequests.inc({ feature, outcome: "error" });
  console.error(`AI ${feature} error:`, err.message);
  const status = err.status === 503 ? 503 : 502;
  res.status(status).json({
    error: status === 503 ? "AI is not configured on this server (set SARVAM_API_KEY)." : "AI service failed, please retry.",
  });
}

router.get("/status", (req, res) => {
  res.json({ configured: sarvam.isConfigured(), languages: sarvam.UI_LANGUAGES });
});

/**
 * Explain an error (or output) for a run. Personalised with the user's
 * recurring mistakes so the explanation can say "you've hit this before".
 */
router.post("/explain", async (req, res) => {
  const userId = req.user.id;
  let { code = "", error = "", language = "python", jobId } = req.body;

  if (jobId) {
    const job = await (await col("executions")).findOne({ jobId, userId });
    if (job) {
      code = job.code;
      language = job.language;
      error = job.stderr || job.stdout || error;
    }
  }
  if (!LANGUAGES[language]) return res.status(400).json({ error: "Unsupported language" });

  const target = await userLanguage(userId, req.body.responseLanguage);
  const langName = sarvam.UI_LANGUAGES[target];

  // Personal context: what this learner keeps getting wrong.
  const history = await (await col("executions"))
    .aggregate([
      { $match: { userId, hasError: true, language } },
      { $group: { _id: "$errorType", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 },
    ])
    .toArray();
  const historyText = history.length
    ? history.map((h) => `${h._id} ×${h.count}`).join(", ")
    : "no previous errors recorded";

  const system =
    "You are a patient programming mentor for Indian college students. " +
    "Reply ONLY with a JSON object. " +
    `Write all prose fields in ${langName} (use simple, conversational ${langName}; keep code, identifiers, ` +
    "keywords and error names in English). fixed_code must be the complete corrected program, not a diff.";

  const user = `Language: ${LANGUAGES[language].label}
Learner's recurring ${LANGUAGES[language].label} errors so far: ${historyText}

Program:
\`\`\`
${code.slice(0, 12000)}
\`\`\`

Compiler / runtime output:
\`\`\`
${String(error).slice(0, 4000)}
\`\`\`

Return JSON with exactly these keys:
{
  "title": "short name of the problem",
  "explanation": "why it happened, 2-4 sentences",
  "fix": "how to fix it, step by step",
  "concept": "the underlying concept to learn",
  "practice_tip": "one tip, referencing the learner's recurring errors if relevant",
  "fixed_code": "full corrected program"
}`;

  try {
    const { data, usage, model } = await sarvam.chatJson({ system, user });
    metrics.aiRequests.inc({ feature: "explain", outcome: "ok" });
    await logInteraction({ userId, feature: "explain", language, responseLanguage: target, jobId, model, usage, title: data.title });
    res.json({ ...data, responseLanguage: target });
  } catch (err) {
    aiError(res, "explain", err);
  }
});

/**
 * Personalised coaching report built from the learner's dashboard data
 * (real-time aggregates + Spark-computed insights).
 */
router.post("/coach", async (req, res) => {
  const userId = req.user.id;
  const target = await userLanguage(userId, req.body.responseLanguage);
  const interactions = await col("ai_interactions");

  if (!req.body.refresh) {
    const cached = await interactions.findOne(
      { userId, feature: "coach", responseLanguage: target, createdAt: { $gte: new Date(Date.now() - COACH_CACHE_MS) } },
      { sort: { createdAt: -1 } }
    );
    if (cached?.result) return res.json({ ...cached.result, cached: true, generatedAt: cached.createdAt });
  }

  const [dash, profile] = await Promise.all([
    getUserDashboard(userId, { days: 30 }),
    (await col("users")).findOne({ _id: new ObjectId(userId) }, { projection: { name: 1, goal: 1, college: 1 } }),
  ]);
  if (!dash.summary.runs) {
    return res.json({
      headline: "Run your first program to unlock personalised coaching!",
      strengths: [],
      focus_areas: [],
      weekly_plan: [],
      motivation: "",
    });
  }

  const context = {
    name: profile?.name,
    goal: profile?.goal || "become a better programmer",
    summary: dash.summary,
    byLanguage: dash.byLanguage,
    topErrors: dash.topErrors.slice(0, 5),
    last30Days: dash.daily.slice(-14),
    insights: dash.insights && {
      skillScore: dash.insights.skillScore,
      percentile: dash.insights.percentile,
      level: dash.insights.level,
      trend: dash.insights.trend,
      weakAreas: dash.insights.weakAreas,
      languages: dash.insights.languages,
    },
  };

  const langName = sarvam.UI_LANGUAGES[target];
  const system =
    "You are an encouraging coding coach. Analyse the learner's real activity data and give specific, " +
    `data-backed advice. Reply ONLY with a JSON object, prose in ${langName} (technical terms in English).`;
  const user = `Learner data (JSON):
${JSON.stringify(context)}

Return JSON:
{
  "headline": "one-line summary of their progress, citing a number",
  "strengths": ["2-3 strengths with evidence from the data"],
  "focus_areas": [{"area": "...", "why": "evidence from data", "action": "concrete exercise"}],
  "weekly_plan": [{"day": "Mon", "task": "..."}],
  "motivation": "one short motivating line"
}`;

  try {
    const { data, usage, model } = await sarvam.chatJson({ system, user, temperature: 0.4 });
    metrics.aiRequests.inc({ feature: "coach", outcome: "ok" });
    await logInteraction({ userId, feature: "coach", responseLanguage: target, model, usage, result: data });
    res.json({ ...data, cached: false, generatedAt: new Date() });
  } catch (err) {
    aiError(res, "coach", err);
  }
});

router.post("/translate", async (req, res) => {
  const text = String(req.body.text || "").slice(0, 8000);
  const target = req.body.target;
  if (!sarvam.UI_LANGUAGES[target]) return res.status(400).json({ error: "Unsupported target language" });
  try {
    const translated = await sarvam.translate(text, target);
    metrics.aiRequests.inc({ feature: "translate", outcome: "ok" });
    await logInteraction({ userId: req.user.id, feature: "translate", responseLanguage: target, chars: text.length });
    res.json({ text: translated, target });
  } catch (err) {
    aiError(res, "translate", err);
  }
});

module.exports = router;
