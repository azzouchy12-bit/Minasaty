const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const root = path.resolve(__dirname, "..");
const js = fs.readFileSync(path.join(root, "public/js/student-live.js"), "utf8");
const html = fs.readFileSync(path.join(root, "public/student-live.html"), "utf8");

test("class-continue-overlay modal is completely removed from student-live.html", () => {
  assert.equal(
    html.includes('id="class-continue-overlay"'),
    false,
    "class-continue-overlay should be completely removed from student-live.html"
  );
  assert.equal(
    html.includes("مرحبًا بك في الحصة"),
    false,
    "The 'مرحبًا بك في الحصة' welcome modal should not exist in student-live.html"
  );
  assert.equal(
    html.includes(">متابعة الحصة</button>"),
    false,
    "The 'متابعة الحصة' button should not exist in student-live.html"
  );
});

test("student entry immediately activates audio and arms auto-unmute without continue dialog", () => {
  assert.match(
    js,
    /completeStudentPrejoinAndJoin\(\)[\s\S]*?startTeacherAudio\(\{ userInitiated: true \}\)[\s\S]*?armAutoUnmuteOnFirstInteraction\(\)/,
    "completeStudentPrejoinAndJoin must start audio and arm auto-unmute directly"
  );
  assert.match(
    js,
    /hasPermanentStudentPrejoinCompleted\(\)[\s\S]*?startTeacherAudio\(\{ userInitiated: true \}\)[\s\S]*?armAutoUnmuteOnFirstInteraction\(\)/,
    "initializeStudentPrejoin with permanent prejoin must start audio and arm auto-unmute directly"
  );
  assert.doesNotMatch(
    js,
    /completeStudentPrejoinAndJoin\(\)[\s\S]*?showClassContinueDialog\(\)/,
    "completeStudentPrejoinAndJoin must not call showClassContinueDialog"
  );
});

test("parent-dashboard restores live class banner with zero delay and connects lobby on boot", () => {
  const parentJs = fs.readFileSync(path.join(root, "public/js/parent-dashboard.js"), "utf8");
  assert.match(
    parentJs,
    /sessionStorage\.getItem\("lastLiveClassState"\)/,
    "parent-dashboard.js must read lastLiveClassState from sessionStorage for 0ms initial render"
  );
  assert.match(
    parentJs,
    /checkLiveStatusFast/,
    "parent-dashboard.js must include fast live status preflight"
  );
});
