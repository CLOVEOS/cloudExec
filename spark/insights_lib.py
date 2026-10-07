"""
Pure Spark transformations for CloudExec personalised analytics.

Input: an "executions" DataFrame with (at least) these columns
    jobId, userId, language, hasError, errorCategory, errorType,
    runtime, linesOfCode, queueMs, createdAt (timestamp or ISO string)

Outputs (gold tables):
    user_insights  – one row per user: skill score, percentile, level, per-language
                     proficiency, weak areas, 7-day trend, streaks, recommendations
    platform_daily – one row per day: volume, DAU, error rate, latency percentiles
"""
from __future__ import annotations  # PEP 604 hints on Python 3.8 (apache/spark image)

from datetime import datetime, timedelta, timezone

from pyspark.sql import DataFrame, Window
from pyspark.sql import functions as F

TZ = "Asia/Kolkata"

# errorType → learning topic. Drives rule-based recommendations; the
# Sarvam AI coach turns these into a narrative in the learner's language.
TOPIC_BY_ERROR = {
    "IndexError": "Array bounds & off-by-one errors",
    "ArrayIndexOutOfBoundsException": "Array bounds & off-by-one errors",
    "SegmentationFault": "Pointers, array bounds & memory safety",
    "KeyError": "Dictionaries / hash maps",
    "NullPointerException": "Null handling & object initialisation",
    "TypeError": "Types & type conversion",
    "ReferenceError": "Variable scope & declarations",
    "NameError": "Variable scope & declarations",
    "UndeclaredIdentifier": "Variable scope & declarations",
    "CannotFindSymbol": "Variable scope & declarations",
    "UndefinedReference": "Functions, linking & headers",
    "NoMatchingFunction": "Function signatures & overloading",
    "IncompatibleTypes": "Types & type conversion",
    "SyntaxError": "Language syntax fundamentals",
    "IndentationError": "Python indentation & blocks",
    "CSyntaxError": "Language syntax fundamentals",
    "JavaSyntaxError": "Language syntax fundamentals",
    "TimeLimitExceeded": "Algorithmic complexity (Big-O)",
    "RecursionError": "Recursion & base cases",
    "StackOverflowError": "Recursion & base cases",
    "MemoryLimitExceeded": "Memory-efficient data structures",
    "ZeroDivisionError": "Edge cases & input validation",
    "FloatingPointException": "Edge cases & input validation",
    "RangeError": "Edge cases & input validation",
}


def normalize(df: DataFrame) -> DataFrame:
    """Type-coerce raw events (Mongo / Kafka JSON / Parquet) into a clean silver table."""
    ts = F.col("createdAt")
    if dict(df.dtypes).get("createdAt") == "string":
        ts = F.to_timestamp("createdAt")
    local = F.from_utc_timestamp(ts, TZ)
    return (
        df.withColumn("createdAt", ts)
        .filter(F.col("userId").isNotNull() & F.col("createdAt").isNotNull())
        .withColumn("hasError", F.coalesce(F.col("hasError").cast("boolean"), F.lit(False)))
        .withColumn("runtime", F.col("runtime").cast("double"))
        .withColumn("linesOfCode", F.coalesce(F.col("linesOfCode").cast("int"), F.lit(0)))
        .withColumn("queueMs", F.col("queueMs").cast("double"))
        .withColumn("eventDate", F.to_date(local))
        .withColumn("hour", F.hour(local))
        .dropDuplicates(["jobId"])
    )


def language_proficiency(df: DataFrame, as_of: datetime) -> DataFrame:
    """Per (user, language) proficiency 0-100."""
    recent_cut = F.lit(as_of - timedelta(days=14))
    per = df.groupBy("userId", "language").agg(
        F.count("*").alias("runs"),
        F.avg(F.when(F.col("hasError"), 0.0).otherwise(1.0)).alias("successRate"),
        F.avg(F.when(F.col("createdAt") >= recent_cut, F.when(F.col("hasError"), 0.0).otherwise(1.0))).alias("recentSuccess"),
        F.percentile_approx(F.when(~F.col("hasError"), F.col("runtime")), 0.5).alias("p50Runtime"),
    )
    # Efficiency: how fast this user's successful programs run vs everyone else in the same language.
    w = Window.partitionBy("language").orderBy(F.col("p50Runtime").asc_nulls_last())
    per = per.withColumn("efficiency", F.when(F.col("p50Runtime").isNull(), F.lit(0.5)).otherwise(1 - F.percent_rank().over(w)))
    volume = F.least(F.lit(1.0), F.log10(F.col("runs") + 1) / 2)  # saturates at ~100 runs
    return per.withColumn(
        "proficiency",
        F.round(
            100
            * (
                0.45 * F.col("successRate")
                + 0.20 * volume
                + 0.20 * F.col("efficiency")
                + 0.15 * F.coalesce(F.col("recentSuccess"), F.col("successRate"))
            ),
            1,
        ),
    )


