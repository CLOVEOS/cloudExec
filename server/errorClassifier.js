// Turns raw stderr into structured features. These two fields
// (errorCategory + errorType) are what the Spark jobs aggregate to find
// each user's weak areas, so keep the vocabulary small and stable.

const CATEGORY = {
  NONE: "none",
  COMPILE: "compile_error",
  SYNTAX: "syntax_error",
  RUNTIME: "runtime_error",
  TIMEOUT: "timeout",
  MEMORY: "memory_limit",
  OUTPUT: "output_limit",
};

// Ordered: first match wins. [regex, errorType, category]
const RULES = [
  // ── Python ──
  [/\bSyntaxError\b/, "SyntaxError", CATEGORY.SYNTAX],
  [/\bIndentationError\b|\bTabError\b/, "IndentationError", CATEGORY.SYNTAX],
  [/\bRecursionError\b/, "RecursionError", CATEGORY.RUNTIME],
  [/\bMemoryError\b/, "MemoryError", CATEGORY.MEMORY],
  [/\b(NameError|TypeError|ValueError|IndexError|KeyError|AttributeError|ZeroDivisionError|ImportError|ModuleNotFoundError|UnboundLocalError|AssertionError|EOFError|FileNotFoundError|OverflowError|StopIteration)\b/, null, CATEGORY.RUNTIME],

  // ── Java ──
  [/error: ';' expected|error: class, interface, enum, or record expected|error: illegal start of/, "JavaSyntaxError", CATEGORY.SYNTAX],
  [/error: cannot find symbol/, "CannotFindSymbol", CATEGORY.COMPILE],
  [/error: incompatible types/, "IncompatibleTypes", CATEGORY.COMPILE],
  [/\.java:\d+: error:/, "JavaCompileError", CATEGORY.COMPILE],
  [/java\.lang\.OutOfMemoryError/, "OutOfMemoryError", CATEGORY.MEMORY],
  [/java\.lang\.StackOverflowError/, "StackOverflowError", CATEGORY.RUNTIME],
  [/java\.lang\.(\w+Exception)/, null, CATEGORY.RUNTIME],

  // ── C / C++ ──
  [/error: expected [^\n]*before|error: expected ';'|error: stray/, "CSyntaxError", CATEGORY.SYNTAX],
  [/undefined reference to/, "UndefinedReference", CATEGORY.COMPILE],
  [/error: '[^']+' was not declared in this scope|error: use of undeclared identifier|error: unknown type name/, "UndeclaredIdentifier", CATEGORY.COMPILE],
  [/error: no matching function for call/, "NoMatchingFunction", CATEGORY.COMPILE],
  [/\b(main\.(c|cpp)):\d+:\d+: error:/, "CCompileError", CATEGORY.COMPILE],
  [/Segmentation fault|SIGSEGV/, "SegmentationFault", CATEGORY.RUNTIME],
  [/std::bad_alloc/, "BadAlloc", CATEGORY.MEMORY],
  [/terminate called after throwing|std::out_of_range|std::(\w+_error)/, "UncaughtException", CATEGORY.RUNTIME],
  [/Floating point exception|SIGFPE/, "FloatingPointException", CATEGORY.RUNTIME],
  [/Aborted|SIGABRT|double free|stack smashing/, "Abort", CATEGORY.RUNTIME],

  // ── JavaScript ──
  [/\bSyntaxError:/, "SyntaxError", CATEGORY.SYNTAX],
  [/\b(ReferenceError|TypeError|RangeError):/, null, CATEGORY.RUNTIME],

  // ── Generic "SomethingError: message" / "SomethingException" (e.g. OSError) ──
  [/^(\w+(?:Error|Exception))\b/m, null, CATEGORY.RUNTIME],
];

function classify({ stderr = "", exitCode = 0, timedOut = false, oomKilled = false, outputTruncated = false }) {
  if (timedOut) return { errorCategory: CATEGORY.TIMEOUT, errorType: "TimeLimitExceeded" };
  if (oomKilled || exitCode === 137) return { errorCategory: CATEGORY.MEMORY, errorType: "MemoryLimitExceeded" };

  const text = stderr || "";
  for (const [re, type, category] of RULES) {
    const m = text.match(re);
    if (m) return { errorCategory: category, errorType: type || m[1] || m[0] };
  }

  if (outputTruncated) return { errorCategory: CATEGORY.OUTPUT, errorType: "OutputLimitExceeded" };
  if (exitCode !== 0) return { errorCategory: CATEGORY.RUNTIME, errorType: `NonZeroExit(${exitCode})` };
  if (text.trim()) return { errorCategory: CATEGORY.RUNTIME, errorType: "StderrOutput" };
  return { errorCategory: CATEGORY.NONE, errorType: null };
}

module.exports = { classify, CATEGORY };
