const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const teacher = fs.readFileSync(path.join(root, 'public/js/teacher-live-v2.js'), 'utf8');
const student = fs.readFileSync(path.join(root, 'public/js/student-live.js'), 'utf8');
function extract(source, name) {
  const found = source.match(new RegExp('(?:async )?function ' + name + '\\([^]*?^\\}', 'm'));
  assert.ok(found, name); return found[0];
}
const quiet = {info() {}, warn() {}, error() {}};

test('Actual SFU connection does not report success when both publications fail', async () => {
  const ctx = {teacherSfuRoom: null, currentTeacherSfuRoomName: null, isTeacherSfuConnecting: false,
    teacherSfuConnectPromise: null, teacherSfuSessionId: 0, sfuActiveForClass: false,
    isSfuMediaSyncing: false, pendingSfuMediaSync: false, teacherSfuVideoPub: null, teacherSfuAudioPub: null,
    recordLiveDiagnosticEvent() {}, getActiveTeacherVideoTrack: () => ({id:'v', readyState:'live'}),
    getActiveTeacherAudioTrack: () => ({id:'a', readyState:'live'}), console: quiet,
    window: {fetchMinasatySfuToken: async () => ({enabled:true, url:'mock', token:'mock'}), LivekitClient: {
      Room: class {constructor() {this.state='disconnected'; this.localParticipant={trackPublications:new Map(),
        publishTrack:async () => {throw Error('publication failed');}};} on() {} async connect(){this.state='connected';}},
      RoomEvent: {TrackSubscribed:'ts', TrackUnsubscribed:'tu', ParticipantDisconnected:'pd', Disconnected:'d'}}}};
  vm.runInNewContext(['initTeacherSfuSession','syncTeacherSfuMedia','executeTeacherSfuMediaSync']
    .map(n => extract(teacher,n)).join('\n'),ctx);
  assert.equal(await ctx.initTeacherSfuSession('class'),false);
  assert.equal(ctx.sfuActiveForClass,false);
  assert.equal(await ctx.initTeacherSfuSession('class'),false, 'Connected-room resync must also propagate failure');
});

test('Actual student offer handler rolls back collision without closing teacher reception', async () => {
  let handler, closed=0, rollbacks=0;
  const pc={connectionState:'connected',signalingState:'have-local-offer',
    async setLocalDescription(desc){if(desc.type==='rollback'){rollbacks++;this.signalingState='stable';}
      else this.signalingState='stable';this.localDescription=desc;},
    async setRemoteDescription(){this.signalingState='have-remote-offer';},
    async createAnswer(){return {type:'answer',sdp:'mock'};}, close(){closed++;}};
  const ctx={pc,joinedClass:true,teacherSocketId:'teacher',microphonePermissionGranted:false,
    console:quiet,window:{},recordStudentDiagnosticEvent(){},createViewerPeerConnection(){throw Error('must preserve receiver');},
    RTCSessionDescription:class{constructor(desc){Object.assign(this,desc);}},flushPendingIceCandidates:async()=>{},
    optimizeOpusSdp:s=>s,emitWithAcknowledgement:async()=>{},beginStreamRecovery(){throw Error('unexpected recovery');},
    socket:{on(name,fn){if(name==='webrtc_offer')handler=fn;}}};
  const start=student.indexOf('socket.on("webrtc_offer",');
  const end=student.indexOf('\nsocket.on(',start+1);
  vm.runInNewContext(student.slice(start,end),ctx);
  await handler({fromSocketId:'teacher',sdp:{type:'offer',sdp:'mock'}});
  assert.equal(rollbacks,1);assert.equal(closed,0);assert.equal(ctx.pc,pc);
});

test('Actual reception monitor detects frozen packet counters and respects muted publications', async () => {
  let now=0, callback, recovery=0, disconnected=0;
  const publication={isMuted:false,track:{async getRTCStatsReport(){return new Map([['audio',{type:'inbound-rtp',bytesReceived:100}]]);}}};
  const room={state:'connected',remoteParticipants:new Map([['teacher',{trackPublications:new Map([['audio',publication]])}]])};
  const ctx={studentSfuRoom:room,joinedClass:true,document:{visibilityState:'visible'},Date:{now:()=>now},
    setInterval(fn){callback=fn;return 1;},clearInterval(){},getSfuParticipantRole:()=> 'teacher',
    recordStudentDiagnosticEvent(){},notifySfuTransportStatus(value){assert.equal(value,false);},
    clearStaleSfuMedia(){},disconnectStudentSfu(){disconnected++;ctx.studentSfuRoom=null;},
    scheduleClassRecovery(){recovery++;}};
  vm.runInNewContext('let sfuReceptionMonitor=null;\n'+extract(student,'stopSfuReceptionMonitor')+'\n'
    +extract(student,'startSfuReceptionMonitor'),ctx);
  ctx.startSfuReceptionMonitor(room);await callback();
  publication.isMuted=true;now=30_000;await callback();assert.equal(recovery,0);
  publication.isMuted=false;now=31_000;await callback();
  now=52_000;await callback();assert.equal(recovery,1);assert.equal(disconnected,1);
});

