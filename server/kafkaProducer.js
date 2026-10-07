const { Kafka, Partitioners, logLevel } = require("kafkajs");
const config = require("./config");

const kafka = new Kafka({
  clientId: "cloudexec",
  brokers: config.kafka.brokers,
  logLevel: logLevel.WARN,
});

const producer = kafka.producer({ createPartitioner: Partitioners.DefaultPartitioner });
let connecting = null;

// Topics are created explicitly so they get N partitions (auto-created
// topics get 1, which caps a consumer group at a single worker).
async function ensureTopics() {
  const admin = kafka.admin();
  await admin.connect();
  try {
    const existing = await admin.listTopics();
    const wanted = [config.kafka.jobsTopic, config.kafka.eventsTopic].filter((t) => !existing.includes(t));
    if (wanted.length) {
      try {
        await admin.createTopics({
          waitForLeaders: true,
          topics: wanted.map((topic) => ({
            topic,
            numPartitions: config.kafka.partitions,
            replicationFactor: parseInt(process.env.KAFKA_REPLICATION_FACTOR || "1", 10),
          })),
        });
        console.log(`✅ Created Kafka topics: ${wanted.join(", ")}`);
      } catch (e) {
        // Another replica may have created them at the same moment.
        const now = await admin.listTopics();
        if (!wanted.every((t) => now.includes(t))) throw e;
      }
    }
  } finally {
    await admin.disconnect();
  }
}

async function connectProducer() {
  if (!connecting) {
    connecting = (async () => {
      await ensureTopics();
      await producer.connect();
      console.log("✅ Kafka producer connected");
    })().catch((e) => {
      connecting = null;
      throw e;
    });
  }
  return connecting;
}

// Keyed by userId: one user's jobs stay ordered on one partition, while
// different users spread across partitions (and therefore workers).
async function publishJob(job) {
  await connectProducer();
  await producer.send({
    topic: config.kafka.jobsTopic,
    messages: [{ key: job.userId, value: JSON.stringify(job) }],
  });
}

// Execution metadata for the data lake (Spark Structured Streaming).
async function publishEvent(event) {
  await connectProducer();
  await producer.send({
    topic: config.kafka.eventsTopic,
    messages: [{ key: event.userId, value: JSON.stringify(event) }],
  });
}

async function disconnectProducer() {
  if (connecting) await producer.disconnect();
  connecting = null;
}

module.exports = { kafka, publishJob, publishEvent, connectProducer, disconnectProducer };
