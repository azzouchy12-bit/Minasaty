const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const studentSource = fs.readFileSync(path.join(root, 'public/js/student-live.js'), 'utf8');

// Evaluate the production functions and wire their real Room event handlers.
// Only browser/LiveKit devices are mocked; routing logic is never reimplemented.
function productionFunction(name) {
  const marker = studentSource.indexOf('function ' + name + '(');
  assert.ok(marker >= 0, name + ' must exist');
  const start = studentSource.lastIndexOf('\n', marker) + 1;
  const next = studentSource.slice(marker + 1).search(/\n(?:async )?function /);
  return studentSource.slice(start, next < 0 ? studentSource.length : marker + 1 + next);
}
class Track {
  constructor(id, kind = 'audio') { this.id = id; this.kind = kind; this.readyState = 'live'; this.enabled = true; this.listeners = new Map(); }
  addEventListener(event, fn) { const callbacks = this.listeners.get(event) || []; callbacks.push(fn); this.listeners.set(event, callbacks); }
  stop() { this.readyState = 'ended'; }
  end() { this.readyState = 'ended'; for (const callback of this.listeners.get('ended') || []) callback(); }
}
class Stream {
  constructor(tracks = []) { this.tracks = [...tracks]; }
  getTracks() { return [...this.tracks]; }
  getAudioTracks() { return this.tracks.filter(t => t.kind === 'audio'); }
  getVideoTracks() { return this.tracks.filter(t => t.kind === 'video'); }
  addTrack(track) { this.tracks.push(track); }
  removeTrack(track) { this.tracks = this.tracks.filter(t => t !== track); }
}
const events = { TrackSubscribed: 'subscribed', TrackUnsubscribed: 'unsubscribed', ParticipantDisconnected: 'left', Disconnected: 'disconnected' };
async function viewer() {
  const attachedElements = new Set();
  class Room {
    constructor() { this.state = 'disconnected'; this.localParticipant = { identity: 'viewer-uuid' }; this.handlers = new Map(); }
    on(event, handler) { this.handlers.set(event, handler); return this; }
    async connect() { this.state = 'connected'; }
    emit(event, ...args) { this.handlers.get(event)?.(...args); }
  }
  const noop = () => {};
  const ctx = {
    console: { info: noop, debug: noop, warn: noop }, MediaStream: Stream,
    socket: { connected: false }, studentSfuRoom: null, isStudentSfuConnecting: false,
    currentStudentSfuRoomName: null, studentDiagnosticEvents: [], classmateAudioElements: new Map(),
    remoteMediaStream: new Stream(), screenShareActive: true, recoveryAttempts: 0, isRecoveringStream: false,
    elements: { remoteVideo: {} },
    clearRecoveryTimer: noop, updateChatControls: noop, setViewerStatus: noop,
    updateRemoteVideoPresentation: noop, updateRemoteAudioControl: noop, startTeacherAudio: async () => {},
    document: {
      createElement() { return { style: {}, muted: false, srcObject: null, playCount: 0,
        async play() { this.playCount++; }, pause: noop, remove() { attachedElements.delete(this); } }; },
      body: { appendChild(el) { attachedElements.add(el); } },
    },
    window: { LivekitClient: { Room, RoomEvent: events }, fetchMinasatySfuToken: async () => ({ enabled: true, token: 'test', url: 'wss://test.invalid' }) },
  };
  ctx.teacherSfuPlaybackTracks = new Map();
  vm.createContext(ctx);
  for (const name of ['detachTeacherSfuPlaybackTrack', 'attachTeacherSfuPlaybackTrack', 'recordStudentDiagnosticEvent', 'notifySfuTransportStatus', 'getSfuParticipantRole',
    'syncClassmateSfuAudioPlayback', 'playClassmateSfuAudio', 'stopClassmateSfuAudio',
    'clearAllClassmateAudio', 'connectStudentSfu', 'addUniqueTrack', 'attachTeacherTrack']) {
    vm.runInContext(productionFunction(name), ctx, { filename: 'student-live.js:' + name });
  }
  assert.equal(await ctx.connectStudentSfu('classroom'), true);
  const participant = (identity, role) => ({ identity, metadata: JSON.stringify({ classroomRole: role }) });
  function subscribe(identity, role, track) { ctx.studentSfuRoom.emit(events.TrackSubscribed, { kind: track.kind, mediaStreamTrack: track }, {}, participant(identity, role)); }
  function unsubscribe(identity, role, track) { ctx.studentSfuRoom.emit(events.TrackUnsubscribed, { kind: track.kind, mediaStreamTrack: track }, {}, participant(identity, role)); }
  return { ctx, subscribe, unsubscribe, participant, attachedElements };
}

