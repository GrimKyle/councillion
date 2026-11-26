'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createAPI}=require('../api.js');
function setup(){const map=new Map(),storage={getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,String(v)),removeItem:k=>map.delete(k)};let now=1700000000000;return {api:createAPI(storage,()=>now),storage,advance:n=>now+=n};}
async function pack(api,title='LAUNCH FIXTURE'){return api.adminSave({title,published:true,questions:Array.from({length:7},(_,i)=>({prompt:'Fixture '+i,answers:[{canonical:'Apple',aliases:['red apple'],tier:'dino',explanation:''}]}))});}
async function finish(api,state){while(state.status!=='completed'){if(state.status==='between')state=await api.startQuestion(state.id);state=await api.answer(state.id,state.question.id,'Apple');}return api.getResults(state.id);}

test('deleting a completed score removes both boards and percentages while preserving the first-run slot',async()=>{
 const {api,storage}=setup(),p=await pack(api);await api.enter('First');const first=await finish(api,await api.begin(p.id));
 storage.removeItem('councillion.player.v1');await api.enter('Second');const second=await finish(api,await api.begin(p.id));
 assert.equal((await api.leaderboard(p.id)).length,2);await api.adminDeleteScore(first.attemptId,'Cheating');
 const board=await api.leaderboard(p.id);assert.equal(board.length,1);assert.equal(board[0].username,'Second');assert.equal(board[0].rank,1);assert.equal((await api.leaderboard()).length,1);
 assert.equal((await api.listPacks())[0].completedCount,1);const result=await api.getResults(second.attemptId);assert.equal(result.questions[0].popularity.total,1);assert.equal(result.questions[0].popularity.count,1);
 const data=JSON.parse(storage.getItem('councillion.game.v1')),firstPlayer=data.attempts.find(a=>a.id===first.attemptId).playerId;storage.setItem('councillion.player.v1',firstPlayer);
 const retry=await api.begin(p.id);assert.equal(retry.id,first.attemptId);assert.equal(retry.scoreStatus,'removed');assert.equal(retry.isOfficial,false);
 const removed=await api.getResults(first.attemptId);assert.equal(removed.total,70);assert.equal(removed.scoreStatus,'removed');assert.equal(removed.isOfficial,false);
 await finish(api,await api.practice(p.id));assert.equal((await api.leaderboard(p.id)).length,1);
 await api.adminDeleteScore(first.attemptId,'Retry');assert.equal(JSON.parse(storage.getItem('councillion.game.v1')).audit.filter(a=>a.action==='score_removed').length,1);
});
test('a Game Master can practice before any official run and never changes public totals or percentages',async()=>{
 const {api}=setup(),p=await pack(api);const host=await api.adminLogin('','');assert.equal(host.isAdmin,true);
 const state=await api.begin(p.id);assert.equal(state.isOfficial,false);assert.equal(state.isGameMaster,true);assert.equal((await api.begin(p.id)).id,state.id);
 const result=await finish(api,state);assert.equal(result.isOfficial,false);assert.equal(result.isGameMaster,true);assert.equal(result.officialAttemptId,null);assert.equal(result.questions[0].popularity.total,0);
 assert.deepEqual(await api.leaderboard(),[]);assert.equal((await api.listPacks())[0].completedCount,0);
 const next=await api.begin(p.id);assert.notEqual(next.id,state.id);assert.equal(next.isOfficial,false);
 assert.equal((await api.practice(p.id)).isOfficial,false);
});
test('existing Game Master first runs become practice and stay out after signing out locally',async()=>{
 const {api}=setup(),p=await pack(api);await api.enter('Owner');const before=await finish(api,await api.begin(p.id));assert.equal(before.isOfficial,true);
 await api.adminLogin('','');assert.deepEqual(await api.leaderboard(),[]);assert.equal((await api.getResults(before.attemptId)).isOfficial,false);
 await api.adminLogout();assert.equal((await api.begin(p.id)).isOfficial,false);
});
test('aliases remain proposals on repeated submit; only explicit confirmation locks, preserving raw input and deadline',async()=>{
 const {api,advance}=setup(),p=await pack(api);await api.enter('Player');const state=await api.begin(p.id),q=state.question.id;
 for(let i=0;i<2;i++){advance(1000);const proposal=await api.answer(state.id,q,'red apple');assert.equal(proposal.feedback.candidate,'Apple');assert.equal(proposal.lockedCount,0);assert.equal(proposal.deadline,state.deadline);}
 const locked=await api.confirmAnswer(state.id,q,'red apple');assert.equal(locked.lastAnswer.rawAnswer,'red apple');assert.equal(locked.lastAnswer.canonical,'Apple');assert.equal(locked.lockedCount,1);
});
test('confirmation after the original deadline expires scores zero even for an exact alias',async()=>{
 const {api,advance}=setup(),p=await pack(api);await api.enter('Player');let state=await api.begin(p.id);const q=state.question.id;
 state=await api.answer(state.id,q,'red apple');advance(25001);state=await api.confirmAnswer(state.id,q,'red apple');assert.equal(state.lastAnswer.points,0);assert.equal(state.lastAnswer.reviewStatus,'timeout');
});
test('remote score controls use authenticated admin RPCs and relay server permission errors',async()=>{
 const {storage}=setup(),calls=[];storage.setItem('councillion.connection.v1',JSON.stringify({url:'https://example.supabase.co',key:'sb_publishable_fixture'}));storage.setItem('councillion.admin.session.v1',JSON.stringify({access_token:'fixture',expires_at:9999999999}));
 const api=createAPI(storage,Date.now,async(url,opts)=>{calls.push({url,opts});return {ok:false,json:async()=>({message:'Game Master access required.'})};});
 await assert.rejects(api.adminDeleteScore('fixture-attempt','Cheating'),/Game Master access required/);
 assert.match(calls[0].url,/council_admin_delete_score$/);assert.deepEqual(JSON.parse(calls[0].opts.body),{p_attempt_id:'fixture-attempt',p_reason:'Cheating'});assert.equal(calls[0].opts.headers.Authorization,'Bearer fixture');
});
