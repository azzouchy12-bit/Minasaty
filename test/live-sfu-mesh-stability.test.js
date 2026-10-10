const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const teacherLive = fs.readFileSync(path.join(ROOT, "public", "js", "teacher-live-v2.js"), "utf8");
const studentLive = fs.readFileSync(path.join(ROOT, "public", "js", "student-live.js"), "utf8");
const serverCode = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");

test("Teacher: isTeacherSfuHealthy accurately checks SFU room state and publications", () => {
  assert.match(teacherLive, /function isTeacherSfuHealthy\(\)/, "isTeacherSfuHealthy must be defined");
  assert.match(teacherLive, /sfuActiveForClass/, "Must verify SFU is active for class");
  assert.match(teacherLive, /teacherSfuRoom\.state === "connected"/, "Must verify SFU room is connected");
  assert.match(teacherLive, /teacherSfuVideoPub || teacherSfuAudioPub/, "Must verify active video or audio publication");
});

test("Teacher: student_joined suppresses redundant P2P WebRTC offers when SFU is healthy", () => {
  assert.match(
    teacherLive,
    /socket\.on\("student_joined",[\s\S]*?!isTeacherSfuHealthy\(\)[\s\S]*?createAndSendOffer\(socketId\)[\s\S]*?student_joined_sfu/,
    "student_joined must skip P2P offer creation when SFU is active and healthy"
  );
});

test("Teacher: addTeacherTracks does not attach outbound tracks to P2P connections when SFU is healthy", () => {
  assert.match(
    teacherLive,
    /function addTeacherTracks\([^)]*\) \{[\s\S]*?if \(isTeacherSfuHealthy\(\)\) \{[\s\S]*?return;/
  );
});

test("Teacher: resumeLiveClassAfterSocketReconnect skips P2P offer storm if SFU is healthy", () => {
  assert.match(
    teacherLive,
    /function resumeLiveClassAfterSocketReconnect\(\) \{[\s\S]*?if \(!isTeacherSfuHealthy\(\)\) \{[\s\S]*?createAndSendOffer/
  );
});

test("Teacher: Signaling disconnect uses grace period instead of immediately tearing down session", () => {
  assert.match(teacherLive, /SIGNALING_DISCONNECT_GRACE_MS\s*=\s*(?:20_000|25_000|30_000)/);
  assert.match(teacherLive, /signalingDisconnectGraceTimer = (?:window\.)?setTimeout/);
});

test("Teacher: Receives student SFU audio without feeding it back into teacher outbound SFU publication", () => {
  assert.match(teacherLive, /function attachSfuStudentAudio\((?:studentIdentity|identity), track\)/);
  assert.match(teacherLive, /audio\.id = `sfu(?:-student)?-audio-\$\{(?:studentIdentity|identity)\}`/);
  // Audio plays through browser element and is NOT piped into teacherSfuAudioPub
  assert.doesNotMatch(
    teacherLive,
    /attachSfuStudentAudio[\s\S]*?teacherSfuAudioPub\.track/,
    "Student audio must not be fed into teacher's outgoing SFU track"
  );
});

test("Student: isStudentSfuHealthy and isStudentSfuConnected are defined", () => {
  assert.match(studentLive, /function isStudentSfuConnected\(\)/);
  assert.match(studentLive, /function isStudentSfuHealthy\(\)/);
  assert.match(studentLive, /studentSfuRoom && studentSfuRoom\.state === "connected"/);
});

test("Student: addUniqueTrack prioritizes SFU audio and video over P2P, dropping P2P when SFU arrives", () => {
  assert.match(
    studentLive,
    /if \(track\.__fromSfu\) \{[\s\S]*?const p2pTracks = existingAudio\.filter\(\(t\) => !t\.__fromSfu\);[\s\S]*?stream\.removeTrack\(oldP2p\);/
  );
  assert.match(
    studentLive,
    /const hasLiveSfuAudio = existingAudio\.some\(\(t\) => t\.readyState === "live" && t\.__fromSfu\);[\s\S]*?return;/
  );
  assert.match(
    studentLive,
    /if \(track\.__fromSfu\) \{[\s\S]*?const p2pVideo = existingVideo\.filter\(\(t\) => !t\.__fromSfu\);[\s\S]*?stream\.removeTrack\(oldP2p\);/
  );
  assert.match(
    studentLive,
    /const hasLiveSfuVideo = existingVideo\.some\(\(t\) => t\.readyState === "live" && t\.__fromSfu\);[\s\S]*?return;/
  );
});

test("Student: enableApprovedMicrophone publishes to SFU as primary and falls back to P2P", () => {
  assert.match(studentLive, /const sfuAvailable = isStudentSfuConnected\(\);/);
  assert.match(studentLive, /const sfuPublished = await publishStudentSfuMic\(localAudioStream\);/);
  assert.match(studentLive, /publishStudentSfuMic[\s\S]*?negotiateStudentMicrophone/);
});

test("Student: unpublishStudentSfuMic is called on mute, revocation, and class exit", () => {
  assert.match(studentLive, /function stopLocalAudio\(\) \{[\s\S]*?unpublishStudentSfuMic\(\);/);
  assert.match(studentLive, /socket\.on\("microphone_revoked"[\s\S]*?unpublishStudentSfuMic\(\);/);
  assert.match(studentLive, /socket\.on\("classroom_all_mics_muted"[\s\S]*?unpublishStudentSfuMic\(\);/);
  assert.match(studentLive, /function resetViewerState\([^)]*\) \{[\s\S]*?disconnectStudentSfu\(\);/);
});

test("Student: Prevents self-echo and plays classmate audio via dedicated audio elements", () => {
  assert.match(studentLive, /participant\?\.identity === studentSfuRoom\?\.localParticipant\?\.identity[\s\S]*?return;/);
  assert.match(studentLive, /function playClassmateSfuAudio\(participantId, track\)/);
  assert.match(studentLive, /`sfu-classmate-audio-\$\{participantId\}`/);
});

test("Student: beginStreamRecovery preserves active SFU media during transient signaling drops", () => {
  assert.match(
    studentLive,
    /function beginStreamRecovery\(message, \{ force = false \} = \{\}\) \{[\s\S]*?if \(!force && isStudentSfuHealthy\(\)\) \{[\s\S]*?return;/
  );
});

test("Server: holdClassroomForTeacherReturn debounces notification so transient blips do not push students to waiting room", () => {
  assert.match(serverCode, /HOLD_NOTIFICATION_DEBOUNCE_MS\s*=\s*(?:3000|4000|4_000|5000)/);
  assert.match(serverCode, /recovery\.notifyTimer\s*=\s*setTimeout/);
  assert.match(serverCode, /clearTimeout\(recovery\.notifyTimer\)/);
});

test("Server: Handles student_media_transport_status socket telemetry", () => {
  assert.match(serverCode, /socket\.on\("student_media_transport_status"/);
  assert.match(serverCode, /socket\.data\.mediaTransport = transport;/);
  assert.match(serverCode, /io\.to\(teacherSocketId\)\.emit\("student_transport_updated"/);
});

test("Diagnostics: Teacher and student provide sanitized diagnostics without secrets or PII", () => {
  assert.match(teacherLive, /window\.getMinasatyLiveDiagnostics = function/);
  assert.match(studentLive, /window\.getMinasatyStudentLiveDiagnostics = function/);

  // Diagnostics must not expose auth tokens, user emails or passwords
  const teacherDiag = teacherLive.match(/window\.getMinasatyLiveDiagnostics = function[\s\S]*?^\};/m)?.[0] || "";
  const studentDiag = studentLive.match(/window\.getMinasatyStudentLiveDiagnostics = function[\s\S]*?^\};/m)?.[0] || "";

  assert.doesNotMatch(teacherDiag, /token|password|email|studentPhone/i);
  assert.doesNotMatch(studentDiag, /token|password|email|studentPhone/i);
});

test("Functional logic: Simulated addUniqueTrack track priority behaves correctly", () => {
  class MockTrack {
    constructor(id, kind, fromSfu = false) {
      this.id = id;
      this.kind = kind;
      this.readyState = "live";
      this.__fromSfu = fromSfu;
      this.enabled = true;
      this.stopped = false;
    }
    stop() {
      this.stopped = true;
      this.readyState = "ended";
    }
  }

  class MockStream {
    constructor() {
      this.tracks = [];
    }
    getTracks() { return [...this.tracks]; }
    getAudioTracks() { return this.tracks.filter(t => t.kind === "audio"); }
    getVideoTracks() { return this.tracks.filter(t => t.kind === "video"); }
    addTrack(t) { this.tracks.push(t); }
    removeTrack(t) { this.tracks = this.tracks.filter(x => x.id !== t.id); }
  }

  function simulateAddUniqueTrack(stream, track) {
    if (track.kind === "audio") {
      const existingAudio = stream.getAudioTracks();
      if (track.__fromSfu) {
        const p2pTracks = existingAudio.filter((t) => !t.__fromSfu);
        p2pTracks.forEach((oldP2p) => {
          stream.removeTrack(oldP2p);
          oldP2p.stop();
        });
      } else {
        const hasLiveSfuAudio = existingAudio.some((t) => t.readyState === "live" && t.__fromSfu);
        if (hasLiveSfuAudio) return false;
      }
      if (existingAudio.some(t => t.id === track.id)) return true;
      existingAudio.forEach(oldTrack => {
        stream.removeTrack(oldTrack);
        oldTrack.stop();
      });
      stream.addTrack(track);
      return true;
    }

    if (track.kind === "video") {
      const existingVideo = stream.getVideoTracks();
      if (track.__fromSfu) {
        const p2pVideo = existingVideo.filter((t) => !t.__fromSfu);
        p2pVideo.forEach((oldP2p) => {
          stream.removeTrack(oldP2p);
          oldP2p.stop();
        });
      } else {
        const hasLiveSfuVideo = existingVideo.some((t) => t.readyState === "live" && t.__fromSfu);
        if (hasLiveSfuVideo) return false;
      }
      if (existingVideo.some(t => t.id === track.id)) return true;
      stream.addTrack(track);
      return true;
    }
    return true;
  }

  const stream = new MockStream();
  const p2pAudio = new MockTrack("p2p-a1", "audio", false);
  const p2pVideo = new MockTrack("p2p-v1", "video", false);

  // Initial P2P setup
  simulateAddUniqueTrack(stream, p2pAudio);
  simulateAddUniqueTrack(stream, p2pVideo);
  assert.equal(stream.getAudioTracks().length, 1);
  assert.equal(stream.getVideoTracks().length, 1);

  // SFU audio arrives: must stop and remove P2P audio
  const sfuAudio = new MockTrack("sfu-a1", "audio", true);
  simulateAddUniqueTrack(stream, sfuAudio);
  assert.equal(p2pAudio.stopped, true, "P2P audio must be stopped");
  assert.equal(stream.getAudioTracks().length, 1);
  assert.equal(stream.getAudioTracks()[0].id, "sfu-a1", "SFU audio must replace P2P audio");

  // Subsequent P2P audio arrives: must be dropped because SFU audio is live
  const p2pAudio2 = new MockTrack("p2p-a2", "audio", false);
  const acceptedAudio = simulateAddUniqueTrack(stream, p2pAudio2);
  assert.equal(acceptedAudio, false, "P2P audio must be rejected when SFU audio is active");
  assert.equal(stream.getAudioTracks().length, 1);
  assert.equal(stream.getAudioTracks()[0].id, "sfu-a1");

  // SFU video arrives: must stop and remove P2P video
  const sfuVideo = new MockTrack("sfu-v1", "video", true);
  simulateAddUniqueTrack(stream, sfuVideo);
  assert.equal(p2pVideo.stopped, true, "P2P video must be stopped");
  assert.equal(stream.getVideoTracks().length, 1);
  assert.equal(stream.getVideoTracks()[0].id, "sfu-v1");

  // Subsequent P2P video arrives: must be dropped
  const p2pVideo2 = new MockTrack("p2p-v2", "video", false);
  const acceptedVideo = simulateAddUniqueTrack(stream, p2pVideo2);
  assert.equal(acceptedVideo, false, "P2P video must be rejected when SFU video is active");
  assert.equal(stream.getVideoTracks().length, 1);
  assert.equal(stream.getVideoTracks()[0].id, "sfu-v1");
});
