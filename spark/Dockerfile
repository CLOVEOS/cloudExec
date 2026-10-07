FROM apache/spark:3.5.3-python3
USER root
RUN pip install --no-cache-dir "pymongo>=4.8"
WORKDIR /opt/cloudexec
COPY insights_lib.py batch_insights.py streaming_ingest.py ./
# Ivy cache for --packages downloads (mount a volume here to reuse across runs)
ENV HOME=/opt/cloudexec PATH="/opt/spark/bin:${PATH}"
RUN mkdir -p /data/lake /data/checkpoints /opt/cloudexec/.ivy2 && chown -R spark:spark /data /opt/cloudexec
USER spark
