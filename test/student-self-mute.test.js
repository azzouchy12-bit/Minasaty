const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..'),student=fs.readFileSync(path.join(root,'public/js/student-live.js'),'utf8'),server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const extract=name=>student.match(new RegExp('^(?:async )?function '+name+'\\([^]*?^\\}','m'))[0];
function serverFixture(role='student') {
 let handler,open=true;const emitted=[],ack=[],changes=[],records=[];
 const socket={id:'self',data:{role,roomLevel:'level',studentId:'student',micStartedAt:Date.now()-20000},rooms:new Set(['level']),
   on(_name,fn){handler=fn},emit:(...args)=>emitted.push(['self',...args])};
 const ctx={socket,console,Date,isValidLevel:l=>l==='level',isInLevelRoom:(s,l)=>s.rooms.has(l),
  emitClassroomError(){ack.push({ok:false})},acknowledge:(_cb,result)=>ack.push(result),
  setStudentMicrophoneOpen:(_l,id,value,studentId)=>{changes.push({id,value,studentId});open=value},isStudentMicrophoneOpen:()=>open,
  webrtcRoutes:{syncStudentMicrophonePermission:async(l,id,value)=>changes.push({l,id,value})},
  recordClassParticipation:async data=>records.push(data),activeSubjectByLevel:new Map([['level','math']]),
  activeTeachersByLevel:new Map([['level','teacher']]),activeCompanionsByLevel:new Map([['level',new Set(['companion'])]]),
  io:{sockets:{sockets:new Map([['teacher',{data:{classResumeToken:'session'}}]])},to:id=>({emit:(...args)=>emitted.push([id,...args])})}};
 const start=server.indexOf('  socket.on("student_close_mic",'),end=server.indexOf('  socket.on("teacher_set_mic",',start);
 vm.runInNewContext(server.slice(start,end),ctx);return {ctx,socket,emitted,ack,changes,records,handler};
}
test('Student self-close revokes only its own mic and informs teacher, companions and room',async()=>{
 const f=serverFixture();await f.handler({targetSocketId:'victim',enabled:true},()=>{});
 assert.equal(f.ack[0].ok,true);assert.equal(f.changes[0].id,'self');assert.equal(f.changes[0].value,false);
 assert.equal(f.changes[1].id,'student');assert.equal(f.changes[1].value,false);
 assert.ok(f.emitted.some(e=>e[0]==='teacher'&&e[1]==='student_mic_state_changed'&&e[2].enabled===false));
 assert.ok(f.emitted.some(e=>e[0]==='companion'));assert.equal(f.records[0].sessionKey,'session');
});
test('Self-close rejects non-students and callers outside their classroom',async()=>{
 const teacher=serverFixture('teacher');await teacher.handler({},()=>{});assert.equal(teacher.changes.length,0);
 const outside=serverFixture();outside.socket.rooms.clear();await outside.handler({},()=>{});assert.equal(outside.changes.length,0);
});
test('Delayed self-close does not override a newer teacher microphone approval',async()=>{
 const f=serverFixture();f.ctx.isStudentMicrophoneOpen=()=>true;await f.handler({},()=>{});
 assert.equal(f.ack[0].superseded,true);assert.equal(f.emitted.length,0);
});
test('Close button stops both send paths while preserving teacher reception and requests only self-close',async()=>{
 const outgoing={stop(){this.stopped=true}},incoming={readyState:'live'},calls=[];
 const ctx={joinedClass:true,microphonePermissionGranted:true,studentMicrophoneSelfClosed:false,
  localAudioStream:{getTracks:()=>[outgoing]},unpublishStudentSfuMic:()=>calls.push('sfu'),unpublishStudentP2pMic:()=>calls.push('p2p'),
  updateMicControl(){},clearHandResetTimer(){},setRaisedHandState(){},showMobileControlToast(){},setViewerStatus(){},
  ensureTeacherAudioPlayback:async()=>{calls.push('teacher');assert.equal(incoming.readyState,'live')},
  emitWithAcknowledgement:async(name,payload)=>{assert.equal(name,'student_close_mic');assert.equal(Object.keys(payload).length,0);return {ok:true}}};
 vm.createContext(ctx);vm.runInContext(extract('stopLocalAudio')+'\n'+extract('closeOwnMicrophone'),ctx);
 await ctx.closeOwnMicrophone();assert.equal(outgoing.stopped,true);assert.equal(ctx.microphonePermissionGranted,false);
 assert.equal(ctx.studentMicrophoneSelfClosed,true);assert.deepEqual(calls,['sfu','p2p','teacher']);
});
test('Clicking active mic closes it; clicking a closed mic only requests teacher permission',()=>{
 let closed=0,raised=0;const ctx={microphonePermissionGranted:true,closeOwnMicrophone(){closed++},raiseHand(){raised++},lowerHand(){},
 elements:{raiseHandButton:{classList:{contains:()=>false}}}};
 vm.runInNewContext(extract('toggleRaisedHand'),ctx);ctx.toggleRaisedHand();assert.equal(closed,1);assert.equal(raised,0);
 ctx.microphonePermissionGranted=false;ctx.toggleRaisedHand();assert.equal(raised,1);
});
