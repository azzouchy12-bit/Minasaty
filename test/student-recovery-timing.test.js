const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('C:/MINASSATI/Minasaty-main (5)/Minasaty-main/public/js/student-live.js','utf8');
function fn(n){const m=source.match(new RegExp('^(?:async )?function '+n+'\\([^]*?^\\}','m'));assert.ok(m,n);return m[0];}
function fixture(){const notifications=[],delays=[],noop=()=>{};const ctx={studentSfuRoom:null,joinedClass:true,isJoining:false,microphonePermissionGranted:true,recoveryAttempts:0,
  elements:{joinButton:{},raiseHandButton:{}},window:{},Date:{now:()=>1000},notifySfuTransportStatus:r=>notifications.push(r),
  clearHandResetTimer:noop,stopSfuReceptionMonitor:noop,unpublishStudentSfuMic:noop,clearAllClassmateAudio:noop,clearStaleSfuMedia:noop,
  closePeerConnection:noop,resetRemoteMedia:noop,setButtonLabel:noop,updateChatControls:noop,setPlaceholder:noop,setViewerStatus:noop,showConnectionOverlay:noop,
  isStudentSfuHealthy:()=>false,scheduleClassRecovery:d=>delays.push(d),recordStudentDiagnosticEvent:noop,console:{info(){},warn(){}}};
 vm.runInNewContext('let studentSfuRecoveryHoldUntil=0;\n'+['disconnectStudentSfu','holdStudentSfuDuringRecovery','isStudentSfuRecoveryHeld','connectStudentSfu','beginStreamRecovery'].map(fn).join('\n'),ctx);
 return{ctx,notifications,delays};}
test('Forced refresh sends one fallback request after rejoin instead of two competing offer requests',async()=>{const f=fixture();f.ctx.holdStudentSfuDuringRecovery();f.ctx.beginStreamRecovery('refresh',{force:true});assert.deepEqual(f.notifications,[]);await f.ctx.connectStudentSfu('class');assert.deepEqual(f.notifications,[false]);assert.deepEqual(f.delays,[150]);});
test('Ordinary transport failure still notifies the teacher and keeps network retry backoff',()=>{const f=fixture();f.ctx.beginStreamRecovery('failure');assert.deepEqual(f.notifications,[false]);assert.deepEqual(f.delays,[1000]);});
test('Silent SFU cleanup does not erase the temporary recovery hold',()=>{const f=fixture();f.ctx.holdStudentSfuDuringRecovery();f.ctx.disconnectStudentSfu({notify:false});assert.equal(f.ctx.isStudentSfuRecoveryHeld(),true);assert.deepEqual(f.notifications,[]);});
test('Normal SFU disconnection still sends missing-media notification',()=>{const f=fixture();f.ctx.disconnectStudentSfu();assert.deepEqual(f.notifications,[false]);});
