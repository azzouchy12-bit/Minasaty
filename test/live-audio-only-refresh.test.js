const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/js/student-live.js'),'utf8');
const refresh=source.match(/^async function refreshClassroomAudioOnly\([^]*?^\}/m)[0];
function fixture() {
  const calls={teacher:[],classmates:0,blocked:0};
  const p2p={id:'p2p',readyState:'live',enabled:true,muted:false};
  const sfu={id:'sfu',readyState:'live',enabled:true,muted:false,__fromSfu:true};
  const audio={muted:false,srcObject:{getAudioTracks:()=>[sfu]},play:async()=>{calls.classmates++}};
  const ctx={joinedClass:true,remoteMediaStream:{getAudioTracks:()=>[p2p,sfu]},teacherInboundAudioTrack:p2p,
    classmateAudioElements:new Map([['other',audio]]),playTeacherInboundAudio:track=>calls.teacher.push(track),
    ensureTeacherAudioPlayback:async()=>({ok:true}),syncClassmateSfuAudioPlayback(){},
    armAutoUnmuteOnFirstInteraction(){calls.blocked++},recordStudentDiagnosticEvent(){}};
  for(const name of ['beginStreamRecovery','createViewerPeerConnection','disconnectStudentSfu','enableApprovedMicrophone'])
    ctx[name]=()=>{throw Error('Audio refresh must not change transport or capture')};
  Object.defineProperty(ctx,'elements',{get(){throw Error('Audio refresh must not touch video controls')}});
  vm.createContext(ctx);vm.runInContext(refresh,ctx);
  return {ctx,calls,p2p,sfu,audio};
}
test('Audio-only refresh selects live SFU teacher audio and resumes classmates without video or reconnect',async()=>{
  const {ctx,calls,sfu}=fixture();assert.equal((await ctx.refreshClassroomAudioOnly()).ok,true);
  assert.equal(calls.teacher[0],sfu);assert.equal(calls.classmates,1);
});
test('Audio refresh preserves muted classmates and uses healthy P2P when SFU track is muted',async()=>{
  const {ctx,calls,p2p,sfu,audio}=fixture();sfu.muted=true;audio.muted=true;
  assert.equal((await ctx.refreshClassroomAudioOnly()).ok,true);
  assert.equal(calls.teacher[0],p2p);assert.equal(calls.classmates,0);assert.equal(audio.muted,true);
});
test('Audio-only refresh respects joined state and browser autoplay refusal',async()=>{
  const {ctx,calls,audio}=fixture();ctx.joinedClass=false;
  assert.equal((await ctx.refreshClassroomAudioOnly()).ok,false);assert.equal(calls.teacher.length,0);
  ctx.joinedClass=true;audio.play=async()=>{throw Error('Autoplay blocked')};
  assert.equal((await ctx.refreshClassroomAudioOnly()).ok,false);assert.equal(calls.blocked,1);
});
test('Simultaneous audio refresh requests share the same playback operation',async()=>{
  const {ctx,calls}=fixture();let release;ctx.ensureTeacherAudioPlayback=()=>new Promise(resolve=>{release=resolve});
  const first=ctx.refreshClassroomAudioOnly(),second=ctx.refreshClassroomAudioOnly();
  assert.equal(calls.teacher.length,1);release({ok:true});await Promise.all([first,second]);
  assert.equal(calls.classmates,1);assert.equal(ctx.refreshClassroomAudioOnly.pendingPromise,null);
});
test('Authoritative mic-open room event refreshes audio on each joined viewer, but closing does not',()=>{
  let handler,refreshes=0;const ctx={joinedClass:true,setViewerStatus(){},refreshClassroomAudioOnly(){refreshes++},
    socket:{on(name,fn){assert.equal(name,'classroom_track_state');handler=fn}}};
  const start=source.indexOf('socket.on("classroom_track_state",');
  const end=source.indexOf('\nsocket.on(',start+1);vm.runInNewContext(source.slice(start,end),ctx);
  handler({type:'student_audio',enabled:true});assert.equal(refreshes,1);
  handler({type:'student_audio',enabled:false});handler({type:'screen',enabled:true});assert.equal(refreshes,1);
  ctx.joinedClass=false;handler({type:'student_audio',enabled:true});assert.equal(refreshes,1);
});
