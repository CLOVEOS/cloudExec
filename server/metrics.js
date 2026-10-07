// Prometheus metrics shared by the API and the workers.
const client = require("prom-client");

const register = new client.Registry();
client.collectDefaultMetrics({ register });

const executions = new client.Counter({
  name: "cloudexec_executions_total",
  help: "Completed executions",
  labelNames: ["language", "status", "category"],
  registers: [register],
});

const runtime = new client.Histogram({
  name: "cloudexec_execution_runtime_ms",
  help: "Program runtime inside the sandbox (ms)",
  labelNames: ["language"],
  buckets: [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
  registers: [register],
});

const queueWait = new client.Histogram({
  name: "cloudexec_queue_wait_ms",
  help: "Time a job spent queued in Kafka before a worker picked it up (ms)",
  buckets: [5, 25, 100, 250, 500, 1000, 5000, 15000],
  registers: [register],
});

const aiRequests = new client.Counter({
  name: "cloudexec_ai_requests_total",
  help: "Sarvam AI calls",
  labelNames: ["feature", "outcome"],
  registers: [register],
});

const httpDuration = new client.Histogram({
  name: "cloudexec_http_request_duration_seconds",
  help: "HTTP request latency",
  labelNames: ["method", "route", "status"],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 15],
  registers: [register],
});

function httpMiddleware(req, res, next) {
  const end = httpDuration.startTimer();
  res.on("finish", () => {
    const route = req.route?.path ? (req.baseUrl || "") + req.route.path : "unmatched";
    end({ method: req.method, route, status: res.statusCode });
  });
  next();
}

module.exports = { register, executions, runtime, queueWait, aiRequests, httpMiddleware };
