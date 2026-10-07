"""
Deprecated entry point, kept for backwards compatibility.

The analytics pipeline now lives in spark/:
  spark/streaming_ingest.py  – Kafka → Parquet data lake + live metrics
  spark/batch_insights.py    – per-user insights & platform aggregates → MongoDB

This wrapper simply forwards to spark/batch_insights.py.
"""
import os
import runpy
import sys

if __name__ == "__main__":
    target = os.path.join(os.path.dirname(os.path.abspath(__file__)), "spark", "batch_insights.py")
    sys.argv[0] = target
    runpy.run_path(target, run_name="__main__")