test('Actual SFU routing preserves teacher UUID audio with two simultaneous student UUID microphones', async () => {
  const { ctx, subscribe } = await viewer();
  const teacher = new Track('teacher-audio');
  const first = new Track('student-one-audio');
  const second = new Track('student-two-audio');
  subscribe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'teacher', teacher);
  subscribe('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'student', first);
  subscribe('cccccccc-cccc-cccc-cccc-cccccccccccc', 'student', second);
  assert.equal(teacher.readyState, 'live');
  assert.deepEqual(ctx.remoteMediaStream.getAudioTracks(), [teacher]);
  assert.equal(ctx.classmateAudioElements.size, 2);
  for (const [id, audio] of ctx.classmateAudioElements) {
    assert.equal(audio.muted, false, id + ' must remain audible alongside teacher');
    assert.equal(audio.srcObject.getAudioTracks().length, 1);
  }
});

test('Actual unsubscribe and participant departure remove only that student, preserving teacher and other speakers', async () => {
  const { ctx, subscribe, unsubscribe, participant } = await viewer();
  const teacher = new Track('teacher'); const first = new Track('first'); const second = new Track('second');
  subscribe('teacher-uuid', 'teacher', teacher); subscribe('one-uuid', 'student', first); subscribe('two-uuid', 'student', second);
  unsubscribe('one-uuid', 'student', first);
  assert.equal(ctx.classmateAudioElements.has('one-uuid'), false);
  assert.equal(ctx.classmateAudioElements.has('two-uuid'), true);
  assert.equal(teacher.readyState, 'live'); assert.deepEqual(ctx.remoteMediaStream.getAudioTracks(), [teacher]);
  ctx.studentSfuRoom.emit(events.ParticipantDisconnected, participant('two-uuid', 'student'));
  assert.equal(ctx.classmateAudioElements.size, 0);
  assert.equal(teacher.readyState, 'live');
});

test('Actual routing rejects own audio, unknown roles, malformed metadata and student video', async () => {
  const { ctx, subscribe } = await viewer();
  subscribe('viewer-uuid', 'student', new Track('self'));
  subscribe('unknown-uuid', 'unknown', new Track('unknown'));
  subscribe('student-video-uuid', 'student', new Track('student-video', 'video'));
  for (const metadata of ['', '{bad']) {
    ctx.studentSfuRoom.emit(events.TrackSubscribed, { kind: 'audio', mediaStreamTrack: new Track('unclassified') }, {}, { identity: 'unclassified-uuid', metadata });
  }
  assert.equal(ctx.remoteMediaStream.getTracks().length, 0);
  assert.equal(ctx.classmateAudioElements.size, 0);
});

test('Actual routing deduplicates subscriptions and ignores late removal of a replaced classmate microphone', async () => {
  const { ctx, subscribe, unsubscribe } = await viewer();
  const first = new Track('first'); const replacement = new Track('replacement');
  subscribe('student-uuid', 'student', first);
  const audio = ctx.classmateAudioElements.get('student-uuid');
  subscribe('student-uuid', 'student', first);
  assert.equal(audio.playCount, 1);
  subscribe('student-uuid', 'student', replacement);
  unsubscribe('student-uuid', 'student', first); first.end();
  assert.equal(ctx.classmateAudioElements.get('student-uuid'), audio);
  assert.deepEqual(audio.srcObject.getAudioTracks(), [replacement]);
  replacement.end(); assert.equal(ctx.classmateAudioElements.size, 0);
});

test('Actual SFU/P2P routing plays classmates once in mix-minus then adds them separately when teacher SFU audio replaces it', async () => {
  const { ctx, subscribe } = await viewer();
  const mix = new Track('p2p-mix'); ctx.attachTeacherTrack({ track: mix });
  subscribe('classmate-uuid', 'student', new Track('classmate'));
  const audio = ctx.classmateAudioElements.get('classmate-uuid');
  assert.equal(audio.muted, true, 'P2P mix already contains classmate audio');
  const teacher = new Track('teacher-sfu'); subscribe('teacher-uuid', 'teacher', teacher);
  assert.equal(mix.readyState, 'ended'); assert.equal(audio.muted, false);
  assert.deepEqual(ctx.remoteMediaStream.getAudioTracks(), [teacher]);
  ctx.attachTeacherTrack({ track: new Track('late-p2p-mix') });
  assert.deepEqual(ctx.remoteMediaStream.getAudioTracks(), [teacher]);
  assert.equal(audio.muted, false);
});

