// Language runtimes available in the sandbox. Every image must ship
// `sh` and `base64` (coreutils/busybox) because source code is injected
// through an environment variable rather than a host bind mount.
const LANGUAGES = {
  python: {
    label: "Python",
    image: "python:3.11-slim",
    file: "main.py",
    run: "python3 main.py",
  },
  cpp: {
    label: "C++",
    image: "gcc:12",
    file: "main.cpp",
    compile: "g++ -O2 -o main main.cpp",
    run: "./main",
  },
  c: {
    label: "C",
    image: "gcc:12",
    file: "main.c",
    compile: "gcc -O2 -o main main.c",
    run: "./main",
  },
  java: {
    label: "Java",
    image: "eclipse-temurin:17-jdk-jammy",
    file: "Main.java",
    compile: "javac Main.java",
    run: "java -Xss64m -XX:+UseSerialGC Main",
  },
  javascript: {
    label: "JavaScript",
    image: "node:20-slim",
    file: "main.js",
    run: "node main.js",
  },
};

const SUPPORTED = Object.keys(LANGUAGES);

module.exports = { LANGUAGES, SUPPORTED };
