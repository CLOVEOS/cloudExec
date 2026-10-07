// Sandboxed code execution on Docker.
//
// Design notes
// - No host bind mounts: source code travels in an env var (base64) and is
//   decoded into a tmpfs inside the container. That keeps workers stateless
//   and lets them run inside a container themselves (docker.sock / DinD /
//   remote DOCKER_HOST) without sharing a filesystem with the daemon.
// - spawn() with an argv array: user input never touches a shell on the host.
// - Hardened container: no network, read-only rootfs, dropped capabilities,
//   pids/memory/cpu limits, unprivileged user, hard wall-clock kill.
const { spawn } = require("child_process");
const { v4: uuidv4 } = require("uuid");
const config = require("./config");
const { LANGUAGES } = require("./languages");

const RUNTIME_MARKER = "__CEXEC_RUNTIME_NS=";

function buildScript(lang) {
  const steps = [`printf '%s' "$CODE_B64" | base64 -d > ${lang.file}`];
  if (lang.compile) steps.push(`${lang.compile} </dev/null || exit $?`);
  // Measure the program itself (not container start-up) and report it on stderr.
  steps.push(
    `T0=$(date +%s%N); ${lang.run}; RC=$?; ` +
      `echo "${RUNTIME_MARKER}$(( $(date +%s%N) - T0 ))" >&2; exit $RC`
  );
  return steps.join(" && ");
}

function dockerArgs(name, lang) {
  const { memory, cpus } = config.sandbox;
  return [
    "run", "--rm", "-i",
    "--name", name,
    "--network=none",
    "--read-only",
    "--tmpfs", "/sandbox:rw,exec,size=64m,mode=1777",
    "--tmpfs", "/tmp:rw,exec,size=64m,mode=1777",
    "-w", "/sandbox",
    `--memory=${memory}`, `--memory-swap=${memory}`,
    `--cpus=${cpus}`,
    "--pids-limit=128",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    "--user=65534:65534",
    "-e", "HOME=/tmp",
    "-e", "CODE_B64",
    lang.image,
    "sh", "-c", buildScript(lang),
  ];
}

function capPush(buf, chunk, limit) {
  if (buf.bytes >= limit) { buf.truncated = true; return; }
  const room = limit - buf.bytes;
  const piece = chunk.length > room ? chunk.subarray(0, room) : chunk;
  if (chunk.length > room) buf.truncated = true;
  buf.parts.push(piece);
  buf.bytes += piece.length;
}

/**
 * Execute `code` in a fresh container.
 * @returns {Promise<{stdout, stderr, exitCode, runtime, wallTime, timedOut, oomKilled, outputTruncated}>}
 */
function runDocker(language, code, input = "") {
  const lang = LANGUAGES[language];
  if (!lang) return Promise.reject(new Error(`Unsupported language: ${language}`));

  const name = `cexec-${uuidv4()}`;
  const { timeoutMs, maxOutputBytes } = config.sandbox;

  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn("docker", dockerArgs(name, lang), {
      env: { ...process.env, CODE_B64: Buffer.from(code, "utf8").toString("base64") },
    });

    const out = { parts: [], bytes: 0, truncated: false };
    const err = { parts: [], bytes: 0, truncated: false };
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      spawn("docker", ["kill", name]).on("error", () => {});
      child.kill("SIGKILL");
    }, timeoutMs + 3000); // + container start-up allowance

    child.stdout.on("data", (c) => {
      capPush(out, c, maxOutputBytes);
      // Runaway output: stop early instead of buffering forever.
      if (out.truncated && !timedOut) spawn("docker", ["kill", name]).on("error", () => {});
    });
    child.stderr.on("data", (c) => capPush(err, c, maxOutputBytes));
    child.on("error", (e) => { clearTimeout(timer); reject(e); });

    child.stdin.on("error", () => {}); // program may exit before reading stdin
    child.stdin.end(input);

    child.on("close", (code) => {
      clearTimeout(timer);
      const wallTime = Date.now() - started;
      let stderr = Buffer.concat(err.parts).toString("utf8");

      let runtime = null;
      const idx = stderr.lastIndexOf(RUNTIME_MARKER);
      if (idx !== -1) {
        runtime = Math.round(parseInt(stderr.slice(idx + RUNTIME_MARKER.length), 10) / 1e6);
        stderr = stderr.slice(0, idx);
      }
      if (timedOut) stderr = (stderr ? stderr + "\n" : "") + `Time Limit Exceeded (${timeoutMs / 1000}s)`;

      resolve({
        stdout: Buffer.concat(out.parts).toString("utf8"),
        stderr,
        exitCode: timedOut ? 124 : code ?? 1,
        runtime: timedOut ? timeoutMs : runtime ?? wallTime,
        wallTime,
        timedOut,
        oomKilled: !timedOut && code === 137,
        outputTruncated: out.truncated,
      });
    });
  });
}

module.exports = { runDocker, buildScript };
