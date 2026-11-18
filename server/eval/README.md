# Evaluation

`scripts/evaluate.js` measures CloudExec and prints a results table. Every number is computed from a run.

| Flag | Measures | Needs |
|---|---|---|
| `--sandbox` | Runs the 63 labelled programs in `benchmark.js` (5 languages, 10 correct + 53 buggy) through the real Docker sandbox and error classifier: execution correctness, limit containment, detection P/R/F1, category and error-type accuracy, run times, throughput | Docker + the language images |
| `--ai --langs en-IN,hi-IN` | Sends each failing program to Sarvam with the production explain prompt: identification accuracy, valid replies, whether the AI's `fixed_code` runs and prints the intended output, native-script share, latency, tokens | `SARVAM_API_KEY` (plus `--sandbox` requirements) |
| `--db` | Real platform usage from MongoDB: users (real vs synthetic), submissions, success rate, runtime/queue/end-to-end latency, error mix, AI usage and latency, Spark profiles | `MONGO_URI` |

On the production VM:

```bash
docker compose -f docker-compose.prod.yml exec api node scripts/evaluate.js --db
docker compose -f docker-compose.prod.yml exec worker node scripts/evaluate.js --sandbox --ai --langs en-IN,hi-IN
```

Results are also written to `eval/results/` as JSON. The committed `sandbox-*.json` files are reference runs
(cloud container, 4-way concurrency): `sandbox-before-classifier-fix.json` is the first run, which found two
classifier bugs (output floods reported as memory limits; C's `'x' undeclared` not recognised), and
`sandbox-run-1..3.json` are three runs after the fix.

Ground truth: labels describe what each program really does, checked against its raw stderr, not against the
classifier. Known disagreements: `js-json-parse` (a runtime `SyntaxError` from `JSON.parse` is reported as a
syntax error) and `java-stackoverflow` (about 3 runs in 8 are killed by the 256 MB limit before the JVM throws).
The benchmark is small and written by the project author, so treat it as a regression suite, not a field study.
