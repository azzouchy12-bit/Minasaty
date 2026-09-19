const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const studentHtml = fs.readFileSync(path.join(root, "public", "student-live.html"), "utf8");
const studentJs = fs.readFileSync(path.join(root, "public", "js", "student-live.js"), "utf8");
const portraitCss = fs.readFileSync(path.join(root, "public", "css", "student-portrait.css"), "utf8");

test("student-live.html includes interactive calculator trigger button in header bar", () => {
  assert.match(studentHtml, /id="student-calculator-btn"/, "Calculator trigger button must exist");
  assert.match(studentHtml, /class="student-calculator-btn"/, "Calculator button class must exist");
  assert.match(studentHtml, /حاسبة/, "Calculator button text must exist");
  assert.match(studentHtml, /id="class-subject-label"[^>]*hidden/, "class-subject-label must be preserved hidden for backward compatibility");
});

test("student-live.html includes complete scientific calculator modal with dual screen, trig, and fraction controls", () => {
  assert.match(studentHtml, /id="student-calculator-modal"/, "Modal container must exist");
  assert.match(studentHtml, /id="student-calc-backdrop"/, "Backdrop must exist");
  assert.match(studentHtml, /id="calc-angle-toggle-btn"/, "DEG/RAD toggle button must exist");
  assert.match(studentHtml, /id="calc-expression"/, "Expression display line must exist");
  assert.match(studentHtml, /id="calc-result"/, "Result display line must exist");
  assert.match(studentHtml, /data-fn="sin"/, "sin button must exist");
  assert.match(studentHtml, /data-fn="cos"/, "cos button must exist");
  assert.match(studentHtml, /data-fn="tan"/, "tan button must exist");
  assert.match(studentHtml, /data-fn="sqrt"/, "sqrt button must exist");
  assert.match(studentHtml, /data-fn="pow"/, "power button must exist");
  assert.match(studentHtml, /data-fn="frac"/, "Fraction a/b button must exist");
  assert.match(studentHtml, /data-fn="sd"/, "Fraction S⇄D toggle button must exist");
  assert.match(studentHtml, /data-action="calculate"/, "Equals button must exist");
  assert.match(studentHtml, /data-action="clear"/, "AC clear button must exist");
});

test("student-portrait.css formats the calculator button in mobile portrait header", () => {
  assert.match(portraitCss, /\.student-calculator-btn/, "CSS must define .student-calculator-btn rules");
  assert.match(portraitCss, /clamp\(/, "Font size must be responsive");
});

test("student-live.js defines the calculator math engine with fractions and trig support", () => {
  assert.match(studentJs, /function decimalToFraction\(/, "decimalToFraction helper must exist");
  assert.match(studentJs, /function evaluateScientificExpression\(/, "evaluateScientificExpression must exist");
  assert.match(studentJs, /function toggleFractionDisplay\(/, "toggleFractionDisplay must exist");
  assert.match(studentJs, /initializeStudentCalculator\(\)/, "initializeStudentCalculator must be called on setup");
  assert.match(studentJs, /closeStudentCalculatorModal\(\)/, "closeStudentCalculatorModal must be called on pagehide");
});

test("Mathematical Engine calculates accurate results including Algerian curriculum DEG trig and fractions", () => {
  const start = studentJs.indexOf("const calcState = {");
  const end = studentJs.indexOf("function updateCalculatorDisplay()");
  assert.ok(start !== -1 && end !== -1, "Scientific calculator code block must be present");

  const mathCode = studentJs.slice(start, end) + "\nreturn { decimalToFraction, safeSin, safeCos, safeTan, evaluateScientificExpression };";
  const mathFactory = new Function(mathCode);
  const math = mathFactory();

  const evaluate = math.evaluateScientificExpression;
  const toFraction = math.decimalToFraction;

  // 1. Basic arithmetic and order of operations
  assert.equal(evaluate("10 + 5 * 2"), 20);
  assert.equal(evaluate("(10 + 5) * 2"), 30);
  assert.equal(evaluate("100 / 4 - 5"), 20);

  // 2. Implicit multiplication
  assert.equal(evaluate("3(4)"), 12);
  assert.equal(evaluate("2(3 + 5)"), 16);

  // 3. Square roots and powers
  assert.equal(evaluate("sqrt(144)"), 12);
  assert.equal(evaluate("2^5"), 32);
  assert.equal(evaluate("3^2 + 4^2"), 25);

  // 4. Trigonometric functions in DEG mode (Algerian Middle/High School standard)
  assert.equal(evaluate("sin(30)", "DEG"), 0.5);
  assert.equal(evaluate("cos(60)", "DEG"), 0.5);
  assert.equal(evaluate("tan(45)", "DEG"), 1);
  assert.equal(evaluate("sin(90)", "DEG"), 1);
  assert.equal(evaluate("cos(90)", "DEG"), 0);
  assert.equal(evaluate("sin(180)", "DEG"), 0);
  assert.equal(evaluate("cos(180)", "DEG"), -1);

  // 5. Fraction engine & S⇄D conversions
  const frac1 = toFraction(0.75);
  assert.equal(frac1.text, "3/4");

  const frac2 = toFraction(0.5);
  assert.equal(frac2.text, "1/2");

  const frac3 = toFraction(2.5);
  assert.equal(frac3.text, "5/2");

  const frac4 = toFraction(0.125);
  assert.equal(frac4.text, "1/8");

  // Sum of fractions: 1/2 + 1/4 = 0.75 -> 3/4
  const sumResult = evaluate("1/2 + 1/4");
  assert.equal(sumResult, 0.75);
  assert.equal(toFraction(sumResult).text, "3/4");
});
