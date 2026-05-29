# CloudExec — Distributed Code Execution Platform

> Big Data & Cloud Engineering Major Project  
> Stack: Node.js · Docker · Apache Kafka · MongoDB · Apache Spark · Claude AI · React

---

## Architecture

```
React (Monaco Editor)
      ↓
Express API Gateway (JWT auth, rate limiting)
      ↓                    ↓
Kafka Job Queue      AI Service (Claude API)
      ↓
Docker Workers (sandboxed, isolated containers)
      ↓
MongoDB (execution logs)
      ↓
Apache Spark (batch analytics)
      ↓
Analytics Dashboard
```

---

## Quick Start (Local Dev — No Kafka)

This mode uses direct Docker execution. Perfect for demos.

### Prerequisites
- Node.js 18+
- Docker Desktop running
- MongoDB (local or Atlas)

### 1. Clone & install

```bash
# Server
cd server
npm install

# Client
cd ../client
npm install
```

### 2. Pull Docker images (one-time)

```bash
docker pull gcc:12
docker pull python:3.11-slim
docker pull openjdk:17-slim
```

### 3. Configure environment

```bash
cp .env.example .env
# Fill in ANTHROPIC_API_KEY and MONGO_URI
```

### 4. Start

```bash
# Terminal 1: Server
cd server
npm start

# Terminal 2: Client
cd client
npm start
```

Open http://localhost:3000

---

## Full Stack Mode (Kafka + MongoDB)

### 1. Start infrastructure

```bash
docker-compose up -d
```

This starts:
- Kafka + Zookeeper on port 9092
- MongoDB on port 27017

### 2. Enable Kafka mode

```env
USE_KAFKA=true
```

### 3. Start server + client (same as above)

---

## Apache Spark Analytics

Run the batch analytics job against MongoDB:

```bash
# Install PySpark
pip install pyspark pymongo

# Run the job
spark-submit \
  --packages org.mongodb.spark:mongo-spark-connector_2.12:10.3.0 \
  server/spark_analytics.py
```

This computes:
- Submissions by language
- Error rate overall + per language
- Slow execution detection (>1000ms)
- Runtime percentiles (P50, P75, P90, P99)
- Hourly submission volume (last 24h)

Output saved to `/tmp/cloudexec_analytics_summary.json`

---

## Features

| Feature | Tech | Status |
|---|---|---|
| Multi-language execution | Docker sandbox | ✅ |
| Async job queue | Apache Kafka | ✅ |
| Execution logging | MongoDB | ✅ |
| Batch analytics | Apache Spark | ✅ |
| AI error explanation | Claude API | ✅ |
| Analytics dashboard | React + REST | ✅ |

---

## Project Structure

```
├── server/
│   ├── server.js          # Express API gateway
│   ├── executor.js        # Docker execution engine
│   ├── kafkaProducer.js   # Publishes jobs to Kafka
│   ├── kafkaConsumer.js   # Consumes & processes jobs
│   ├── db.js              # MongoDB helpers
│   ├── aiRoute.js         # Claude AI endpoint
│   └── spark_analytics.py # PySpark batch job
├── client/
│   ├── App.jsx            # Main React app
│   └── App.css            # Styles
├── docker-compose.yml     # Kafka + MongoDB
└── .env.example
```

---

## Security

- Each code execution runs in an isolated Docker container
- Memory limited to 128MB per container
- CPU limited to 0.5 cores
- Network disabled (`--network=none`)
- 15-second execution timeout
- File descriptors limited (`ulimit`)

---

## Big Data Components (for project report)

1. **Apache Kafka** — Distributed message streaming. Decouples submission ingestion from execution. Partitioned by language for horizontal scalability.

2. **Apache Spark** — Batch processing of execution logs. Computes aggregations, percentiles, and trend analysis across the full dataset.

3. **MongoDB** — Document store for semi-structured execution logs. Supports flexible schema as the log structure evolves.

4. **Docker** — Container orchestration for isolated, reproducible execution environments. Foundation for cloud-native deployment.
