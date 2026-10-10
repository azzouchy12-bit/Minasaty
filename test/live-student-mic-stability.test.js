const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const studentSource = fs.readFileSync(path.join(root, 'public/js/student-live.js'), 'utf8');
const studentHtml = fs.readFileSync(path.join(root, 'public/student-live.html'), 'utf8');

function productionFunction(name) {
  const marker = studentSource.indexOf('function ' + name + '(');
  assert.ok(marker >= 0, name + ' must exist in student-live.js');
  const start = studentSource.lastIndexOf('\n', marker) + 1;
  const next = studentSource.slice(marker + 1).search(/\n(?:async )?function /);
  return studentSource.slice(start, next < 0 ? studentSource.length : marker + 1 + next);
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
    const callbacks = this.listeners.get(event) || [];
    callbacks.push(fn);
    this.listeners.set(event, callbacks);
  }
  stop() {
    this.readyState = 'ended';
  }
  end() {
    this.readyState = 'ended';
    for (const callback of this.listeners.get('ended') || []) callback();
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
    return this.tracks.filter((t) => t.kind === 'audio');
  }
  getVideoTracks() {
    return this.tracks.filter((t) => t.kind === 'video');
  }
  addTrack(track) {
    if (!this.tracks.includes(track)) {
      this.tracks.push(track);
    }
  }
  removeTrack(track) {
    this.tracks = this.tracks.filter((t) => t !== track);
  }
}

class MockAudioElement {
  constructor(id = '') {
    this.id = id;
    this.muted = false;
    this.volume = 1.0;
    this.srcObject = null;
    this.paused = true;
    this.playCount = 0;
    this.style = {};
  }
  async play() {
    this.playCount++;
    this.paused = false;
  }
  pause() {
    this.paused = true;
  }
  remove() {}
}

