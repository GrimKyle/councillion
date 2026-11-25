'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createAPI}=require('../api.js');
function setup(){const m=new Map();const storage={getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)};return {api:createAPI(storage),storage};}
function fixture(){return {title:'PACK MANAGEMENT TEST ONLY',published:false,questions:Array.from({length:7},(_,i)=>({prompt:'Fixture '+i,answers:[{canonical:'Fixture answer',tier:'dino',aliases:[],explanation:''}]}))};}
async function complete(api,s){while(s.status!=='completed'){if(s.status==='between')s=await api.startQuestion(s.id);s=await api.answer(s.id,s.question.id,'Fixture answer');}return api.getResults(s.id);}
test('create privately, validate exactly seven questions, publish and hide directly',async()=>{
 const {api}=setup();const draft=fixture();draft.questions.pop();const p=await api.adminSave(draft);
 assert.equal((await api.listPacks()).length,0);assert.equal((await api.adminList()).length,1);
 await assert.rejects(api.adminVisibility(p.id,true),/seven/);
 const full=await api.adminSave({...p,questions:fixture().questions});await api.adminVisibility(full.id,true);
 assert.equal((await api.listPacks()).length,1);await api.adminVisibility(full.id,false);assert.equal((await api.listPacks()).length,0);
 assert.equal((await api.adminGet(full.id)).published,false);
});
test('private blocks direct starts, resumed questions and submissions until republished',async()=>{
 const {api}=setup();const p=await api.adminSave({...fixture(),published:true});await api.enter('Player');const s=await api.begin(p.id);
 await api.adminVisibility(p.id,false);
 await assert.rejects(api.begin(p.id),/private/);await assert.rejects(api.getState(s.id),/private/);
 await assert.rejects(api.startQuestion(s.id),/private/);await assert.rejects(api.answer(s.id,s.question.id,'Fixture answer'),/private/);
 await api.adminVisibility(p.id,true);const resumed=await api.begin(p.id);assert.equal(resumed.id,s.id);assert.equal(resumed.deadline,s.deadline);
});
test('delete removes public and admin listings, blocks play and retains completed results and score history',async()=>{
 const {api,storage}=setup();const p=await api.adminSave({...fixture(),published:true});await api.enter('Finished');const r=await complete(api,await api.begin(p.id));const board=await api.leaderboard();
 storage.removeItem('councillion.player.v1');await api.enter('Active');const active=await api.begin(p.id);
 await api.adminDelete(p.id);assert.equal((await api.listPacks()).length,0);assert.equal((await api.adminList()).length,0);
 await assert.rejects(api.begin(p.id),/private|deleted/);await assert.rejects(api.getState(active.id),/private|deleted/);
 await assert.rejects(api.practice(p.id),/not open/);await assert.rejects(api.adminGet(p.id),/not found/);
 await assert.rejects(api.adminSave(p),/deleted/);await assert.rejects(api.adminVisibility(p.id,true),/not found/);
 assert.deepEqual(await api.leaderboard(),board);
 const d=JSON.parse(storage.getItem('councillion.game.v1'));storage.setItem('councillion.player.v1',d.players.find(p=>p.username==='Finished').id);
 assert.equal((await api.getResults(r.attemptId)).total,70);await api.adminDelete(p.id);
});
test('upload/import stays private until published and never creates a playable incomplete pack',async()=>{
 const {api}=setup();const [p]=await api.importPacks([{...fixture(),published:true}]);assert.equal(p.published,false);
 assert.equal((await api.listPacks()).length,0);await api.adminVisibility(p.id,true);assert.equal((await api.listPacks()).length,1);
});