test('Actual SFU disconnect cleanup removes every classmate playback element', async () => {
  const { ctx, subscribe, attachedElements } = await viewer();
  subscribe('one', 'student', new Track('one')); subscribe('two', 'student', new Track('two'));
  assert.equal(attachedElements.size, 2);
  ctx.studentSfuRoom.emit(events.Disconnected);
  assert.equal(ctx.classmateAudioElements.size, 0); assert.equal(attachedElements.size, 0);
});

test('Actual token endpoint signs authenticated roles, rejects body role spoofing and preserves existing publication grants', async () => {
  let tokenHandler; let options; let grants;
  const router = { get() {}, post(route, ...handlers) { if (route === '/sfu-token') tokenHandler = handlers.at(-1); } };
  const context = { module: { exports: {} }, process: { env: { NODE_ENV: "test" } }, console: { error() {} },
    require(name) {
      if (name === 'crypto') return require('node:crypto');
      if (name === 'express') return { Router: () => router };
      if (name === '../middleware/authMiddleware') return { verifyToken() {} };
      if (name === 'livekit-server-sdk') return { AccessToken: class {
        constructor(_key, _secret, opts) { options = opts; }
        addGrant(value) { grants = value; } async toJwt() { return 'test-token'; }
      } };
      throw new Error('Unexpected dependency: ' + name);
    },
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'routes/webrtcRoutes.js'), 'utf8'), context);
  router.setClassroomAuthorizer(async () => true);
  const res = { status() { return this; }, json() { return this; } };
  for (const role of ['student', 'parent', 'teacher']) {
    await tokenHandler({ user: { role, id: 'uuid-' + role }, body: { roomName: 'test-room', allowMic: false, classroomRole: 'teacher', metadata: '{"classroomRole":"teacher"}' }, query: {} }, res);
    assert.equal(JSON.parse(options.metadata).classroomRole, role === 'teacher' ? 'teacher' : 'student');
    assert.equal(options.identity, 'uuid-' + role);
    assert.equal(grants.canUpdateOwnMetadata, false);
    assert.equal(grants.canPublish, role === 'teacher', 'Student publication requires server-owned approval');
    assert.equal(grants.canSubscribe, true); assert.equal(grants.canPublishData, true);
  }
});
test('Actual subscribe/unsubscribe keeps video muted while preserving the teacher audio track', async () => {
  const { ctx, subscribe, unsubscribe } = await viewer();
  ctx.elements.remoteVideo.volume = 1;
  ctx.elements.remoteVideo.muted = false;
  const teacher = new Track('teacher'); const student = new Track('student');
  subscribe('teacher-uuid', 'teacher', teacher);
  subscribe('student-uuid', 'student', student);
  assert.equal(ctx.elements.remoteVideo.volume, 1);
  assert.equal(ctx.elements.remoteVideo.muted, true);
  assert.equal(teacher.enabled, true);
  unsubscribe('student-uuid', 'student', student);
  assert.equal(ctx.elements.remoteVideo.volume, 1);
  assert.equal(ctx.elements.remoteVideo.muted, true);
  assert.equal(teacher.readyState, 'live');
});

test('Actual mix-minus graph retains teacher gain when student audio becomes active', () => {
  const code = fs.readFileSync(path.join(root, 'public/js/teacher-live-v2.js'), 'utf8');
  const start = code.indexOf('function rebuildClassroomAudioGraph()');
  const end = code.indexOf('\nfunction removeClassroomAudioSource', start);
  assert.ok(start >= 0 && end > start);
  const teacherGain = { gain: { value: 1.25 }, disconnect() {}, connect() {} };
  const studentGain = { gain: { value: 1 }, disconnect() {}, connect() {} };
  const ctx = {
    classroomAudioContext: { state: 'running' }, classActive: true,
    classroomAudioSources: new Map([
      ['__teacher_microphone__', { gainNode: teacherGain, enabled: true }],
      ['student-socket', { gainNode: studentGain, enabled: false }],
    ]),
    classroomAudioDestinations: new Map([['listener-socket', {}]]),
    teacherMicGainNode: teacherGain, teacherMicAnalyserNode: null,
  };
  vm.createContext(ctx); vm.runInContext(code.slice(start, end), ctx);
  ctx.rebuildClassroomAudioGraph();
  ctx.classroomAudioSources.get('student-socket').enabled = true;
  ctx.rebuildClassroomAudioGraph();
  assert.equal(teacherGain.gain.value, 1.25);
  assert.equal(studentGain.gain.value, 1);
});