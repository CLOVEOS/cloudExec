// API gateway entry point.
const config = require("./config");
const app = require("./app");
const db = require("./db");

async function start() {
  await db.getDb();

  if (config.kafka.enabled) {
    const { connectProducer } = require("./kafkaProducer");
    await connectProducer();
  }

  // In single-process dev mode you can also run the worker in-process.
  if (config.kafka.enabled && process.env.EMBEDDED_WORKER === "true") {
    const { startConsumer } = require("./kafkaConsumer");
    await startConsumer();
  }

  const server = app.listen(config.port, () => {
    console.log(`🚀 CloudExec API on :${config.port} (mode: ${config.kafka.enabled ? "Kafka async" : "Docker sync"})`);
  });

  const shutdown = async () => {
    console.log("Shutting down…");
    server.close();
    if (config.kafka.enabled) await require("./kafkaProducer").disconnectProducer().catch(() => {});
    await db.close();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

start().catch((e) => {
  console.error("Failed to start:", e);
  process.exit(1);
});
