'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createAPI}=require('../api.js');
function setup(){const m=new Map(),storage={getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)};let now=1700000000000;return {api:createAPI(storage,()=>now),storage,advance:n=>{now+=n;}};}
async function pack(api){return api.adminSave({title:'ARCADE TEST FIXTURE ONLY',published:true,questions:Array.from({length:7},(_,i)=>({prompt:'Test question '+i,answers:[{canonical:'Apple',aliases:['red apple'],tier:i===0?'councillion':'dino',explanation:i===0?'A test gem':''},{canonical:'Other accepted answer',aliases:[],tier:'grimkyle',explanation:''}]}))});}
async function finish(api,s){while(s.status!=='completed'){if(s.status==='between')s=await api.startQuestion(s.id);s=await api.answer(s.id,s.question.id,'Apple');}return api.getResults(s.id);}
test('invalid answer stays on the same prompt and deadline and lets a fresh valid guess lock once',async()=>{
 const {api,advance}=setup();const p=await pack(api);await api.enter('Player 🦃');let s=await api.begin(p.id);const deadline=s.deadline,q=s.question.id;
 advance(4000);s=await api.answer(s.id,q,'Not a valid fixture','invalid-id');
 assert.equal(s.status,'active');assert.equal(s.question.id,q);assert.equal(s.lockedCount,0);assert.equal(s.deadline,deadline);assert.equal(s.feedback.kind,'invalid');assert.equal(s.runScore,0);
 advance(2000);s=await api.answer(s.id,q,'appel','proposal-id');assert.equal(s.status,'active');assert.equal(s.feedback.kind,'suggestion');assert.equal(s.feedback.candidate,'Apple');assert.equal(s.deadline,deadline);assert.equal(s.lockedCount,0);s=await api.confirmAnswer(s.id,q,'appel','valid-id');assert.equal(s.status,'between');assert.equal(s.lockedCount,1);assert.equal(s.runScore,100);assert.equal(s.depth,1000);assert.equal(s.hasCouncillion,true);
 assert.equal(s.lastAnswer.canonical,'Apple');assert.equal(s.lastAnswer.rawAnswer,'appel');assert.equal(s.lastAnswer.explanation,'A test gem');assert.equal(s.history.length,1);assert.ok(!('answers' in s.lastAnswer));
 const retry=await api.answer(s.id,q,'Other accepted answer','valid-id');assert.equal(retry.runScore,100);assert.equal(retry.lockedCount,1);
});
test('uncertain guesses preserve the question and timer; a blank explicitly skips with zero',async()=>{
 const {api,advance}=setup();const p=await pack(api);await api.enter('Player');let s=await api.begin(p.id);const deadline=s.deadline;
 for(const [i,value] of ['unrelated','xxx'].entries()){advance(1000);s=await api.answer(s.id,s.question.id,value,'invalid'+i);assert.equal(s.deadline,deadline);assert.equal(s.lockedCount,0);assert.equal(s.feedback.kind,'invalid');}
 assert.equal((await api.getState(s.id)).feedback,undefined);assert.deepEqual(await api.leaderboard(),[]);s=await api.answer(s.id,s.question.id,'   ','blank');assert.equal(s.status,'between');assert.equal(s.lastAnswer.points,0);assert.equal(s.lastAnswer.rawAnswer,'');
});
test('invalid request retry is idempotent and cannot be reused with another spelling',async()=>{
 const {api}=setup();const p=await pack(api);await api.enter('Player');const s=await api.begin(p.id);
 await api.answer(s.id,s.question.id,'unrelated','same-request');await api.answer(s.id,s.question.id,'unrelated','same-request');
 await assert.rejects(api.answer(s.id,s.question.id,'Apple','same-request'),/fresh request/);
 const after=await api.answer(s.id,s.question.id,'Apple','fresh-request');assert.equal(after.lockedCount,1);
 await finish(api,after);const invalid=(await api.adminReviews()).filter(x=>x.type==='invalid_attempt');assert.equal(invalid.length,1);assert.equal(invalid[0].rawAnswer,'unrelated');assert.equal(invalid[0].actionable,false);assert.equal(invalid[0].submissionId,null);
});
test('deadline wins after invalid guesses; zero timeout locks without exposing other answers',async()=>{
 const {api,advance}=setup();const p=await pack(api);await api.enter('Player');let s=await api.begin(p.id);const q=s.question.id;
 await api.answer(s.id,q,'unrelated','invalid');advance(25000);s=await api.answer(s.id,q,'Apple','late');
 assert.equal(s.status,'between');assert.equal(s.lastAnswer.reviewStatus,'timeout');assert.equal(s.runScore,0);assert.equal(s.lastAnswer.canonical,null);assert.equal(s.lastAnswer.rawAnswer,'');assert.ok(!JSON.stringify(s).includes('Other accepted answer'));
 await assert.rejects(api.getResults(s.id),/seven/);
});
test('gold state persists through the next question and full answer lists still wait until completion',async()=>{
 const {api}=setup();const p=await pack(api);await api.enter('Player');let s=await api.begin(p.id);s=await api.answer(s.id,s.question.id,'Apple');s=await api.startQuestion(s.id);
 assert.equal(s.hasCouncillion,true);assert.equal(s.depth,1000);assert.equal(s.question.prompt,'Test question 1');assert.ok(!JSON.stringify(s).includes('Other accepted answer'));await assert.rejects(api.getResults(s.id),/seven/);
 const r=await finish(api,s);assert.equal(r.questions[0].answers.length,2);
});
test('emoji names and seven emoji leaderboard marks survive without accepting HTML or controls',async()=>{
 const {api}=setup();const p=await pack(api);const profile=await api.enter('Grim 🦃✨');assert.equal(profile.username,'Grim 🦃✨');await finish(api,await api.begin(p.id));
 const [row]=await api.leaderboard(p.id);assert.deepEqual(row.marks,['🟨','⬜','⬜','⬜','⬜','⬜','⬜']);assert.deepEqual(row.markTiers,['councillion','dino','dino','dino','dino','dino','dino']);
 const {api:other}=setup();await assert.rejects(other.enter('<script>'),/visible/);await assert.rejects(other.enter('Name\nNext'),/visible/);await assert.rejects(other.enter('A'),/visible/);await assert.rejects(other.enter('😀'.repeat(25)),/visible/);assert.equal((await other.enter('😀🦃')).username,'😀🦃');
});
test('invalid history is bounded per question while valid guesses remain usable afterward',async()=>{
 const {api,storage}=setup();const p=await pack(api);await api.enter('Player');let s=await api.begin(p.id);
 for(let i=0;i<110;i++)s=await api.answer(s.id,s.question.id,'unrelated','invalid-'+i);
 assert.equal(s.lockedCount,0);assert.equal(JSON.parse(storage.getItem('councillion.game.v1')).attempts[0].invalidGuesses.length,100);
 s=await api.answer(s.id,s.question.id,'Apple','valid-final');assert.equal(s.lockedCount,1);assert.equal(s.runScore,100);
});

