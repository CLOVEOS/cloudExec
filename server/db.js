const { MongoClient } = require("mongodb");
const config = require("./config");

let client = null;
let db = null;

async function getDb() {
  if (db) return db;
  client = new MongoClient(config.mongoUri, { maxPoolSize: 50 });
  await client.connect();
  db = client.db(config.mongoDb);
  await ensureIndexes(db);
  console.log("✅ MongoDB connected");
  return db;
}

async function ensureIndexes(database) {
  await Promise.all([
    database.collection("users").createIndex({ email: 1 }, { unique: true }),
    database.collection("executions").createIndex({ jobId: 1 }, { unique: true }),
    // Personal dashboard: "my runs, newest first"
    database.collection("executions").createIndex({ userId: 1, createdAt: -1 }),
    // Platform analytics + Spark incremental reads
    database.collection("executions").createIndex({ createdAt: -1 }),
    database.collection("user_insights").createIndex({ userId: 1 }, { unique: true }),
    database.collection("ai_interactions").createIndex({ userId: 1, createdAt: -1 }),
    database.collection("platform_daily").createIndex({ date: 1 }, { unique: true }),
    // Written by Spark Structured Streaming; keep 2 days of 1-minute windows.
    database.collection("live_metrics").createIndex({ windowStart: 1 }, { expireAfterSeconds: 2 * 24 * 3600 }),
  ]);
}

const col = async (name) => (await getDb()).collection(name);

async function ping() {
  const database = await getDb();
  await database.command({ ping: 1 });
  return true;
}

async function close() {
  if (client) await client.close();
  client = null;
  db = null;
}

module.exports = { getDb, col, ping, close };
