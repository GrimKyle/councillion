'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createAPI } = require('../api.js');
function setup() {
  const m = new Map(), storage = { getItem: k => m.get(k) || null, setItem: (k,v) => m.set(k,String(v)), removeItem: k => m.delete(k) };
  let time = 1700000000000;
  const api=createAPI(storage,()=>time);api.testAdvance=n=>{time+=n;};return {api,storage,advance:n=>{time+=n;}};
}
async function pack(api, title = 'REPLAY TEST FIXTURE ONLY') {
  return api.adminSave({ title, published: true, questions: Array.from({length:7}, (_,i) => ({ prompt: 'Synthetic fixture ' + i, answers: [
    { canonical: 'FixtureCommon', aliases: [], tier: 'dino', explanation: '' },
    { canonical: 'FixtureGem', aliases: [], tier: 'councillion', explanation: 'Test fixture' }
  ] })) });
}
async function finish(api, state, value = 'FixtureCommon') {
  let s = state;
  while (s.status !== 'completed') {
    if (s.status === 'between') s = await api.startQuestion(s.id);
    s = await api.answer(s.id, s.question.id, value);
    if(s.feedback?.kind==='invalid'){api.testAdvance(25000);s=await api.getState(s.id);}
  }
  return api.getResults(s.id);
}
test('replays unlock only after the first official attempt finishes', async () => {
  const {api} = setup(); const p = await pack(api); await api.enter('Player');
  await assert.rejects(api.practice(p.id), /Finish your first/);
  const s = await api.begin(p.id); assert.equal(s.isOfficial, true);
  await assert.rejects(api.practice(p.id), /Finish your first/);
  await finish(api,s); assert.equal((await api.practice(p.id)).isOfficial,false);
});
test('higher and lower replay scores never replace the first score or inflate statistics', async () => {
  const {api} = setup(); const p = await pack(api); await api.enter('Player');
  const first = await finish(api,await api.begin(p.id)); assert.equal(first.total,70);
  const baseline = await api.leaderboard(p.id);
  const perfect = await finish(api,await api.practice(p.id),'FixtureGem');
  assert.equal(perfect.total,700); assert.equal(perfect.officialScore,70); assert.equal(perfect.isOfficial,false); assert.equal(perfect.officialAttemptId,first.attemptId);
  const zero = await finish(api,await api.practice(p.id),'Not a fixture answer'); assert.equal(zero.total,0);
  assert.deepEqual(await api.leaderboard(p.id),baseline); assert.deepEqual(await api.leaderboard(),baseline);
  assert.equal((await api.listPacks())[0].completedCount,1);
  for (const q of perfect.questions) {
    assert.equal(q.popularity.total,1); assert.equal(q.popularity.count,0);
    assert.equal(q.answers.find(a => a.canonical === 'FixtureCommon').count,1);
    assert.equal(q.answers.find(a => a.canonical === 'FixtureGem').count,0);
  }
  const unchanged = await api.getResults(first.attemptId); assert.deepEqual(unchanged,first);
  const history = await api.adminReviews(); assert.equal(history.filter(x=>x.isOfficial===false&&x.actionable).length,14);
});
test('unlimited replay attempts are distinct; repeated official begin always returns the first run', async () => {
  const {api} = setup(); const p = await pack(api); await api.enter('Player');
  const first = await finish(api,await api.begin(p.id)); const ids = new Set();
  for (let i=0;i<6;i++) { const s=await api.practice(p.id); ids.add(s.id); await finish(api,s); }
  assert.equal(ids.size,6); assert.equal((await api.begin(p.id)).id,first.attemptId);
  assert.equal((await api.leaderboard())[0].games,1);
});
test('replay request retries preserve ID/deadline and reject another player or official run ID', async () => {
  const {api,storage,advance} = setup(); const p = await pack(api); await api.enter('Player');
  const first = await finish(api,await api.begin(p.id)); const request = randomUUID(); const s = await api.practice(p.id,request);
  advance(1000); const retry = await api.practice(p.id,request); assert.equal(retry.id,s.id); assert.equal(retry.deadline,s.deadline);
  await assert.rejects(api.practice(p.id,first.attemptId),/already used/);
  storage.removeItem('councillion.player.v1'); await api.enter('Other'); await finish(api,await api.begin(p.id));
  await assert.rejects(api.practice(p.id,request),/already used/); await assert.rejects(api.getResults(s.id),/different player/);
});
test('unfinished replays resume with their original timer and appear on the correct pack', async () => {
  const {api,advance} = setup(); const p=await pack(api); await api.enter('Player'); const first=await finish(api,await api.begin(p.id));
  const s=await api.practice(p.id); advance(26000);
  const resumed=await api.getState(s.id); assert.equal(resumed.status,'between'); assert.equal(resumed.lockedCount,1); assert.equal(resumed.isOfficial,false);
  const [card]=await api.listPacks(); assert.equal(card.myPractice.id,s.id); assert.equal(card.myAttempt.id,first.attemptId);
  const r=await finish(api,resumed); assert.equal(r.total,60); assert.equal((await api.listPacks())[0].myPractice,null);
  assert.equal((await api.leaderboard())[0].score,70);
});
test('older local attempts without an official flag remain the first official score', async () => {
  const {api,storage}=setup(); const p=await pack(api); await api.enter('Player'); const first=await finish(api,await api.begin(p.id));
  const d=JSON.parse(storage.getItem('councillion.game.v1')); delete d.attempts[0].isOfficial; storage.setItem('councillion.game.v1',JSON.stringify(d));
  const r=await finish(api,await api.practice(p.id),'FixtureGem'); assert.equal(r.officialScore,70);
  assert.equal((await api.begin(p.id)).id,first.attemptId); assert.equal((await api.leaderboard())[0].score,70);
});
test('each pack has its own first score and practices require the same pack to be finished', async () => {
  const {api}=setup(); const one=await pack(api,'Pack One'); const two=await pack(api,'Pack Two'); await api.enter('Player');
  await finish(api,await api.begin(one.id)); await assert.rejects(api.practice(two.id),/Finish your first/);
  await finish(api,await api.begin(two.id),'FixtureGem'); await finish(api,await api.practice(one.id),'FixtureGem');
  assert.equal((await api.leaderboard(one.id))[0].score,70); assert.equal((await api.leaderboard(two.id))[0].score,700);
  const [all]=await api.leaderboard(); assert.equal(all.score,770); assert.equal(all.games,2);
});
