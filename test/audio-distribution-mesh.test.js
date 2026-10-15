"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

test("Audio Distribution Mesh: Teacher immediately attaches already-speaking students upon connect and reconnect", () => {
  const teacherLive = fs.readFileSync(path.join(root, "public/js/teacher-live-v2.js"), "utf8");

  // Verify code patterns
  assert.match(teacherLive, /teacherSfuRoom\.remoteParticipants\?\.values\?\.[\s\S]*?attachSfuStudentAudio/, "Teacher connect must iterate remoteParticipants and attach student audio");
  assert.match(teacherLive, /RoomEvent\.TrackPublished[\s\S]*?attachSfuStudentAudio/, "Teacher must listen to TrackPublished and attach student audio");
});

test("Audio Distribution Mesh: Student immediately attaches already-speaking classmates and listens to TrackPublished", () => {
  const studentLive = fs.readFileSync(path.join(root, "public/js/student-live.js"), "utf8");

  assert.match(studentLive, /studentSfuRoom\.remoteParticipants\?\.values\?\.[\s\S]*?playClassmateSfuAudio/, "Student connect must iterate remoteParticipants and play classmate audio");
  assert.match(studentLive, /RoomEvent\.TrackPublished[\s\S]*?playClassmateSfuAudio/, "Student must listen to TrackPublished and play classmate audio");
  assert.match(studentLive, /MinasatyAudioEnhancer\?\.armAutoplayUnlock/, "Classmate audio playback failure must arm autoplay unlock");
});

test("Audio Distribution Mesh: MinasatyAudioEnhancer provides unlockAudioContext and armAutoplayUnlock", async () => {
  const enhancerSource = fs.readFileSync(path.join(root, "public/js/audio-enhancer.js"), "utf8");

  let resumed = false;
  class MockAudioContext {
    constructor() {
      this.state = "suspended";
    }
    resume() {
      this.state = "running";
      resumed = true;
      return Promise.resolve();
    }
  }

  let capturedCallback = null;
  const ctx = {
    window: {
      AudioContext: MockAudioContext,
      addEventListener: (ev, cb) => {
        if (ev === "click") capturedCallback = cb;
      },
      removeEventListener: () => {},
      console,
    },
    document: {
      addEventListener: () => {},
      removeEventListener: () => {},
    },
    module: { exports: {} },
  };

  vm.runInNewContext(enhancerSource, ctx);
  const enhancer = ctx.window.MinasatyAudioEnhancer;

  assert.ok(typeof enhancer.unlockAudioContext === "function", "unlockAudioContext must be exported");
  assert.ok(typeof enhancer.armAutoplayUnlock === "function", "armAutoplayUnlock must be exported");

  let unlockedCallbackFired = false;
  enhancer.armAutoplayUnlock(() => {
    unlockedCallbackFired = true;
  });

  assert.ok(capturedCallback, "armAutoplayUnlock must register gesture listener");
  capturedCallback();

  assert.equal(resumed, true, "AudioContext must be resumed on gesture");
  assert.equal(unlockedCallbackFired, true, "Callback must be invoked on gesture");
});
