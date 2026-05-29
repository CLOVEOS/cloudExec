const { Kafka } = require("kafkajs");
const { runDocker } = require("./executor");
const { saveExecution } = require("./db");

const kafka = new Kafka({
  clientId: "cloudexec-consumer",
  brokers: [process.env.KAFKA_BROKER || "localhost:9092"],
});

const consumer = kafka.consumer({ groupId: "exec-workers" });


const resultStore = new Map();

async function startConsumer() {
  await consumer.connect();
  await consumer.subscribe({ topic: "compile-jobs", fromBeginning: false });

  console.log("✅ Kafka consumer running");

  await consumer.run({
    eachMessage: async ({ message }) => {
      let job;
      try {
        job = JSON.parse(message.value.toString());
      } catch {
        return;
      }

      const { jobId, language, code, input, timestamp } = job;

      console.log(`🔧 Processing job ${jobId} [${language}]`);

      const result = await runDocker(language, code, input);

      // Store result for polling
      resultStore.set(jobId, {
        ...result,
        status: result.exitCode === 0 ? "success" : "error",
        jobId,
      });

      // Clean up after 5 min
      setTimeout(() => resultStore.delete(jobId), 5 * 60 * 1000);

      // Log to MongoDB
      try {
        await saveExecution({
          jobId,
          language,
          exitCode: result.exitCode,
          runtime: result.runtime,
          hasError: !!result.stderr,
          timestamp: timestamp || new Date().toISOString(),
        });
      } catch (e) {
        console.warn("MongoDB log failed:", e.message);
      }
    },
  });
}

function getResult(jobId) {
  return resultStore.get(jobId) || null;
}

module.exports = { startConsumer, getResult };
