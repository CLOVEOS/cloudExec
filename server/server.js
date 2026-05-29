require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const { publishJob } = require("./kafkaProducer");
const { startConsumer, getResult } = require("./kafkaConsumer");
const { getAnalytics } = require("./db");
const aiRoute = require("./aiRoute");

const app = express();
const PORT = process.env.PORT || 8000;

// Fallback: direct Docker execution (no Kafka) for local dev without Kafka
const USE_KAFKA = process.env.USE_KAFKA === "true";
const { runDocker } = require("./executor");
const { saveExecution } = require("./db");


app.use(cors());
app.use(express.json());


app.use("/ai", aiRoute);


app.post("/compile", async (req, res) => {
  const code = req.body.code || "";
  const language = req.body.language || "python";
  const input = typeof req.body.input === "string" ? req.body.input : "";

  const supported = ["cpp", "c", "python", "java"];
  if (!supported.includes(language)) {
    return res.status(400).json({ error: "Unsupported language" });
  }

  if (USE_KAFKA) {
    // Async Kafka path
    const jobId = uuidv4();
    await publishJob({ jobId, language, code, input, timestamp: new Date().toISOString() });
    return res.json({ jobId, status: "queued" });
  }

  // Sync Docker path (default for dev)
  try {
    const result = await runDocker(language, code, input);

    // Log async (don't await)
    saveExecution({
      jobId: uuidv4(),
      language,
      exitCode: result.exitCode,
      runtime: result.runtime,
      hasError: !!result.stderr?.trim(),
      timestamp: new Date().toISOString(),
    }).catch(() => {});

    res.json({
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      runtime: result.runtime,
    });
  } catch (error) {
    console.error("Execution error:", error.message);
    res.status(500).json({ error: "Execution failed", details: error.message });
  }
});


app.get("/job/:jobId", (req, res) => {
  const result = getResult(req.params.jobId);
  if (!result) return res.json({ status: "pending" });
  res.json(result);
});


app.get("/analytics", async (req, res) => {
  try {
    const data = await getAnalytics();
    res.json(data);
  } catch (err) {
    console.error("Analytics error:", err.message);
    res.status(500).json({ error: "Analytics unavailable" });
  }
});


app.use(express.static(path.join(__dirname, "../client/build")));
app.use((req, res) => {
  res.sendFile(path.join(__dirname, "../client/build/index.html"));
});


async function start() {
  if (USE_KAFKA) {
    try {
      await startConsumer();
    } catch (e) {
      console.warn("⚠️  Kafka unavailable, falling back to sync mode:", e.message);
    }
  }

  app.listen(PORT, () => {
    console.log(`🚀 CloudExec server running on port ${PORT}`);
    console.log(`   Mode: ${USE_KAFKA ? "Kafka async" : "Docker sync"}`);
  });
}

start();
