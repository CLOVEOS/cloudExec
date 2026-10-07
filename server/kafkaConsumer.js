const config = require("./config");
const { kafka } = require("./kafkaProducer");
const { processJob } = require("./jobs");

// How many jobs one worker process runs at once (one per partition it owns).
const CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY || "4", 10);

const consumer = kafka.consumer({ groupId: config.kafka.groupId });

async function startConsumer() {
  await consumer.connect();
  await consumer.subscribe({ topic: config.kafka.jobsTopic, fromBeginning: false });
  console.log(`✅ Kafka consumer running (group=${config.kafka.groupId}, concurrency=${CONCURRENCY})`);

  await consumer.run({
    partitionsConsumedConcurrently: CONCURRENCY,
    eachMessage: async ({ message, partition }) => {
      let job;
      try {
        job = JSON.parse(message.value.toString());
      } catch {
        console.warn("Skipping malformed job message");
        return;
      }
      console.log(`🔧 [p${partition}] job ${job.jobId} (${job.language}) user=${job.userId}`);
      await processJob(job);
    },
  });
}

async function stopConsumer() {
  await consumer.disconnect();
}

module.exports = { startConsumer, stopConsumer };
