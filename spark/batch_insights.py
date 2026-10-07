"""
CloudExec – batch personalisation job (gold layer).

Reads execution events from the data lake (Parquet, written by
streaming_ingest.py), from MongoDB, or from a JSONL file, computes
per-user insights + platform daily aggregates, and upserts them into
MongoDB where the API serves them to each user's dashboard.

Examples
  # From the Parquet lake (production path)
  spark-submit spark/batch_insights.py --source lake --path /data/lake/executions

  # Straight from MongoDB (dev mode without Kafka)
  spark-submit --packages org.mongodb.spark:mongo-spark-connector_2.12:10.4.0 \
      spark/batch_insights.py --source mongo

  # From the synthetic generator's JSONL output, writing results to JSON files
  spark-submit spark/batch_insights.py --source jsonl --path data/seed.jsonl --sink files --out /tmp/gold
"""
import argparse
import os
import sys
import time
from datetime import datetime, timezone

from pyspark.sql import SparkSession
from pyspark.sql import functions as F
from pyspark.sql.utils import AnalysisException

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import insights_lib as lib  # noqa: E402

COLUMNS = [
    "jobId", "userId", "language", "status", "hasError", "errorCategory", "errorType",
    "runtime", "linesOfCode", "queueMs", "createdAt",
]


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--source", choices=["lake", "mongo", "jsonl"], default=os.getenv("INSIGHTS_SOURCE", "lake"))
    p.add_argument("--path", default=os.getenv("LAKE_PATH", "/data/lake/executions"))
    p.add_argument("--mongo-uri", default=os.getenv("MONGO_URI", "mongodb://localhost:27017"))
    p.add_argument("--mongo-db", default=os.getenv("MONGO_DB", "cloudexec"))
    p.add_argument("--sink", choices=["mongo", "files"], default="mongo")
    p.add_argument("--out", default="/tmp/cloudexec_gold")
    p.add_argument("--days", type=int, default=180, help="look-back window")
    p.add_argument(
        "--fallback-mongo",
        action="store_true",
        help="if the lake is empty or missing (e.g. streaming still catching up), read MongoDB instead",
    )
    return p.parse_args()


def read_mongo(spark, args):
    df = (
        spark.read.format("mongodb")
        .option("connection.uri", args.mongo_uri)
        .option("database", args.mongo_db)
        .option("collection", "executions")
        # Push the filter down to Mongo instead of scanning code/stdout.
        .option("aggregation.pipeline", '[{"$match": {"status": {"$in": ["success", "error"]}}}]')
        .load()
    )
    if "userId" in df.columns:
        df = df.withColumn("userId", df["userId"].cast("string"))
    return df


def read_events(spark, args):
    if args.source == "lake":
        try:
            df = spark.read.parquet(args.path)
        except AnalysisException as e:
            # "Unable to infer schema" / "Path does not exist": nothing streamed yet.
            if not args.fallback_mongo:
                raise SystemExit(f"Data lake at {args.path} is empty or missing ({e.getMessage().splitlines()[0]}). "
                                 "Is spark-streaming running? Re-run with --fallback-mongo to use MongoDB.")
            print(f"⚠️  Data lake at {args.path} is empty — falling back to MongoDB")
            df = read_mongo(spark, args)
    elif args.source == "jsonl":
        df = spark.read.json(args.path)
    else:
        df = read_mongo(spark, args)
    present = [c for c in COLUMNS if c in df.columns]
    return df.select(*present)


def write_mongo(df, uri, db, collection, key):
    """Idempotent upserts, executed in parallel on the executors."""

    def upsert_partition(rows):
        from pymongo import MongoClient, ReplaceOne

        client = MongoClient(uri)
        coll = client[db][collection]
        batch = []
        for r in rows:
            doc = r.asDict(recursive=True)
            batch.append(ReplaceOne({key: doc[key]}, doc, upsert=True))
            if len(batch) >= 1000:
                coll.bulk_write(batch, ordered=False)
                batch = []
        if batch:
            coll.bulk_write(batch, ordered=False)
        client.close()

    df.foreachPartition(upsert_partition)


def main():
    args = parse_args()
    spark = (
        SparkSession.builder.appName("CloudExec-UserInsights")
        .config("spark.sql.session.timeZone", "UTC")
        .config("spark.sql.shuffle.partitions", os.getenv("SHUFFLE_PARTITIONS", "64"))
        .getOrCreate()
    )
    spark.sparkContext.setLogLevel("WARN")
    t0 = time.time()

    as_of = datetime.now(timezone.utc).replace(tzinfo=None)
    raw = read_events(spark, args)
    events = lib.normalize(raw)
    events = events.filter(F.col("createdAt") >= F.expr(f"current_timestamp() - INTERVAL {args.days} DAYS"))
    events.cache()
    n = events.count()
    print(f"📥 {n} events loaded from {args.source}")
    if n == 0:
        print("Nothing to do.")
        return

    insights = lib.user_insights(events, as_of)
    daily = lib.platform_daily(events)

    if args.sink == "mongo":
        write_mongo(insights, args.mongo_uri, args.mongo_db, "user_insights", "userId")
        write_mongo(daily, args.mongo_uri, args.mongo_db, "platform_daily", "date")
    else:
        insights.coalesce(1).write.mode("overwrite").json(os.path.join(args.out, "user_insights"))
        daily.coalesce(1).write.mode("overwrite").json(os.path.join(args.out, "platform_daily"))

    users = insights.count()
    print(f"✅ insights for {users} users written to {args.sink} in {time.time() - t0:.1f}s")
    insights.select("userId", "totalRuns", "skillScore", "percentile", "level", "topLanguage").orderBy(
        "skillScore", ascending=False
    ).show(10, truncate=False)
    spark.stop()


if __name__ == "__main__":
    main()
