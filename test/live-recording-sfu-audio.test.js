const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const teacherSource = fs.readFileSync(path.join(ROOT, 'public/js/teacher-live-v2.js'), 'utf8');

function productionFunction(name) {
  const regex = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`, 'g');
  const match = regex.exec(teacherSource);
  assert.ok(match, `production function ${name} must exist in teacher-live-v2.js`);
  const start = teacherSource.lastIndexOf('\n', match.index) + 1;
  const next = teacherSource.slice(match.index + 1).search(/\n(?:async\s+)?function\s+[a-zA-Z0-9_$]+\s*\(/);
  return teacherSource.slice(start, next < 0 ? teacherSource.length : match.index + 1 + next);
}

class MockTrack {
  constructor(id, kind = 'audio') {
    this.id = id;
    this.kind = kind;
    this.readyState = 'live';
    this.enabled = true;
    this.muted = false;
    this.listeners = new Map();
  }
  addEventListener(event, fn) {
    const list = this.listeners.get(event) || [];
    list.push(fn);
    this.listeners.set(event, list);
  }
  removeEventListener(event, fn) {
    const list = this.listeners.get(event) || [];
    this.listeners.set(event, list.filter(cb => cb !== fn));
  }
  stop() {
    this.readyState = 'ended';
    for (const cb of this.listeners.get('ended') || []) cb();
  }
  mute() {
    this.muted = true;
    for (const cb of this.listeners.get('mute') || []) cb();
  }
  unmute() {
    this.muted = false;
    for (const cb of this.listeners.get('unmute') || []) cb();
  }
}

class MockMediaStream {
  constructor(tracks = []) {
    this.tracks = [...tracks];
  }
  getTracks() {
    return [...this.tracks];
  }
  getAudioTracks() {
    return this.tracks.filter(t => t.kind === 'audio');
  }
  getVideoTracks() {
    return this.tracks.filter(t => t.kind === 'video');
  }
  addTrack(t) {
    this.tracks.push(t);
  }
  removeTrack(t) {
    this.tracks = this.tracks.filter(track => track !== t);
  }
}

class MockGainNode {
  constructor() {
    this.gain = { value: 1.0 };
    this.connectedTo = null;
    this.disconnected = false;
  }
  connect(dest) {
    this.connectedTo = dest;
    this.disconnected = false;
  }
  disconnect() {
    this.disconnected = true;
  }
}

class MockSourceNode {
  constructor(stream) {
    this.stream = stream;
    this.connectedTo = null;
    this.disconnected = false;
  }
  connect(dest) {
    this.connectedTo = dest;
    this.disconnected = false;
  }
  disconnect() {
    this.disconnected = true;
  }
}

class MockDestinationNode {
  constructor() {
    this.stream = new MockMediaStream([new MockTrack('mixed-audio-track', 'audio')]);
  }
}

class MockAudioContext {
  constructor() {
    this.state = 'running';
  }
  createMediaStreamSource(stream) {
    return new MockSourceNode(stream);
  }
  createGain() {
    return new MockGainNode();
  }
  createMediaStreamDestination() {
    return new MockDestinationNode();
  }
  async close() {
    this.state = 'closed';
  }
}

function createTeacherFixture() {
  const appendedElements = new Set();
  const audioContext = new MockAudioContext();
  const audioDestination = audioContext.createMediaStreamDestination();

  const ctx = {
    console: {
      info: () => {},
      debug: () => {},
      warn: () => {},
      error: () => {},
    },
    MediaStream: MockMediaStream,
    attendeeSocketByStudentId: new Map(),
    attendeeElements: new Map(),
    approvedStudentMicrophones: new Set(),
    studentMicStates: new Map(),
    studentAudioElements: new Map(),
    sfuStudentAudioElements: new Map(),
    sfuStudentAudioStreams: new Map(),
    classroomAudioSources: new Map(),
    cameraStream: new MockMediaStream([new MockTrack('teacher-mic-track', 'audio')]),
    screenStream: new MockMediaStream([new MockTrack('screen-audio-track', 'audio')]),
    localRecordingAudioContext: audioContext,
    localRecordingAudioDestination: audioDestination,
    localRecordingSourceNodes: new Map(),
    teacherMicRecordingGainNode: null,
    teacherMicGainLevel: 1.0,
    peerConnections: {},
    diagnosticEvents: [],
    mediaTransportState: 'sfu_active',
    teacherSfuRoom: { state: 'connected' },
    teacherSfuVideoPub: { kind: 'video' },
    teacherSfuAudioPub: { kind: 'audio' },
    sfuActiveForClass: true,
    socket: { connected: true },
    rebuildClassroomAudioGraph: () => {},
    syncStudentMicButton: () => {},
    reorderOpenMicrophoneAttendees: () => {},
    document: {
      createElement: (tag) => ({
        tagName: tag.toUpperCase(),
        id: '',
        style: {},
        autoplay: false,
        playsInline: false,
        srcObject: null,
        paused: true,
        play: async function() { this.paused = false; },
        pause: function() { this.paused = true; },
        remove: function() { appendedElements.delete(this); },
      }),
      body: {
        appendChild: (el) => { appendedElements.add(el); },
      },
    },
    window: {},
  };

  vm.createContext(ctx);

  const functionNames = [
    'getSocketIdForStudentIdentity',
    'isStudentMicrophoneApproved',
    'recordLiveDiagnosticEvent',
    'isTeacherSfuHealthy',
    'attachSfuStudentAudio',
    'removeSfuStudentAudio',
    'clearAllSfuStudentAudio',
    'syncLocalRecordingAudioSources',
    'applyStudentMicrophoneState',
  ];

  for (const name of functionNames) {
    const code = productionFunction(name);
    vm.runInContext(code, ctx, { filename: `teacher-live-v2.js:${name}` });
  }

  // Also define getMinasatyLiveDiagnostics from production
  const diagnosticsMarker = teacherSource.indexOf('window.getMinasatyLiveDiagnostics = function getMinasatyLiveDiagnostics()');
  assert.ok(diagnosticsMarker >= 0, 'getMinasatyLiveDiagnostics must exist');
  const returnObjEnd = teacherSource.indexOf('};', diagnosticsMarker);
  const fnEnd = teacherSource.indexOf('};', returnObjEnd + 2) + 2;
  const diagnosticsCode = teacherSource.slice(diagnosticsMarker, fnEnd);
  vm.runInContext(diagnosticsCode, ctx, { filename: 'teacher-live-v2.js:getMinasatyLiveDiagnostics' });

  return { ctx, audioContext, audioDestination, appendedElements };
}

test('Local recording mixes simultaneous teacher microphone, screen audio, and multiple authorized SFU student audio', () => {
  const { ctx, audioDestination } = createTeacherFixture();

  const student1Id = 'student-uuid-alpha';
  const student2Id = 'student-uuid-beta';
  const track1 = new MockTrack('track-sfu-alpha', 'audio');
  const track2 = new MockTrack('track-sfu-beta', 'audio');

  ctx.approvedStudentMicrophones.add(student1Id);
  ctx.approvedStudentMicrophones.add(student2Id);

  ctx.attachSfuStudentAudio(student1Id, track1);
  ctx.attachSfuStudentAudio(student2Id, track2);

  // Both students attached to SFU streams
  assert.equal(ctx.sfuStudentAudioStreams.size, 2);

  // Synchronize recording mix
  ctx.syncLocalRecordingAudioSources();

  // All 4 sources must be present: teacher mic, screen audio, and both student mics
  assert.ok(ctx.localRecordingSourceNodes.has('__teacher_microphone__'), 'Teacher mic must be mixed');
  assert.ok(ctx.localRecordingSourceNodes.has('__screen_audio__'), 'Screen audio must be mixed');
  assert.ok(ctx.localRecordingSourceNodes.has(`__sfu_student_${student1Id}__`), 'Student 1 SFU mic must be mixed');
  assert.ok(ctx.localRecordingSourceNodes.has(`__sfu_student_${student2Id}__`), 'Student 2 SFU mic must be mixed');
  assert.equal(ctx.localRecordingSourceNodes.size, 4);

  // Gain values: students and screen must have standard 1.0 (no ducking, no amplification)
  const node1 = ctx.localRecordingSourceNodes.get(`__sfu_student_${student1Id}__`);
  const node2 = ctx.localRecordingSourceNodes.get(`__sfu_student_${student2Id}__`);
  const screenNode = ctx.localRecordingSourceNodes.get('__screen_audio__');
  assert.equal(node1.gainNode.gain.value, 1.0);
  assert.equal(node2.gainNode.gain.value, 1.0);
  assert.equal(screenNode.gainNode.gain.value, 1.0);

  // All gain nodes connect to recording destination
  assert.equal(node1.gainNode.connectedTo, audioDestination);
  assert.equal(node2.gainNode.connectedTo, audioDestination);
  assert.equal(screenNode.gainNode.connectedTo, audioDestination);
});

test('Dynamic student joining and microphone activation after recording has started', () => {
  const { ctx } = createTeacherFixture();

  // Initial sync: only teacher mic and screen audio
  ctx.syncLocalRecordingAudioSources();
  assert.equal(ctx.localRecordingSourceNodes.size, 2);
  assert.ok(ctx.localRecordingSourceNodes.has('__teacher_microphone__'));
  assert.ok(ctx.localRecordingSourceNodes.has('__screen_audio__'));

  // Student joins SFU while recording is active
  const studentId = 'student-dynamic-001';
  const socketId = 'sock-dynamic-001';
  const track = new MockTrack('dyn-audio-track', 'audio');

  // Map student identity to socketId via attendeeElements
  ctx.attendeeElements.set(socketId, {
    dataset: { studentId },
    classList: { remove: () => {}, toggle: () => {} },
    querySelector: () => null,
  });
  ctx.attendeeSocketByStudentId.set(studentId, socketId);

  // Student attaches audio before teacher approval
  ctx.attachSfuStudentAudio(studentId, track);

  // Before approval, student audio must NOT be in recording mix
  assert.ok(!ctx.localRecordingSourceNodes.has(`__sfu_student_${studentId}__`));
  assert.equal(ctx.localRecordingSourceNodes.size, 2);

  // Teacher grants microphone permission to student
  ctx.applyStudentMicrophoneState(socketId, true);

  // Now student audio must be dynamically added to recording mix immediately
  assert.ok(ctx.localRecordingSourceNodes.has(`__sfu_student_${studentId}__`));
  assert.equal(ctx.localRecordingSourceNodes.size, 3);
});

test('Deduplication prevents duplicate student audio when SFU and P2P paths overlap', () => {
  const { ctx } = createTeacherFixture();

  const studentId = 'student-overlap-99';
  const socketId = 'sock-overlap-99';

  ctx.attendeeElements.set(socketId, {
    dataset: { studentId },
    classList: { remove: () => {}, toggle: () => {} },
    querySelector: () => null,
  });
  ctx.attendeeSocketByStudentId.set(studentId, socketId);
  ctx.approvedStudentMicrophones.add(socketId);
  ctx.approvedStudentMicrophones.add(studentId);

  // Student is streaming on P2P path
  const p2pTrack = new MockTrack('p2p-track-99', 'audio');
  const p2pStream = new MockMediaStream([p2pTrack]);
  ctx.classroomAudioSources.set(socketId, {
    stream: p2pStream,
    enabled: true,
  });

  // Student also streams on SFU path
  const sfuTrack = new MockTrack('sfu-track-99', 'audio');
  ctx.attachSfuStudentAudio(studentId, sfuTrack);

  ctx.syncLocalRecordingAudioSources();

  // Exactly ONE audio node for this student must exist in the recording mix: the SFU one
  assert.ok(ctx.localRecordingSourceNodes.has(`__sfu_student_${studentId}__`), 'SFU source node must be used');
  assert.ok(!ctx.localRecordingSourceNodes.has(socketId), 'P2P source node must be excluded to prevent duplication');

  // Verify total nodes: teacher mic (1) + screen audio (1) + student SFU (1) = 3 (NO duplicate)
  assert.equal(ctx.localRecordingSourceNodes.size, 3);
});

test('Microphone revocation, track replacement, and track end listeners clean up cleanly', () => {
  const { ctx } = createTeacherFixture();

  const studentId = 'student-mute-test';
  const socketId = 'sock-mute-test';
  const trackA = new MockTrack('track-initial', 'audio');

  ctx.attendeeElements.set(socketId, {
    dataset: { studentId },
    classList: { remove: () => {}, toggle: () => {} },
    querySelector: () => null,
  });
  ctx.attendeeSocketByStudentId.set(studentId, socketId);
  ctx.applyStudentMicrophoneState(socketId, true);

  ctx.attachSfuStudentAudio(studentId, trackA);
  assert.ok(ctx.localRecordingSourceNodes.has(`__sfu_student_${studentId}__`));

  // Teacher revokes microphone
  ctx.applyStudentMicrophoneState(socketId, false);
  assert.ok(!ctx.localRecordingSourceNodes.has(`__sfu_student_${studentId}__`), 'Revoked student must be removed from mix');

  // Teacher re-enables microphone
  ctx.applyStudentMicrophoneState(socketId, true);
  assert.ok(ctx.localRecordingSourceNodes.has(`__sfu_student_${studentId}__`), 'Re-approved student must be restored to mix');

  // Track replacement: student replaces track (e.g. changing input device)
  const trackB = new MockTrack('track-replaced', 'audio');
  const oldNode = ctx.localRecordingSourceNodes.get(`__sfu_student_${studentId}__`);
  ctx.attachSfuStudentAudio(studentId, trackB);
  const newNode = ctx.localRecordingSourceNodes.get(`__sfu_student_${studentId}__`);

  assert.ok(oldNode.node.disconnected, 'Old source node must be disconnected');
  assert.equal(newNode.stream.getAudioTracks()[0].id, 'track-replaced');

  // Track ends via WebRTC
  trackB.stop();
  assert.ok(!ctx.localRecordingSourceNodes.has(`__sfu_student_${studentId}__`), 'Ended track must be removed from recording mix');
});

test('Participant departure and full SFU disconnection remove all student recording nodes', () => {
  const { ctx } = createTeacherFixture();

  const id1 = 'std-depart-1';
  const id2 = 'std-depart-2';
  ctx.approvedStudentMicrophones.add(id1);
  ctx.approvedStudentMicrophones.add(id2);

  ctx.attachSfuStudentAudio(id1, new MockTrack('tr-1', 'audio'));
  ctx.attachSfuStudentAudio(id2, new MockTrack('tr-2', 'audio'));

  assert.ok(ctx.localRecordingSourceNodes.has(`__sfu_student_${id1}__`));
  assert.ok(ctx.localRecordingSourceNodes.has(`__sfu_student_${id2}__`));

  // One participant leaves
  ctx.removeSfuStudentAudio(id1);
  assert.ok(!ctx.localRecordingSourceNodes.has(`__sfu_student_${id1}__`));
  assert.ok(ctx.localRecordingSourceNodes.has(`__sfu_student_${id2}__`));

  // SFU room disconnects entirely
  ctx.clearAllSfuStudentAudio();
  assert.equal(ctx.sfuStudentAudioStreams.size, 0);
  assert.ok(!ctx.localRecordingSourceNodes.has(`__sfu_student_${id2}__`));

  // Teacher microphone and screen audio are preserved
  assert.ok(ctx.localRecordingSourceNodes.has('__teacher_microphone__'));
  assert.ok(ctx.localRecordingSourceNodes.has('__screen_audio__'));

  // Live diagnostics report 0 recording audio streams
  const diag = ctx.window.getMinasatyLiveDiagnostics();
  assert.equal(diag.sfuStudentRecordingAudioCount, 0);
});

test('Live hearing audio playback element is maintained alongside recording mix', () => {
  const { ctx, appendedElements } = createTeacherFixture();

  const studentId = 'student-live-playback';
  ctx.approvedStudentMicrophones.add(studentId);
  const track = new MockTrack('tr-playback', 'audio');

  ctx.attachSfuStudentAudio(studentId, track);

  // Audio element created for teacher hearing
  const audioEl = ctx.sfuStudentAudioElements.get(studentId);
  assert.ok(audioEl, 'HTMLAudioElement must exist for teacher hearing');
  assert.equal(audioEl.id, `sfu-audio-${studentId}`);
  assert.ok(appendedElements.has(audioEl));

  // Clean removal cleans up both the live audio element and recording stream
  ctx.removeSfuStudentAudio(studentId);
  assert.equal(ctx.sfuStudentAudioElements.has(studentId), false);
  assert.ok(!appendedElements.has(audioEl));
});


test('Recording includes approved audible P2P source even when classroom graph did not register it', () => {
  const {ctx}=createTeacherFixture();
  const stream=new MockMediaStream([new MockTrack('p2p-mic')]);
  ctx.studentAudioElements.set('socket-one',{srcObject:stream});
  ctx.attendeeElements.set('socket-one',{dataset:{studentId:'student-one'}});
  ctx.approvedStudentMicrophones.add('student-one');
  ctx.syncLocalRecordingAudioSources();
  assert.equal(ctx.localRecordingSourceNodes.get('socket-one')?.stream,stream);
  ctx.approvedStudentMicrophones.clear();
  ctx.syncLocalRecordingAudioSources();
  assert.equal(ctx.localRecordingSourceNodes.has('socket-one'),false,'Revoked audio must leave recording');
});

test('Obsolete P2P track end preserves replacement recording source and server approval', () => {
  const {ctx}=createTeacherFixture();
  const audio={dataset:{},style:{},setAttribute(){},play(){return Promise.resolve()}};
  ctx.document.createElement=()=>audio;ctx.document.body.append=()=>{};
  ctx.addClassroomAudioSource=(id,stream,opts)=>ctx.classroomAudioSources.set(id,{stream,...opts});
  ctx.removeStudentAudio=id=>ctx.studentAudioElements.delete(id);
  ctx.removeClassroomAudioSource=id=>{ctx.classroomAudioSources.delete(id);ctx.syncLocalRecordingAudioSources()};
  ctx.approvedStudentMicrophones.add('socket-one');
  vm.runInContext(productionFunction('attachStudentAudio'),ctx);
  const peer={};ctx.attachStudentAudio(peer,'socket-one');
  const old=new MockTrack('old');const next=new MockTrack('new');
  const oldStream=new MockMediaStream([old]);const newStream=new MockMediaStream([next]);
  peer.ontrack({track:old,streams:[oldStream]});
  peer.ontrack({track:next,streams:[newStream]});ctx.syncLocalRecordingAudioSources();
  old.stop();
  assert.equal(ctx.studentAudioElements.get('socket-one').srcObject,newStream);
  assert.equal(ctx.classroomAudioSources.get('socket-one').stream,newStream);
  assert.equal(ctx.localRecordingSourceNodes.get('socket-one').stream,newStream);
  assert.equal(ctx.approvedStudentMicrophones.has('socket-one'),true);
  next.stop();
  assert.equal(ctx.localRecordingSourceNodes.has('socket-one'),false);
  assert.equal(ctx.approvedStudentMicrophones.has('socket-one'),true,'Track end is not permission revocation');
});