async function createStudentEnvironment({ sfuConnected = false, p2pConnected = true } = {}) {
  const teacherAudioEl = new MockAudioElement('teacher-live-audio');
  const remoteVideoEl = new MockAudioElement('remote-video');

  const attachedDomElements = new Set();
  const socketHandlers = new Map();

  const mockSocket = {
    connected: true,
    on(event, handler) {
      socketHandlers.set(event, handler);
      return this;
    },
    emit() {},
  };

  const p2pSenders = [];
  const mockPc = {
    connectionState: p2pConnected ? 'connected' : 'new',
    signalingState: 'stable',
    getSenders() {
      return [...p2pSenders];
    },
    addTrack(track, stream) {
      const sender = {
        track,
        streams: [stream],
        async replaceTrack(newTrack) {
          this.track = newTrack;
        },
      };
      p2pSenders.push(sender);
      return sender;
    },
    close() {
      this.connectionState = 'closed';
    },
  };

  // Populate mock downstream receive-only transceiver senders (where track === null)
  // as happens in real WebRTC viewer sessions receiving teacher tracks.
  const teacherVideoDownstreamSender = {
    track: null,
    async replaceTrack(newTrack) {
      this.track = newTrack;
    },
  };
  const teacherAudioDownstreamSender = {
    track: null,
    async replaceTrack(newTrack) {
      this.track = newTrack;
    },
  };
  p2pSenders.push(teacherVideoDownstreamSender, teacherAudioDownstreamSender);

  let activeRoom = null;
  class MockRoom {
    constructor() {
      this.state = 'disconnected';
      this.localParticipant = {
        identity: 'student-self-id',
        async publishTrack(track) {
          return { track };
        },
        unpublishTrack() {},
      };
      this.handlers = new Map();
      activeRoom = this;
    }
    on(event, handler) {
      this.handlers.set(event, handler);
      return this;
    }
    emit(event, ...args) {
      this.handlers.get(event)?.(...args);
    }
    async connect() {
      this.state = 'connected';
    }
    disconnect() {
      this.state = 'disconnected';
    }
  }

  const noop = () => {};
  let currentViewerStatus = '';

  const ctx = {
    console: { info: noop, warn: noop, error: noop, debug: noop },
    MediaStream: MockMediaStream,
    socket: mockSocket,
    joinedClass: true,
    microphonePermissionGranted: false,
    microphonePrepared: false,
    isPreparingMicrophone: false,
    isRequestingMicrophone: false,
    isMakingRenegotiationOffer: false,
    microphoneOfferSent: false,
    microphoneNegotiated: false,
    localAudioStream: undefined,
    remoteMediaStream: new MockMediaStream(),
    teacherAudioStream: null,
    teacherAudioElement: teacherAudioEl,
    teacherInboundAudioTrack: null,
    knownTeacherIdentity: 'teacher-auth-uuid',
    teacherSocketId: 'teacher-socket-123',
    studentP2pMicSender: null,
    studentSfuRoom: null,
    studentSfuMicPub: null,
    isStudentMicSyncing: false,
    isStudentSfuConnecting: false,
    currentStudentSfuRoomName: null,
    studentDiagnosticEvents: [],
    classmateAudioElements: new Map(),
    pc: p2pConnected ? mockPc : null,
    rtcConfig: {},
    pendingIceCandidates: [],
    screenShareActive: true,
    recoveryAttempts: 0,
    isRecoveringStream: false,
    elements: {
      remoteVideo: remoteVideoEl,
      raiseHandButton: { hidden: false },
      handWaitingActions: { hidden: true },
      toggleMicButton: { style: {}, disabled: true },
      joinButton: { hidden: false, disabled: false },
    },
    document: {
      getElementById(id) {
        if (id === 'teacher-live-audio') return teacherAudioEl;
        if (id === 'remote-video') return remoteVideoEl;
        return null;
      },
      createElement(tag) {
        const el = new MockAudioElement(tag);
        return el;
      },
      body: {
        appendChild(el) {
          attachedDomElements.add(el);
        },
      },
    },
    navigator: {
      mediaDevices: {
        async getUserMedia(constraints) {
          if (ctx.__simulateMediaError) {
            const err = new Error('Permission denied');
            err.name = ctx.__simulateMediaError;
            throw err;
          }
          const audioTrack = new MockTrack('student-local-mic-track', 'audio');
          return new MockMediaStream([audioTrack]);
        },
      },
    },
    window: {
      LivekitClient: {
        Room: MockRoom,
        RoomEvent: {
          TrackSubscribed: 'subscribed',
          TrackUnsubscribed: 'unsubscribed',
          ParticipantDisconnected: 'left',
          Disconnected: 'disconnected',
        },
      },
      fetchMinasatySfuToken: async () => ({
        enabled: true,
        token: 'test-token',
        url: 'wss://test-sfu.invalid',
      }),
      clearTimeout: noop,
      setTimeout: () => 1,
    },
    setViewerStatus: (msg) => {
      currentViewerStatus = msg;
    },
    getViewerStatus: () => currentViewerStatus,
    setRaisedHandState: noop,
    clearHandResetTimer: noop,
    clearRecoveryTimer: noop,
    updateChatControls: noop,
    updateRemoteVideoPresentation: noop,
    updateRemoteAudioControl: noop,
    startTeacherAudio: async () => {},
    playMicOpenedAlert: noop,
    negotiateStudentMicrophone: async () => {
      ctx.microphoneNegotiated = true;
    },
    emitWithAcknowledgement: async () => {},
    isStudentSfuConnected: () => Boolean(ctx.studentSfuRoom && ctx.studentSfuRoom.state === 'connected'),
    isStudentSfuHealthy: () => Boolean(ctx.studentSfuRoom && ctx.studentSfuRoom.state === 'connected'),
  };

  ctx.teacherSfuPlaybackTracks = new Map();
  ctx.teacherAudioPlaybackBlocked = false;
  vm.createContext(ctx);

  const functionsToLoad = [
    'setTeacherAudioPlaybackBlocked',
    'detachTeacherSfuPlaybackTrack',
    'attachTeacherSfuPlaybackTrack',
    'getTeacherAudioElement',
    'playTeacherInboundAudio',
    'recordStudentDiagnosticEvent',
    'notifySfuTransportStatus',
    'getSfuParticipantRole',
    'syncClassmateSfuAudioPlayback',
    'playClassmateSfuAudio',
    'stopClassmateSfuAudio',
    'clearAllClassmateAudio',
    'connectStudentSfu',
    'publishStudentSfuMic',
    'unpublishStudentSfuMic',
    'publishStudentP2pMic',
    'unpublishStudentP2pMic',
    'addUniqueTrack',
    'attachTeacherTrack',
    'updateMicControl',
    'enableApprovedMicrophone',
    'stopLocalAudio',
    'getMinasatyStudentLiveDiagnostics',
  ];

  for (const fn of functionsToLoad) {
    vm.runInContext(productionFunction(fn), ctx, { filename: 'student-live.js:' + fn });
  }

  if (sfuConnected) {
    await ctx.connectStudentSfu('room-1');
  }

  return {
    ctx,
    teacherAudioEl,
    remoteVideoEl,
    mockPc,
    getMockSfuRoom: () => activeRoom || ctx.studentSfuRoom,
    socketHandlers,
    downstreamSenders: {
      video: teacherVideoDownstreamSender,
      audio: teacherAudioDownstreamSender,
    },
  };
}

