// Central configuration. Every value can be overridden through environment
// variables so the same image runs locally, in docker-compose and on Kubernetes.
require("dotenv").config({ quiet: true });

const bool = (v, d = false) => (v === undefined ? d : v === "true" || v === "1");
const int = (v, d) => (v === undefined || v === "" ? d : parseInt(v, 10));

const config = {
  env: process.env.NODE_ENV || "development",
  port: int(process.env.PORT, 8000),

  mongoUri: process.env.MONGO_URI || "mongodb://localhost:27017",
  mongoDb: process.env.MONGO_DB || "cloudexec",

  jwtSecret: process.env.JWT_SECRET || "dev-only-change-me",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",
  // Comma separated list of e-mails that get the admin role on sign-up.
  adminEmails: (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),

  kafka: {
    enabled: bool(process.env.USE_KAFKA),
    brokers: (process.env.KAFKA_BROKERS || process.env.KAFKA_BROKER || "localhost:9092").split(","),
    jobsTopic: process.env.KAFKA_JOBS_TOPIC || "compile-jobs",
    eventsTopic: process.env.KAFKA_EVENTS_TOPIC || "execution-events",
    partitions: int(process.env.KAFKA_PARTITIONS, 6),
    groupId: process.env.KAFKA_GROUP_ID || "exec-workers",
  },

  sandbox: {
    timeoutMs: int(process.env.SANDBOX_TIMEOUT_MS, 10000),
    memory: process.env.SANDBOX_MEMORY || "256m",
    cpus: process.env.SANDBOX_CPUS || "0.5",
    maxCodeBytes: int(process.env.MAX_CODE_BYTES, 64 * 1024),
    maxInputBytes: int(process.env.MAX_INPUT_BYTES, 64 * 1024),
    maxOutputBytes: int(process.env.MAX_OUTPUT_BYTES, 64 * 1024),
  },

  sarvam: {
    apiKey: process.env.SARVAM_API_KEY || "",
    baseUrl: process.env.SARVAM_BASE_URL || "https://api.sarvam.ai",
    chatModel: process.env.SARVAM_CHAT_MODEL || "sarvam-105b",
    translateModel: process.env.SARVAM_TRANSLATE_MODEL || "sarvam-translate:v1",
    timeoutMs: int(process.env.SARVAM_TIMEOUT_MS, 120000),
    maxTokens: int(process.env.SARVAM_MAX_TOKENS, 8192),
    // low | medium | high | none (disable) | default (don't send the field)
    reasoningEffort: process.env.SARVAM_REASONING_EFFORT || "low",
  },

  rateLimit: {
    compilePerMinute: int(process.env.RATE_LIMIT_COMPILE_PER_MIN, 30),
    aiPerMinute: int(process.env.RATE_LIMIT_AI_PER_MIN, 10),
  },
};

if (config.env === "production" && config.jwtSecret === "dev-only-change-me") {
  throw new Error("JWT_SECRET must be set in production");
}

module.exports = config;
