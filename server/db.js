const { MongoClient } = require("mongodb");

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017";
const DB_NAME = "cloudexec";

let client = null;
let db = null;

async function getDb() {
  if (db) return db;
  client = new MongoClient(MONGO_URI);
  await client.connect();
  db = client.db(DB_NAME);
  console.log("✅ MongoDB connected");
  return db;
}

async function saveExecution(doc) {
  const database = await getDb();
  await database.collection("executions").insertOne({
    ...doc,
    createdAt: new Date(),
  });
}

async function getAnalytics() {
  const database = await getDb();
  const col = database.collection("executions");

  const [langStats, errorRate, recent, hourly] = await Promise.all([
    // Submissions by language
    col
      .aggregate([
        { $group: { _id: "$language", count: { $sum: 1 }, avgRuntime: { $avg: "$runtime" } } },
        { $sort: { count: -1 } },
      ])
      .toArray(),

    // Error rate overall
    col
      .aggregate([
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            errors: { $sum: { $cond: ["$hasError", 1, 0] } },
          },
        },
      ])
      .toArray(),

    // Last 20 executions
    col.find({}).sort({ createdAt: -1 }).limit(20).toArray(),

    // Submissions per hour (last 24h)
    col
      .aggregate([
        {
          $match: {
            createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
          },
        },
        {
          $group: {
            _id: { $hour: "$createdAt" },
            count: { $sum: 1 },
          },
        },
        { $sort: { "_id": 1 } },
      ])
      .toArray(),
  ]);

  return {
    langStats,
    errorRate: errorRate[0] || { total: 0, errors: 0 },
    recent: recent.map((r) => ({
      jobId: r.jobId,
      language: r.language,
      exitCode: r.exitCode,
      runtime: r.runtime,
      hasError: r.hasError,
      time: r.createdAt,
    })),
    hourly,
  };
}

module.exports = { saveExecution, getAnalytics, getDb };
