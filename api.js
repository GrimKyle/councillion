/* Councillion: dependency-free browser client and an explicitly local host mode. */
(function (root) {
  'use strict';
  const TIERS = Object.freeze([
    { id: 'councillion', name: 'One in a Councillion', points: 100, color: '#f5cc62' },
    { id: 'grimkyle', name: 'Grimkyle', points: 85, color: '#d3a1ff' },
    { id: 'donovan', name: 'Donovan', points: 60, color: '#ee9f88' },
    { id: 'cavaughn', name: 'Cavaughn', points: 30, color: '#85cbd0' },
    { id: 'kalen', name: 'Kalen', points: 15, color: '#a9c990' },
    { id: 'dino', name: 'Dino', points: 10, color: '#b7afb6' }
  ]);
  const uuid = () => root.crypto?.randomUUID?.() || 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const n = Math.random() * 16 | 0; return (c === 'x' ? n : (n & 3 | 8)).toString(16); });
  const clone = x => JSON.parse(JSON.stringify(x));
  const normalize = x => String(x || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  // Bounded edit distance: 0 = equal, 1 = one edit, 2 = too different.
  // A swap of adjacent letters counts as one edit (appel -> apple).
  function typoDistance(left, right) {
    if (left === right) return 0;
    const a = Array.from(left), b = Array.from(right);
    if (Math.abs(a.length - b.length) > 1) return 2;
    let i = 0;
    while (i < Math.min(a.length, b.length) && a[i] === b[i]) i++;
    if (a.length === b.length) {
      if (a.slice(i + 1).join('') === b.slice(i + 1).join('')) return 1;
      if (i + 1 < a.length && a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2).join('') === b.slice(i + 2).join('')) return 1;
      return 2;
    }
    const short = a.length < b.length ? a : b, long = a.length < b.length ? b : a;
    return short.slice(i).join('') === long.slice(i + 1).join('') ? 1 : 2;
  }
  function matchAnswer(raw, answers) {
    const n = normalize(raw);
    if (!n) return null;
    const exact = answers.find(a => [a.canonical, ...(a.aliases || [])].some(s => normalize(s) === n));
    if (exact) return exact;
    if (Array.from(n).length < 4) return null;
    const candidates = [];
    for (const answer of answers) {
      const spellings = [answer.canonical, ...(answer.aliases || [])].map(normalize).filter(s => typoDistance(n, s) === 1);
      if (spellings.length) candidates.push({ answer, eligible: spellings.some(s => Array.from(s).length >= 5) });
    }
    // Count short-name competitors too; several aliases of one answer count once.
    return candidates.length === 1 && candidates[0].eligible ? candidates[0].answer : null;
  }
  const tierFor = id => TIERS.find(t => t.id === id);
  const markFor = points => ({100:'🟨',85:'🟪',60:'🟧',30:'🟦',15:'🟩',10:'⬜'})[points] || '⬛';
  const parse = (s, fallback) => { try { return JSON.parse(s) ?? fallback; } catch { return fallback; } };
  const requireText = (x, max = 200) => String(x || '').trim().slice(0, max);
  class LocalStore {
    constructor(storage, clock = Date.now) { this.storage = storage; this.clock = clock; }
    read() { return parse(this.storage.getItem('councillion.game.v1'), { version: 1, players: [], packs: [], attempts: [], audit: [] }); }
    write(d) { try { this.storage.setItem('councillion.game.v1', JSON.stringify(d)); } catch { throw new Error('This browser could not save the game. Allow site storage or export your packs before continuing.'); } }
    identity() { return this.storage.getItem('councillion.player.v1'); }
    player(d) { return d.players.find(p => p.id === this.identity()) || null; }
    profile() { const p = this.player(this.read()); return p ? { ...p, isAdmin: false } : null; }
    enter(name) {
      const username = String(name || '').trim();
      if (Array.from(username).length < 2 || Array.from(username).length > 24 || /[\u0000-\u001f\u007f-\u009f<>&"'\\/\u200b\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(username) || !/[\p{L}\p{N}\p{Extended_Pictographic}]/u.test(username)) throw new Error('Use 2–24 visible characters. Emoji are welcome; avoid control characters and HTML symbols.');
      const d = this.read(); let p = this.player(d);
      if (p && p.username !== username && d.attempts.some(a => a.playerId === p.id)) throw new Error('Your name is locked after starting a pack. Keep your original username.');
      if (d.players.some(x => x.username.toLowerCase() === username.toLowerCase() && x.id !== p?.id)) throw new Error('That username is taken on this browser. Choose another.');
      if (!p) { p = { id: uuid(), username }; d.players.push(p); this.storage.setItem('councillion.player.v1', p.id); } else p.username = username;
      this.write(d); return { ...p, isAdmin: false };
    }
    needPlayer(d) { const p = this.player(d); if (!p) throw new Error('Enter your username first.'); return p; }
    owned(d, id) { const p = this.needPlayer(d); const a = d.attempts.find(x => x.id === id && x.playerId === p.id); if (!a) throw new Error('This attempt belongs to a different player.'); if (a.status !== 'completed') this.openPack(d,a.packId); return a; }
    openPack(d,id) { const p=d.packs.find(p=>p.id===id && !p.deletedAt && p.published); if(!p) throw new Error('This pack is private or has been deleted.'); return p; }
    state(d, a) {
      const p = d.packs.find(x => x.id === a.packId);
      const history = this.scored(d,a).map(row=>({questionId:row.questionId,prompt:p.questions.find(q=>q.id===row.questionId).prompt,rawAnswer:row.rawAnswer,canonical:row.canonical,points:row.points,tier:row.tier,explanation:row.explanation,reviewStatus:row.reviewStatus}));
      const runScore=history.reduce((n,row)=>n+row.points,0);
      return { id:a.id,packId:p.id,title:p.title,isOfficial:a.isOfficial!==false,status:a.status,position:Math.min(a.submissions.length,6),deadline:a.deadline,serverNow:this.clock(),lockedCount:a.submissions.length,question:a.status==='active'?{id:p.questions[a.submissions.length].id,prompt:p.questions[a.submissions.length].prompt}:null,runScore,depth:runScore*10,hasCouncillion:history.some(row=>row.points===100),history,lastAnswer:history.at(-1)||null };
    }
    expire(d, a) { if (a.status === 'active' && this.clock() >= a.deadline) this.lock(d, a, '', true); }
    lock(d, a, text, timeout = false, requestId = uuid()) {
      const p = d.packs.find(x => x.id === a.packId), q = p.questions[a.submissions.length];
      const raw = requireText(text, 200), n = normalize(raw);
      const answer = !timeout && n ? matchAnswer(raw, q.answers) : null;
      a.submissions.push({ id: uuid(), questionId: q.id, rawAnswer: timeout ? '' : raw, answerId: answer?.id || null, reviewStatus: timeout ? 'timeout' : answer ? 'accepted' : 'rejected', overridePoints: null, requestId });
      a.deadline = null; a.status = a.submissions.length === 7 ? 'completed' : 'between';
      if (a.status === 'completed') a.completedAt = this.clock();
    }
    list(admin = false) {
      const d = this.read(), player = this.player(d);
      return d.packs.filter(p => !p.deletedAt && (admin || p.published)).map(p => { const a = d.attempts.find(x => x.packId === p.id && x.playerId === player?.id && x.isOfficial !== false); const practice = d.attempts.filter(x => x.packId === p.id && x.playerId === player?.id && x.isOfficial === false && x.status !== 'completed').at(-1); return { id: p.id, title: p.title, description: p.description, icon: p.icon, color: p.color, published: p.published, completedCount: d.attempts.filter(a => a.packId === p.id && a.status === 'completed' && a.isOfficial !== false).length, myAttempt: a ? { id: a.id, status: a.status } : null, myPractice: practice ? { id: practice.id, status: practice.status } : null }; });
    }
    begin(id) {
      const d = this.read(), player = this.needPlayer(d), pack = d.packs.find(p => p.id === id);
      this.openPack(d,id);
      let a = d.attempts.find(a => a.packId === id && a.playerId === player.id && a.isOfficial !== false);
      if (!a && !pack.published) throw new Error('This pack is not published.');
      if (!a) { a = { id: uuid(), playerId: player.id, packId: id, isOfficial: true, status: 'active', deadline: this.clock() + 25000, submissions: [], createdAt: this.clock() }; d.attempts.push(a); }
      this.expire(d, a); this.write(d); return this.state(d, a);
    }
    practice(id, requestId = uuid()) {
      const d = this.read(), player = this.needPlayer(d), pack = d.packs.find(p => p.id === id);
      if (!pack?.published || pack.deletedAt) throw new Error('This pack is not open for replays.');
      const first = d.attempts.find(a => a.packId === id && a.playerId === player.id && a.isOfficial !== false);
      if (!first || first.status !== 'completed') throw new Error('Finish your first leaderboard run before replaying.');
      let a = d.attempts.find(a => a.id === requestId);
      if (a && (a.playerId !== player.id || a.packId !== id || a.isOfficial !== false)) throw new Error('Replay request ID already used.');
      if (!a) { a = { id: requestId, playerId: player.id, packId: id, isOfficial: false, status: 'active', deadline: this.clock() + 25000, submissions: [], createdAt: this.clock() }; d.attempts.push(a); }
      this.expire(d, a); this.write(d); return this.state(d, a);
    }
    getState(id) { const d = this.read(), a = this.owned(d, id); this.expire(d, a); this.write(d); return this.state(d, a); }
    resume(id, questionId = null) {
      const d=this.read(),a=this.owned(d,id),pack=d.packs.find(p=>p.id===a.packId);
      // Compare the interrupted question: a retried resume cannot skip the next one.
      if(a.status==='active' && pack.questions[a.submissions.length].id===questionId)this.lock(d,a,'',true);
      else if(a.status==='active' || a.status==='completed')return this.state(d,a);
      if(a.status==='between'){a.status='active';a.deadline=this.clock()+25000;}
      this.write(d);return this.state(d,a);
    }
    next(id) { const d = this.read(), a = this.owned(d, id); this.expire(d, a); if (a.status === 'between') { a.status = 'active'; a.deadline = this.clock() + 25000; } this.write(d); return this.state(d, a); }
    answer(id, questionId, text, requestId = uuid(), confirm = false) {
      const d=this.read(),a=this.owned(d,id);
      if(a.submissions.some(row=>row.requestId===requestId||row.questionId===questionId))return this.state(d,a);
      if(a.status!=='active')throw new Error('This answer is already locked.');
      const p=d.packs.find(p=>p.id===a.packId),q=p.questions[a.submissions.length];
      if(q.id!==questionId)throw new Error('That question is not active.');
      const raw=String(text||'').trim();if(raw.length>200)throw new Error('Answers must be 200 characters or fewer.');
      if(this.clock()>=a.deadline || raw===''){this.lock(d,a,'',true,requestId);this.write(d);return this.state(d,a);}
      const prior=(a.invalidGuesses||[]).find(row=>row.requestId===requestId);
      if(prior&&prior.rawAnswer!==raw)throw new Error('Use a fresh request ID for another guess.');
      const match=matchAnswer(raw,q.answers);
      if(prior||!match){
        a.invalidGuesses=a.invalidGuesses||[];
        if(!prior&&a.invalidGuesses.filter(row=>row.questionId===q.id).length<100)a.invalidGuesses.push({id:uuid(),questionId:q.id,rawAnswer:raw,requestId,at:this.clock()});
        this.write(d);return {...this.state(d,a),feedback:{kind:'invalid',message:`"${raw}" is invalid. Try again.`}};
      }
      if(!confirm && ![match.canonical,...(match.aliases||[])].some(x=>normalize(x)===normalize(raw)))
        return {...this.state(d,a),feedback:{kind:'suggestion',candidate:match.canonical,rawAnswer:raw,message:`Did you mean “${match.canonical}”?`}};
      this.lock(d,a,raw,false,requestId);this.write(d);return this.state(d,a);
    }
    scored(d, a) {
      const p = d.packs.find(p => p.id === a.packId);
      return a.submissions.map(s => { const q = p.questions.find(q => q.id === s.questionId), answer = q.answers.find(x => x.id === s.answerId), tier = answer ? tierFor(answer.tier) : null; const points = s.overridePoints ?? (s.reviewStatus === 'accepted' ? tier?.points || 0 : 0); return { ...s, canonical: answer?.canonical || null, tier: s.overridePoints !== null ? TIERS.find(x => x.points === points)?.id || null : tier?.id || null, points, explanation: points === 100 ? answer?.explanation || '' : '' }; });
    }
    results(id) {
      const d = this.read(), a = this.owned(d, id);
      this.expire(d, a); this.write(d);
      if (a.status !== 'completed') throw new Error('Finish all seven questions before opening results.');
      const pack = d.packs.find(p => p.id === a.packId), scored = this.scored(d, a), completed = d.attempts.filter(x => x.packId === a.packId && x.status === 'completed' && x.isOfficial !== false);
      const official = completed.find(x => x.playerId === a.playerId);
      const total = completed.length;
      const count = (qid, aid) => completed.filter(x => x.submissions.some(s => s.questionId === qid && s.answerId === aid && s.reviewStatus === 'accepted')).length;
      return { attemptId: a.id, packId: pack.id, title: pack.title, isOfficial: a.isOfficial !== false, officialAttemptId: official?.id || null, officialScore: official ? this.scored(d, official).reduce((n, s) => n + s.points, 0) : null, username: d.players.find(p => p.id === a.playerId).username, total: scored.reduce((n, s) => n + s.points, 0), max: 700, ones: scored.filter(s => s.points === 100).length, pendingCount: scored.filter(s => s.reviewStatus === 'pending').length, questions: pack.questions.map(q => { const s = scored.find(s => s.questionId === q.id), c = s.answerId && s.reviewStatus === 'accepted' ? count(q.id, s.answerId) : 0; return { id: q.id, prompt: q.prompt, rawAnswer: s.rawAnswer, canonical: s.canonical, points: s.points, tier: s.tier, reviewStatus: s.reviewStatus, explanation: s.explanation, popularity: { count: c, total, percentage: total ? c / total * 100 : 0 }, answers: q.answers.map(ans => { const n = count(q.id, ans.id); return { id: ans.id, canonical: ans.canonical, tier: ans.tier, points: tierFor(ans.tier).points, explanation: ans.explanation, count: n, percentage: total ? n / total * 100 : 0 }; }).sort((x, y) => y.points - x.points || x.canonical.localeCompare(y.canonical)) }; }) };
    }
    leaderboard(id = null) {
      const d = this.read(), map = new Map();
      d.attempts.filter(a => a.status === 'completed' && a.isOfficial !== false && (!id || a.packId === id)).forEach(a => { const scored = this.scored(d, a), p = d.players.find(p => p.id === a.playerId); const v = map.get(p.id) || { username: p.username, score: 0, games: 0, ones: 0, pending: 0, marks: [], markTiers: [], lastMarksAt: -1 }; if((a.completedAt||a.createdAt||0)>=v.lastMarksAt){v.marks=scored.map(row=>markFor(row.points));v.markTiers=scored.map(row=>row.tier);v.lastMarksAt=a.completedAt||a.createdAt||0;} v.games++; v.score += scored.reduce((n, s) => n + s.points, 0); v.ones += scored.filter(s => s.points === 100).length; v.pending += scored.filter(s => s.reviewStatus === 'pending').length; map.set(p.id, v); });
      const rows = [...map.values()].sort((x, y) => y.score - x.score || x.username.localeCompare(y.username));
      let rank = 0; rows.forEach((x, i) => { if (!i || x.score !== rows[i - 1].score) rank = i + 1; x.rank = rank; delete x.lastMarksAt; }); return rows;
    }
    get(id) { const p = this.read().packs.find(p => p.id === id && !p.deletedAt); if (!p) throw new Error('Pack not found.'); return clone(p); }
    save(input) {
      const d = this.read(), existing = d.packs.find(p => p.id === input.id);
      if(existing?.deletedAt) throw new Error('This pack has been deleted.');
      const p = { id: existing?.id || uuid(), title: requireText(input.title, 80), description: requireText(input.description, 400), icon: requireText(input.icon || 'turkey', 20), color: /^#[0-9a-f]{6}$/i.test(input.color || '') ? input.color : '#b7a0ce', published: !!input.published, questions: (input.questions || []).slice(0, 7).map(q => ({ id: q.id || uuid(), prompt: requireText(q.prompt, 500), answers: (q.answers || []).map(a => ({ id: a.id || uuid(), canonical: requireText(a.canonical, 160), tier: a.tier, aliases: (a.aliases || []).map(v => requireText(v, 160)).filter(Boolean), explanation: requireText(a.explanation, 1200) })) })) };
      if (!p.title) throw new Error('Give your pack a title first.');
      if (existing && d.attempts.some(a => a.packId === p.id)) {
        const fixed = x => JSON.stringify({ ...x, published: undefined });
        if (fixed(existing) !== fixed(p)) throw new Error('This pack has started. Duplicate it for new questions; use the review queue to correct scores.');
      }
      for (const q of p.questions) {
        const seen = new Map();
        for (const a of q.answers) {
          if (!a.canonical || !normalize(a.canonical) || !tierFor(a.tier)) throw new Error('Every answer needs a name and a valid rarity.');
          if (p.published && a.tier === 'councillion' && !a.explanation) throw new Error('Add an explanation for each One in a Councillion answer.');
          for (const alias of [a.canonical, ...a.aliases]) { const n = normalize(alias); if (!n) throw new Error('An alias must contain a letter or number.'); if (seen.has(n) && seen.get(n) !== a.id) throw new Error('Two answers or aliases match the same spelling: ' + alias); seen.set(n, a.id); }
        }
      }
      if (p.published && (p.questions.length !== 7 || p.questions.some(q => !q.prompt || !q.answers.length))) throw new Error('Publishing needs exactly seven questions, each with at least one accepted answer.');
      if (existing) d.packs[d.packs.findIndex(x => x.id === p.id)] = p; else d.packs.push(p);
      d.audit.push({ at: this.clock(), action: 'pack_saved', packId: p.id, published: p.published }); this.write(d); return clone(p);
    }
    visibility(id,published) {
      if(typeof published!=='boolean') throw new Error('Choose public or private.');
      const d=this.read(),p=d.packs.find(p=>p.id===id&&!p.deletedAt); if(!p) throw new Error('Pack not found.');
      if(published) {
        if(p.questions.length!==7||p.questions.some(q=>!q.prompt.trim()||!q.answers.length||q.answers.some(a=>a.tier==='councillion'&&!a.explanation.trim()))) throw new Error('Publishing needs exactly seven complete questions and explanations for top answers.');
      }
      p.published=published;d.audit.push({at:this.clock(),action:published?'pack_published':'pack_private',packId:id});this.write(d);return {ok:true};
    }
    deletePack(id) {
      const d=this.read(),p=d.packs.find(p=>p.id===id);if(!p) throw new Error('Pack not found.');
      p.deletedAt=p.deletedAt||this.clock();p.published=false;d.audit.push({at:this.clock(),action:'pack_deleted',packId:id});this.write(d);return {ok:true};
    }
    reviews() {
      const d = this.read(), out = [];
      for (const a of d.attempts) {
        if (a.status !== 'completed') continue;
        const p = d.packs.find(p => p.id === a.packId);
        for (const s of this.scored(d, a)) { const q = p.questions.find(q => q.id === s.questionId); out.push({ id: s.id,type:'submission',submissionId:s.id,actionable:true, attemptId: a.id, isOfficial: a.isOfficial !== false, questionId: q.id, packTitle: p.title, prompt: q.prompt, rawAnswer: s.rawAnswer, username: d.players.find(p => p.id === a.playerId).username, reviewStatus: s.reviewStatus, canonical: s.canonical, points: s.points, answers: q.answers.map(x => ({ id: x.id, canonical: x.canonical, tier: x.tier, points: tierFor(x.tier).points })) }); }
        for(const row of a.invalidGuesses||[])out.push({id:'invalid:'+row.id,type:'invalid_attempt',submissionId:null,actionable:false,attemptId:a.id,isOfficial:a.isOfficial!==false,questionId:row.questionId,packTitle:p.title,prompt:p.questions.find(q=>q.id===row.questionId).prompt,rawAnswer:row.rawAnswer,username:d.players.find(p=>p.id===a.playerId).username,reviewStatus:'invalid_attempt',canonical:null,points:0,answers:[]});
      } return out.sort((x, y) => Number(['pending','rejected'].includes(y.reviewStatus)) - Number(['pending','rejected'].includes(x.reviewStatus)));
    }
    review({ submissionId, answerId = null, reject = false, overridePoints = null, note = '', newAnswer = null, applyToMatching = true }) {
      const d = this.read(); let selected, q;
      for (const a of d.attempts) { const s = a.submissions.find(s => s.id === submissionId); if (s) { if (a.status !== 'completed') throw new Error('Wait until this player finishes.'); selected = s; q = d.packs.find(p => p.id === a.packId).questions.find(q => q.id === s.questionId); break; } }
      if (!selected) throw new Error('Submission not found.');
      if (overridePoints !== null && ![0, 10, 15, 30, 60, 85, 100].includes(Number(overridePoints))) throw new Error('Choose a valid point value.');
      if (newAnswer && !reject) {
        const a = { id: uuid(), canonical: requireText(newAnswer.canonical, 160), tier: newAnswer.tier, aliases: (newAnswer.aliases || []).map(x => requireText(x, 160)).filter(Boolean), explanation: requireText(newAnswer.explanation, 1200) };
        if (!normalize(a.canonical) || !tierFor(a.tier)) throw new Error('Enter an accepted answer and tier.');
        if (a.tier === 'councillion' && !a.explanation) throw new Error('Add an explanation for the top answer.');
        const names = [a.canonical, ...a.aliases].map(normalize);
        if (q.answers.some(x => [x.canonical, ...x.aliases].some(n => names.includes(normalize(n))))) throw new Error('That answer already exists; select it instead.');
        q.answers.push(a); answerId = a.id;
      }
      if (!reject && !q.answers.some(a => a.id === answerId) && overridePoints === null) throw new Error('Choose an accepted answer, create one, or reject this submission.');
      if (answerId && !q.answers.some(a => a.id === answerId)) throw new Error('That accepted answer belongs to another question.');
      const target = normalize(selected.rawAnswer);
      if (applyToMatching && !reject && answerId && target) {
        const collision = q.answers.find(a => [a.canonical, ...a.aliases].some(n => normalize(n) === target));
        if (collision && collision.id !== answerId) throw new Error('This spelling already belongs to another answer.');
        if (!collision) q.answers.find(a => a.id === answerId).aliases.push(selected.rawAnswer);
      }
      for (const attempt of d.attempts) {
        if (attempt.status !== 'completed') continue;
        for (const s of attempt.submissions) {
          if (s.id === selected.id || (applyToMatching && s.questionId === q.id && (s.reviewStatus === 'pending' || (s.reviewStatus === 'rejected' && !s.reviewedAt)) && normalize(s.rawAnswer) === target)) {
            s.answerId = reject ? null : answerId; s.reviewStatus = reject ? 'rejected' : 'accepted'; s.overridePoints = overridePoints === null ? null : Number(overridePoints);
            s.reviewedAt = this.clock();
            d.audit.push({ at: this.clock(), action: 'submission_reviewed', submissionId: s.id, answerId, reject, overridePoints, note: requireText(note, 500) });
          }
        }
      }
      this.write(d); return { ok: true };
    }
    regrade({ answerId, tier, explanation = '' }) {
      if (!tierFor(tier)) throw new Error('Choose a valid tier.');
      if (tier === 'councillion' && !String(explanation).trim()) throw new Error('Add an explanation for this Councillion answer.');
      const d = this.read(); let answer;
      for (const p of d.packs) for (const q of p.questions) { const a = q.answers.find(a => a.id === answerId); if (a) answer = a; }
      if (!answer) throw new Error('Save this answer first.');
      answer.tier = tier; answer.explanation = requireText(explanation, 1200);
      d.audit.push({ at: this.clock(), action: 'answer_regraded', answerId, tier }); this.write(d); return { ok: true };
    }
  }

  function createAPI(storage, clock = Date.now, fetchImpl = root.fetch?.bind(root)) {
    const local = new LocalStore(storage, clock);
    let config = parse(storage.getItem('councillion.connection.v1'), null), authRefresh = null;
    const sessionKey = admin => 'councillion.' + (admin ? 'admin' : 'guest') + '.session.v1';
    const readSession = admin => parse(storage.getItem(sessionKey(admin)), null);
    const storeSession = (session, admin = false) => { const saved = { ...session, expires_at: session.expires_at || Math.floor(clock() / 1000) + (session.expires_in || 3600) }; storage.setItem(sessionKey(admin), JSON.stringify(saved)); return saved; };
    async function auth(path, body) {
      const res = await fetchImpl(config.url + '/auth/v1/' + path, { method: 'POST', headers: { apikey: config.key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.msg || data.error_description || data.message || 'Could not sign in. Check Supabase authentication settings.'); return data;
    }
    async function token() {
      const admin = !!readSession(true); let s = readSession(admin);
      if (s && s.expires_at * 1000 > clock() + 60000) return s.access_token;
      if (authRefresh) return authRefresh;
      authRefresh = (async () => {
        if (s?.refresh_token) { try { s = storeSession(await auth('token?grant_type=refresh_token', { refresh_token: s.refresh_token }), admin); return s.access_token; } catch { storage.removeItem(sessionKey(admin)); throw new Error('Your session expired. Sign in again; your submitted scores remain saved.'); } }
        s = storeSession(await auth('signup', {}), false); return s.access_token;
      })();
      try { return await authRefresh; } finally { authRefresh = null; }
    }
    async function rpc(name, args = {}) {
      const access = await token();
      const response = await fetchImpl(config.url + '/rest/v1/rpc/' + name, { method: 'POST', headers: { apikey: config.key, Authorization: 'Bearer ' + access, 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
      const value = await response.json().catch(() => null);
      if (!response.ok) throw new Error(value?.message || value?.error || 'The server could not complete that request. Your previous submissions are saved.');
      return value;
    }
    const call = (name, args, fallback) => config ? rpc(name, args) : Promise.resolve().then(fallback);
    const api = {
      tiers: TIERS,
      get mode() { return config ? 'remote' : 'local'; },
      async init() { return config ? rpc('council_profile') : local.profile(); },
      getProfile() { return call('council_profile', {}, () => local.profile()); },
      enter(username) { return call('council_enter', { p_username: username }, () => local.enter(username)); },
      getConfig() { return config ? { ...config } : null; },
      configure(input) {
        const url = String(input.url || '').trim().replace(/\/+$/, ''), key = String(input.key || '').trim();
        let parsedURL; try { parsedURL = new URL(url); } catch { throw new Error('Enter your Supabase project URL.'); }
        if (parsedURL.protocol !== 'https:' || parsedURL.username || parsedURL.password || parsedURL.pathname !== '/' || parsedURL.search || parsedURL.hash) throw new Error('Use the HTTPS Supabase project origin without a path.');
        if (!(key.startsWith('sb_publishable_') || key.split('.').length === 3)) throw new Error('Use your Supabase public publishable or anon key.');
        if (key.startsWith('sb_secret_')) throw new Error('Never enter a private service key.');
        if (key.split('.').length === 3) { let payload; try { payload = JSON.parse(root.atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch { throw new Error('That key is not valid.'); } if (payload.role !== 'anon') throw new Error('Only a public anon key is allowed here. Never enter service-role credentials.'); }
        config = { url, key }; storage.setItem('councillion.connection.v1', JSON.stringify(config)); storage.removeItem(sessionKey(true)); storage.removeItem(sessionKey(false));
      },
      disconnect() { config = null; storage.removeItem('councillion.connection.v1'); storage.removeItem(sessionKey(true)); storage.removeItem(sessionKey(false)); },
      listPacks() { return call('council_packs', { p_admin: false }, () => local.list(false)); },
      begin(id) { return call('council_begin', { p_pack_id: id }, () => local.begin(id)); },
      practice(id, requestId = uuid()) { return call('council_practice', { p_pack_id: id, p_request_id: requestId }, () => local.practice(id, requestId)); },
      resume(id, questionId=null) { return call('council_resume', {p_attempt_id:id,p_question_id:questionId},()=>local.resume(id,questionId)); },
      confirmAnswer(id, questionId, text, requestId=uuid()) { return call('council_confirm_answer',{p_attempt_id:id,p_question_id:questionId,p_answer:text,p_request_id:requestId},()=>local.answer(id,questionId,text,requestId,true)); },
      getState(id) { return call('council_state', { p_attempt_id: id }, () => local.getState(id)); },
      startQuestion(id) { return call('council_next', { p_attempt_id: id }, () => local.next(id)); },
      answer(id, questionId, text, requestId = uuid()) { return call('council_answer', { p_attempt_id: id, p_question_id: questionId, p_answer: text, p_request_id: requestId }, () => local.answer(id, questionId, text, requestId)); },
      getResults(id) { return call('council_results', { p_attempt_id: id }, () => local.results(id)); },
      leaderboard(id = null) { return call('council_leaderboard', { p_pack_id: id }, () => local.leaderboard(id)); },
      async adminLogin(email, password) {
        if (!config) return { id: 'local-host', username: 'Game Master', isAdmin: true };
        storeSession(await auth('token?grant_type=password', { email, password }), true);
        let p; try { p = await rpc('council_profile'); } catch (e) { storage.removeItem(sessionKey(true)); throw e; }
        if (!p?.isAdmin) { storage.removeItem(sessionKey(true)); throw new Error('This account is not a Game Master. Ask the owner to grant access in Supabase.'); } return p;
      },
      async adminLogout() { storage.removeItem(sessionKey(true)); },
      adminList() { return call('council_packs', { p_admin: true }, () => local.list(true)); },
      adminGet(id) { return call('council_admin_get', { p_pack_id: id }, () => local.get(id)); },
      adminSave(pack) { return call('council_admin_save', { p_pack: pack }, () => local.save(pack)); },
      adminVisibility(id,published) { return call('council_admin_visibility',{p_pack_id:id,p_published:published},()=>local.visibility(id,published)); },
      adminDelete(id) { return call('council_admin_delete',{p_pack_id:id},()=>local.deletePack(id)); },
      adminReviews() { return call('council_reviews', {}, () => local.reviews()); },
      adminReview(x) { return call('council_review', { p_submission_id: x.submissionId, p_answer_id: x.answerId || null, p_reject: !!x.reject, p_override_points: x.overridePoints ?? null, p_note: x.note || '', p_new_answer: x.newAnswer || null, p_apply_to_matching: x.applyToMatching !== false }, () => local.review(x)); },
      adminRegradeAnswer(x) { return call('council_regrade_answer', { p_answer_id: x.answerId, p_tier: x.tier, p_explanation: x.explanation || '' }, () => local.regrade(x)); },
      async exportPacks() { const packs = await api.adminList(); return Promise.all(packs.map(p => api.adminGet(p.id))); },
      async importPacks(packs) {
        if (!Array.isArray(packs) || packs.length > 50) throw new Error('Import a JSON array containing at most 50 packs.');
        const saved = [];
        for (const value of packs) { const p = clone(value); delete p.id; p.published = false; for (const q of p.questions || []) { delete q.id; for (const a of q.answers || []) delete a.id; } saved.push(await api.adminSave(p)); }
        return saved;
      }
    };
    return api;
  }
  // Tests use isolated storage and a deterministic clock; no server or packages needed.
  if (typeof module !== 'undefined' && module.exports) module.exports = { createAPI, LocalStore, normalize, typoDistance, matchAnswer, TIERS };
  if (root.document) {
    let storage;
    try { storage = root.localStorage; storage.getItem('councillion.storage-check'); } catch {
      const m = new Map(); storage = { getItem: k => m.get(k) || null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
      root.CouncilStorageUnavailable = true;
    }
    root.CouncilAPI = createAPI(storage);
    if (!root.CouncilAPI.getConfig() && root.COUNCIL_CONFIG?.url && root.COUNCIL_CONFIG?.key) {
      try { root.CouncilAPI.configure(root.COUNCIL_CONFIG); } catch (e) { root.CouncilConfigurationError = e.message; }
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
