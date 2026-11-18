// Labelled benchmark for evaluating CloudExec.
//
// Each case is a small, realistic student program. Correct programs carry the
// output they must print; buggy programs carry the ground-truth label a human
// grader would give (category + type, in the classifier's vocabulary), the
// keywords any correct explanation must mention, and - when the intent is
// unambiguous - the output a correctly fixed program must print (`fixOutput`).
//
// Labels describe what the program really does, never what the classifier
// says: they are checked against the raw stderr, not the classifier result.
// Known flaky case: java-stackoverflow is sometimes (about 3 runs in 8) killed
// by the 256 MB memory limit before the JVM throws StackOverflowError, because
// the JVM runs with -Xss64m. It is labelled with the real error either way.
const r = String.raw;

const ok = (id, language, code, expectOutput, input = "") => ({ id, language, code, input, expectOutput, label: { category: "none", type: null } });
const bug = (id, language, code, category, type, keywords, fixOutput = null, input = "") => ({
  id, language, code, input, label: { category, type }, keywords, fixOutput,
});

module.exports = [
  // ───────────── Python ─────────────
  ok("py-sum", "python", r`n = int(input())
nums = list(map(int, input().split()))
print(sum(nums[:n]))`, "6", "3\n1 2 3\n"),
  ok("py-fib", "python", r`a, b = 0, 1
out = []
for _ in range(10):
    out.append(a)
    a, b = b, a + b
print(*out)`, "0 1 1 2 3 5 8 13 21 34"),
  bug("py-missing-colon", "python", r`def greet(name)
    print("Hello, " + name)

greet("Asha")`, "syntax_error", "SyntaxError", ["colon", ":"], "Hello, Asha"),
  bug("py-indent", "python", r`def say_hi():
print("hi")

say_hi()`, "syntax_error", "IndentationError", ["indent"], "hi"),
  bug("py-index", "python", r`marks = [90, 80, 70]
for i in range(len(marks) + 1):
    print(marks[i])`, "runtime_error", "IndexError", ["IndexError", "index", "range"], "90\n80\n70"),
  bug("py-key", "python", r`stock = {"apple": 5, "banana": 3}
print(stock["Apple"])`, "runtime_error", "KeyError", ["KeyError", "key"]),
  bug("py-type-concat", "python", r`age = input()
print("Next year you will be " + age + 1)`, "runtime_error", "TypeError", ["TypeError", "str", "int", "string", "integer"], "Next year you will be 21", "20\n"),
  bug("py-name", "python", r`total = 0
for x in [1, 2, 3]:
    totl += x
print(total)`, "runtime_error", "NameError", ["NameError", "totl", "not defined", "typo", "spell"], "6"),
  bug("py-zero-div", "python", r`scores = []
print(sum(scores) / len(scores))`, "runtime_error", "ZeroDivisionError", ["ZeroDivisionError", "zero", "empty"]),
  bug("py-attr", "python", r`nums = [3, 1, 2]
nums.push(4)
print(nums)`, "runtime_error", "AttributeError", ["AttributeError", "append", "push"], "[3, 1, 2, 4]"),
  bug("py-value", "python", r`n = int(input())
print(n * 2)`, "runtime_error", "ValueError", ["ValueError", "int", "convert", "float"], null, "12.5\n"),
  bug("py-recursion", "python", r`def fact(n):
    return n * fact(n - 1)

print(fact(5))`, "runtime_error", "RecursionError", ["RecursionError", "base case", "recursion"], "120"),
  bug("py-unbound", "python", r`count = 0
def inc():
    count += 1
inc()
print(count)`, "runtime_error", "UnboundLocalError", ["UnboundLocalError", "global", "local"], "1"),
  bug("py-infinite", "python", r`i = 0
while i < 10:
    i == i + 1
print("done")`, "timeout", "TimeLimitExceeded", ["infinite", "never", "==", "comparison", "assignment"], "done"),
  bug("py-output-flood", "python", r`i = 0
while i < 5:
    print(i)`, "output_limit", "OutputLimitExceeded", ["infinite", "increment", "never", "i += 1", "i = i + 1"], "0\n1\n2\n3\n4"),
  bug("py-memory", "python", r`data = [0] * (10 ** 9)
print(len(data))`, "memory_limit", "MemoryLimitExceeded", ["memory", "MemoryError", "large"]),

  // ───────────── JavaScript ─────────────
  ok("js-sum", "javascript", r`const nums = require("fs").readFileSync(0, "utf8").trim().split(/\s+/).map(Number);
console.log(nums.reduce((a, b) => a + b, 0));`, "6", "1 2 3\n"),
  ok("js-sort", "javascript", r`console.log([5, 3, 9, 1].sort((a, b) => a - b).join(" "));`, "1 3 5 9"),
  bug("js-missing-brace", "javascript", r`function add(a, b) {
  return a + b;

console.log(add(2, 3));`, "syntax_error", "SyntaxError", ["brace", "}", "unexpected end"], "5"),
  bug("js-reference", "javascript", r`const items = [1, 2, 3];
console.log(itemz.length);`, "runtime_error", "ReferenceError", ["ReferenceError", "itemz", "not defined", "typo"], "3"),
  bug("js-undefined-prop", "javascript", r`const user = { name: "Asha" };
console.log(user.address.city);`, "runtime_error", "TypeError", ["TypeError", "undefined", "address"]),
  bug("js-not-function", "javascript", r`const nums = [1, 2, 3];
console.log(nums.sum());`, "runtime_error", "TypeError", ["TypeError", "not a function", "reduce", "sum"], "6"),
  bug("js-const-assign", "javascript", r`const total = 0;
for (const x of [1, 2, 3]) total += x;
console.log(total);`, "runtime_error", "TypeError", ["TypeError", "const", "let", "constant"], "6"),
  bug("js-recursion", "javascript", r`function fact(n) { return n * fact(n - 1); }
console.log(fact(5));`, "runtime_error", "RangeError", ["RangeError", "call stack", "base case", "recursion"], "120"),
  bug("js-bad-array-length", "javascript", r`const size = -1;
const arr = new Array(size);
console.log(arr.length);`, "runtime_error", "RangeError", ["RangeError", "length", "negative"]),
  bug("js-json-parse", "javascript", r`const data = JSON.parse("{name: 'Asha'}");
console.log(data.name);`, "runtime_error", "SyntaxError", ["JSON", "quote", "double"], "Asha"),
  bug("js-infinite", "javascript", r`let i = 0;
while (i < 10) {
  if (i % 2 === 0) continue;
  i++;
}
console.log("done");`, "timeout", "TimeLimitExceeded", ["infinite", "continue", "never"], "done"),
  bug("js-output-flood", "javascript", r`for (let i = 0; i < 5; i--) console.log(i);`, "output_limit", "OutputLimitExceeded", ["infinite", "i--", "decrement", "i++"], "0\n1\n2\n3\n4"),
  bug("js-heap", "javascript", r`const chunks = [];
while (true) chunks.push(new Array(1e6).fill(1));`, "memory_limit", "MemoryLimitExceeded", ["memory", "heap"]),

  // ───────────── C ─────────────
  ok("c-sum", "c", r`#include <stdio.h>
int main(void) {
  int n, x, s = 0;
  scanf("%d", &n);
  for (int i = 0; i < n; i++) { scanf("%d", &x); s += x; }
  printf("%d\n", s);
  return 0;
}`, "6", "3\n1 2 3\n"),
  ok("c-fact", "c", r`#include <stdio.h>
int main(void) {
  long f = 1;
  for (int i = 2; i <= 5; i++) f *= i;
  printf("%ld\n", f);
  return 0;
}`, "120"),
  bug("c-missing-semicolon", "c", r`#include <stdio.h>
int main(void) {
  int x = 5
  printf("%d\n", x);
  return 0;
}`, "syntax_error", "CSyntaxError", ["semicolon", ";"], "5"),
  bug("c-undeclared", "c", r`#include <stdio.h>
int main(void) {
  for (int i = 0; i < 3; i++) count++;
  printf("%d\n", count);
  return 0;
}`, "compile_error", "UndeclaredIdentifier", ["declare", "count"], "3"),
  bug("c-undefined-ref", "c", r`#include <stdio.h>
int main(void) {
  prnt("hi\n");
  return 0;
}`, "compile_error", "UndefinedReference", ["printf", "prnt", "undefined", "typo"], "hi"),
  bug("c-no-member", "c", r`#include <stdio.h>
struct Point { int x; };
int main(void) {
  struct Point p;
  p.y = 3;
  printf("%d\n", p.y);
  return 0;
}`, "compile_error", "CCompileError", ["member", "y", "struct"]),
  bug("c-null-deref", "c", r`#include <stdio.h>
#include <stdlib.h>
int main(void) {
  int *scores = NULL;
  int n;
  scanf("%d", &n);
  scores[n] = 10;
  printf("%d\n", scores[n]);
  return 0;
}`, "runtime_error", "SegmentationFault", ["NULL", "null", "malloc", "segmentation", "memory"], null, "2\n"),
  bug("c-div-zero", "c", r`#include <stdio.h>
int main(void) {
  int total = 10, count;
  scanf("%d", &count);
  printf("%d\n", total / count);
  return 0;
}`, "runtime_error", "FloatingPointException", ["zero", "divide", "division"], null, "0\n"),
  bug("c-unsigned-loop", "c", r`#include <stdio.h>
int main(void) {
  unsigned int i;
  long sum = 0;
  for (i = 10; i >= 0; i--) sum += i;
  printf("%ld\n", sum);
  return 0;
}`, "timeout", "TimeLimitExceeded", ["unsigned", "infinite", ">= 0", "never"], "55"),
  bug("c-huge-alloc", "c", r`#include <stdio.h>
#include <stdlib.h>
#include <string.h>
int main(void) {
  size_t n = 1UL << 30;
  volatile char *buf = malloc(n);
  for (size_t i = 0; i < n; i += 4096) buf[i] = 1;
  printf("%d\n", buf[100]);
  return 0;
}`, "memory_limit", "MemoryLimitExceeded", ["memory", "large", "malloc", "1 GB", "GB"]),

  // ───────────── C++ ─────────────
  ok("cpp-sum", "cpp", r`#include <iostream>
#include <vector>
int main() {
  int n; std::cin >> n;
  std::vector<int> v(n);
  long s = 0;
  for (auto &x : v) { std::cin >> x; s += x; }
  std::cout << s << "\n";
}`, "6", "3\n1 2 3\n"),
  ok("cpp-reverse", "cpp", r`#include <iostream>
#include <string>
#include <algorithm>
int main() {
  std::string s = "hello";
  std::reverse(s.begin(), s.end());
  std::cout << s << "\n";
}`, "olleh"),
  bug("cpp-missing-semicolon", "cpp", r`#include <iostream>
int main() {
  std::cout << "Hello" << std::endl
  return 0;
}`, "syntax_error", "CSyntaxError", ["semicolon", ";"], "Hello"),
  bug("cpp-no-std", "cpp", r`#include <iostream>
int main() {
  cout << "Hello" << endl;
  return 0;
}`, "compile_error", "UndeclaredIdentifier", ["std", "namespace"], "Hello"),
  bug("cpp-max-types", "cpp", r`#include <iostream>
#include <algorithm>
int main() {
  int a = 1;
  double b = 2.5;
  std::cout << std::max(a, b) << "\n";
}`, "compile_error", "NoMatchingFunction", ["type", "double", "int", "template"], "2.5"),
  bug("cpp-bad-convert", "cpp", r`#include <iostream>
#include <string>
int main() {
  int x = std::string("5");
  std::cout << x + 1 << "\n";
}`, "compile_error", "CCompileError", ["stoi", "convert", "string", "int"], "6"),
  bug("cpp-at-range", "cpp", r`#include <iostream>
#include <vector>
int main() {
  std::vector<int> v = {1, 2, 3};
  for (size_t i = 0; i <= v.size(); i++) std::cout << v.at(i) << "\n";
}`, "runtime_error", "UncaughtException", ["out_of_range", "range", "<=", "size"], "1\n2\n3"),
  bug("cpp-bad-index", "cpp", r`#include <iostream>
#include <vector>
int main() {
  int idx; std::cin >> idx;
  std::vector<int> v(3);
  v[idx] = 5;
  std::cout << v[idx] << "\n";
}`, "runtime_error", "SegmentationFault", ["index", "bounds", "segmentation", "size"], null, "100000000\n"),
  bug("cpp-unsigned-loop", "cpp", r`#include <iostream>
int main() {
  long sum = 0;
  for (unsigned i = 10; i >= 0; i--) sum += i;
  std::cout << sum << "\n";
}`, "timeout", "TimeLimitExceeded", ["unsigned", "infinite", ">= 0", "never"], "55"),
  bug("cpp-output-flood", "cpp", r`#include <iostream>
int main() {
  for (int i = 0; i < 5;) std::cout << i << "\n";
}`, "output_limit", "OutputLimitExceeded", ["infinite", "increment", "i++"], "0\n1\n2\n3\n4"),
  bug("cpp-huge-vector", "cpp", r`#include <iostream>
#include <vector>
int main() {
  std::vector<long long> v(1000000000LL, 1);
  std::cout << v[5] << "\n";
}`, "memory_limit", "MemoryLimitExceeded", ["memory", "large", "bad_alloc", "GB"]),

  // ───────────── Java ─────────────
  ok("java-sum", "java", r`import java.util.*;
public class Main {
  public static void main(String[] args) {
    Scanner sc = new Scanner(System.in);
    int n = sc.nextInt(), s = 0;
    for (int i = 0; i < n; i++) s += sc.nextInt();
    System.out.println(s);
  }
}`, "6", "3\n1 2 3\n"),
  ok("java-reverse", "java", r`public class Main {
  public static void main(String[] args) {
    System.out.println(new StringBuilder("hello").reverse());
  }
}`, "olleh"),
  bug("java-missing-semicolon", "java", r`public class Main {
  public static void main(String[] args) {
    int x = 5
    System.out.println(x);
  }
}`, "syntax_error", "JavaSyntaxError", ["semicolon", ";"], "5"),
  bug("java-symbol", "java", r`public class Main {
  public static void main(String[] args) {
    int total = 0;
    for (int i = 1; i <= 3; i++) totl += i;
    System.out.println(total);
  }
}`, "compile_error", "CannotFindSymbol", ["symbol", "totl", "typo", "declare"], "6"),
  bug("java-incompatible", "java", r`public class Main {
  public static void main(String[] args) {
    int x = "5";
    System.out.println(x + 1);
  }
}`, "compile_error", "IncompatibleTypes", ["incompatible", "String", "int", "parseInt"], "6"),
  bug("java-missing-return", "java", r`public class Main {
  static int max(int a, int b) {
    if (a > b) return a;
  }
  public static void main(String[] args) {
    System.out.println(max(3, 7));
  }
}`, "compile_error", "JavaCompileError", ["return"], "7"),
  bug("java-npe", "java", r`public class Main {
  public static void main(String[] args) {
    String name = null;
    System.out.println(name.length());
  }
}`, "runtime_error", "NullPointerException", ["NullPointerException", "null"]),
  bug("java-aioobe", "java", r`public class Main {
  public static void main(String[] args) {
    int[] arr = {1, 2, 3};
    for (int i = 0; i <= arr.length; i++) System.out.println(arr[i]);
  }
}`, "runtime_error", "ArrayIndexOutOfBoundsException", ["ArrayIndexOutOfBounds", "<=", "length", "index"], "1\n2\n3"),
  bug("java-arith", "java", r`public class Main {
  public static void main(String[] args) {
    int[] marks = {};
    int sum = 0;
    for (int m : marks) sum += m;
    System.out.println(sum / marks.length);
  }
}`, "runtime_error", "ArithmeticException", ["ArithmeticException", "zero", "empty"]),
  bug("java-nfe", "java", r`public class Main {
  public static void main(String[] args) {
    int n = Integer.parseInt("12a");
    System.out.println(n);
  }
}`, "runtime_error", "NumberFormatException", ["NumberFormatException", "12a", "number", "parse"]),
  bug("java-stackoverflow", "java", r`public class Main {
  static long fact(int n) { return n * fact(n - 1); }
  public static void main(String[] args) {
    System.out.println(fact(5));
  }
}`, "runtime_error", "StackOverflowError", ["StackOverflowError", "base case", "recursion"], "120"),
  bug("java-infinite", "java", r`public class Main {
  public static void main(String[] args) {
    int i = 0;
    while (i < 10) {
      if (i % 2 == 0) continue;
      i++;
    }
    System.out.println("done");
  }
}`, "timeout", "TimeLimitExceeded", ["infinite", "continue", "never"], "done"),
  bug("java-oom", "java", r`import java.util.*;
public class Main {
  public static void main(String[] args) {
    List<long[]> blocks = new ArrayList<>();
    while (true) blocks.add(new long[1_000_000]);
  }
}`, "memory_limit", "OutOfMemoryError", ["OutOfMemoryError", "memory", "heap"]),
];