test('confirming a proposal after the deadline scores zero; a random confirmation remains invalid',async()=>{
 const {api,advance}=setup();const p=await pack(api);await api.enter('Player');let s=await api.begin(p.id);const q=s.question.id;
 s=await api.answer(s.id,q,'appel','proposal');assert.equal(s.feedback.kind,'suggestion');
 s=await api.confirmAnswer(s.id,q,'something arbitrary','invalid-confirmation');assert.equal(s.feedback.kind,'invalid');assert.equal(s.feedback.message,'"something arbitrary" is invalid. Try again.');assert.equal(s.lockedCount,0);
 advance(25000);s=await api.confirmAnswer(s.id,q,'appel','late-confirmation');assert.equal(s.lastAnswer.points,0);assert.equal(s.lastAnswer.reviewStatus,'timeout');
});
test('authored aliases propose the canonical answer and require explicit confirmation',async()=>{
 const {api}=setup();const p=await pack(api);await api.enter('Player');let s=await api.begin(p.id);
 const deadline=s.deadline,q=s.question.id; s=await api.answer(s.id,q,'red apple');assert.equal(s.status,'active');assert.equal(s.feedback.kind,'suggestion');assert.equal(s.feedback.candidate,'Apple');assert.equal(s.lockedCount,0);assert.equal(s.deadline,deadline);s=await api.confirmAnswer(s.id,q,'red apple');assert.equal(s.status,'between');assert.equal(s.runScore,100);assert.equal(s.lastAnswer.rawAnswer,'red apple');
});
test('resuming consumes the interrupted question once; retry cannot consume the next question',async()=>{
 const {api,advance}=setup();const p=await pack(api);await api.enter('Player');const first=await api.begin(p.id);const q=first.question.id;
 advance(1000);const peek=await api.getState(first.id);assert.equal(peek.question.id,q);assert.equal(peek.deadline,first.deadline);
 let resumed=await api.resume(first.id,q);assert.equal(resumed.status,'active');assert.equal(resumed.lockedCount,1);assert.equal(resumed.lastAnswer.points,0);assert.notEqual(resumed.question.id,q);assert.equal(resumed.deadline,resumed.serverNow+25000);
 const retry=await api.resume(first.id,q);assert.equal(retry.question.id,resumed.question.id);assert.equal(retry.lockedCount,1);assert.equal(retry.deadline,resumed.deadline);
 resumed=await api.answer(resumed.id,resumed.question.id,'Apple');const next=await api.resume(resumed.id,null);assert.equal(next.lockedCount,2);assert.equal(next.status,'active');assert.equal((await api.resume(next.id,null)).lockedCount,2);
});
test('resuming the last interrupted question completes the run and preserves its first score',async()=>{
 const {api}=setup();const p=await pack(api);await api.enter('Player');let s=await api.begin(p.id);
 for(let i=0;i<6;i++){s=await api.answer(s.id,s.question.id,'Apple');s=await api.startQuestion(s.id);}
 s=await api.resume(s.id,s.question.id);assert.equal(s.status,'completed');assert.equal(s.lockedCount,7);const result=await api.getResults(s.id);assert.equal(result.total,150);assert.equal((await api.leaderboard(p.id))[0].score,150);
});
