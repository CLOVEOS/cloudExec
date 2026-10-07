import os
import sys
from datetime import datetime, timedelta

import pytest
from pyspark.sql import SparkSession

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import insights_lib as lib  # noqa: E402

AS_OF = datetime(2026, 3, 10, 12, 0, 0)


@pytest.fixture(scope="session")
def spark():
    s = (SparkSession.builder.master("local[2]").appName("insights-tests")
         .config("spark.sql.session.timeZone", "UTC")
         .config("spark.sql.shuffle.partitions", "2").getOrCreate())
    yield s
    s.stop()


def ev(i, user, lang, days_ago, err=None, runtime=50):
    ts = AS_OF - timedelta(days=days_ago, hours=1)
    return (f"j{i}", user, lang, err is not None, "runtime_error" if err else "none", err,
            float(runtime), 20, 10.0, ts.strftime("%Y-%m-%dT%H:%M:%SZ"))


COLS = ["jobId", "userId", "language", "hasError", "errorCategory", "errorType",
        "runtime", "linesOfCode", "queueMs", "createdAt"]


@pytest.fixture(scope="session")
def events(spark):
    rows = []
    i = 0
    # alice: strong, active 5 consecutive days up to today, python
    for d in range(5):
        for _ in range(4):
            rows.append(ev(i, "alice", "python", d, runtime=30)); i += 1
    # bob: weak, keeps hitting IndexError, last active 10 days ago
    for d in range(10, 20):
        rows.append(ev(i, "bob", "python", d, err="IndexError", runtime=200)); i += 1
        rows.append(ev(i, "bob", "cpp", d, runtime=20 if d % 2 else 40,
                       err=None if d % 3 else "SegmentationFault")); i += 1
    # duplicate jobId must be dropped
    rows.append(rows[0])
    return lib.normalize(spark.createDataFrame(rows, COLS))


def by_user(df):
    return {r["userId"]: r for r in df.collect()}


def test_normalize_dedups(events):
    assert events.count() == 40


def test_user_insights(events):
    out = by_user(lib.user_insights(events, AS_OF))
    a, b = out["alice"], out["bob"]

    assert a["totalRuns"] == 20 and a["successRate"] == 100.0
    assert a["skillScore"] > b["skillScore"]
    assert a["percentile"] == 100.0 and b["percentile"] == 0.0
    assert a["currentStreak"] == 5 and a["longestStreak"] == 5
    assert b["currentStreak"] == 0 and b["longestStreak"] == 10
    assert a["weakAreas"] == []

    top = b["weakAreas"][0]
    assert top["errorType"] == "IndexError" and top["topic"].startswith("Array bounds")
    assert "Practise: Array bounds & off-by-one errors" in b["recommendations"]
    assert b["trend"]["direction"] == "inactive"
    assert {l["language"] for l in b["languages"]} == {"python", "cpp"}
    assert b["topLanguage"] in {"python", "cpp"}


def test_platform_daily(events):
    rows = lib.platform_daily(events).collect()
    assert sum(r["runs"] for r in rows) == 40
    assert all(0 <= r["errorRate"] <= 100 for r in rows)
