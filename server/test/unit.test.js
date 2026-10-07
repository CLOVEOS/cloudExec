const { test } = require("node:test");
const assert = require("node:assert/strict");

process.env.SARVAM_API_KEY = "test-key";
const { classify } = require("../errorClassifier");
const sarvam = require("../sarvam");
const { computeStreaks } = require("../analytics");
const { buildScript } = require("../executor");
const { LANGUAGES } = require("../languages");

test("classifier: success", () => {
  assert.deepEqual(classify({ stderr: "", exitCode: 0 }), { errorCategory: "none", errorType: null });
});

test("classifier: python runtime + syntax", () => {
  const tb = 'Traceback (most recent call last):\n  File "main.py", line 2\nIndexError: list index out of range';
  assert.deepEqual(classify({ stderr: tb, exitCode: 1 }), { errorCategory: "runtime_error", errorType: "IndexError" });
  assert.equal(classify({ stderr: "SyntaxError: invalid syntax", exitCode: 1 }).errorCategory, "syntax_error");
  assert.equal(classify({ stderr: "OSError: [Errno 101] Network is unreachable", exitCode: 1 }).errorType, "OSError");
});

test("classifier: C/C++/Java", () => {
  assert.equal(classify({ stderr: "main.cpp:1:20: error: 'foo' was not declared in this scope", exitCode: 1 }).errorType, "UndeclaredIdentifier");
  assert.equal(classify({ stderr: "Segmentation fault (core dumped)", exitCode: 139 }).errorType, "SegmentationFault");
  assert.equal(
    classify({ stderr: 'Exception in thread "main" java.lang.NullPointerException', exitCode: 1 }).errorType,
    "NullPointerException"
  );
  assert.equal(classify({ stderr: "Main.java:3: error: cannot find symbol", exitCode: 1 }).errorCategory, "compile_error");
});

test("classifier: limits", () => {
  assert.equal(classify({ timedOut: true }).errorCategory, "timeout");
  assert.equal(classify({ exitCode: 137, stderr: "Killed" }).errorCategory, "memory_limit");
  assert.equal(classify({ outputTruncated: true, exitCode: 0 }).errorCategory, "output_limit");
});

test("streaks", () => {
  const today = new Date("2026-03-10T12:00:00+05:30");
  assert.deepEqual(computeStreaks([], today), { current: 0, longest: 0 });
  assert.deepEqual(computeStreaks(["2026-03-01", "2026-03-02", "2026-03-03", "2026-03-08", "2026-03-09", "2026-03-10"], today), {
    current: 3,
    longest: 3,
  });
  // Yesterday still counts as an active streak.
  assert.equal(computeStreaks(["2026-03-08", "2026-03-09"], today).current, 2);
  assert.equal(computeStreaks(["2026-03-01"], today).current, 0);
});

test("sandbox script injects code via env and reports runtime", () => {
  const s = buildScript(LANGUAGES.cpp);
  assert.match(s, /base64 -d > main\.cpp/);
  assert.match(s, /g\+\+ -O2/);
  assert.match(s, /__CEXEC_RUNTIME_NS=/);
});

