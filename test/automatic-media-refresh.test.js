const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('C:/MINASSATI/Minasaty-main (5)/Minasaty-main/public/js/student-live.js', 'utf8');
function fn(name) { const match = source.match(new RegExp('^function ' + name + '\\([^]*?^\\}', 'm')); assert.ok(match, name); return match[0]; }
function fixture() {
  let now = 0; const calls = [];
  const state = {missingSince:null,lastAttempt:null,attempts:0};
  const ctx = {automaticMediaRefreshState:state, joinedClass:true, screenShareActive:true,
    document:{visibilityState:'visible'}, teacherSfuPlaybackTracks:new Map(), isJoining:false,
    isRecoveringStream:false, socket:{connected:true}, elements:{remoteVideo:{readyState:0,videoWidth:0,paused:true},refreshMediaButton:{disabled:false}},
    Date:{now:()=>now}, refreshAudioVideo:options=>calls.push(options)};
  vm.runInNewContext(fn('checkAutomaticMediaRefresh'),ctx);
  return {ctx,state,calls,tick(time){now=time;ctx.checkAutomaticMediaRefresh();}};
}
test('Late student automatically requests the same audio/video refresh after missing screen grace period',()=>{
  const f=fixture(); f.tick(0); f.tick(1999); assert.equal(f.calls.length,0); f.tick(2000);
  assert.equal(f.calls.length,1); assert.equal(f.calls[0].automatic,true);
});
test('Attached but undecoded screen is not mistaken for delivered video',()=>{
  const f=fixture(); f.ctx.elements.remoteVideo.srcObject={getVideoTracks:()=>[{readyState:'live',muted:false}]};
  f.tick(0); f.tick(2000); assert.equal(f.calls.length,1);
});
test('Healthy rendered screen is never automatically rebuilt and resets retry budget',()=>{
  const f=fixture(); Object.assign(f.ctx.elements.remoteVideo,{srcObject:{getVideoTracks:()=>[{readyState:'live',muted:false}]},readyState:2,videoWidth:1280,paused:false});
  f.state.attempts=3; f.tick(0); f.tick(60000); assert.equal(f.calls.length,0); assert.equal(f.state.attempts,0);
});
test('Automatic refresh has cooldown and finite retries during a persistent outage',()=>{
  const f=fixture(); f.tick(0); f.tick(2000); f.tick(3000); assert.equal(f.calls.length,1);
  f.tick(6000); f.tick(10000); f.tick(14000); assert.equal(f.calls.length,3);
});
test('Hidden page, inactive screen and deliberate adaptive pause do not trigger refresh',()=>{
  for (const setup of [f=>f.ctx.document.visibilityState='hidden',f=>f.ctx.screenShareActive=false,
    f=>f.ctx.teacherSfuPlaybackTracks.set('video',{streamState:'paused'})]) {
    const f=fixture(); setup(f); f.tick(0); f.tick(60000); assert.equal(f.calls.length,0);
  }
});
test('A disconnected socket or recovery in progress cannot start an overlapping refresh',()=>{
  for (const setup of [f=>f.ctx.socket.connected=false,f=>f.ctx.isJoining=true,f=>f.ctx.isRecoveringStream=true,f=>f.ctx.elements.refreshMediaButton.disabled=true]) {
    const f=fixture(); f.tick(0); setup(f); f.tick(60000); assert.equal(f.calls.length,0);
  }
});
test('Leaving class resets the automatic retry state for the next class',()=>{
  const f=fixture(); f.tick(0); f.tick(2000); f.ctx.joinedClass=false; f.tick(10000);
  assert.equal(f.state.attempts,0); assert.equal(f.state.lastAttempt,null);
});
test('Refresh explicitly forces failed media rebuild even when SFU tracks are still present',()=>{
  const calls=[]; const ctx={joinedClass:true,isJoining:false,isRecoveringStream:false,socket:{connected:true},elements:{},
    showMobileControlToast(){},recordStudentDiagnosticEvent(){},beginStreamRecovery:(m,o)=>calls.push(o),window:{setTimeout:cb=>cb()}};
  vm.runInNewContext(fn('refreshAudioVideo'),ctx); ctx.refreshAudioVideo({automatic:true});
  assert.equal(calls.length,1); assert.equal(calls[0].force,true);
});