def streaks(df: DataFrame, as_of: datetime) -> DataFrame:
    """Longest and current daily streaks via gaps-and-islands."""
    days = df.select("userId", "eventDate").distinct()
    w = Window.partitionBy("userId").orderBy("eventDate")
    islands = (
        days.withColumn("grp", F.date_sub(F.col("eventDate"), F.row_number().over(w).cast("int")))
        .groupBy("userId", "grp")
        .agg(F.count("*").alias("len"), F.max("eventDate").alias("end"))
    )
    today = F.to_date(F.from_utc_timestamp(F.lit(as_of), TZ))
    return islands.groupBy("userId").agg(
        F.max("len").alias("longestStreak"),
        F.coalesce(
            F.max(F.when(F.col("end") >= F.date_sub(today, 1), F.col("len"))), F.lit(0)
        ).alias("currentStreak"),
        F.count("*").alias("_islands"),
    ).drop("_islands")


def weak_areas(df: DataFrame, top_n: int = 3) -> DataFrame:
    topic_map = F.create_map(*[F.lit(x) for kv in TOPIC_BY_ERROR.items() for x in kv])
    errs = df.filter(F.col("hasError") & F.col("errorType").isNotNull())
    counts = errs.groupBy("userId", "language", "errorType", "errorCategory").agg(F.count("*").alias("count"))
    totals = errs.groupBy("userId").agg(F.count("*").alias("totalErrors"))
    w = Window.partitionBy("userId").orderBy(F.desc("count"), F.asc("errorType"))
    ranked = (
        counts.join(totals, "userId")
        .withColumn("rank", F.row_number().over(w))
        .filter(F.col("rank") <= top_n)
        .withColumn("share", F.round(F.col("count") / F.col("totalErrors") * 100, 1))
        .withColumn("topic", F.coalesce(topic_map[F.col("errorType")], F.lit("Debugging fundamentals")))
    )
    return ranked.groupBy("userId").agg(
        F.sort_array(
            F.collect_list(F.struct("rank", "errorType", "errorCategory", "language", "count", "share", "topic"))
        ).alias("weakAreas")
    )


def trend(df: DataFrame, as_of: datetime) -> DataFrame:
    """Success rate and volume: last 7 days vs the 7 days before."""
    last7 = F.col("createdAt") >= F.lit(as_of - timedelta(days=7))
    prev7 = (F.col("createdAt") >= F.lit(as_of - timedelta(days=14))) & ~last7
    ok = F.when(F.col("hasError"), 0.0).otherwise(1.0)
    t = df.groupBy("userId").agg(
        F.sum(F.when(last7, 1).otherwise(0)).alias("runsLast7"),
        F.sum(F.when(prev7, 1).otherwise(0)).alias("runsPrev7"),
        F.avg(F.when(last7, ok)).alias("successLast7"),
        F.avg(F.when(prev7, ok)).alias("successPrev7"),
    )
    return t.select(
        "userId",
        F.struct(
            "runsLast7",
            "runsPrev7",
            F.round(F.col("successLast7") * 100, 1).alias("successLast7"),
            F.round(F.col("successPrev7") * 100, 1).alias("successPrev7"),
            F.round((F.col("successLast7") - F.col("successPrev7")) * 100, 1).alias("successDelta"),
            F.when(F.col("successLast7").isNull(), "inactive")
            .when(F.col("successPrev7").isNull(), "new")
            .when(F.col("successLast7") - F.col("successPrev7") > 0.05, "improving")
            .when(F.col("successLast7") - F.col("successPrev7") < -0.05, "declining")
            .otherwise("steady")
            .alias("direction"),
        ).alias("trend"),
    )