test("sarvam: parseJsonReply tolerates fences and think blocks", () => {
  assert.deepEqual(sarvam.parseJsonReply('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(sarvam.parseJsonReply('<think>hmm {no}</think>Sure! {"b":2} done'), { b: 2 });
  assert.throws(() => sarvam.parseJsonReply("no json here"));
});

test("sarvam: chatJson sends correct request", async () => {
  let captured;
  const fakeFetch = async (url, opts) => {
    captured = { url, opts };
    return {
      ok: true,
      text: async () =>
        JSON.stringify({ model: "sarvam-105b", choices: [{ message: { content: '{"title":"IndexError"}' } }], usage: { total_tokens: 10 } }),
    };
  };
  const out = await sarvam.chatJson({ system: "s", user: "u" }, fakeFetch);
  assert.equal(captured.url, "https://api.sarvam.ai/v1/chat/completions");
  assert.equal(captured.opts.headers["api-subscription-key"], "test-key");
  const body = JSON.parse(captured.opts.body);
  assert.equal(body.model, "sarvam-105b");
  assert.deepEqual(body.response_format, { type: "json_object" });
  assert.equal(out.data.title, "IndexError");
});

test("sarvam: translate chunks long text and skips English", async () => {
  const calls = [];
  const fakeFetch = async (url, opts) => {
    calls.push(JSON.parse(opts.body));
    return { ok: true, text: async () => JSON.stringify({ translated_text: "T" }) };
  };
  assert.equal(await sarvam.translate("hello", "en-IN", { fetchImpl: fakeFetch }), "hello");
  const long = Array.from({ length: 50 }, () => "x".repeat(99)).join("\n"); // ~5000 chars
  const out = await sarvam.translate(long, "hi-IN", { fetchImpl: fakeFetch });
  assert.ok(calls.length >= 3);
  assert.ok(calls.every((c) => c.input.length <= 2000 && c.target_language_code === "hi-IN"));
  assert.equal(out.split("\n").length, calls.length);
});

test("sarvam: surfaces HTTP errors", async () => {
  const fakeFetch = async () => ({ ok: false, status: 429, text: async () => "rate limited" });
  await assert.rejects(sarvam.chatJson({ system: "s", user: "u" }, fakeFetch), /429/);
});

test("sarvam: falls back to reasoning_content and reports truncation", async () => {
  const reply = (message, finish_reason = "stop") => async () => ({
    ok: true,
    text: async () => JSON.stringify({ choices: [{ message, finish_reason }], usage: { completion_tokens: 2048 } }),
  });
  const out = await sarvam.chatJson({ system: "s", user: "u" }, reply({ content: null, reasoning_content: '{"ok":true}' }));
  assert.deepEqual(out.data, { ok: true });
  await assert.rejects(
    sarvam.chatJson({ system: "s", user: "u" }, reply({ content: null, reasoning_content: "thinking..." }, "length")),
    /finish_reason=length/
  );
});

test("sarvam: sends low reasoning effort and retries with reasoning off when truncated", async () => {
  const bodies = [];
  const fakeFetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    bodies.push(body);
    const truncated = bodies.length === 1;
    return {
      ok: true,
      text: async () =>
        JSON.stringify({
          choices: [{ message: { content: truncated ? null : '{"done":1}', reasoning_content: truncated ? "hmm" : null }, finish_reason: truncated ? "length" : "stop" }],
        }),
    };
  };
  const out = await sarvam.chatJson({ system: "s", user: "u" }, fakeFetch);
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].reasoning_effort, "low");
  assert.equal(bodies[1].reasoning_effort, null);
  assert.deepEqual(out.data, { done: 1 });
});

test("admin users: filter, sort with nulls last, CSV escaping", () => {
  const { filterSort, csvCell } = require("../adminUsers");
  const rows = [
    { name: "Asha", email: "a@x", college: "", activityTier: "heavy", skillScore: 70, runs: 900 },
    { name: "Bala", email: "b@x", college: "", activityTier: "low", skillScore: null, runs: 90 },
    { name: "Chitra", email: "c@x", college: "MIT", activityTier: "low", skillScore: 40, runs: 120 },
  ];
  assert.deepEqual(filterSort(rows, { sort: "skillScore", order: "desc" }).map((r) => r.name), ["Asha", "Chitra", "Bala"]);
  assert.deepEqual(filterSort(rows, { sort: "skillScore", order: "asc" }).map((r) => r.name), ["Chitra", "Asha", "Bala"]);
  assert.deepEqual(filterSort(rows, { tier: "low", sort: "runs", order: "asc" }).map((r) => r.name), ["Bala", "Chitra"]);
  assert.deepEqual(filterSort(rows, { q: "mit" }).map((r) => r.name), ["Chitra"]);
  assert.equal(csvCell('He said "hi", ok'), '"He said ""hi"", ok"');
  assert.equal(csvCell("=HYPERLINK(1)"), `"'=HYPERLINK(1)"`);
  assert.equal(csvCell(null), "");
});
