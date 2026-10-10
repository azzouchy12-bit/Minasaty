const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('C:/MINASSATI/Minasaty-main (5)/Minasaty-main/public/js/student-live.js','utf8');
function fn(n){const m=source.match(new RegExp('^(?:async )?function '+n+'\\([^]*?^\\}','m'));assert.ok(m,n);return m[0];}
function fixture(){let now=1000;const notifications=[],events=[];let tokenRequests=0;
 const ctx={Date:{now:()=>now},window:{fetchMinasatySfuToken:async()=>{tokenRequests++;throw Error('should not request a token while held');},LivekitClient:{Room:class{}}},
  notifySfuTransportStatus:r=>notifications.push(r),recordStudentDiagnosticEvent:e=>events.push(e),console:{info(){},warn(){}}};
 vm.runInNewContext('let studentSfuRecoveryHoldUntil=0;\n'+['holdStudentSfuDuringRecovery','isStudentSfuRecoveryHeld','connectStudentSfu'].map(fn).join('\n'),ctx);
 return{ctx,events,notifications,setTime:n=>now=n,get tokenRequests(){return tokenRequests;}};
}
test('Recovery holds competing LiveKit startup before token request and requests targeted fallback',async()=>{const f=fixture();f.ctx.holdStudentSfuDuringRecovery();assert.equal(await f.ctx.connectStudentSfu('class'),false);assert.equal(f.tokenRequests,0);assert.deepEqual(f.notifications,[false]);assert.ok(f.events.includes('sfu_recovery_held'));});
test('Repeated room join events during peer recovery cannot restart LiveKit',async()=>{const f=fixture();f.ctx.holdStudentSfuDuringRecovery();await f.ctx.connectStudentSfu('class');f.setTime(20000);await f.ctx.connectStudentSfu('class');assert.equal(f.tokenRequests,0);assert.deepEqual(f.notifications,[false,false]);});
test('Recovery preference expires and does not permanently disable LiveKit',()=>{const f=fixture();assert.equal(f.ctx.isStudentSfuRecoveryHeld(),false);f.ctx.holdStudentSfuDuringRecovery();f.setTime(45999);assert.equal(f.ctx.isStudentSfuRecoveryHeld(),true);f.setTime(46000);assert.equal(f.ctx.isStudentSfuRecoveryHeld(),false);});
test('Manual and automatic refresh set fallback preference before rebuilding the media connection',()=>{for(const automatic of [false,true]){const f=fixture();Object.assign(f.ctx,{joinedClass:true,isJoining:false,isRecoveringStream:false,socket:{connected:true},elements:{},showMobileControlToast(){},window:{setTimeout:cb=>cb()},beginStreamRecovery(){assert.equal(f.ctx.isStudentSfuRecoveryHeld(),true);}});vm.runInNewContext(fn('refreshAudioVideo'),f.ctx);f.ctx.refreshAudioVideo({automatic});assert.equal(f.ctx.isStudentSfuRecoveryHeld(),true);}});