test('Actual token grants and connected participant permissions follow server approval', async () => {
  let handler, grants, update;
  const router={get(){},post(_route,...handlers){handler=handlers.at(-1);}};
  const ctx={module:{exports:{}},process:{env:{NODE_ENV:'test'}},console:quiet,
    require(name){if(name==='crypto')return require('node:crypto');
      if(name==='express')return {Router:()=>router};
      if(name.includes('authMiddleware'))return {verifyToken(){}};
      if(name==='livekit-server-sdk')return {TrackSource:{MICROPHONE:2},AccessToken:class{
        addGrant(value){grants=value;}async toJwt(){return 'mock';}},
        RoomServiceClient:class{async updateParticipant(...args){
          if(args[2].permission.canPublish) await new Promise(resolve=>setTimeout(resolve,10));
          update=args;
        }}};
      throw Error('unused dependency');}};
  vm.runInNewContext(fs.readFileSync(path.join(root,'routes/webrtcRoutes.js'),'utf8'),ctx);
  let status=200;const res={status(code){status=code;return this;},json(){return this;}};
  const req={user:{id:'student',role:'student'},body:{roomName:'class',allowMic:true},query:{}};
  await handler(req,res);assert.equal(status,403,'Missing authorizer must deny access');
  router.setClassroomAuthorizer(async()=>true);router.setStudentMicChecker(()=>false);
  await handler(req,res);assert.equal(grants.canPublish,false);
  router.setStudentMicChecker(()=>true);await handler(req,res);assert.equal(grants.canPublish,true);
  assert.deepEqual(Array.from(grants.canPublishSources),[2]);
  await router.syncStudentMicrophonePermission('class','student',false);
  assert.equal(update[2].permission.canPublish,false);
  await router.syncStudentMicrophonePermission('class','student',true);
  assert.equal(update[2].permission.canPublish,true);
  await Promise.all([router.syncStudentMicrophonePermission('class','student',true),
    router.syncStudentMicrophonePermission('class','student',false)]);
  assert.equal(update[2].permission.canPublish,false,'A slow grant must not override a later revocation');
});

test('Actual classroom authorizer rejects wrong-level and unavailable-database access', async () => {
  let authorizer, fail=false;
  const record={id:'student',level:'4AM',liveAccessEnabled:true,mathEnrollment:true,accountActive:true};
  const src=fs.readFileSync(path.join(root,'server.js'),'utf8');
  const start=src.indexOf('if (typeof webrtcRoutes?.setClassroomAuthorizer');
  const end=src.indexOf('\nfunction clearClassroomChatHistory',start);
  const ctx={webrtcRoutes:{setClassroomAuthorizer(fn){authorizer=fn;}},isValidLevel:()=>true,
    GLOBAL_FREE_LEVEL:'FREE',UNIVERSITY_LEVEL:'UNIVERSITY',canonicalLevel:v=>v,
    activeTeachersByLevel:new Map([['4AM','t'],['3AM','t'],['FREE','t']]),
    activeSubjectByLevel:new Map([['4AM','MATH'],['3AM','MATH'],['FREE','FREE']]),
    pendingTeacherRecoveryByLevel:new Map(),io:{sockets:{sockets:new Map([['t',{}]])}},isInLevelRoom:()=>true,
    isPaidSubscription:()=>false,prisma:{student:{async findUnique(){if(fail)throw Error('database offline');return record;}}}};
  vm.runInNewContext(src.slice(start,end),ctx);
  assert.equal(await authorizer('4AM','student'),true);
  assert.equal(await authorizer('3AM','student'),false);
  assert.equal(await authorizer('FREE','student'),true);
  fail=true;assert.equal(await authorizer('4AM','student'),false);
});

test('Actual microphone renegotiation fetches TURN after the initial ICE request failed', async () => {
  let calls=0,configured=false;
  const pc={signalingState:'stable',setConfiguration(config){
    assert.equal(config.iceServers[0].urls,'turn:mock');configured=true;},
    async createOffer(){assert.equal(configured,true);return {type:'offer',sdp:'mock'};},
    async setLocalDescription(desc){this.localDescription=desc;this.signalingState='have-local-offer';}};
  const ctx={window:{},sessionStorage:{getItem:()=> 'mock-auth'},AbortController,setTimeout,clearTimeout,
    fetch:async()=>{if(++calls===1)throw Error('temporarily offline');return {ok:true,
      json:async()=>({iceServers:[{urls:'turn:mock'}],expiresAt:Math.floor(Date.now()/1000)+600})};},
    console:quiet,pc,rtcConfig:{},microphonePermissionGranted:true,
    localAudioStream:{getAudioTracks:()=>[{readyState:'live'}]},teacherSocketId:'teacher',
    microphoneOfferSent:false,microphoneNegotiated:false,isMakingRenegotiationOffer:false,
    RTCSessionDescription:class{constructor(desc){Object.assign(this,desc);}},
    optimizeOpusSdp:s=>s,emitWithAcknowledgement:async()=>{},setViewerStatus(){}};
  vm.runInNewContext(fs.readFileSync(path.join(root,'public/js/webrtc-ice.js'),'utf8'),ctx);
  await ctx.window.getMinasatyRtcConfig();
  vm.runInNewContext(extract(student,'negotiateStudentMicrophone'),ctx);
  await ctx.negotiateStudentMicrophone();
  assert.equal(calls,2);assert.equal(configured,true);assert.equal(ctx.microphoneOfferSent,true);
});
