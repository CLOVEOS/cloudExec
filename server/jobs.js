// Job lifecycle: queued → running → success | error.
// MongoDB is the job store (not process memory), so any API replica can
// answer a poll for a job that any worker replica executed.
const os = require("os");
const { v4: uuidv4 } = require("uuid");
const config = require("./config");
const { col } = require("./db");
const { runDocker } = require("./executor");
const { classify } = require("./errorClassifier");
const metrics = require("./metrics");

const WORKER_ID = process.env.HOSTNAME || os.hostname();
const KEEP_OUTPUT_BYTES = 8 * 1024;

const trim = (s) => (s && s.length > KEEP_OUTPUT_BYTES ? s.slice(0, KEEP_OUTPUT_BYTES) + "\n…[truncated]" : s || "");

/** Persist a new job and return its document. */
async function createJob({ userId, language, code, input, source = "editor" }) {
  const doc = {
    jobId: uuidv4(),
    userId,
    language,
    source,
    status: "queued",
    code,
    codeBytes: Buffer.byteLength(code),
    linesOfCode: code.split("\n").filter((l) => l.trim()).length,
    inputBytes: Buffer.byteLength(input || ""),
    createdAt: new Date(),
  };
  await (await col("executions")).insertOne(doc);
  return doc;
}

/** Run a job to completion and record the result. Used by Kafka workers and sync mode. */
async function processJob({ jobId, userId, language, code, input, createdAt }) {
  const executions = await col("executions");
  const startedAt = new Date();
  const queueMs = createdAt ? startedAt - new Date(createdAt) : 0;
  metrics.queueWait.observe(queueMs);

  await executions.updateOne({ jobId }, { $set: { status: "running", startedAt, workerId: WORKER_ID, queueMs } });

  let result;
  try {
    result = await runDocker(language, code, input);
  } catch (e) {
    result = { stdout: "", stderr: `Sandbox failure: ${e.message}`, exitCode: 1, runtime: 0, wallTime: 0 };
  }

  const { errorCategory, errorType } = classify(result);
  const hasError = errorCategory !== "none";
  const status = hasError ? "error" : "success";
  const completedAt = new Date();

  const update = {
    status,
    exitCode: result.exitCode,
    runtime: result.runtime,
    wallTime: result.wallTime,
    hasError,
    errorCategory,
    errorType,
    stdout: trim(result.stdout),
    stderr: trim(result.stderr),
    stdoutBytes: Buffer.byteLength(result.stdout || ""),
    completedAt,
  };
  await executions.updateOne({ jobId }, { $set: update });

  metrics.executions.inc({ language, status, category: errorCategory });
  metrics.runtime.observe({ language }, result.runtime || 0);

  if (config.kafka.enabled) {
    // Lightweight analytics event (no source code / output) for the data lake.
    const { publishEvent } = require("./kafkaProducer");
    publishEvent({
      jobId,
      userId,
      language,
      status,
      exitCode: result.exitCode,
      runtime: result.runtime,
      wallTime: result.wallTime,
      queueMs,
      hasError,
      errorCategory,
      errorType,
      codeBytes: Buffer.byteLength(code),
      linesOfCode: code.split("\n").filter((l) => l.trim()).length,
      createdAt: new Date(createdAt || startedAt).toISOString(),
      completedAt: completedAt.toISOString(),
      workerId: WORKER_ID,
    }).catch((e) => console.warn("event publish failed:", e.message));
  }

  return { jobId, language, createdAt, ...update };
}

function publicJob(doc) {
  return {
    jobId: doc.jobId,
    status: doc.status,
    language: doc.language,
    stdout: doc.stdout,
    stderr: doc.stderr,
    exitCode: doc.exitCode,
    runtime: doc.runtime,
    errorCategory: doc.errorCategory,
    errorType: doc.errorType,
    createdAt: doc.createdAt,
    completedAt: doc.completedAt,
  };
}

module.exports = { createJob, processJob, publicJob };
