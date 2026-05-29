const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { v4: uuidv4 } = require("uuid");

const DOCKER_IMAGES = {
  cpp: "gcc:12",
  c: "gcc:12",
  python: "python:3.11-slim",
  java: "eclipse-temurin:17-jdk-jammy",
};

const FILE_NAMES = {
  cpp: "main.cpp",
  c: "main.c",
  python: "main.py",
  java: "Main.java",
};

const COMPILE_CMDS = {
  cpp: "g++ -O2 -o main main.cpp && ./main",
  c: "gcc -O2 -o main main.c && ./main",
  python: "python3 main.py",
  java: "javac Main.java && java Main",
};

function runDocker(language, code, input = "") {
  return new Promise((resolve) => {
    const jobId = uuidv4();
    const tmpDir = path.join(os.tmpdir(), `cexec_${jobId}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    const fileName = FILE_NAMES[language];
    const filePath = path.join(tmpDir, fileName);
    const inputPath = path.join(tmpDir, "input.txt");

    fs.writeFileSync(filePath, code);
    fs.writeFileSync(inputPath, input);

    const image = DOCKER_IMAGES[language];
    const cmd = COMPILE_CMDS[language];

    const dockerCmd = [
      "docker run --rm",
      "--memory=128m",
      "--cpus=0.5",
      "--network=none",
      `--ulimit nproc=64`,
      `--ulimit nofile=64`,
      `-v "${tmpDir}:/sandbox"`,
      `-w /sandbox`,
      image,
      `sh -c "${cmd} < input.txt"`,
    ].join(" ");

    const startTime = Date.now();

    exec(dockerCmd, { timeout: 15000 }, (err, stdout, stderr) => {
      const elapsed = Date.now() - startTime;

      // cleanup
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch (_) {}

      if (err && err.killed) {
        return resolve({
          stdout: "",
          stderr: "Time Limit Exceeded (15s)",
          exitCode: 1,
          runtime: elapsed,
        });
      }

      resolve({
        stdout: stdout || "",
        stderr: stderr || "",
        exitCode: err ? err.code ?? 1 : 0,
        runtime: elapsed,
      });
    });
  });
}

module.exports = { runDocker };
