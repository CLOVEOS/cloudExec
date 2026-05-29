"""
CloudExec Analytics - PySpark Batch Job
Run: spark-submit spark_analytics.py
Reads execution logs from MongoDB, computes analytics, writes summary.
"""

from pyspark.sql import SparkSession
from pyspark.sql import functions as F
from pyspark.sql.types import StructType, StructField, StringType, IntegerType, BooleanType, TimestampType
import json
from datetime import datetime

# ── Spark Session ──────────────────────────────────────────────
spark = (
    SparkSession.builder
    .appName("CloudExec-Analytics")
    .config("spark.mongodb.input.uri", "mongodb://localhost:27017/cloudexec.executions")
    .config("spark.mongodb.output.uri", "mongodb://localhost:27017/cloudexec.analytics")
    .getOrCreate()
)

spark.sparkContext.setLogLevel("WARN")

print("🔥 CloudExec Spark Analytics Job Starting...")

# ── Load Data from MongoDB ─────────────────────────────────────
try:
    df = (
        spark.read
        .format("mongo")
        .option("uri", "mongodb://localhost:27017/cloudexec.executions")
        .load()
    )
    print(f"✅ Loaded {df.count()} execution records")
except Exception as e:
    print(f"⚠️  MongoDB read failed: {e}")
    print("   Running with sample data for demo...")

    # Sample data for demo/testing when MongoDB isn't available
    sample_data = [
        ("job1", "python", 0, 234, False, "2024-01-01T10:00:00"),
        ("job2", "cpp", 1, 1200, True, "2024-01-01T10:05:00"),
        ("job3", "java", 0, 890, False, "2024-01-01T10:10:00"),
        ("job4", "python", 0, 156, False, "2024-01-01T10:15:00"),
        ("job5", "cpp", 0, 340, False, "2024-01-01T10:20:00"),
        ("job6", "python", 1, 445, True, "2024-01-01T11:00:00"),
        ("job7", "c", 0, 280, False, "2024-01-01T11:05:00"),
        ("job8", "java", 1, 2100, True, "2024-01-01T11:10:00"),
        ("job9", "python", 0, 120, False, "2024-01-01T12:00:00"),
        ("job10", "cpp", 0, 670, False, "2024-01-01T12:30:00"),
    ]

    schema = StructType([
        StructField("jobId", StringType()),
        StructField("language", StringType()),
        StructField("exitCode", IntegerType()),
        StructField("runtime", IntegerType()),
        StructField("hasError", BooleanType()),
        StructField("timestamp", StringType()),
    ])

    df = spark.createDataFrame(sample_data, schema)

df.cache()
df.printSchema()

# ── Analytics 1: Submissions by Language ─────────────────────
print("\n📊 Submissions by Language:")
lang_stats = (
    df.groupBy("language")
    .agg(
        F.count("*").alias("total_submissions"),
        F.avg("runtime").alias("avg_runtime_ms"),
        F.sum(F.col("hasError").cast("int")).alias("error_count"),
        F.round(
            F.sum(F.col("hasError").cast("int")) / F.count("*") * 100, 2
        ).alias("error_rate_pct"),
    )
    .orderBy(F.desc("total_submissions"))
)
lang_stats.show()

# ── Analytics 2: Error Rate Overall ──────────────────────────
print("\n🔴 Overall Error Rate:")
overall = df.agg(
    F.count("*").alias("total"),
    F.sum(F.col("hasError").cast("int")).alias("errors"),
    F.round(F.avg("runtime"), 2).alias("avg_runtime_ms"),
    F.min("runtime").alias("min_runtime_ms"),
    F.max("runtime").alias("max_runtime_ms"),
)
overall.show()

# ── Analytics 3: Slow Executions (> 1000ms) ──────────────────
print("\n🐢 Slow Executions (>1000ms):")
slow = df.filter(F.col("runtime") > 1000).select("jobId", "language", "runtime", "hasError")
slow.show()

# ── Analytics 4: Runtime Percentiles ─────────────────────────
print("\n📈 Runtime Percentiles:")
percentiles = df.groupBy("language").agg(
    F.percentile_approx("runtime", [0.50, 0.75, 0.90, 0.99]).alias("percentiles")
)
percentiles.show(truncate=False)

# ── Analytics 5: Hourly Submission Volume ────────────────────
print("\n⏰ Hourly Submission Volume (last 24h):")
try:
    hourly = (
        df.withColumn("hour", F.hour(F.to_timestamp("timestamp")))
        .groupBy("hour")
        .agg(F.count("*").alias("submissions"))
        .orderBy("hour")
    )
    hourly.show(24)
except Exception as e:
    print(f"  Skipped (timestamp parse): {e}")

# ── Save Summary ──────────────────────────────────────────────
summary = {
    "generated_at": datetime.now().isoformat(),
    "lang_stats": [row.asDict() for row in lang_stats.collect()],
    "overall": overall.collect()[0].asDict(),
}

with open("/tmp/cloudexec_analytics_summary.json", "w") as f:
    json.dump(summary, f, indent=2, default=str)

print("\n✅ Analytics summary written to /tmp/cloudexec_analytics_summary.json")
print("🎉 Spark job complete.")

spark.stop()
