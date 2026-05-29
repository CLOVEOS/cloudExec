const { Kafka } = require("kafkajs");

const kafka = new Kafka({
  clientId: "cloudexec-producer",
  brokers: [process.env.KAFKA_BROKER || "localhost:9092"],
});

const producer = kafka.producer();
let connected = false;

async function connectProducer() {
  if (!connected) {
    await producer.connect();
    connected = true;
    console.log("✅ Kafka producer connected");
  }
}

async function publishJob(job) {
  await connectProducer();
  await producer.send({
    topic: "compile-jobs",
    messages: [
      {
        key: job.jobId,
        value: JSON.stringify(job),
        partition: getPartition(job.language),
      },
    ],
  });
}

// Partition by language for parallel scaling
function getPartition(language) {
  const map = { python: 0, cpp: 1, c: 1, java: 2 };
  return map[language] ?? 0;
}

module.exports = { publishJob, connectProducer };
