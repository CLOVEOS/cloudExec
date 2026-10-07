// Execution worker: consumes `compile-jobs`, runs code in Docker,
// writes results to MongoDB and emits `execution-events` for the lake.
// Scale horizontally: every replica joins the same consumer group and
// Kafka spreads partitions across them.
const http = require("http");
const config = require("./config");
const db = require("./db");
const metrics = require("./metrics");
const { connectProducer, disconnectProducer } = require("./kafkaProducer");
const { startConsumer, stopConsumer } = require("./kafkaConsumer");

// Pull sandbox images in the background so the first job per language
// doesn't spend its time limit downloading an image.
function prepullImages() {
  const { spawn } = require("child_process");
  const { LANGUAGES } = require("./languages");
  for (const image of new Set(Object.values(LANGUAGES).map((l) => l.image))) {
    spawn("docker", ["pull", "-q", image], { stdio: "ignore" })
      .on("close", (code) => console.log(`${code === 0 ? "🐳" : "⚠️ "} sandbox image ${image} ${code === 0 ? "ready" : "pull failed"}`))
      .on("error", (e) => console.warn(`docker unavailable: ${e.message}`));
  }
}

async function main() {
  if (!config.kafka.enabled) {
    console.error("worker.js requires USE_KAFKA=true");
    process.exit(1);
  }
  await db.getDb();
  await connectProducer();
  if (process.env.PREPULL_IMAGES !== "false") prepullImages();
  await startConsumer();

  const port = parseInt(process.env.WORKER_METRICS_PORT || "9100", 10);
  http
    .createServer(async (req, res) => {
      if (req.url === "/metrics") {
        res.setHeader("Content-Type", metrics.register.contentType);
        return res.end(await metrics.register.metrics());
      }
      res.end("ok");
    })
    .listen(port, () => console.log(`📈 worker metrics on :${port}/metrics`));

  const shutdown = async () => {
    await stopConsumer().catch(() => {});
    await disconnectProducer().catch(() => {});
    await db.close();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((e) => {
  console.error("Worker failed:", e);
  process.exit(1);
});
