const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const root = require('node:path').join(__dirname, '..');
const student = fs.readFileSync(root+'/public/js/student-live.js','utf8');
const teacher = fs.readFileSync(root+'/public/js/teacher-live-v2.js','utf8');
function fn(source,name) { const m=source.match(new RegExp('(?:async )?function '+name+'\\([^]*?^\\}', 'm')); assert.ok(m,name); return m[0]; }
const quiet={info(){},warn(){},error(){},debug(){}};
class Track {
  constructor(id,kind='audio'){this.id=id;this.kind=kind;this.readyState='live';this.enabled=true;this.listeners={};}
  addEventListener(name,handler){(this.listeners[name] ||= []).push(handler);}
  stop(){this.readyState='ended';}
  end(){this.readyState='ended';for(const cb of this.listeners.ended||[])cb();}
}
class Stream {
  constructor(tracks=[]){this.tracks=[...tracks];}
  getTracks(){return [...this.tracks];}
  getAudioTracks(){return this.tracks.filter(t=>t.kind==='audio');}
  getVideoTracks(){return this.tracks.filter(t=>t.kind==='video');}
  addTrack(t){this.tracks.push(t);}
  removeTrack(t){this.tracks=this.tracks.filter(x=>x!==t);}
}
function audio(){return {muted:false,volume:1,paused:true,srcObject:null,plays:0,style:{},async play(){this.plays++;this.paused=false;},pause(){},remove(){}};}
function playbackContext(){
  const ctx={teacherAudioElement:audio(),teacherAudioStream:null,teacherInboundAudioTrack:null,
    remoteMediaStream:null,MediaStream:Stream,console:quiet,elements:{remoteVideo:audio()},
    syncClassmateSfuAudioPlayback(){},clearRecoveryTimer(){},updateChatControls(){},setViewerStatus(){},
    updateRemoteVideoPresentation(){},updateRemoteAudioControl(){},recordStudentDiagnosticEvent(){},
    screenShareActive:false,isAttemptingTeacherAudio:false};
  vm.runInNewContext(['getTeacherAudioElement','playTeacherInboundAudio','addUniqueTrack','attachTeacherTrack','startTeacherAudio'].map(n=>fn(student,n)).join('\n'),ctx);
  return ctx;
}
test('Teacher track plays through dedicated audio while the video stays muted',async()=>{
  const ctx=playbackContext(),track=new Track('teacher');ctx.attachTeacherTrack({track});await Promise.resolve();
  assert.equal(ctx.teacherAudioElement.srcObject.getAudioTracks()[0],track);
  assert.equal(ctx.elements.remoteVideo.srcObject.getAudioTracks()[0],track);
  assert.equal(ctx.teacherAudioElement.muted,false);assert.equal(ctx.elements.remoteVideo.muted,true);
  assert.ok(ctx.teacherAudioElement.plays>0);assert.ok(ctx.elements.remoteVideo.plays>0);
});
test('Late P2P audio cannot replace the selected SFU audio or revive on unmute',()=>{
  const ctx=playbackContext(),sfu=new Track('sfu');sfu.__fromSfu=true;ctx.attachTeacherTrack({track:sfu});
  const p2p=new Track('p2p');ctx.attachTeacherTrack({track:p2p});
  assert.equal(ctx.remoteMediaStream.getAudioTracks()[0],sfu);
  assert.equal(ctx.teacherAudioStream.getAudioTracks()[0],sfu);
  for(const cb of p2p.listeners.unmute||[])cb();
  assert.equal(ctx.teacherAudioStream.getAudioTracks()[0],sfu);
});
test('Mic approval revoked during permission prompt prevents publication and stops capture',async()=>{
  let resolve,published=0;
  const ctx={microphonePermissionGranted:true,isRequestingMicrophone:false,localAudioStream:null,
    isStudentSfuConnected:()=>true,joinedClass:true,navigator:{mediaDevices:{getUserMedia:()=>new Promise(r=>{resolve=r;})}},
    unpublishStudentSfuMic(){},unpublishStudentP2pMic(){},updateMicControl(){},ensureTeacherAudioPlayback:async()=>{},setViewerStatus(){},setRaisedHandState(){},console:quiet,
    publishStudentSfuMic:async()=>{published++;return true;}};
  vm.runInNewContext(fn(student,'stopLocalAudio')+'\n'+fn(student,'enableApprovedMicrophone'),ctx);
  const pending=ctx.enableApprovedMicrophone();ctx.microphonePermissionGranted=false;
  const track=new Track('mic');resolve(new Stream([track]));await pending;
  assert.equal(published,0);assert.equal(track.readyState,'ended');assert.equal(ctx.microphonePermissionGranted,false);
});
test('Delayed end and unsubscribe preserve the replacement SFU microphone and recording source',()=>{
  const ctx={sfuStudentAudioElements:new Map(),sfuStudentAudioStreams:new Map(),MediaStream:Stream,
    document:{createElement:audio,body:{appendChild(){}}},console:quiet,syncLocalRecordingAudioSources(){}};
  vm.runInNewContext(['attachSfuStudentAudio','removeSfuStudentAudio'].map(n=>fn(teacher,n)).join('\n'),ctx);
  const old=new Track('old'),current=new Track('new');ctx.attachSfuStudentAudio('student',old);ctx.attachSfuStudentAudio('student',current);
  assert.equal(ctx.sfuStudentAudioStreams.get('student').track,current);old.end();
  assert.equal(ctx.sfuStudentAudioStreams.get('student').track,current);
  ctx.removeSfuStudentAudio('student',{mediaStreamTrack:old});
  assert.equal(ctx.sfuStudentAudioStreams.get('student').track,current);
  current.end();assert.equal(ctx.sfuStudentAudioStreams.has('student'),false);
});
test('Reception watchdog detects stalled audio despite continuing video packets',async()=>{
  let callback,now=0,recovery=0,videoBytes=0;
  const report=bytes=>({isMuted:false,track:{async getRTCStatsReport(){return new Map([['r',{type:'inbound-rtp',bytesReceived:bytes()}]]);}}});
  const room={state:'connected',remoteParticipants:new Map([['teacher',{trackPublications:new Map([['audio',report(()=>100)],['video',report(()=>videoBytes)]])}]])};
  const ctx={studentSfuRoom:room,joinedClass:true,document:{visibilityState:'visible'},Date:{now:()=>now},
    setInterval(cb){callback=cb;return 1;},clearInterval(){},getSfuParticipantRole:()=> 'teacher',
    recordStudentDiagnosticEvent(){},notifySfuTransportStatus(){},clearStaleSfuMedia(){},disconnectStudentSfu(){},scheduleClassRecovery(){recovery++;}};
  vm.runInNewContext('let sfuReceptionMonitor=null;\n'+fn(student,'stopSfuReceptionMonitor')+'\n'+fn(student,'startSfuReceptionMonitor'),ctx);
  ctx.startSfuReceptionMonitor(room);await callback();
  for(let i=0;i<10;i++){now+=4000;videoBytes+=1000;await callback();}
  assert.ok(recovery>0);
});