test('HTML contains dedicated #teacher-live-audio with autoplay and playsinline', () => {
  assert.ok(studentHtml.includes('id="teacher-live-audio"'), 'HTML must include dedicated #teacher-live-audio');
  assert.ok(studentHtml.includes('autoplay'), 'Must include autoplay');
  assert.ok(studentHtml.includes('playsinline'), 'Must include playsinline');
});

test('Student hears teacher -> Teacher grants mic -> Student mic active -> Both speak -> Close mic -> Reopen mic (P2P mode)', async () => {
  const env = await createStudentEnvironment({ sfuConnected: false, p2pConnected: true });
  const { ctx, teacherAudioEl, downstreamSenders } = env;

  // Step 1: Student receives teacher audio
  const teacherAudioTrack = new MockTrack('teacher-mic-track-1', 'audio');
  ctx.attachTeacherTrack({ track: teacherAudioTrack });

  assert.equal(teacherAudioTrack.readyState, 'live', 'Teacher track must be live');
  assert.equal(teacherAudioEl.muted, false, 'Teacher audio must be unmuted');
  assert.equal(teacherAudioEl.volume, 1.0, 'Teacher volume must be 1.0');
  assert.equal(teacherAudioEl.paused, false, 'Teacher audio element must be playing');
  assert.ok(
    teacherAudioEl.srcObject.getAudioTracks().some((t) => t.id === teacherAudioTrack.id),
    'Teacher audio element srcObject must contain teacher audio track'
  );

  // Initial diagnostic state
  const diagBeforeGrant = ctx.window.getMinasatyStudentLiveDiagnostics();
  assert.equal(diagBeforeGrant.teacherAudioTrackState, 'live');
  assert.equal(diagBeforeGrant.teacherAudioElementState.muted, false);
  assert.equal(diagBeforeGrant.teacherAudioElementState.paused, false);
  assert.equal(diagBeforeGrant.studentMicPublishedP2p, false);

  // Step 2: Teacher grants mic permission
  ctx.microphonePermissionGranted = true;
  await ctx.enableApprovedMicrophone();

  // Verification: Downstream receive-only senders must NEVER be hijacked
  assert.equal(downstreamSenders.audio.track, null, 'Teacher downstream audio transceiver must NOT be hijacked');
  assert.equal(downstreamSenders.video.track, null, 'Teacher downstream video transceiver must NOT be hijacked');

  // Verification: Student mic was attached as its own sender
  assert.ok(ctx.studentP2pMicSender, 'Dedicated student mic sender must be created');
  assert.equal(ctx.studentP2pMicSender.__isStudentMic, true, 'Sender must be tagged as student mic');
  assert.equal(ctx.studentP2pMicSender.track.id, 'student-local-mic-track', 'Student sender must carry local mic track');

  // Verification: Teacher audio remains completely audible and uninterrupted
  assert.equal(teacherAudioTrack.readyState, 'live', 'Teacher track must remain live during student mic activation');
  assert.equal(teacherAudioEl.muted, false, 'Teacher audio element must remain unmuted');
  assert.equal(teacherAudioEl.volume, 1.0, 'Teacher volume must remain 1.0');
  assert.equal(teacherAudioEl.paused, false, 'Teacher audio element must still be playing');

  const diagDuringMic = ctx.window.getMinasatyStudentLiveDiagnostics();
  assert.equal(diagDuringMic.teacherAudioTrackState, 'live');
  assert.equal(diagDuringMic.studentMicPublishedP2p, true);

  // Step 3: Both speak - student mic is live, teacher track is live
  assert.equal(ctx.localAudioStream.getAudioTracks()[0].enabled, true);
  assert.equal(teacherAudioTrack.enabled, true);

  // Step 4: Teacher closes the microphone (microphone_revoked)
  ctx.unpublishStudentP2pMic();
  const studentTrack = ctx.localAudioStream.getAudioTracks()[0];
  studentTrack.enabled = false;
  ctx.microphonePermissionGranted = false;

  assert.equal(ctx.studentP2pMicSender.track, null, 'P2P student mic track must be replaced with null');
  assert.equal(teacherAudioTrack.readyState, 'live', 'Teacher audio track must remain live after mic revocation');
  assert.equal(teacherAudioEl.muted, false, 'Teacher audio element must remain unmuted after mic revocation');
  assert.equal(teacherAudioEl.paused, false, 'Teacher audio element must remain playing after mic revocation');

  // Step 5: Teacher re-opens the microphone
  ctx.microphonePermissionGranted = true;
  await ctx.enableApprovedMicrophone();

  assert.ok(ctx.studentP2pMicSender.track, 'P2P student mic track must be restored');
  assert.equal(teacherAudioTrack.readyState, 'live', 'Teacher audio track must remain live after reopening mic');
  assert.equal(teacherAudioEl.muted, false, 'Teacher audio element must remain unmuted after reopening mic');
  assert.equal(teacherAudioEl.paused, false, 'Teacher audio element must remain playing after reopening mic');
});

