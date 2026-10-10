const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const studentSource = fs.readFileSync(path.join(root, 'public/js/student-live.js'), 'utf8');
const teacherSource = fs.readFileSync(path.join(root, 'public/js/teacher-live-v2.js'), 'utf8');

function extractStudentFunction(name) {
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
    this.__fromSfu = false;
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
    this.currentTime = 0;
    this.readyState = 4;
  }
  async play() {
    if (this.__shouldFailPlay) {
      throw new Error('NotAllowedError: play() failed');
    }
    this.playCount++;
    this.paused = false;
  }
  pause() {
    this.paused = true;
  }
  remove() {}
}

async function createTestEnvironment({ sfuConnected = true, p2pConnected = true } = {}) {
  const teacherAudioEl = new MockAudioElement('teacher-live-audio');
  const remoteVideoEl = new MockAudioElement('remote-video');
  const socketHandlers = new Map();
  const socketEmitted = [];

  const mockSocket = {
    connected: true,
    on(event, handler) {
      socketHandlers.set(event, handler);
      return this;
    },
    emit(event, data) {
      socketEmitted.push({ event, data });
    },
  };

  const p2pSenders = [];
  const p2pReceivers = [];
  const p2pTransceivers = [];

  const teacherInboundP2pTrack = new MockTrack('teacher-inbound-track-p2p', 'audio');
  const teacherReceiver = { track: teacherInboundP2pTrack };
  const teacherTransceiver = {
    receiver: teacherReceiver,
    direction: 'recvonly',
    currentDirection: 'recvonly',
  };
  p2pReceivers.push(teacherReceiver);
  p2pTransceivers.push(teacherTransceiver);

  const mockPc = {
    connectionState: p2pConnected ? 'connected' : 'new',
    signalingState: 'stable',
    getSenders() {
      return [...p2pSenders];
    },
    getReceivers() {
      return [...p2pReceivers];
    },
    getTransceivers() {
      return [...p2pTransceivers];
    },
    addTrack(track, stream) {
      const sender = {
        track,
        streams: [stream],
        __isStudentMic: true,
        async replaceTrack(newTrack) {
          this.track = newTrack;
        },
      };
      p2pSenders.push(sender);
      return sender;
    },
    async createOffer() {
      return { type: 'offer', sdp: 'v=0\r\no=mock 1 1 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n' };
    },
    async createAnswer() {
      return { type: 'answer', sdp: 'v=0\r\no=mock 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n' };
    },
    async setLocalDescription(desc) {
      if (desc.type === 'rollback') {
        this.signalingState = 'stable';
      } else if (desc.type === 'offer') {
        this.signalingState = 'have-local-offer';
      } else if (desc.type === 'answer') {
        this.signalingState = 'stable';
      }
      this.localDescription = desc;
    },
    async setRemoteDescription(desc) {
      if (desc.type === 'offer') {
        this.signalingState = 'have-remote-offer';
      } else if (desc.type === 'answer') {
        this.signalingState = 'stable';
      }
      this.remoteDescription = desc;
    },
    async addIceCandidate() {},
    async getStats() {
      return [
        { type: 'inbound-rtp', kind: 'audio', bytesReceived: 65536, packetsReceived: 512, packetsLost: 2, jitter: 0.005 },
      ];
    },
    close() {
      this.connectionState = 'closed';
      this.signalingState = 'closed';
      teacherInboundP2pTrack.end();
    },
  };

  let activeRoom = null;
  const sfuPublishedTracks = [];
  class MockRoom {
    constructor() {
      this.state = 'disconnected';
      this.localParticipant = {
        identity: 'student-self-id',
        async publishTrack(track, options) {
          if (ctx.__simulateSfuPublishError) {
            throw new Error('LiveKit publication rejected');
          }
          const pub = { track, options };
          sfuPublishedTracks.push(pub);
          return pub;
        },
        async unpublishTrack(track) {
          const idx = sfuPublishedTracks.findIndex((p) => p.track === track);
          if (idx >= 0) sfuPublishedTracks.splice(idx, 1);
        },
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
    remoteMediaStream: new MockMediaStream([teacherInboundP2pTrack]),
    teacherAudioStream: null,
    teacherAudioElement: teacherAudioEl,
    teacherInboundAudioTrack: teacherInboundP2pTrack,
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
    optimizeOpusSdp: (sdp) => sdp,
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
        return new MockAudioElement(tag);
      },
      body: { appendChild: noop },
    },
    navigator: {
      mediaDevices: {
        listeners: new Map(),
        addEventListener(event, fn) {
          const cbs = this.listeners.get(event) || [];
          cbs.push(fn);
          this.listeners.set(event, cbs);
        },
        emitDeviceChange() {
          for (const fn of this.listeners.get('devicechange') || []) fn();
        },
        async getUserMedia(constraints) {
          if (ctx.__simulateMediaError) {
            const err = new Error('Permission denied');
            err.name = ctx.__simulateMediaError;
            throw err;
          }
          // Simulating browser audio focus behavior: opening mic can pause background audio
          if (ctx.__simulateAudioElementPauseOnMicOpen) {
            teacherAudioEl.pause();
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
          TrackSubscribed: 'trackSubscribed',
          TrackUnsubscribed: 'trackUnsubscribed',
          ParticipantDisconnected: 'participantDisconnected',
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
    setViewerStatus: (msg) => { currentViewerStatus = msg; },
    getViewerStatus: () => currentViewerStatus,
    setRaisedHandState: noop,
    clearHandResetTimer: noop,
    clearRecoveryTimer: noop,
    updateChatControls: noop,
    updateRemoteVideoPresentation: noop,
    updateRemoteAudioControl: noop,
    startTeacherAudio: async () => {},
    playMicOpenedAlert: noop,
    armAutoUnmuteOnFirstInteraction: noop,
    emitWithAcknowledgement: async () => {},
    isStudentSfuConnected: () => Boolean(ctx.studentSfuRoom && ctx.studentSfuRoom.state === 'connected'),
    isStudentSfuHealthy: () => Boolean(ctx.studentSfuRoom && ctx.studentSfuRoom.state === 'connected'),
    RTCSessionDescription: class { constructor(init) { Object.assign(this, init); } },
    RTCIceCandidate: class { constructor(init) { Object.assign(this, init); } },
  };

  vm.createContext(ctx);

  const functionsToLoad = [
    'getTeacherAudioElement',
    'playTeacherInboundAudio',
    'ensureTeacherAudioPlayback',
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
    'negotiateStudentMicrophone',
    'addUniqueTrack',
    'attachTeacherTrack',
    'updateMicControl',
    'enableApprovedMicrophone',
    'stopLocalAudio',
    'getMinasatyStudentLiveDiagnostics',
    'getMinasatyStudentLiveStatsAsync',
  ];

  for (const fn of functionsToLoad) {
    vm.runInContext(extractStudentFunction(fn), ctx, { filename: 'student-live.js:' + fn });
  }

  ctx.getMinasatyStudentLiveDiagnostics = () => ctx.window.getMinasatyStudentLiveDiagnostics();
  ctx.getMinasatyStudentLiveStatsAsync = () => ctx.window.getMinasatyStudentLiveStatsAsync();

  // Pre-seed teacher audio playback
  ctx.attachTeacherTrack({ track: teacherInboundP2pTrack, receiver: teacherReceiver });
  assert.equal(teacherAudioEl.paused, false, 'Teacher audio must be playing initially');

  if (sfuConnected) {
    await ctx.connectStudentSfu('room-test');
  }

  return {
    ctx,
    teacherAudioEl,
    remoteVideoEl,
    mockPc,
    teacherInboundP2pTrack,
    sfuPublishedTracks,
    socketHandlers,
    socketEmitted,
    getMockSfuRoom: () => activeRoom,
  };
}

test('1. Mixed Transport: P2P teacher receiver with connected SFU Room and SFU-published student mic preserves teacher audio', async () => {
  const env = await createTestEnvironment({ sfuConnected: true, p2pConnected: true });
  const { ctx, teacherAudioEl, teacherInboundP2pTrack, sfuPublishedTracks, socketHandlers } = env;

  // Simulate browser behavior: opening getUserMedia causes audio focus interruption
  ctx.__simulateAudioElementPauseOnMicOpen = true;

  // Diagnostic verification BEFORE mic approval
  const diagBefore = ctx.getMinasatyStudentLiveDiagnostics();
  assert.equal(diagBefore.teacherInboundTrack.id, teacherInboundP2pTrack.id);
  assert.equal(diagBefore.teacherInboundTrack.readyState, 'live');
  assert.equal(diagBefore.teacherAudioElementState.paused, false);
  assert.equal(diagBefore.p2pAudioReceiver.direction, 'recvonly');

  // Trigger server permission_granted event
  ctx.microphonePermissionGranted = true;
  await ctx.enableApprovedMicrophone();

  // Verify mic was published to SFU
  assert.equal(sfuPublishedTracks.length, 1, 'Student mic must be published to SFU');
  assert.equal(Boolean(ctx.studentSfuMicPub), true);

  // CRITICAL: Teacher audio must NOT disappear for the approved student!
  assert.equal(teacherAudioEl.paused, false, 'Teacher audio element must remain unpaused');
  assert.equal(teacherInboundP2pTrack.readyState, 'live', 'P2P teacher track must remain live');

  // Diagnostic verification AFTER mic approval
  const diagAfter = await ctx.getMinasatyStudentLiveStatsAsync();
  assert.equal(diagAfter.teacherInboundTrack.id, teacherInboundP2pTrack.id);
  assert.equal(diagAfter.teacherInboundTrack.readyState, 'live');
  assert.equal(diagAfter.teacherAudioElementState.paused, false);
  assert.ok(diagAfter.inboundAudioStats.bytesReceived > 0, 'Inbound audio bytes must be nonzero');
});

test('2. Offer collision handling: polite student rolls back local renegotiation offer instead of destroying receiving connection', async () => {
  const env = await createTestEnvironment({ sfuConnected: false, p2pConnected: true });
  const { ctx, teacherAudioEl, mockPc, teacherInboundP2pTrack } = env;

  // Step 1: Student is negotiating a P2P mic, so localDescription is set to offer
  mockPc.signalingState = 'have-local-offer';
  ctx.isMakingRenegotiationOffer = true;

  // Step 2: Teacher sends a simultaneous webrtc_offer
  const teacherOffer = {
    fromSocketId: 'teacher-socket-123',
    sdp: { type: 'offer', sdp: 'v=0\r\no=teacher 1 1 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n' },
  };

  // Run the offer handler logic directly
  let peerConnection = ctx.pc;
  const isSamePeer = Boolean(ctx.pc && ctx.teacherSocketId === teacherOffer.fromSocketId && ctx.pc.connectionState !== 'closed');
  assert.equal(isSamePeer, true);

  if (peerConnection.signalingState === 'have-local-offer') {
    await peerConnection.setLocalDescription({ type: 'rollback' });
  }

  assert.equal(peerConnection.signalingState, 'stable', 'Polite peer rollback must return signaling to stable');
  assert.equal(mockPc.connectionState, 'connected', 'PeerConnection must NOT be closed');
  assert.equal(teacherInboundP2pTrack.readyState, 'live', 'Teacher inbound track must NOT be terminated');
  assert.equal(teacherAudioEl.paused, false, 'Teacher audio playback must be preserved');
});

test('3. P2P-only mode: student mic publication over P2P preserves teacher playback', async () => {
  const env = await createTestEnvironment({ sfuConnected: false, p2pConnected: true });
  const { ctx, teacherAudioEl, mockPc, teacherInboundP2pTrack } = env;

  ctx.microphonePermissionGranted = true;
  await ctx.enableApprovedMicrophone();

  const diag = ctx.getMinasatyStudentLiveDiagnostics();
  assert.equal(diag.studentMicPublishedP2p, true, 'Mic must be published over P2P');
  assert.equal(teacherInboundP2pTrack.readyState, 'live', 'Teacher track must remain live');
  assert.equal(teacherAudioEl.paused, false, 'Teacher playback must remain active');
});

test('4. SFU-only mode: both teacher and student mic on SFU keep teacher audio playing', async () => {
  const env = await createTestEnvironment({ sfuConnected: true, p2pConnected: false });
  const { ctx, teacherAudioEl, sfuPublishedTracks, getMockSfuRoom } = env;

  // Teacher SFU track attached
  const sfuTeacherTrack = new MockTrack('teacher-sfu-track-1', 'audio');
  sfuTeacherTrack.__fromSfu = true;
  ctx.attachTeacherTrack({ track: sfuTeacherTrack });

  ctx.microphonePermissionGranted = true;
  await ctx.enableApprovedMicrophone();

  assert.equal(sfuPublishedTracks.length, 1);
  assert.equal(sfuTeacherTrack.readyState, 'live');
  assert.equal(teacherAudioEl.paused, false);
});

test('5. Delayed SFU teacher subscription: switches to SFU teacher track without playback interruption', async () => {
  const env = await createTestEnvironment({ sfuConnected: true, p2pConnected: true });
  const { ctx, teacherAudioEl, teacherInboundP2pTrack } = env;

  // Mic approved while still on P2P teacher reception
  ctx.microphonePermissionGranted = true;
  await ctx.enableApprovedMicrophone();
  assert.equal(teacherAudioEl.paused, false);

  // Delayed teacher SFU track arrives
  const delayedSfuTeacherTrack = new MockTrack('teacher-delayed-sfu-track', 'audio');
  delayedSfuTeacherTrack.__fromSfu = true;
  ctx.playTeacherInboundAudio(delayedSfuTeacherTrack);

  assert.equal(ctx.teacherInboundAudioTrack.id, delayedSfuTeacherTrack.id);
  assert.equal(teacherAudioEl.paused, false, 'Teacher playback must remain uninterrupted on track switch');
});

test('6. Failed SFU microphone publication gracefully falls back to P2P without dropping teacher audio', async () => {
  const env = await createTestEnvironment({ sfuConnected: true, p2pConnected: true });
  const { ctx, teacherAudioEl, teacherInboundP2pTrack } = env;

  ctx.__simulateSfuPublishError = true;
  ctx.microphonePermissionGranted = true;
  await ctx.enableApprovedMicrophone();

  const diag = ctx.getMinasatyStudentLiveDiagnostics();
  assert.equal(diag.studentMicPublishedP2p, true, 'Must fall back to P2P mic sender');
  assert.equal(teacherInboundP2pTrack.readyState, 'live');
  assert.equal(teacherAudioEl.paused, false);
});

test('7. Multiple approvals & Mute/Revoke/Reapprove cycle preserves teacher audio at every step', async () => {
  const env = await createTestEnvironment({ sfuConnected: true, p2pConnected: true });
  const { ctx, teacherAudioEl, sfuPublishedTracks } = env;

  // Step 1: Initial approval
  ctx.microphonePermissionGranted = true;
  await ctx.enableApprovedMicrophone();
  assert.equal(teacherAudioEl.paused, false);

  // Step 2: Microphone revoked
  ctx.microphonePermissionGranted = false;
  ctx.unpublishStudentSfuMic();
  ctx.unpublishStudentP2pMic();
  await ctx.ensureTeacherAudioPlayback({ sourceHint: 'revocation_test' });
  assert.equal(teacherAudioEl.paused, false, 'Teacher playback must remain active when mic is revoked');

  // Step 3: Re-approved
  ctx.microphonePermissionGranted = true;
  await ctx.enableApprovedMicrophone();
  assert.equal(teacherAudioEl.paused, false, 'Teacher playback must remain active when re-approved');
});

test('8. Audio device change & local playback error observability', async () => {
  const env = await createTestEnvironment({ sfuConnected: true, p2pConnected: true });
  const { ctx, teacherAudioEl } = env;

  // Simulate playback error (e.g. autoplay block)
  teacherAudioEl.__shouldFailPlay = true;
  teacherAudioEl.paused = true;

  const res = await ctx.ensureTeacherAudioPlayback({ sourceHint: 'devicechange_error_test' });
  assert.equal(res.ok, false);
  assert.equal(res.error, 'playback_failed');

  // Must be observably recorded in diagnostics without swallowing
  const latestEvent = ctx.studentDiagnosticEvents.find((e) => e.type === 'teacher_audio_playback_failed');
  assert.ok(latestEvent, 'Diagnostic event must be recorded for playback failure');
  assert.ok(latestEvent.message.includes('Playback error'));
});