test('Watchdog respects adaptive pauses and browsers without usable stats',async()=>{
  let callback,now=0,recovery=0;
  const unsupported={isMuted:false,track:{kind:'audio'}};
  const paused={isMuted:false,track:{streamState:'paused',async getRTCStatsReport(){throw Error('must not read paused video');}}};
  const room={state:'connected',remoteParticipants:new Map([['teacher',{trackPublications:new Map([['audio',unsupported],['video',paused]])}]])};
  const ctx={studentSfuRoom:room,joinedClass:true,document:{visibilityState:'visible'},Date:{now:()=>now},
    setInterval(cb){callback=cb;return 1;},clearInterval(){},getSfuParticipantRole:()=> 'teacher',
    recordStudentDiagnosticEvent(){},notifySfuTransportStatus(){},clearStaleSfuMedia(){},disconnectStudentSfu(){},scheduleClassRecovery(){recovery++;}};
  vm.runInNewContext('let sfuReceptionMonitor=null;\n'+fn(student,'stopSfuReceptionMonitor')+'\n'+fn(student,'startSfuReceptionMonitor'),ctx);
  ctx.startSfuReceptionMonitor(room);await callback();now=30000;await callback();assert.equal(recovery,0);
});

test('SFU mic publication revoked in flight is removed without stopping the reusable local track',async()=>{
  let release,removed=0;
  const track=new Track('mic');
  const room={state:'connected',localParticipant:{publishTrack:()=>new Promise(resolve=>{release=resolve;}),
    async unpublishTrack(value,stop){assert.equal(value,track);assert.equal(stop,false);removed++;}}};
  const ctx={studentSfuRoom:room,studentSfuMicPub:null,isStudentMicSyncing:false,
    microphonePermissionGranted:true,joinedClass:true,isStudentSfuConnected:()=>true,
    window:{},console:quiet,recordStudentDiagnosticEvent(){}};
  vm.runInNewContext(fn(student,'publishStudentSfuMic'),ctx);
  const task=ctx.publishStudentSfuMic(new Stream([track]));ctx.microphonePermissionGranted=false;track.enabled=false;
  release({track});assert.equal(await task,false);assert.equal(removed,1);
  assert.equal(ctx.studentSfuMicPub,null);assert.equal(track.readyState,'live');
});


test('Native video volume changes cannot create a second teacher audio output',()=>{
  const ctx=playbackContext();ctx.elements.remoteVideo.muted=false;
  vm.runInNewContext(fn(student,'updateRemoteAudioControl'),ctx);
  ctx.updateRemoteAudioControl();assert.equal(ctx.elements.remoteVideo.muted,true);
  assert.equal(ctx.teacherAudioElement.muted,false);
});