test('Student hears teacher -> Teacher grants mic -> Student mic active (SFU mode)', async () => {
  const env = await createStudentEnvironment({ sfuConnected: true, p2pConnected: false });
  const { ctx, teacherAudioEl, getMockSfuRoom } = env;
  const mockSfuRoom = getMockSfuRoom();

  const teacherAudioTrack = new MockTrack('teacher-sfu-audio-track', 'audio');
  const teacherParticipant = {
    identity: 'teacher-auth-uuid',
    metadata: JSON.stringify({ classroomRole: 'teacher' }),
  };

  // Subscribe to teacher audio on SFU
  mockSfuRoom.emit('subscribed', { kind: 'audio', mediaStreamTrack: teacherAudioTrack }, {}, teacherParticipant);

  assert.equal(teacherAudioTrack.readyState, 'live');
  assert.equal(teacherAudioEl.muted, false);
  assert.equal(teacherAudioEl.volume, 1.0);
  assert.equal(teacherAudioEl.paused, false);

  // Teacher grants mic
  ctx.microphonePermissionGranted = true;
  await ctx.enableApprovedMicrophone();

  assert.ok(ctx.studentSfuMicPub, 'Student mic must be published to SFU');
  assert.equal(teacherAudioTrack.readyState, 'live', 'Teacher audio track must remain live in SFU mode');
  assert.equal(teacherAudioEl.muted, false, 'Teacher audio element must remain unmuted in SFU mode');
  assert.equal(teacherAudioEl.paused, false, 'Teacher audio element must remain playing in SFU mode');

  // Teacher revokes mic
  ctx.unpublishStudentSfuMic();
  assert.equal(ctx.studentSfuMicPub, null, 'SFU publication reference cleared');
  assert.equal(teacherAudioTrack.readyState, 'live', 'Teacher audio track still live');
  assert.equal(teacherAudioEl.muted, false, 'Teacher audio still unmuted');
});

