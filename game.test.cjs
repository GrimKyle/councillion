'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAPI, normalize, typoDistance, matchAnswer, TIERS } = require('../api.js');
function context() {
  const m = new Map(), storage = { getItem: k => m.get(k) || null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
  let now = 1700000000000;
  const api=createAPI(storage,()=>now);api.testAdvance=n=>now+=n;return {api,advance:n=>now+=n,storage,now:()=>now};
}
// Deliberately artificial test fixtures, never shipped as playable trivia content.
function fixture() {
  return { title: 'TEST FIXTURE ONLY', description: 'Not a playable sample pack', published: true, questions: Array.from({ length: 7 }, (_, i) => ({ prompt: 'Fixture prompt ' + i, answers: [{ canonical: 'Kai’Sa', aliases: ['kaisa'], tier: TIERS[i % 6].id, explanation: 'Fixture explanation' }, { canonical: 'Other token', aliases: [], tier: 'dino', explanation: '' }] })) };
}
async function finish(api, pack, values = []) {
  let s = await api.begin(pack.id);
  while (s.status !== 'completed') {
    if (s.status === 'between') s = await api.startQuestion(s.id);
    const index = s.lockedCount;
    s = await api.answer(s.id, s.question.id, values[index] ?? 'Kai Sa', 'request-' + index);
    if(s.feedback?.kind==='suggestion')s=await api.confirmAnswer(s.id,s.question.id,values[index]??'Kai Sa','confirmation-'+index);
    if(s.feedback?.kind==='invalid'){api.testAdvance(25000);s=await api.getState(s.id);}
  }
  return api.getResults(s.id);
}
test('normalization groups apostrophes, whitespace, accents and case', () => {
  for (const text of ['Kaisa', '  KAI SA ', 'Kai’Sa', "Kai'Sa", 'Káï-Sa']) assert.equal(normalize(text), 'kaisa');
  assert.notEqual(normalize('Kai Sa'), normalize('Kai Son'));
});
test('no seeded trivia, fake players or fake scores', async () => {
  const { api } = context(); assert.equal(await api.init(), null); assert.deepEqual(await api.listPacks(), []); assert.deepEqual(await api.leaderboard(), []);
});
test('official tiers and maximum exactly match requirements', () => {
  assert.deepEqual(TIERS.map(x => x.points), [100, 85, 60, 30, 15, 10]); assert.equal(Math.max(...TIERS.map(x => x.points)) * 7, 700);
});
test('publish requires seven complete prompts and top-tier explanation', async () => {
  const { api } = context(); const p = fixture(); p.questions.pop(); await assert.rejects(api.adminSave(p), /seven/);
  const p2 = fixture(); p2.questions[0].answers[0].explanation = ''; await assert.rejects(api.adminSave(p2), /explanation/);
});
test('normalization collisions across different canonical answers are rejected', async () => {
  const { api } = context(); const p = fixture(); p.questions[0].answers[1].aliases = ['KAI-SA']; await assert.rejects(api.adminSave(p), /same spelling/);
});
test('first prompt has 25 seconds; active state has no hidden answer data', async () => {
  const { api, now } = context(); const p = await api.adminSave(fixture()); await api.enter('Tester'); const s = await api.begin(p.id);
  assert.equal(s.deadline - now(), 25000); assert.deepEqual(Object.keys(s.question).sort(), ['id', 'prompt']); assert.equal(JSON.stringify(s).includes('Kai'), false);
  await assert.rejects(api.getResults(s.id), /seven/);
});
test('refresh and repeated start cannot reset the active deadline', async () => {
  const { api, advance } = context(); const p = await api.adminSave(fixture()); await api.enter('Tester'); const s = await api.begin(p.id); advance(9000);
  assert.equal((await api.getState(s.id)).deadline, s.deadline); assert.equal((await api.startQuestion(s.id)).deadline, s.deadline); assert.equal((await api.begin(p.id)).deadline, s.deadline);
});
test('deadline expiry locks only current question, never silently starts remaining questions', async () => {
  const { api, advance, now } = context(); const p = await api.adminSave(fixture()); await api.enter('Tester'); let s = await api.begin(p.id); advance(25000);
  s = await api.getState(s.id); assert.equal(s.status, 'between'); assert.equal(s.lockedCount, 1); assert.equal(s.question, null); advance(600000); s = await api.getState(s.id); assert.equal(s.lockedCount, 1);
  s = await api.startQuestion(s.id); assert.equal(s.deadline - now(), 25000); assert.equal(s.position, 1);
});
test('late answer is a timeout; retries do not create duplicate submissions', async () => {
  const { api, advance } = context(); const p = await api.adminSave(fixture()); await api.enter('Tester'); let s = await api.begin(p.id); const qid = s.question.id; advance(25000);
  s = await api.answer(s.id, qid, 'Kai Sa', 'retry-token'); assert.equal(s.lockedCount, 1);
  s = await api.answer(s.id, qid, 'Other token', 'retry-token'); assert.equal(s.lockedCount, 1);
  s = await api.answer(s.id, qid, 'Other token', 'different-token'); assert.equal(s.lockedCount, 1);
  s = await api.startQuestion(s.id); await assert.rejects(api.answer(s.id, 'wrong-question', 'x'), /not active/);
});
test('completed results include all seven rows, correct tiers, sorted answer keys and explanations', async () => {
  const { api } = context(); const p = await api.adminSave(fixture()); await api.enter('Tester'); const r = await finish(api, p);
  assert.equal(r.questions.length, 7); assert.equal(r.total, 400); assert.equal(r.ones, 2); assert.equal(r.pendingCount, 0);
  for (const q of r.questions) { assert.equal(q.canonical, 'Kai’Sa'); assert.equal(q.popularity.count, 1); assert.equal(q.popularity.percentage, 100); assert.equal(q.answers.length, 2); assert.ok(q.answers[0].points >= q.answers[1].points); }
  assert.equal(r.questions[0].explanation, 'Fixture explanation'); assert.equal((await api.begin(p.id)).status, 'completed');
});
test('unknown guesses retry until timeout; optional corrections update totals and popularity', async () => {
  const { api } = context(); const p = await api.adminSave(fixture()); await api.enter('Tester'); let r = await finish(api, p, ['Kai Something']);
  assert.equal(r.questions[0].reviewStatus, 'timeout'); assert.equal(r.pendingCount, 0); assert.equal(r.questions[0].points, 0); assert.equal(r.total, 300);
  const review = (await api.adminReviews()).find(row=>row.actionable && row.questionId===p.questions[0].id); await api.adminReview({ submissionId: review.id, answerId: p.questions[0].answers[0].id });
  r = await api.getResults(r.attemptId); assert.equal(r.total, 400); assert.equal(r.pendingCount, 0); assert.equal(r.questions[0].popularity.count, 1); assert.equal((await api.leaderboard(p.id))[0].score, 400);
});
const accepted = (id, canonical, aliases = []) => ({ id, canonical, aliases });
test('one-edit distance includes adjacent swaps, insertion, deletion and substitution', () => {
  for (const s of ['appel', 'appl', 'appple', 'applw']) {
    assert.equal(typoDistance(s, 'apple'), 1, s);
    assert.equal(typoDistance('apple', s), 1, s);
  }
  assert.equal(typoDistance('apple', 'apple'), 0);
  assert.equal(typoDistance('aplep', 'apple'), 2);
  assert.equal(typoDistance('', 'a'), 1);
  assert.equal(typoDistance('', 'aa'), 2);
});
test('appel is corrected to Apple without needing a typo alias', () => {
  assert.equal(matchAnswer('appel', [accepted('apple', 'Apple')]).id, 'apple');
  assert.equal(matchAnswer('  APPEL! ', [accepted('apple', 'Apple')]).id, 'apple');
});
test('exact canonical and alias matches always beat another answer’s typo match', () => {
  const answers = [accepted('apple', 'Apple'), accepted('apply', 'Apply', ['appel'])];
  assert.equal(matchAnswer('apply', answers).id, 'apply');
  assert.equal(matchAnswer('appel', answers).id, 'apply');
});
test('typos match configured equivalent names and count aliases once per canonical', () => {
  const answers = [accepted('apple', 'Apple', ['red apple', 'apples'])];
  assert.equal(matchAnswer('red appel', answers).id, 'apple');
  assert.equal(matchAnswer('appl', answers).id, 'apple');
  assert.equal(matchAnswer('apple pie', answers), null);
});
test('ambiguous close answers are not auto-mapped to the first or highest tier', () => {
  assert.equal(matchAnswer('herry', [accepted('a', 'Berry'), accepted('b', 'Ferry')]), null);
  assert.equal(matchAnswer('aple', [accepted('a', 'Apple'), accepted('b', 'Maple')]), null);
  assert.equal(matchAnswer('peac', [accepted('a', 'Peach'), accepted('b', 'Pear')]), null);
});
test('short names require exact matching and two edits or extra phrases are not inferred', () => {
  assert.equal(matchAnswer('peqr', [accepted('a', 'Pear')]), null);
  assert.equal(matchAnswer('apl', [accepted('a', 'Apple')]), null);
  assert.equal(matchAnswer('red apple', [accepted('a', 'Apple')]), null);
  assert.equal(matchAnswer('pineapple', [accepted('a', 'Apple')]), null);
  assert.equal(matchAnswer('aplep', [accepted('a', 'Apple')]), null);
});
test('corrected submission retains raw wording, scores canonical rarity and joins its popularity', async () => {
  const { api, storage } = context(); const p = fixture();
  p.questions[0].answers = [{ canonical: 'Apple', aliases: ['red apple'], tier: 'donovan', explanation: '' }];
  const saved = await api.adminSave(p); await api.enter('First');
  const r1 = await finish(api, saved, ['appel']);
  assert.equal(r1.questions[0].rawAnswer, 'appel'); assert.equal(r1.questions[0].canonical, 'Apple');
  assert.equal(r1.questions[0].points, 60); assert.equal(r1.pendingCount, 0);
  storage.removeItem('councillion.player.v1'); await api.enter('Second');
  const r2 = await finish(api, saved, ['red apple']);
  assert.equal(r2.questions[0].popularity.count, 2); assert.equal(r2.questions[0].popularity.percentage, 100);
  assert.equal((await api.leaderboard(saved.id))[0].score, r2.total);
});
test('own matched answer reveals immediately but complete key stays hidden until seven answers', async () => {
  const { api, advance } = context(); const p = fixture();
  p.questions.forEach(q => { q.answers = [{ canonical: 'Apple', aliases: [], tier: 'dino', explanation: '' }]; });
  const pack = await api.adminSave(p); await api.enter('Typo Tester'); let s = await api.begin(pack.id);
  s = await api.confirmAnswer(s.id, s.question.id, 'appel'); assert.equal(s.status, 'between');
  assert.equal(s.lastAnswer.canonical,'Apple');assert.equal(s.runScore,10);assert.ok(!('answers' in s.lastAnswer)); await assert.rejects(api.getResults(s.id), /seven/);
  s = await api.startQuestion(s.id); advance(25000); s = await api.answer(s.id, s.question.id, 'appel');
  while (s.status !== 'completed') { s = await api.startQuestion(s.id); s = await api.confirmAnswer(s.id, s.question.id, 'appel'); }
  const r = await api.getResults(s.id); assert.equal(r.total, 60); assert.equal(r.questions[1].reviewStatus, 'timeout');
});
test('ambiguous guesses stay retryable and eventual timeouts finish with no review dependency', async () => {
  const { api } = context(); const p = fixture();
  p.questions.forEach(q => { q.answers = [{ canonical: 'Berry', aliases: [], tier: 'dino', explanation: '' }, { canonical: 'Ferry', aliases: [], tier: 'grimkyle', explanation: '' }]; });
  const pack = await api.adminSave(p); await api.enter('Automatic Tester');
  const r = await finish(api, pack, Array(7).fill('herry'));
  assert.equal(r.total, 0); assert.equal(r.pendingCount, 0);
  assert.ok(r.questions.every(q => q.reviewStatus === 'timeout')); 
  const [board] = await api.leaderboard(pack.id); assert.equal(board.score, 0); assert.equal(board.pending, 0);
  const history = await api.adminReviews(); assert.equal(history.filter(row=>row.type==='invalid_attempt').length,7);
  assert.ok(history.filter(row=>row.type==='invalid_attempt').every(row=>row.rawAnswer==='herry' && !row.actionable));
});
test('Game Master can add a previously unrecognized accepted answer after play', async () => {
  const { api } = context(); const p = await api.adminSave(fixture()); await api.enter('Tester'); let r = await finish(api, p, ['Unlisted fixture']); const review = (await api.adminReviews()).find(row=>row.actionable && row.questionId===p.questions[0].id);
  await api.adminReview({ submissionId: review.id, newAnswer: { canonical: 'Unlisted fixture', tier: 'grimkyle', aliases: [], explanation: '' } });
  r = await api.getResults(r.attemptId); assert.equal(r.questions[0].points, 85); assert.equal(r.questions[0].canonical, 'Unlisted fixture'); assert.equal(r.questions[0].answers.length, 3);
});
test('changing canonical rarity regrades historical answers except individual overrides', async () => {
  const { api } = context(); const p = await api.adminSave(fixture()); await api.enter('Tester'); const r = await finish(api, p);
  const reviews = await api.adminReviews();
  const first = reviews.find(x => x.questionId === p.questions[0].id);
  await api.adminReview({ submissionId: first.id, answerId: p.questions[0].answers[0].id, overridePoints: 60 });
  await api.adminRegradeAnswer({ answerId: p.questions[0].answers[0].id, tier: 'kalen', explanation: '' });
  assert.equal((await api.getResults(r.attemptId)).total, 360); assert.equal((await api.leaderboard(p.id))[0].score, 360);
});
test('backend adapter creates guest auth then uses token for authorized RPC', async () => {
  const m = new Map(), storage = { getItem: k => m.get(k) || null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
  const calls = [], api = createAPI(storage, Date.now, async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => url.includes('/auth/') ? { access_token: 'guest-token', refresh_token: 'refresh', expires_in: 3600 } : [] };
  });
  api.configure({ url: 'https://project.supabase.co', key: 'sb_publishable_test' }); await api.listPacks();
  assert.equal(calls.length, 2); assert.match(calls[0].url, /auth\/v1\/signup$/); assert.equal(calls[1].options.headers.Authorization, 'Bearer guest-token'); assert.deepEqual(JSON.parse(calls[1].options.body), { p_admin: false });
});
test('played pack content frozen, but unpublishing and score overrides allowed', async () => {
  const { api } = context(); const p = await api.adminSave(fixture()); await api.enter('Tester'); const r = await finish(api, p, ['unknown']);
  const changed = structuredClone(p); changed.questions[0].prompt = 'different'; await assert.rejects(api.adminSave(changed), /started/);
  await api.adminSave({ ...p, published: false }); assert.equal((await api.listPacks()).length, 0);
  const review = (await api.adminReviews()).find(row=>row.actionable && row.questionId===p.questions[0].id); await api.adminReview({ submissionId: review.id, overridePoints: 30, note: 'Fixture correction' }); assert.equal((await api.getResults(r.attemptId)).total, 330);
});
test('full results and attempts cannot be read by a different guest identity', async () => {
  const { api, storage } = context(); const p = await api.adminSave(fixture()); await api.enter('Tester'); const r = await finish(api, p); storage.removeItem('councillion.player.v1'); await api.enter('Other Tester');
  await assert.rejects(api.getResults(r.attemptId), /different player/); await assert.rejects(api.getState(r.attemptId), /different player/);
});
test('unique username and played identity lock; equal totals share rank; popularity denominator includes incorrect', async () => {
  const { api, storage } = context(); const p = await api.adminSave(fixture()); await api.enter('Alpha'); await finish(api, p); await assert.rejects(api.enter('Renamed'), /locked/); storage.removeItem('councillion.player.v1'); await assert.rejects(api.enter('ALPHA'), /taken/);
  await api.enter('Beta'); await finish(api, p); storage.removeItem('councillion.player.v1'); await api.enter('Gamma'); const r = await finish(api, p, ['unlisted']);
  const rows = await api.leaderboard(p.id); assert.deepEqual(rows.map(x => x.rank), [1, 1, 3]); assert.equal(r.questions[0].popularity.total, 3); assert.equal(r.questions[0].answers.find(x => x.canonical === 'Kai’Sa').count, 2);
});
test('import makes fresh unpublished drafts and exports actual content', async () => {
  const { api } = context(); const p = await api.adminSave(fixture()); const [copy] = await api.importPacks([p]); assert.notEqual(copy.id, p.id); assert.equal(copy.published, false); assert.notEqual(copy.questions[0].id, p.questions[0].id); assert.equal((await api.exportPacks()).length, 2);
});
test('cloud settings reject privileged credentials and non-origin URLs', () => {
  const { api } = context(); assert.throws(() => api.configure({ url: 'http://unsafe.test', key: 'sb_publishable_test' }), /HTTPS/);
  assert.throws(() => api.configure({ url: 'https://safe.test/path', key: 'sb_publishable_test' }), /origin/);
  const key = 'e30.' + Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url') + '.sig';
  assert.throws(() => api.configure({ url: 'https://safe.test', key }), /public anon/);
  api.configure({ url: 'https://safe.test', key: 'sb_publishable_test' }); assert.equal(api.mode, 'remote'); api.disconnect(); assert.equal(api.mode, 'local');
});