def peak_hour(df: DataFrame) -> DataFrame:
    w = Window.partitionBy("userId").orderBy(F.desc("n"), F.asc("hour"))
    return (
        df.groupBy("userId", "hour")
        .agg(F.count("*").alias("n"))
        .withColumn("r", F.row_number().over(w))
        .filter("r = 1")
        .select("userId", F.col("hour").alias("peakHour"))
    )


def user_insights(df: DataFrame, as_of: datetime | None = None) -> DataFrame:
    as_of = as_of or datetime.now(timezone.utc).replace(tzinfo=None)
    df = df.filter(F.col("createdAt") <= F.lit(as_of))

    prof = language_proficiency(df, as_of)
    langs = prof.groupBy("userId").agg(
        F.round(F.sum(F.col("proficiency") * F.col("runs")) / F.sum("runs"), 1).alias("skillScore"),
        F.max(F.struct("runs", "language")).getField("language").alias("topLanguage"),
        F.sort_array(
            F.collect_list(
                F.struct(
                    F.col("runs"),
                    "language",
                    F.round(F.col("successRate") * 100, 1).alias("successRate"),
                    F.col("p50Runtime").cast("int").alias("p50Runtime"),
                    "proficiency",
                )
            ),
            asc=False,
        ).alias("languages"),
    )

    totals = df.groupBy("userId").agg(
        F.count("*").alias("totalRuns"),
        F.round(F.avg(F.when(F.col("hasError"), 0.0).otherwise(1.0)) * 100, 1).alias("successRate"),
        F.countDistinct("eventDate").alias("activeDays"),
        F.sum("linesOfCode").alias("linesWritten"),
        F.min("createdAt").alias("firstSeen"),
        F.max("createdAt").alias("lastSeen"),
    )

    out = (
        totals.join(langs, "userId")
        .join(streaks(df, as_of), "userId", "left")
        .join(weak_areas(df), "userId", "left")
        .join(trend(df, as_of), "userId", "left")
        .join(peak_hour(df), "userId", "left")
    )

    w = Window.orderBy("skillScore")
    out = (
        out.withColumn("percentile", F.round(F.percent_rank().over(w) * 100, 1))
        .withColumn(
            "level",
            F.when(F.col("skillScore") >= 75, "Expert")
            .when(F.col("skillScore") >= 55, "Advanced")
            .when(F.col("skillScore") >= 35, "Intermediate")
            .otherwise("Beginner"),
        )
        .withColumn("weakAreas", F.coalesce(F.col("weakAreas"), F.array()))
    )

    # Rule-based recommendations (deterministic, explainable; AI coach adds the narrative).
    rec_topics = F.transform(F.col("weakAreas"), lambda w_: F.concat(F.lit("Practise: "), w_.getField("topic")))
    extra = F.array_compact(
        F.array(
            F.when(F.col("currentStreak") == 0, F.lit("Restart your streak — solve one small problem today")),
            F.when(F.col("trend.direction") == "declining", F.lit("Your success rate dipped this week — revisit fundamentals before new topics")),
            F.when(F.size("languages") == 1, F.lit("Try solving one problem in a second language to broaden your skills")),
            F.when(F.col("skillScore") >= 75, F.lit("You're ready for contest-level problems — try timed practice")),
        )
    )
    out = out.withColumn("recommendations", F.array_distinct(F.concat(rec_topics, extra)))

    return out.withColumn("computedAt", F.lit(as_of)).withColumn("modelVersion", F.lit("insights-v1"))


def platform_daily(df: DataFrame) -> DataFrame:
    return (
        df.groupBy("eventDate")
        .agg(
            F.count("*").alias("runs"),
            F.countDistinct("userId").alias("activeUsers"),
            F.round(F.avg(F.col("hasError").cast("double")) * 100, 2).alias("errorRate"),
            F.percentile_approx("runtime", 0.5).alias("p50Runtime"),
            F.percentile_approx("runtime", 0.95).alias("p95Runtime"),
            F.round(F.avg("queueMs"), 1).alias("avgQueueMs"),
        )
        .withColumn("date", F.date_format("eventDate", "yyyy-MM-dd"))
        .drop("eventDate")
        .orderBy("date")
    )