test('Browser permission denial (NotAllowedError) handles gracefully without disrupting teacher audio', async () => {
  const env = await createStudentEnvironment({ sfuConnected: false, p2pConnected: true });
  const { ctx, teacherAudioEl } = env;

  const teacherAudioTrack = new MockTrack('teacher-mic-track', 'audio');
  ctx.attachTeacherTrack({ track: teacherAudioTrack });

  assert.equal(teacherAudioEl.muted, false);
  assert.equal(teacherAudioEl.paused, false);

  // Simulate user clicking "Block" / browser permission denial
  ctx.__simulateMediaError = 'NotAllowedError';
  ctx.microphonePermissionGranted = true;

  await ctx.enableApprovedMicrophone();

  // Student receives informative message, permission flag is reset
  assert.equal(ctx.microphonePermissionGranted, false);
  assert.ok(ctx.getViewerStatus().includes('لم تسمح للمتصفح'), 'Status should inform student of denied permission');

  // Teacher audio must be COMPLETELY unaffected
  assert.equal(teacherAudioTrack.readyState, 'live', 'Teacher track must not end when student blocks mic');
  assert.equal(teacherAudioEl.muted, false, 'Teacher element must remain unmuted');
  assert.equal(teacherAudioEl.paused, false, 'Teacher element must remain playing');
});

test('Two students with teacher: one student departure does not interrupt teacher or other student', async () => {
  const env = await createStudentEnvironment({ sfuConnected: true, p2pConnected: false });
  const { ctx, teacherAudioEl, getMockSfuRoom } = env;
  const mockSfuRoom = getMockSfuRoom();

  // Teacher audio
  const teacherAudioTrack = new MockTrack('teacher-audio', 'audio');
  mockSfuRoom.emit(
    'subscribed',
    { kind: 'audio', mediaStreamTrack: teacherAudioTrack },
    {},
    { identity: 'teacher-auth-uuid', metadata: JSON.stringify({ classroomRole: 'teacher' }) }
  );

  // Student A audio
  const studentATrack = new MockTrack('student-a-audio', 'audio');
  mockSfuRoom.emit(
    'subscribed',
    { kind: 'audio', mediaStreamTrack: studentATrack },
    {},
    { identity: 'student-a', metadata: JSON.stringify({ classroomRole: 'student' }) }
  );

  // Student B audio
  const studentBTrack = new MockTrack('student-b-audio', 'audio');
  mockSfuRoom.emit(
    'subscribed',
    { kind: 'audio', mediaStreamTrack: studentBTrack },
    {},
    { identity: 'student-b', metadata: JSON.stringify({ classroomRole: 'student' }) }
  );

  assert.equal(ctx.classmateAudioElements.size, 2, 'Both students should have audio elements');
  assert.equal(teacherAudioEl.muted, false, 'Teacher audio must be unmuted');

  // Student A leaves
  mockSfuRoom.emit(
    'unsubscribed',
    { kind: 'audio', mediaStreamTrack: studentATrack },
    {},
    { identity: 'student-a', metadata: JSON.stringify({ classroomRole: 'student' }) }
  );

  assert.equal(ctx.classmateAudioElements.has('student-a'), false, 'Student A audio element must be removed');
  assert.equal(ctx.classmateAudioElements.has('student-b'), true, 'Student B audio element must remain');
  assert.equal(teacherAudioTrack.readyState, 'live', 'Teacher track must remain live');
  assert.equal(teacherAudioEl.muted, false, 'Teacher audio must remain unmuted');
  assert.equal(teacherAudioEl.paused, false, 'Teacher audio must remain playing');
});
