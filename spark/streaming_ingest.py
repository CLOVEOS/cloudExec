"""
CloudExec – Spark Structured Streaming ingest (bronze + real-time layer).

Kafka `execution-events`  ──►  Parquet data lake   (partitioned by eventDate/language)
                          └─►  MongoDB live_metrics (1-minute tumbling windows, watermarked)

Run (inside docker-compose this is the `spark-streaming` service):
  spark-submit \
    --packages org.apache.spark:spark-sql-kafka-0-10_2.12:3.5.3 \
    spark/streaming_ingest.py --brokers kafka:29092 --lake /data/lake/executions
"""
import argparse
import os

from pyspark.sql import SparkSession
from pyspark.sql import functions as F
from pyspark.sql.types import (BooleanType, DoubleType, IntegerType, StringType,
                               StructField, StructType)

EVENT_SCHEMA = StructType([
    StructField("jobId", StringType()),
    StructField("userId", StringType()),
    StructField("language", StringType()),
    StructField("status", StringType()),
    StructField("exitCode", IntegerType()),
    StructField("runtime", DoubleType()),
    StructField("wallTime", DoubleType()),
    StructField("queueMs", DoubleType()),
    StructField("hasError", BooleanType()),
    StructField("errorCategory", StringType()),
    StructField("errorType", StringType()),
    StructField("codeBytes", IntegerType()),
    StructField("linesOfCode", IntegerType()),
    StructField("createdAt", StringType()),
    StructField("completedAt", StringType()),
    StructField("workerId", StringType()),
])


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--brokers", default=os.getenv("KAFKA_BROKERS", "localhost:9092"))
    p.add_argument("--topic", default=os.getenv("KAFKA_EVENTS_TOPIC", "execution-events"))
    p.add_argument("--lake", default=os.getenv("LAKE_PATH", "/data/lake/executions"))
    p.add_argument("--checkpoints", default=os.getenv("CHECKPOINT_PATH", "/data/checkpoints"))
    p.add_argument("--mongo-uri", default=os.getenv("MONGO_URI", "mongodb://localhost:27017"))
    p.add_argument("--mongo-db", default=os.getenv("MONGO_DB", "cloudexec"))
    p.add_argument("--trigger", default=os.getenv("TRIGGER_INTERVAL", "30 seconds"))
    return p.parse_args()


def main():
    args = parse_args()
    spark = (
        SparkSession.builder.appName("CloudExec-StreamingIngest")
        .config("spark.sql.session.timeZone", "UTC")
        .config("spark.sql.shuffle.partitions", "8")
        .getOrCreate()
    )
    spark.sparkContext.setLogLevel("WARN")

    raw = (
        spark.readStream.format("kafka")
        .option("kafka.bootstrap.servers", args.brokers)
        .option("subscribe", args.topic)
        .option("startingOffsets", "earliest")
        .option("failOnDataLoss", "false")
        .option("maxOffsetsPerTrigger", 200000)
        .load()
    )

    events = (
        raw.select(F.from_json(F.col("value").cast("string"), EVENT_SCHEMA).alias("e"), F.col("timestamp").alias("kafkaTs"))
        .select("e.*", "kafkaTs")
        .withColumn("createdAt", F.to_timestamp("createdAt"))
        .withColumn("completedAt", F.to_timestamp("completedAt"))
        .withColumn("eventDate", F.to_date(F.from_utc_timestamp("createdAt", "Asia/Kolkata")))
        .filter(F.col("jobId").isNotNull())
    )

    # ── Bronze: append-only Parquet lake, exactly-once via checkpoint ──
    lake_q = (
        events.writeStream.format("parquet")
        .option("path", args.lake)
        .option("checkpointLocation", os.path.join(args.checkpoints, "lake"))
        .partitionBy("eventDate", "language")
        .trigger(processingTime=args.trigger)
        .outputMode("append")
        .start()
    )

    # ── Real-time layer: 1-minute windows per language, late data up to 2 min ──
    live = (
        events.withWatermark("completedAt", "2 minutes")
        .groupBy(F.window("completedAt", "1 minute"), "language")
        .agg(
            F.count("*").alias("runs"),
            F.sum(F.col("hasError").cast("int")).alias("errors"),
            F.approx_count_distinct("userId").alias("users"),
            F.avg("runtime").alias("avgRuntime"),
            F.avg("queueMs").alias("avgQueueMs"),
        )
        .select(
            F.col("window.start").alias("windowStart"),
            F.col("window.end").alias("windowEnd"),
            "language", "runs", "errors", "users",
            F.round("avgRuntime", 1).alias("avgRuntime"),
            F.round("avgQueueMs", 1).alias("avgQueueMs"),
        )
    )

    mongo_uri, mongo_db = args.mongo_uri, args.mongo_db

    def upsert_batch(batch_df, batch_id):
        rows = batch_df.collect()  # small: (#languages × #open windows)
        if not rows:
            return
        from pymongo import MongoClient, ReplaceOne

        client = MongoClient(mongo_uri)
        ops = []
        for r in rows:
            d = r.asDict()
            key = {"windowStart": d["windowStart"], "language": d["language"]}
            ops.append(ReplaceOne(key, d, upsert=True))
        client[mongo_db]["live_metrics"].bulk_write(ops, ordered=False)
        client.close()

    live_q = (
        live.writeStream.outputMode("update")
        .foreachBatch(upsert_batch)
        .option("checkpointLocation", os.path.join(args.checkpoints, "live"))
        .trigger(processingTime="15 seconds")
        .start()
    )

    print(f"🌊 Streaming {args.topic} → {args.lake} (+ live_metrics)")
    spark.streams.awaitAnyTermination()
    lake_q.stop()
    live_q.stop()


if __name__ == "__main__":
    main()
