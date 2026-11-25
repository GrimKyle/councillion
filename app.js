(function () {
  'use strict';
  const api = window.CouncilAPI;
  const app = document.getElementById('app');
  const dialogRoot = document.getElementById('dialog-root');
  const TIERS = [
    { id: 'councillion', name: 'One in a Councillion', points: 100 },
    { id: 'grimkyle', name: 'Grimkyle', points: 85 },
    { id: 'donovan', name: 'Donovan', points: 60 },
    { id: 'cavaughn', name: 'Cavaughn', points: 30 },
    { id: 'kalen', name: 'Kalen', points: 15 },
    { id: 'dino', name: 'Dino', points: 10 }
  ];
  const S = { screen: 'home', packs: [], profile: null, game: null, results: null,
    board: [], boardPack: '', editor: null, review: [], reviewFilter: 'all', adminPacks: [], busy: false,
    error: '', notice: '', dialog: null, afterName: null, clockOffset: 0,
    sound: readStore('councillion.sound', 'on') === 'on', timerRequest: false,
    editorQuestion: 0, savedAnswerIds: new Set(), lastFocus: null, introDone: false, animating:false, preserveQuestion:false, animationFrom:0, animationGoldBefore:false, invalid:'', suggestion:null, search:'' };
  const e = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function readStore(key, fallback) { try { return localStorage.getItem(key) || fallback; } catch (_) { return fallback; } }
  function writeStore(key, value) { try { localStorage.setItem(key, value); } catch (_) {} }
  function tierFor(tier, points) { return TIERS.find(t => t.id === tier || t.name === tier || (tier == null && t.points === points)); }
  function tierLabel(tier, points) { return tierFor(tier, points)?.name || 'Unranked'; }
  function tierId(tier, points) { return tierFor(tier, points)?.id || 'incorrect'; }
  function tierBadge(tier, points) { return `<span class="tier-chip" data-tier="${e(tierId(tier, points))}">${e(tierLabel(tier, points))}</span>`; }
  const isRemote = () => api && (api.mode === 'remote' || api.mode === 'cloud' || api.configured === true);
  const isAdmin = () => !!S.profile?.isAdmin || !isRemote();
  const newId = () => window.crypto?.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const n=Math.random()*16|0;return(c==='x'?n:(n&3|8)).toString(16);});
  const PACK_COLORS=[{id:'#d38966',name:'Orange'},{id:'#b7a0ce',name:'Purple'},{id:'#85b8ad',name:'Teal'},{id:'#d58cab',name:'Pink'}];
  function packColor(pack){return /^#[0-9a-f]{6}$/i.test(pack.color||'')?pack.color:'#d38966';}
  function packColorName(pack){return (PACK_COLORS.find(c=>c.id===pack.color)?.name||'orange').toLowerCase();}
  function turkey(state = 'idle', small = false) {
    const gold = state === 'gold';
    const palette = gold ? ['#dcae47','#ffdf74','#fff0ab','#8c571f','#fff4df'] : ['#ec7252','#f3aa57','#d34c69','#78364e','#fff4df'];
    return `<svg class="turkey-svg turkey-${e(state)}${small ? ' turkey-small' : ''}" role="img" aria-label="${gold ? 'Golden Councillion turkey' : 'The Council’s pixel turkey mascot'}" viewBox="0 0 40 40" shape-rendering="crispEdges"><g class="turkey-tail"><path fill="${palette[3]}" d="M5 10h5V6h6V3h8v3h6v4h5v12h-5v7H10v-7H5z"/><path fill="${palette[0]}" d="M7 11h5v11H7zm21 0h5v11h-5zM11 7h5v16h-5zm13 0h5v16h-5z"/><path fill="${palette[1]}" d="M17 5h6v18h-6zM8 13h3v6H8zm21 0h3v6h-3z"/><path fill="${palette[2]}" d="M13 9h3v11h-3zm11 0h3v11h-3z"/></g><path fill="${palette[3]}" d="M13 20h14v4h3v9h-4v3H14v-3h-4v-9h3z"/><path fill="${palette[0]}" d="M16 22h9v4h3v6h-4v2h-9v-3h-3v-6h4z"/><path fill="${palette[1]}" d="M16 12h10v3h3v10h-3v3H16v-3h-3V15h3z"/><path fill="${palette[4]}" d="M16 15h4v5h-4zm7 0h4v5h-4z"/><path fill="#211722" d="M18 16h2v3h-2zm5 0h2v3h-2z"/><path fill="${gold ? '#fff0ab' : '#ffdc77'}" d="M20 20h6v3h-6z"/><path fill="${palette[2]}" d="M23 23h3v5h-3z"/><g class="turkey-leg-left"><path fill="${palette[1]}" d="M15 35h3v3h-7v-2h4z"/></g><g class="turkey-leg-right"><path fill="${palette[1]}" d="M23 35h3v1h4v2h-7z"/></g><path fill="${palette[4]}" opacity=".4" d="M16 24h2v4h-2z"/></svg>`;
  }
  function icon(name) { return ({ packs:'▦', board:'▤', host:'⚑', sound:'♪', muted:'♩', star:'✦', next:'→', close:'×', gear:'⚙', check:'✓', lock:'▣' })[name] || '✦'; }
  function packIcon(pack) { return ({ turkey:'✦', crown:'♛', game:'✚', music:'♫', film:'▣', globe:'◎', food:'♨', sport:'⚑', book:'▥', star:'✦' })[pack.icon] || '✦'; }
  function busyText(normal) { return S.busy ? 'Working…' : normal; }
  function header() {
    if(S.screen==='game')return `<header class="topbar game-topbar" ${S.animating?'inert aria-hidden="true"':''}><button class="brand" data-action="home" aria-label="Councillion home"><span class="brand-icon">${turkey('idle',true)}</span><span>COUNCILLION</span></button><div class="header-actions"><button class="sound-toggle" data-action="sound" aria-pressed="${S.sound}" aria-label="${S.sound?'Disable':'Enable'} sound effects">${icon(S.sound?'sound':'muted')}</button><details class="game-menu"><summary aria-label="Open game menu">☰</summary><nav class="game-menu-panel" aria-label="Game navigation"><button data-action="packs">Packs</button><button data-action="leaderboard">Leaderboard</button><button data-action="how">How to play</button><button data-action="username">${e(S.profile?.username||'Your username')}</button></nav></details></div></header>`;
    return `<header class="topbar"><button class="brand" data-action="home" aria-label="Councillion home"><span class="brand-icon">${turkey('idle', true)}</span><span>COUNCILLION<span class="brand-subtitle">THE COUNCIL HAS SPOKEN.</span></span></button><nav class="nav-links" aria-label="Main navigation"><button class="nav-btn ${['home','packs'].includes(S.screen) ? 'active' : ''}" data-action="packs">${icon('packs')} Packs</button><button class="nav-btn ${S.screen === 'leaderboard' ? 'active' : ''}" data-action="leaderboard">${icon('board')} Leaderboard</button><button class="nav-btn" data-action="how">How to play</button></nav><div class="header-actions"><button class="sound-toggle" data-action="sound" aria-pressed="${S.sound}" aria-label="${S.sound ? 'Disable' : 'Enable'} sound effects">${icon(S.sound ? 'sound' : 'muted')}</button><button class="nav-btn player-button" data-action="username">${S.profile?.username ? e(S.profile.username) : 'Enter username'} <span aria-hidden="true">↗</span></button></div></header>`;
  }
  function footer() {
    return `<footer class="footer"><span>SEVEN QUESTIONS. ZERO OBVIOUS ANSWERS.</span><div><span class="mode-indicator ${isRemote() ? 'mode-live' : ''}">${isRemote() ? '● Connected · shared scores' : '◦ This browser only'}</span><button data-action="settings">Connection settings</button><button data-action="admin">Game Master ${icon('next')}</button></div><span>MADE FOR THE COUNCIL.</span></footer>`;
  }
  function render() {
    const answerWasFocused=document.activeElement?.id==='answer';
    window.CouncilArcade?.destroy();
    document.documentElement?.classList?.toggle('game-open',S.screen==='game');
    const screen = ({home: homeView, packs: packsView, leaderboard: leaderboardView, game: gameView, results: resultsView, admin: adminView, editor: editorView, how: howView})[S.screen] || homeView;
    app.innerHTML = `<div class="app-shell ${S.screen==='game'?`playing-arcade${S.animating?' motion-running':''}`:''}">${header()}<main id="main" class="container" tabindex="-1">${S.error ? `<p class="error-message" role="alert">${e(S.error)}</p>` : ''}${S.notice ? `<p class="success-message" role="status">${e(S.notice)}</p>` : ''}${screen()}</main>${footer()}</div>`;
    document.title = `${({game:'Play',results:'Your results',admin:'Game Master',editor:'Pack editor',leaderboard:'Leaderboard',packs:'Packs',how:'How to play'})[S.screen] || 'The Council has spoken.'} · Councillion`;
    renderDialog();
    window.CouncilArcade?.setSound(S.sound);
    syncViewport();
    if(S.screen==='game')window.CouncilArcade?.mount(document.getElementById('arcade-stage')||app);
    if(S.screen==='results')filterAnswers(S.search);
    if (S.screen === 'game') {
      updateTimer();
      const input = document.getElementById('answer');
      if (input) { input.value = readStore(`councillion.draft.${S.game.id}.${S.game.question?.id}`, ''); if(answerWasFocused||!window.matchMedia?.('(pointer: coarse)').matches)setTimeout(() => input.focus({preventScroll:true}), 20); }
    }
  }
  function homeView() {
    return `<section class="hero"><div class="hero-copy"><div class="eyebrow"><span class="status-dot"></span> THE COUNCIL IS IN SESSION</div><h1 class="hero-title">THINK<br><span class="outline-word">LESS</span><br>OBVIOUS.</h1><p class="hero-subtitle">The right answer is a start.<br>The one nobody thought of? <strong>That’s a Councillion.</strong></p><div class="hero-cta"><button class="button primary" data-action="packs">CHOOSE YOUR PACK <span>→</span></button><button class="button secondary" data-action="how">HOW IT WORKS</button></div><div class="hero-stats"><div class="hero-stat"><strong>07</strong><span>QUESTIONS</span></div><div class="hero-stat"><strong>25<span>s</span></strong><span>PER ANSWER</span></div><div class="hero-stat"><strong>700</strong><span>POINTS TO GLORY</span></div></div></div><div class="hero-art" aria-label="The Councillion turkey is waiting for your rarest answer"><span class="pixel-star star-one">✦</span><span class="pixel-star star-two">+</span><span class="pixel-star star-three">✦</span><div class="turkey-bubble">GOT ANYTHING<br>LESS OBVIOUS?</div><div class="turkey-stage">${turkey()}</div><div class="mascot-caption"><span>MEET YOUR JUDGE.</span><strong>HE’S SEEN YOUR ANSWERS.</strong></div><span class="art-coordinate">EST. THE COUNCIL</span></div></section><section class="packs-section"><div class="section-heading"><div><p class="eyebrow">PICK YOUR BATTLE</p><h2 class="section-title">THE PACKS<span class="section-count">${S.packs.length.toString().padStart(2, '0')}</span></h2></div><button class="text-button" data-action="packs">View all packs →</button></div>${packGrid(S.packs.slice(0, 3))}</section><section class="rarity-section"><div><p class="eyebrow">CORRECT IS GOOD. OBSCURE IS BETTER.</p><h2 class="section-title">CLIMB THE COUNCIL.</h2></div><div class="tier-strip">${[...TIERS].reverse().map((t,i) => `<div class="tier-stop" data-tier="${t.id}"><span class="tier-symbol">${['·','✧','◆','✦','✷','♛'][i]}</span><strong>${t.points}</strong><span>${e(t.name)}</span></div>`).join('')}</div></section>`;
  }
  function packGrid(packs) {
    if (!packs.length) return `<div class="empty-state"><div class="empty-icon">${icon('packs')}</div><div><h3>Every great session starts with a pack.</h3><p>Your Game Master hasn’t published a pack yet. Build or upload a seven-question pack, then publish it for everyone to play.</p></div><button class="button secondary" data-action="admin">CREATE THE FIRST PACK →</button></div>`;
    return `<div class="pack-grid">${packs.map((pack,index) => `<article class="pack-card" data-color="${e(packColorName(pack))}" style="--pack-accent:${packColor(pack)}"><div class="pack-art"><span class="pack-tag">PACK ${(index+1).toString().padStart(2,'0')}</span><span class="pack-art-icon" aria-hidden="true">${packIcon(pack)}</span><span class="pack-art-stars" aria-hidden="true">+ · ✦</span>${pack.myAttempt?.status === 'completed' ? '<span class="pack-complete">✓ COMPLETED</span>' : ''}</div><div class="pack-body"><h3 class="pack-title">${e(pack.title)}</h3><p class="pack-description">${e(pack.description || 'Seven questions. Your rarest answers. The Council is waiting.')}</p><div class="pack-meta"><span>7 QUESTIONS</span><span>25 SEC / QUESTION</span></div><button class="button wide ${pack.myAttempt?.status === 'completed' ? 'secondary' : 'primary'}" data-action="play" data-id="${e(pack.id)}">${pack.myAttempt?.status === 'completed' ? 'VIEW FIRST-RUN RESULTS' : pack.myAttempt ? 'RESUME PACK' : 'PLAY PACK'} <span>→</span></button>${pack.myAttempt?.status === 'completed' ? `<button class="button secondary wide" data-action="${pack.myPractice?'resume-practice':'replay'}" data-id="${e(pack.myPractice?.id || pack.id)}">${pack.myPractice?'RESUME REPLAY':'REPLAY PACK'} ↻</button>` : ''}<button class="text-button pack-board-link" data-action="pack-board" data-id="${e(pack.id)}">${Number(pack.completedCount || 0)} finished · View leaderboard ↗</button></div></article>`).join('')}</div>`;
  }
  function packsView() {
    return `<section class="page-intro"><p class="eyebrow">YOUR NEXT CLAIM TO FAME</p><h1 class="section-title">CHOOSE YOUR PACK.</h1><p class="section-subtitle">Same seven questions for everyone. A different way to show what you know.</p></section>${packGrid(S.packs)}<p class="local-note">${isRemote() ? 'Your first run sets your leaderboard score. Finish it to unlock unlimited replays. Progress is saved as you play.' : 'You’re in local mode. Packs and scores stay on this browser. Connect Supabase in settings to play together across devices.'}</p>`;
  }
  function howView() {
    return `<section class="page-intro"><p class="eyebrow">A BRIEFING FROM THE COUNCIL</p><h1 class="section-title">KNOW THE OBSCURE.</h1></section><div class="rules-grid"><section class="rules-card"><span class="rule-number">01</span><h2>Pick a pack.</h2><p>Enter your username and choose a pack of seven questions written by your Game Master.</p></section><section class="rules-card"><span class="rule-number">02</span><h2>Think past the obvious.</h2><p>You have 25 seconds per question. Type one correct answer and lock it in. A rare answer scores more than a common one.</p></section><section class="rules-card"><span class="rule-number">03</span><h2>Meet your judgment.</h2><p>After all seven questions, see your score and every ranked answer. Your first run counts for the leaderboard; afterward, replay as often as you want for fun.</p></section></div><div class="notice"><strong>Correct answers lock in.</strong> Invalid answers let you retry until the same 25 seconds expire. Accepted answers send your turkey deeper; a Councillion transforms it into gold. Full answer lists unlock after question seven. Returning to an interrupted run skips that question for zero.</div><section class="rarity-section"><h2 class="section-title">THE SIX RANKS.</h2><div class="tier-strip">${TIERS.map(t => `<div class="tier-stop" data-tier="${t.id}"><strong>${t.points}</strong><span>${e(t.name)}</span></div>`).join('')}</div></section><button class="button primary" data-action="packs">I’M READY →</button>`;
  }
  function suggestionView() {
    return S.suggestion?`<div class="answer-suggestion"><button type="button" class="button primary" data-action="confirm-suggestion" ${S.busy?'disabled':''}>YES, USE IT</button><button type="button" class="button secondary" data-action="dismiss-suggestion">KEEP TYPING</button></div>`:'';
  }
  function questionView(g,locked) {
    return `<div class="question-ui"><div class="burrow-prompt"><p class="eyebrow">QUESTION ${locked+1} / 7</p><h1>${e(g.question.prompt)}</h1><p>THE RARER THE ANSWER, THE DEEPER THE BURROW.</p></div><form data-form="answer" class="burrow-controls ${S.invalid?'answer-rejected':''}"><div class="burrow-feedback" role="status" aria-live="polite">${e(S.suggestion?`Did you mean “${S.suggestion.candidate}”?`:S.invalid||'Think past your first answer.')}</div><div class="answer-suggestion-slot">${suggestionView()}</div><div class="burrow-input-row"><div class="timer"><span id="timer-value">25</span><small>SEC</small></div><label class="screen-reader-only" for="answer">Your answer</label><input id="answer" class="answer-input" name="answer" type="text" inputmode="text" enterkeyhint="go" autocapitalize="none" autocorrect="off" maxlength="200" autocomplete="off" spellcheck="false" placeholder="Type one answer…" ${S.busy?'disabled':''}><button class="button primary" ${S.busy?'disabled':''}>BURROW ▼</button></div><div class="timer-track"><div id="timer-fill" class="timer-fill"></div></div><p>Invalid guess? Try again. Blank answer skips. The clock keeps ticking.</p></form></div>`;
  }
  function revealView(g,last,locked) {
    return `<div class="result-ui"><div class="burrow-reveal ${last?.points===100?'is-gold':''}" data-tier="${e(last?.tier||'incorrect')}" role="status" aria-live="polite"><p class="eyebrow">${last?.points===100?'ONE IN A COUNCILLION!':last?.points?e(tierLabel(last.tier,last.points)).toUpperCase():'NO ANSWER · NO DEPTH'}</p><h1>${e(last?.canonical||'THE BURROW WAITS.')}</h1><strong class="burrow-award">+${Number(last?.points||0)} PTS <span>· ${Number(last?.points||0)*10}m DEEPER</span></strong>${last?.explanation?`<p class="burrow-explanation">${e(last.explanation)}</p>`:''}<p>${last?.points===100?'THE COUNCIL HAS SPOKEN.':`${locked} OF 7 ANSWERS LOCKED`}</p></div><div class="burrow-controls reveal-controls"><button class="button primary" data-action="${g.status==='completed'?'finish-results':'next-question'}" ${S.busy?'disabled':''}>${g.status==='completed'?'SEE YOUR RESULTS ▼':'BURROW AGAIN ▼'}</button><p>${g.status==='completed'?'All seven answers are locked.':`Question ${locked+1} of 7 · The next timer starts when you continue.`}</p></div></div>`;
  }
  function gameView() {
    const g=S.game;if(!g)return '<p>Opening the burrow…</p>';
    const locked=Number(g.lockedCount||0),active=g.status==='active'&&g.question;
    const last=g.lastAnswer||g.history?.at(-1)||null;
    const visibleLocked=S.animating?Math.max(0,locked-1):locked;
    const score=S.animating?S.animationFrom:Number(g.runScore||0);
    const gold=S.animating?S.animationGoldBefore:!!g.hasCouncillion;
    const sprite=turkey(gold?'gold':active?'thinking':'happy');
    const scene=window.CouncilArcade?.scene({turkeySVG:sprite,score,tier:last?.tier,gold,phase:S.animating?'descending':active?'thinking':'reveal',question:locked,progress:locked})||`<div class="arcade-scene">${sprite}</div>`;
    const dots=`<div class="burrow-progress" aria-label="${visibleLocked} of 7 completed">${Array.from({length:7},(_,i)=>`<span class="${i<visibleLocked?'done':i===visibleLocked?'current':''}" data-tier="${e(i<visibleLocked?g.history?.[i]?.tier||'':'')}">${i<visibleLocked?'◆':'·'}</span>`).join('')}</div>`;
    return `<section class="arcade-shell ${S.animating?'is-in-flight':active?'is-answering':'is-result'}" aria-label="Councillion underground arcade">${scene}<div class="burrow-hud"><div class="burrow-meter"><span>DEPTH</span><strong id="burrow-depth">${(score*10).toLocaleString()}<small>m</small></strong></div><div class="burrow-hud-center"><span>${e(g.title)}</span>${dots}<small>${g.isOfficial===false?'REPLAY · FIRST SCORE SAVED':'FIRST RUN · LEADERBOARD ATTEMPT'}</small></div><div class="burrow-meter score-meter"><span>SCORE</span><strong id="burrow-score">${score}</strong></div></div>${S.animating?'<p class="screen-reader-only" role="status">The turkey is burrowing. Your result appears when it stops.</p>':active?questionView(g,locked):revealView(g,last,locked)}${S.animating?'':`<div class="burrow-caption">${gold?'THE GOLDEN COUNCIL TURKEY':'THE COUNCIL’S GREAT BURROW'} · ${locked}/7 QUESTIONS</div>`}</section>`;
  }
  function patchQuestionFeedback() {
    const form=document.querySelector?.('[data-form="answer"]');
    const feedback=form?.querySelector('.burrow-feedback'),slot=form?.querySelector('.answer-suggestion-slot');
    if(!form||!feedback||!slot)return false;
    form.classList.toggle('answer-rejected',!!S.invalid);
    feedback.textContent=S.suggestion?`Did you mean “${S.suggestion.candidate}”?`:S.invalid||'Think past your first answer.';
    slot.innerHTML=suggestionView();updateTimer();if(app.querySelector?.('.playing-arcade')?.classList.contains('keyboard-open'))form.scrollIntoView?.({block:'end',inline:'nearest'});return true;
  }
  let viewportBaseline=0,viewportWidth=0;
  function syncViewport() {
    const viewport=window.visualViewport;
    const height=viewport?.height||window.innerHeight;
    const root=document.documentElement;
    if(height)root?.style?.setProperty('--game-viewport-height',Math.round(height)+'px');
    root?.style?.setProperty('--game-viewport-top',Math.max(0,viewport?.offsetTop||0)+'px');
    const width=window.innerWidth||viewport?.width||0;
    if(Math.abs(width-viewportWidth)>80){viewportBaseline=0;viewportWidth=width;}
    const editing=/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName||'');
    if(!editing)viewportBaseline=Math.max(viewportBaseline,height||0,window.innerHeight||0);
    const shell=app.querySelector?.('.playing-arcade');
    const keyboardOpen=!!height&&(window.innerHeight-height>130||(editing&&viewportBaseline-height>130));
    const wasOpen=shell?.classList.contains('keyboard-open');
    shell?.classList.toggle('keyboard-open',keyboardOpen);
    if(keyboardOpen&&!wasOpen)document.getElementById('answer')?.scrollIntoView?.({block:'nearest',inline:'nearest'});
    window.CouncilArcade?.resize?.();
  }
  window.visualViewport?.addEventListener('resize',syncViewport);
  window.visualViewport?.addEventListener('scroll',syncViewport);
  window.addEventListener?.('resize',syncViewport);
  function resultsView() {
    const r = S.results;
    if (!r) return '<p>Opening results…</p>';
    const rows = r.questions || [];
    const golds = rows.filter(q => Number(q.points) === 100);
    return `<section class="results-hero"><p class="eyebrow">${e(r.title)} · ${e(r.username || S.profile?.username)}</p><h1 class="section-title">THE COUNCIL<br>HAS SPOKEN.</h1><div class="results-score-row"><div class="score-total">${Number(r.total || 0)}<span>/ 700</span></div>${turkey(golds.length ? 'gold' : Number(r.total)>350?'happy':'idle')}</div><p class="section-subtitle">${golds.length ? `${golds.length} One in a Councillion ${golds.length===1?'answer':'answers'}. A performance for the Council archives.` : 'Seven answers. One judgment. See how you got here.'}</p>${Number(r.pendingCount)>0 ? `<p class="notice">${Number(r.pendingCount)} ${Number(r.pendingCount)===1?'answer is':'answers are'} awaiting Game Master review. Your score is provisional and will update after review.</p>` : ''}${r.isOfficial===false ? `<p class="notice">REPLAY SCORE ONLY · Your first-run leaderboard score remains <strong>${Number(r.officialScore||0)}/700</strong>.</p>` : `<p class="notice">FIRST-RUN SCORE · Saved to the leaderboard. You can now replay this pack as often as you like.</p>`}<div class="section-actions"><button class="button primary" data-action="pack-board" data-id="${e(r.packId)}">VIEW LEADERBOARD →</button><button class="button secondary" data-action="share-results">COPY SCORE</button><button class="text-button" data-action="refresh-results">Refresh results ↻</button></div></section>${golds.length ? `<section class="achievement-banner"><div class="achievement-star" aria-hidden="true">♛</div><div><p class="eyebrow">ONE IN A COUNCILLION!</p><h2>THE COUNCIL HAS SPOKEN.</h2>${golds.map(q=>`<p><strong>${e(q.canonical || q.rawAnswer)}</strong>${q.explanation ? ` — ${e(q.explanation)}` : ''}</p>`).join('')}</div><span class="achievement-points">+${golds.length*100}</span></section>` : ''}<section><div class="section-heading"><div><p class="eyebrow">THE FULL PICTURE</p><h2 class="section-title">YOUR SEVEN ANSWERS.</h2></div><p class="hint">Open a question to explore every answer.</p></div><div class="answer-search-toolbar"><label class="field" for="answer-search">SEARCH THE ANSWER ARCHIVE<input id="answer-search" class="input" type="search" placeholder="Search answers, ranks or explanations…" value="${e(S.search)}" autocomplete="off"></label><span id="answer-search-count" role="status" aria-live="polite"></span></div><div class="result-list">${rows.map((q,i) => resultCard(q,i)).join('')}</div></section><div class="section-actions results-bottom"><button class="button primary" data-action="replay" data-id="${e(r.packId)}">REPLAY PACK ↻</button>${r.isOfficial===false?`<button class="button secondary" data-action="official-results" data-id="${e(r.officialAttemptId)}">VIEW FIRST-RUN RESULTS</button>`:''}<button class="button secondary" data-action="packs">BACK TO PACKS →</button></div>`;
  }
  function resultCard(q,i) {
    const points = Number(q.points || 0);
    const chosen = q.canonical || q.rawAnswer || 'No answer';
    const pop = q.popularity || {};
    return `<details data-answer-card class="result-card" data-tier="${e(tierId(q.tier,points))}"><summary class="result-summary"><span class="result-number">${String(i+1).padStart(2,'0')}</span><div class="result-answer"><h3>${e(q.prompt)}</h3><p><span class="your-answer">${e(chosen)}</span>${q.rawAnswer && q.canonical && q.rawAnswer !== q.canonical ? `<span class="text-muted"> · you typed “${e(q.rawAnswer)}”</span>` : ''}</p>${points ? tierBadge(q.tier,points) : `<span class="badge">${q.reviewStatus === 'pending'?'PENDING REVIEW':'NO POINTS'}</span>`}</div><span class="result-points">+${points}</span><span class="expand-icon" aria-hidden="true">+</span></summary><div class="result-detail">${q.explanation && points===100 ? `<div class="notice gold-note"><strong>ONE IN A COUNCILLION</strong><p>${e(q.explanation)}</p></div>` : ''}<p class="hint">${Number(pop.count || 0)} of ${Number(pop.total || 0)} completed players chose your recognized answer (${formatPct(pop.percentage)}%). Percentages include every completed official attempt.</p><p class="eyebrow">ALL ACCEPTED ANSWERS · RAREST FIRST</p>${TIERS.map(t=>{const answers=(q.answers||[]).filter(a=>tierId(a.tier,a.points)===t.id);return `<section data-answer-group class="answer-group" data-tier="${t.id}"><div class="answer-group-heading"><h4>${e(t.name)}</h4><span>${t.points} PTS · ${answers.length} ${answers.length===1?'ANSWER':'ANSWERS'}</span></div>${answers.length?answers.map(a=>`<div data-answer-search="${e(searchKey([a.canonical,t.name,a.explanation].join(' ')))}" class="answer-row ${a.canonical===q.canonical?'selected-answer':''}"><div><strong>${e(a.canonical)}</strong>${a.canonical===q.canonical?'<span class="badge">YOUR ANSWER</span>':''}${a.explanation?`<p>${e(a.explanation)}</p>`:''}</div><span>${Number(a.count||0)} players · ${formatPct(a.percentage)}%</span></div>`).join(''):'<p class="hint">No answers in this rank.</p>'}</section>`;}).join('')}</div></details>`;
  }
  function searchKey(value){return String(value||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');}
  function filterAnswers(query){
    const key=searchKey(query);let count=0;
    document.querySelectorAll('[data-answer-card]').forEach(card=>{
      let visible=0;card.querySelectorAll('[data-answer-search]').forEach(row=>{const match=!key||row.dataset.answerSearch.includes(key);row.hidden=!match;if(match){visible++;count++;}});
      card.querySelectorAll('[data-answer-group]').forEach(group=>{group.hidden=!!key&&![...group.querySelectorAll('[data-answer-search]')].some(row=>!row.hidden);});
      card.hidden=!!key&&!visible;if(key&&visible)card.open=true;
    });
    const label=document.getElementById('answer-search-count');if(label)label.textContent=key?`${count} matching ${count===1?'answer':'answers'}`:'';
  }
  function formatPct(value) { const n=Number(value || 0); return Number.isFinite(n) ? n.toFixed(n%1?1:0) : '0'; }
  function leaderboardView() {
    const selected = S.packs.find(p=>p.id===S.boardPack);
    return `<section class="page-intro"><p class="eyebrow">FRIENDSHIPS WILL BE TESTED</p><h1 class="section-title">THE COUNCIL<br>STANDINGS.</h1><p class="section-subtitle">${selected ? e(selected.title) : 'The running total across all completed packs.'}</p></section><div class="leaderboard-tabs"><button class="nav-btn ${!S.boardPack?'active':''}" data-action="board-select" data-id="">ALL PACKS</button>${S.packs.map(p=>`<button class="nav-btn ${S.boardPack===p.id?'active':''}" data-action="board-select" data-id="${e(p.id)}">${e(p.title)}</button>`).join('')}</div>${S.board.length?`<div class="table-wrap"><table class="ranking-table"><thead><tr><th scope="col">RANK</th><th scope="col">PLAYER</th><th scope="col">SCORE</th><th scope="col">${S.boardPack?'COUNCILLIONS':'PACKS'}</th></tr></thead><tbody>${S.board.map((row,i)=>`<tr class="${row.username===S.profile?.username?'your-score':''}"><td><span class="rank-number rank-${Number(row.rank||i+1)}">${Number(row.rank||i+1)===1?'♛':String(row.rank||i+1).padStart(2,'0')}</span></td><th scope="row">${e(row.username)}<div class="leader-marks" aria-label="Answer rarity marks">${(row.marks||[]).map((mark,j)=>{const t=tierFor(row.markTiers?.[j]);return `<span title="Question ${j+1}: ${e(t?.name||'No answer')} · ${t?.points||0} points" aria-label="Question ${j+1}: ${t?.points||0} points">${e(mark)}</span>`;}).join('')}</div>${row.username===S.profile?.username?' <span class="badge">YOU</span>':''}${row.pending?'<span class="badge">PROVISIONAL</span>':''}</th><td class="leader-score">${Number(row.score||0)}${S.boardPack?'<span>/700</span>':''}</td><td>${S.boardPack?Number(row.ones||0):Number(row.games||0)}</td></tr>`).join('')}</tbody></table></div>`:`<div class="empty-state"><div class="empty-icon">♛</div><div><h2>The throne is unclaimed.</h2><p>Complete a pack to put your name on the board.</p></div><button class="button primary" data-action="packs">PLAY A PACK →</button></div>`}<p class="score-mark-legend">🟨 100 · 🟪 85 · 🟧 60 · 🟦 30 · 🟩 15 · ⬜ 10 · ⬛ 0<br>Each symbol is one question’s score.${S.boardPack?'':' All packs shows the latest completed first run.'}</p><p class="local-note">Only first runs count. Replays never replace your leaderboard score. Equal scores share a rank. ${isRemote()?'Scores are assigned automatically when players finish. Any later Game Master corrections also update standings.':'This leaderboard shows players saved on this browser. Connect Supabase in settings for a shared leaderboard.'}</p>`;
  }
  function invalidHistoryCard(item){return `<article class="review-card"><p class="eyebrow">${e(item.username)} · INVALID GUESS</p><h3>${e(item.prompt)}</h3><p class="review-answer">“${e(item.rawAnswer)}”</p><p class="hint">Rejected during play. The player could retry until time expired. Saved here for future pack improvements.</p></article>`;}
  function filteredReviews() { return S.reviewFilter==='all'?S.review:S.review.filter(item=>['pending','rejected','invalid_attempt'].includes(item.reviewStatus)); }
  function adminView() {
    if (!isAdmin()) return `<section class="page-intro"><p class="eyebrow">THE OTHER SIDE OF THE TABLE</p><h1 class="section-title">GAME MASTER.</h1><p>Sign in with your authorized Game Master account to manage packs and review answers.</p></section><form data-form="admin-login" class="login-form"><label class="field">Email<input class="input" type="email" name="email" autocomplete="username" required></label><label class="field">Password<input class="input" type="password" name="password" autocomplete="current-password" required></label><button class="button primary" ${S.busy?'disabled':''}>${busyText('ENTER THE CHAMBER →')}</button><p style="margin-top:18px"><a href="reset-password.html">Forgot your password?</a></p></form>`;
    return `<section class="page-intro"><p class="eyebrow">YOU SET THE QUESTIONS. YOU MAKE THE CALL.</p><h1 class="section-title">GAME MASTER.</h1>${!isRemote()?'<p class="notice">Local workspace · Packs, answer keys, and scores stay on this browser. This editor is open locally. Connect your backend for protected administration and shared play.</p>':''}</section><div class="admin-toolbar"><h2 class="section-title">YOUR PACKS.</h2><div class="section-actions"><button class="button primary" data-action="new-pack">+ CREATE PACK</button><label class="button secondary" for="import-pack">UPLOAD PACK</label><button class="button secondary" data-action="bulk-pack">PASTE 7 PROMPTS / PACK</button><button class="button secondary" data-action="refresh-admin">REFRESH</button>${isRemote()?'<button class="text-button" data-action="admin-logout">Sign out</button>':''}</div></div>${S.adminPacks.length?`<div class="admin-pack-list">${S.adminPacks.map(p=>`<article class="admin-pack-row"><div><h3>${e(p.title)}</h3><p>${e(p.description || 'No description yet.')}</p><span class="badge">${p.published?'PUBLIC':'PRIVATE / DRAFT'}</span><span class="hint"> ${Number(p.completedCount||0)} completed</span></div><div class="section-actions"><button class="button secondary small" data-action="edit-pack" data-id="${e(p.id)}">EDIT PACK →</button><button class="text-button" data-action="export-pack" data-id="${e(p.id)}">Export</button><button class="button secondary small" data-action="${p.published?'private-pack':'publish-pack'}" data-id="${e(p.id)}">${p.published?'MAKE PRIVATE':'PUBLISH PACK'}</button><button class="button danger small" data-action="delete-pack" data-id="${e(p.id)}">DELETE</button></div></article>`).join('')}</div>`:'<div class="empty-state"><div class="empty-icon">⚑</div><div><h3>Your first pack starts here.</h3><p>Add seven questions and their accepted answers. Nothing is generated for you: you decide every answer and rank.</p></div><button class="button primary" data-action="new-pack">CREATE PACK →</button></div>'}<section class="review-section"><p class="notice">Scoring is automatic. Nothing needs approval. Browse what players typed to improve future packs; any corrections below are optional.</p><div class="section-heading"><div><p class="eyebrow">THE FINAL WORD IS YOURS</p><h2 class="section-title">ANSWER HISTORY.</h2></div><div class="section-actions"><button class="nav-btn ${S.reviewFilter==='unrecognized'?'active':''}" data-action="review-filter" data-id="unrecognized">Unrecognized only</button><button class="nav-btn ${S.reviewFilter==='all'?'active':''}" data-action="review-filter" data-id="all">All answers</button></div></div>${filteredReviews().length?filteredReviews().map(item=>item.actionable===false?invalidHistoryCard(item):`<article class="review-card"><p class="eyebrow">${e(item.packTitle||'PLAYER SUBMISSION')} · ${e(item.username)}</p><span class="badge">${item.isOfficial===false?'REPLAY · ':''}${e((item.reviewStatus||'pending').toUpperCase())}</span><h3>${e(item.prompt)}</h3><p class="review-answer">“${e(item.rawAnswer)}”</p><details><summary class="text-button">Optional correction</summary><form data-form="review" data-id="${e(item.id)}"><label class="field">Map to an existing answer, or create one<select class="select" name="answerId"><option value="">Create a newly accepted answer below</option>${(item.answers||[]).map(a=>`<option value="${e(a.id)}" ${a.id===item.answerId||a.canonical===item.canonical?'selected':''}>${e(a.canonical)} · ${e(tierLabel(a.tier,a.points))}</option>`).join('')}</select></label><div class="form-grid"><label class="field">Canonical answer<input class="input" name="canonical" value="${e(item.canonical||item.suggestedCanonical||item.rawAnswer)}" maxlength="160" required></label><label class="field">Rank<select class="select" name="tier">${TIERS.map(t=>`<option value="${t.id}">${e(t.name)} · ${t.points}</option>`).join('')}</select></label></div><label class="field">Explanation for a Councillion answer<input class="input" name="explanation" maxlength="1000"></label><div class="form-grid"><label class="field">Optional score override<select class="select" name="overridePoints"><option value="">Use the answer’s assigned rank</option><option value="0">0 points</option>${[...TIERS].reverse().map(t=>`<option value="${t.points}">${t.points} points · ${e(t.name)}</option>`).join('')}</select></label><label class="field">Review note<input class="input" name="note" maxlength="500" placeholder="Optional reason for this correction"></label></div><div class="section-actions"><button class="button primary small">APPLY OPTIONAL CORRECTION</button><button type="button" class="button danger small" data-action="reject-review" data-id="${e(item.id)}">SET ZERO POINTS</button></div></form></details></article>`).join(''):`<p class="empty-review">✓ ${S.reviewFilter==='all'?'No submitted answers yet.':'No unrecognized answers recorded.'}</p>`}</section><section class="import-section"><h2>Bring a pack with you.</h2><p class="hint">Upload a text pack, JSON pack or an Excel-compatible CSV/TSV file. You can also paste a full pack or a list of answers. Imported packs stay private until you publish.</p><label class="button secondary small file-label">UPLOAD TXT / JSON / CSV<input id="import-pack" type="file" accept="text/plain,application/json,text/csv,text/tab-separated-values,.txt,.json,.csv,.tsv" class="screen-reader-only"></label></section>`;
  }
  function blankPack() { return {id:null,title:'',description:'',icon:'turkey',color:'#d38966',published:false,questions:Array.from({length:7},()=>({id:newId(),prompt:'',answers:[{id:newId(),canonical:'',tier:'dino',aliases:[],explanation:''}]}))}; }
  function editorView() {
    const pack = S.editor;
    if (!pack) return '<p>Opening the editor…</p>';
    const i=S.editorQuestion, q=pack.questions[i];
    return `<section class="page-intro editor-intro"><button class="text-button" data-action="admin">← BACK TO GAME MASTER</button><p class="eyebrow">MAKE THE COUNCIL THINK</p><h1 class="section-title">${pack.id?'EDIT YOUR PACK.':'BUILD A PACK.'}</h1></section><form data-form="pack-editor"><div class="form-grid"><label class="field">Pack title<input class="input" data-pack-field="title" value="${e(pack.title)}" maxlength="80" placeholder="Give your pack a name" required></label><label class="field">Pack icon<select class="select" data-pack-field="icon">${['turkey','crown','game','music','film','globe','food','sport','book','star'].map(icon=>`<option value="${icon}" ${pack.icon===icon?'selected':''}>${e(icon.charAt(0).toUpperCase()+icon.slice(1))}</option>`).join('')}</select></label><label class="field">Description<textarea class="textarea" data-pack-field="description" maxlength="300" placeholder="What are we getting ourselves into?">${e(pack.description)}</textarea></label><label class="field">Pack color<select class="select" data-pack-field="color">${PACK_COLORS.map(color=>`<option value="${color.id}" ${pack.color===color.id?'selected':''}>${e(color.name)}</option>`).join('')}</select></label></div><div class="question-nav" aria-label="Questions">${pack.questions.map((question,index)=>`<button type="button" class="nav-btn ${index===i?'active':''}" data-action="edit-question" data-index="${index}">Q${index+1}${question.prompt.trim()&&question.answers.some(a=>a.canonical.trim())?' ✓':''}</button>`).join('')}</div><section class="editor-question"><div class="question-editor-header"><p class="eyebrow">QUESTION ${i+1} OF 7</p><span class="badge">25 SECONDS</span></div><label class="field">The question<textarea class="textarea question-textarea" data-question-field="prompt" maxlength="500" placeholder="Write the exact question your players will see…">${e(q.prompt)}</textarea></label><div class="section-heading"><div><h2>Accepted answers</h2><p class="hint">Set the rank yourself. Small, unique typos prompt players to confirm the correction. Use comma-separated aliases for equivalent names such as red apple for Apple.</p></div><div class="section-actions"><button type="button" class="button secondary small" data-action="bulk-answers">PASTE ANSWER LIST</button><button type="button" class="button secondary small" data-action="add-answer">+ ADD ANSWER</button></div></div>${pack.id?'<p class="notice">Already played? Use <strong>Apply rarity correction</strong> on a saved answer to update its rank and explanation. Non-overridden historical scores update automatically. Other question content stays frozen once play begins.</p>':''}<div class="answers-editor">${q.answers.map((a,index)=>`<div class="answer-editor" data-tier="${e(a.tier)}"><div class="answer-editor-main"><label class="field">Answer<input class="input" data-answer-field="canonical" data-answer-index="${index}" value="${e(a.canonical)}" maxlength="160" placeholder="Canonical answer"></label><label class="field">Rank<select class="select" data-answer-field="tier" data-answer-index="${index}">${TIERS.map(t=>`<option value="${t.id}" ${a.tier===t.id?'selected':''}>${e(t.name)} · ${t.points}</option>`).join('')}</select></label><button type="button" class="dialog-close remove-answer" aria-label="Remove answer ${index+1}" data-action="remove-answer" data-index="${index}">×</button></div><label class="field">Aliases<input class="input" data-answer-field="aliases" data-answer-index="${index}" value="${e((a.aliases||[]).join(', '))}" maxlength="2000" placeholder="Alternative name, nickname, other spelling"></label>${a.tier==='councillion'?`<label class="field gold-field">One in a Councillion subtitle<textarea class="textarea" data-answer-field="explanation" data-answer-index="${index}" maxlength="1000" placeholder="Explain what this answer is and why it deserves 100 points…">${e(a.explanation||'')}</textarea></label>`:''}${pack.id&&S.savedAnswerIds.has(a.id)?`<button type="button" class="button secondary small" data-action="regrade-answer" data-index="${index}">APPLY RARITY CORRECTION</button>`:''}</div>`).join('')}</div></section><div class="editor-actions"><button type="button" class="button secondary" data-action="save-draft" ${S.busy?'disabled':''}>${busyText('SAVE DRAFT')}</button><button type="submit" class="button primary" ${S.busy?'disabled':''}>${busyText('PUBLISH PACK →')}</button></div><p class="local-note">Publication requires seven complete questions, at least one accepted answer per question, and an explanation for every Councillion answer. Once someone starts playing, create a new pack for structural changes; score corrections happen through review.</p></form>`;
  }
  function renderDialog() {
    if (!S.dialog) { dialogRoot.innerHTML=''; return; }
    const shell=(title,content)=>`<div class="dialog-backdrop" data-action="dialog-backdrop"><section class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><div class="dialog-header"><h2 id="dialog-title" class="dialog-title">${title}</h2><button class="dialog-close" data-action="close-dialog" aria-label="Close dialog">×</button></div><div class="dialog-content">${content}</div></section></div>`;
    if (S.dialog==='username') dialogRoot.innerHTML=shell('MAKE A NAME FOR YOURSELF.',`<p>Your username goes on the leaderboard. Paste emojis if you like. 🦃</p><form data-form="username"><label class="field" for="username">Username<input id="username" class="input" name="username" value="${e(S.profile?.username||'')}" minlength="2" maxlength="24" autocomplete="nickname" required placeholder="Your Council name"></label><p class="hint">2–24 characters. Letters, numbers and emojis welcome.</p><button class="button primary wide" ${S.busy?'disabled':''}>${busyText('THAT’S ME →')}</button></form>`);
    if (S.dialog==='settings') {
      const config=(typeof api.getConfig==='function'?api.getConfig():{})||{};
      dialogRoot.innerHTML=shell('CONNECT THE COUNCIL.',`<p>Connect your Supabase project to share packs and leaderboards across everyone’s devices.</p><p class="notice">${isRemote()?'Shared backend connected.':'Local mode is active. Nothing is shared with other devices yet.'}</p><form data-form="settings"><label class="field">Supabase project URL<input class="input" name="url" type="url" value="${e(config.url||'')}" placeholder="https://your-project.supabase.co" required></label><label class="field">Public anon / publishable key<textarea class="textarea" name="key" required placeholder="Your project’s public key">${e(config.key||'')}</textarea></label><p class="hint">Use only the public browser key. Never enter a service-role or secret key. The included setup guide explains how to install the backend.</p><button class="button primary wide" ${S.busy?'disabled':''}>SAVE CONNECTION →</button></form>${isRemote()?'<button class="text-button" data-action="disconnect">Switch back to local workspace</button>':''}<p class="hint">Changing connections keeps your local packs on this browser. Existing players need the same backend settings in the hosted site configuration.</p>`);
    }
    if(S.dialog==='bulk-pack')dialogRoot.innerHTML=shell('BUILD A PACK IN ONE PASTE.',`<p>Paste a readable pack, a numbered list of seven prompts, or JSON/CSV/Excel rows. The editor fills all seven questions at once.</p><form data-form="bulk-pack"><label class="field">Pack title (optional if your text includes Pack:)<input class="input" name="title" maxlength="80" placeholder="Your pack title"></label><label class="field">Paste your pack<textarea class="textarea bulk-textarea" name="text" rows="13" required spellcheck="false" autocapitalize="none" autocorrect="off" placeholder="Pack: Your pack name&#10;&#10;Q1: Your first prompt&#10;Answer | 10&#10;Special answer | 100 | alias | Councillion subtitle&#10;&#10;Q2: Your next prompt&#10;…continue through Q7"></textarea></label><p class="hint">Answers go below their question: <strong>Answer | points | aliases | subtitle</strong>. Separate aliases with ;. Bare answer lines use Dino (10). Only have prompts? Paste 1. … through 7. … and add answers later.</p><p class="import-status" data-import-status role="status" aria-live="polite"></p><button class="button primary">FILL ALL 7 QUESTIONS →</button><div class="section-actions"><button type="button" class="text-button" data-action="download-text-template">Download text template</button><button type="button" class="text-button" data-action="download-template">Download Excel CSV template</button></div><details class="bulk-chat-help"><summary>Use a pack prepared in ChatGPT</summary><p>Send your prompts, accepted answers, ranks and special subtitles to ChatGPT. Ask for a Councillion text pack using the format above, then paste the returned block here. Exported JSON files also work. Missing answers can stay in a private draft.</p></details></form>`);
    if(S.dialog==='bulk-answers')dialogRoot.innerHTML=shell('PASTE YOUR ANSWER LIST.',`<p>Add many answers to question ${S.editorQuestion+1}. Each line becomes one accepted answer. Nothing is published yet.</p><form data-form="bulk-answers"><label class="field">Default rank<select class="select" name="tier">${TIERS.map(t=>`<option value="${t.id}" ${t.id==='dino'?'selected':''}>${e(t.name)} · ${t.points}</option>`).join('')}</select></label><label class="field">Answers<textarea class="textarea bulk-textarea" name="text" rows="12" required spellcheck="false" autocapitalize="none" autocorrect="off" placeholder="One answer per line"></textarea></label><p class="hint">For individual ranks, use: Answer | Rank | aliases separated by semicolons | explanation. Pasted Excel columns separated by tabs also work.</p><p class="import-status" data-import-status role="status" aria-live="polite"></p><button class="button primary">ADD THESE ANSWERS →</button></form>`);
    setTimeout(()=>dialogRoot.querySelector('input, button')?.focus(),20);
  }
  function openDialog(name) { S.lastFocus=document.activeElement;S.dialog=name;renderDialog(); }
  function closeDialog() { S.dialog=null;renderDialog();S.lastFocus?.focus?.(); }
  async function run(task, {rerender=true,keepDialog=false}={}) {
    if(S.busy)return;
    S.busy=true;S.error='';S.notice='';
    try { await task(); }
    catch(err) { S.error=err?.message||'Something went wrong. Please try again.';if(S.dialog){if(keepDialog){const status=dialogRoot.querySelector('[data-import-status]');if(status){status.textContent=S.error;status.classList?.add('is-error');}}else closeDialog();} }
    finally { S.busy=false;if(rerender||(keepDialog&&!S.dialog)){if(!S.preserveQuestion||!patchQuestionFeedback())render();S.preserveQuestion=false;} }
  }
  async function refreshPacks() { S.packs=await api.listPacks(); }
  async function navigate(screen) {
    if(S.screen==='game'&&screen!=='game') {
      const active=S.game?.status==='active';
      if(active&&!window.confirm('Leaving uses up this question. When you return, it will score zero and you will continue with the next one. Leave?'))return;
    }
    S.error='';S.notice='';S.screen=screen;
    if(screen==='home'||screen==='packs')await refreshPacks();
    if(screen==='leaderboard')S.board=await api.leaderboard(S.boardPack||null);
    if(screen==='admin'&&isAdmin())await loadAdmin();
    render();window.scrollTo({top:0,behavior:'instant'});
  }
  async function loadAdmin() {
    S.adminPacks=await api.adminList();
    S.review=typeof api.adminReviews==='function'?await api.adminReviews():[];
  }
  async function play(packId) {
    if(!S.profile?.username){S.afterName=()=>play(packId);openDialog('username');return;}
    S.invalid='';S.suggestion=null;
    const existing=S.packs.find(p=>p.id===packId)?.myAttempt;
    if(existing && existing.status!=='completed'){
      const interrupted=await api.getState(existing.id);
      S.game=await api.resume(interrupted.id,interrupted.question?.id||null);
    }else S.game=await api.begin(packId);
    syncClock();
    if(S.game.status==='completed'){await showResults(S.game.id);return;}
    S.screen='game';S.timerRequest=false;render();window.scrollTo({top:0,behavior:'instant'});
  }
  function syncClock() { S.clockOffset=Number(S.game?.serverNow || Date.now())-Date.now(); }
  async function replay(packId) {
    S.invalid='';S.suggestion=null;S.game=await api.practice(packId,newId());syncClock();S.screen='game';S.timerRequest=false;render();window.scrollTo({top:0,behavior:'instant'});
  }
  async function resumePractice(id) {
    const interrupted=await api.getState(id);
    S.invalid='';S.suggestion=null;S.game=await api.resume(id,interrupted.question?.id||null);syncClock();S.timerRequest=false;
    if(S.game.status==='completed'){await showResults(id);return;}
    S.screen='game';render();window.scrollTo({top:0,behavior:'instant'});
  }
  async function showResults(id) {
    S.results=await api.getResults(id);S.screen='results';S.search='';
    writeStore('councillion.lastAttempt',id);
    if((S.results.questions||[]).some(q=>Number(q.points)===100)){beep(true);celebrate();}else beep(false);
    await refreshPacks();
  }
  async function lockAnswer(text, confirmed=false) {
    if(!S.game?.question)return;
    const before=S.game,questionId=before.question.id;
    const requestKey=`councillion.request.${before.id}.${questionId}`;
    const saved=readStore(requestKey,'');let requestId;
    try{const pending=JSON.parse(saved);requestId=pending.text===text&&!!pending.confirmed===confirmed?pending.id:null;}catch(_){}
    requestId=requestId||newId();writeStore(requestKey,JSON.stringify({id:requestId,text,confirmed}));
    S.game=await api[confirmed?'confirmAnswer':'answer'](before.id,questionId,text,requestId);syncClock();S.timerRequest=false;
    try{localStorage.removeItem(requestKey);}catch(_){}
    S.suggestion=null;
    if(S.game.feedback?.kind==='suggestion'){
      S.suggestion={raw:text,candidate:S.game.feedback.candidate};S.invalid='';
      writeStore(`councillion.draft.${before.id}.${questionId}`,text);
      S.preserveQuestion=true;window.CouncilArcade?.sound('suggest');return;
    }
    if(S.game.feedback?.kind==='invalid'){
      S.invalid=S.game.feedback.message||`"${text}" is invalid. Try again.`;
      writeStore(`councillion.draft.${before.id}.${questionId}`,text);
      S.preserveQuestion=true;window.CouncilArcade?.sound('reject');return;
    }
    S.invalid='';try{localStorage.removeItem(`councillion.draft.${before.id}.${questionId}`);}catch(_){}
    const last=S.game.lastAnswer||S.game.history?.at(-1);
    S.animationFrom=Number(before.runScore||0);S.animationGoldBefore=!!before.hasCouncillion;S.animating=true;
    try{
      app.querySelector?.('.game-topbar')?.setAttribute('inert','');
      await window.CouncilArcade?.dismissQuestion?.();
      render();
      if(last?.points>0)await window.CouncilArcade?.descend({fromScore:S.animationFrom,toScore:Number(S.game.runScore||0),tier:last.tier,gold:last.points===100,explanation:last.explanation,canonical:last.canonical});
      else await window.CouncilArcade?.miss();
    }finally{S.animating=false;}
    // The seventh reveal remains visible until the player chooses results.
  }
  function updateTimer() {
    if(S.screen!=='game'||!S.game?.question||!S.game.deadline)return;
    const left=Math.max(0,Number(S.game.deadline)-(Date.now()+S.clockOffset));
    const value=document.getElementById('timer-value');
    if(value){value.textContent=String(Math.ceil(left/1000)).padStart(2,'0');value.parentElement.classList.toggle('urgent',left<=5000);}
    const fill=document.getElementById('timer-fill');if(fill)fill.style.width=`${Math.min(100,left/25000*100)}%`;
    if(left<=0&&!S.busy&&!S.timerRequest){S.timerRequest=true;run(async()=>{await lockAnswer('');}).then(()=>{if(S.error)S.timerRequest=false;});}
  }
  function beep(gold=false) {
    if(!S.sound)return;
    try{const context=new(window.AudioContext||window.webkitAudioContext)();const notes=gold?[523,659,784,1047]:[392,523];notes.forEach((freq,i)=>{const oscillator=context.createOscillator(),gain=context.createGain();oscillator.type='square';oscillator.frequency.value=freq;gain.gain.setValueAtTime(.035,context.currentTime+i*.11);gain.gain.exponentialRampToValueAtTime(.001,context.currentTime+i*.11+.16);oscillator.connect(gain);gain.connect(context.destination);oscillator.start(context.currentTime+i*.11);oscillator.stop(context.currentTime+i*.11+.17);});setTimeout(()=>context.close(),1000);}catch(_){}
  }
  function celebrate() {
    if(window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
    const confetti=document.createElement('div');confetti.className='confetti';confetti.setAttribute('aria-hidden','true');confetti.innerHTML=Array.from({length:32},(_,i)=>`<i style="--x:${(i*37)%100}%;--delay:${(i%7)*.07}s;--rotation:${i*29}deg"></i>`).join('');document.body.append(confetti);setTimeout(()=>confetti.remove(),2600);
  }
  async function savePack(published) {
    syncEditor();const pack=JSON.parse(JSON.stringify(S.editor));pack.published=published;
    pack.questions.forEach(q=>{q.answers=q.answers.filter(a=>a.canonical.trim());});
    if(!pack.title.trim())throw new Error('Give your pack a title before saving.');
    if(published){for(let i=0;i<7;i++){const q=pack.questions[i];if(!q?.prompt.trim())throw new Error(`Question ${i+1} needs its question text.`);if(!q.answers.length)throw new Error(`Question ${i+1} needs at least one accepted answer.`);if(q.answers.some(a=>a.tier==='councillion'&&!a.explanation?.trim()))throw new Error(`Question ${i+1}: give each Councillion answer an explanation.`);}}
    S.editor=await api.adminSave(pack);S.savedAnswerIds=new Set(S.editor.questions.flatMap(q=>q.answers.map(a=>a.id)));S.notice=published?'Pack published. The Council is ready.':'Draft saved. Keep making it yours.';await refreshPacks();
  }
  function syncEditor() {
    if(!S.editor)return;
    document.querySelectorAll('[data-pack-field]').forEach(input=>S.editor[input.dataset.packField]=input.value);
    const q=S.editor.questions[S.editorQuestion];
    document.querySelectorAll('[data-question-field]').forEach(input=>q[input.dataset.questionField]=input.value);
    document.querySelectorAll('[data-answer-field]').forEach(input=>{const answer=q.answers[Number(input.dataset.answerIndex)];if(!answer)return;answer[input.dataset.answerField]=input.dataset.answerField==='aliases'?input.value.split(',').map(x=>x.trim()).filter(Boolean):input.value;});
  }
  function downloadText(name,text,type='text/plain'){const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function importEditor(pack){S.editor=pack;S.savedAnswerIds=new Set();S.editorQuestion=0;S.screen='editor';const count=pack.questions.reduce((n,q)=>n+q.answers.length,0);S.notice=`Filled 7 questions and ${count} accepted answers. Save your draft or publish when complete.`;}
  async function exportPack(id) {
    const pack=await api.adminGet(id);const blob=new Blob([JSON.stringify(pack,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`${pack.title.toLowerCase().replace(/[^a-z0-9]+/g,'-')||'councillion-pack'}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  document.addEventListener('click',event=>{
    const button=event.target.closest('[data-action]');if(!button)return;
    const action=button.dataset.action,id=button.dataset.id;
    window.CouncilArcade?.setSound(S.sound);window.CouncilArcade?.unlockAudio();
    if(action==='gobble'){window.CouncilArcade?.gobble();return;}
    if(action==='dismiss-suggestion'){S.suggestion=null;if(!patchQuestionFeedback())render();document.getElementById('answer')?.focus({preventScroll:true});return;}
    if(action==='dialog-backdrop'&&event.target!==button)return;
    if(S.animating&&action!=='gobble')return;
    if(action==='sound'){S.sound=!S.sound;writeStore('councillion.sound',S.sound?'on':'off');window.CouncilArcade?.setSound(S.sound);if(!S.animating)render();return;}
    if(action==='close-dialog'||action==='dialog-backdrop'){closeDialog();return;}
    if(action==='username'){openDialog('username');return;}
    if(action==='settings'){openDialog('settings');return;}
    if(action==='bulk-pack'){openDialog('bulk-pack');return;}
    if(action==='bulk-answers'){syncEditor();openDialog('bulk-answers');return;}
    if(action==='download-text-template'){downloadText('Councillion-pack-template.txt',window.CouncilBulk.textTemplate());return;}
    if(action==='download-template'){downloadText('Councillion-pack-template.csv',window.CouncilBulk.template(),'text/csv');return;}
    if(action==='review-filter'){S.reviewFilter=id==='all'?'all':'unrecognized';render();return;}
    if(action==='new-pack'){S.savedAnswerIds=new Set();S.editor=blankPack();S.editorQuestion=0;S.screen='editor';render();return;}
    if(action==='edit-question'){syncEditor();S.editorQuestion=Number(button.dataset.index);render();return;}
    if(action==='add-answer'){syncEditor();S.editor.questions[S.editorQuestion].answers.push({id:newId(),canonical:'',tier:'dino',aliases:[],explanation:''});render();return;}
    if(action==='remove-answer'){syncEditor();S.editor.questions[S.editorQuestion].answers.splice(Number(button.dataset.index),1);render();return;}
    run(async()=>{
      if(['home','packs','leaderboard','how','admin'].includes(action)){await navigate(action);return;}
      if(action==='confirm-suggestion'){if(S.suggestion)await lockAnswer(S.suggestion.raw,true);return;}
      if(action==='play'){await play(id);return;}
      if(action==='replay'){await replay(id);return;}
      if(action==='resume-practice'){await resumePractice(id);return;}
      if(action==='official-results'){await showResults(id);return;}
      if(action==='finish-results'){await showResults(S.game.id);return;}
      if(action==='next-question'){S.invalid='';S.suggestion=null;await window.CouncilArcade?.prepareNext?.();S.game=await api.startQuestion(S.game.id);syncClock();S.timerRequest=false;return;}
      if(action==='pack-board'||action==='board-select'){S.boardPack=id||'';await navigate('leaderboard');return;}
      if(action==='refresh-results'){await showResults(S.results?.attemptId||S.game?.id||readStore('councillion.lastAttempt',''));return;}
      if(action==='share-results'){const text=`${S.results.username||S.profile?.username} · ${S.results.title}\n${S.results.total}/700 on COUNCILLION${S.results.isOfficial===false?' (REPLAY — not a leaderboard score)':''}\n${(S.results.questions||[]).map(q=>({councillion:'🟨',grimkyle:'🟪',donovan:'🟧',cavaughn:'🟦',kalen:'🟩',dino:'⬜'})[q.tier]||'⬛').join('')}\nTHE COUNCIL HAS SPOKEN.`;try{await navigator.clipboard.writeText(text);S.notice='Score copied. Send it to the Council.';}catch(_){window.prompt('Copy your score:',text);}return;}
      if(action==='edit-pack'){S.editor=await api.adminGet(id);S.savedAnswerIds=new Set(S.editor.questions.flatMap(q=>q.answers.map(a=>a.id)));S.editorQuestion=0;S.screen='editor';return;}
      if(action==='regrade-answer'){syncEditor();const answer=S.editor.questions[S.editorQuestion].answers[Number(button.dataset.index)];await api.adminRegradeAnswer({answerId:answer.id,tier:answer.tier,explanation:answer.explanation||''});S.notice='Rarity correction applied. Historical scores without individual overrides and the leaderboards are updated.';return;}
      if(action==='save-draft'){await savePack(false);return;}
      if(action==='refresh-admin'){await loadAdmin();return;}
      if(action==='publish-pack'||action==='private-pack'){await api.adminVisibility(id,action==='publish-pack');await loadAdmin();await refreshPacks();S.notice=action==='publish-pack'?'Pack is public. Everyone with the website link can play.':'Pack is private. Players cannot start or continue it until you publish it again.';return;}
      if(action==='delete-pack'){const pack=S.adminPacks.find(p=>p.id===id);if(!window.confirm(`Delete “${pack?.title||'this pack'}” from the website? It will stop being playable. Saved results and score history will be retained.`))return;await api.adminDelete(id);await loadAdmin();await refreshPacks();S.notice='Pack deleted from the website. Saved results and score history are retained.';return;}
      if(action==='admin-logout'){await api.adminLogout();S.profile=await api.init();await navigate('admin');return;}
      if(action==='reject-review'){await api.adminReview({submissionId:id,reject:true});await loadAdmin();S.notice='Zero points recorded. Results have been updated.';return;}
      if(action==='export-pack'){await exportPack(id);return;}
      if(action==='disconnect'){await api.disconnect();window.location.reload();return;}
    });
  });
  document.addEventListener('submit',event=>{
    const form=event.target.closest('[data-form]');if(!form)return;event.preventDefault();
    const data=new FormData(form),type=form.dataset.form;
    window.CouncilArcade?.setSound(S.sound);window.CouncilArcade?.unlockAudio();
    const inlineImport=['bulk-pack','bulk-answers'].includes(type);
    run(async()=>{
      if(type==='username'){S.profile=await api.enter(String(data.get('username')).trim());closeDialog();const next=S.afterName;S.afterName=null;if(next)await next();return;}
      if(type==='answer'){await lockAnswer(String(data.get('answer')||'').trim());return;}
      if(type==='admin-login'){S.profile=await api.adminLogin(String(data.get('email')),String(data.get('password')));if(!isAdmin())throw new Error('This account is not an authorized Game Master. Ask the project owner to grant access.');await loadAdmin();return;}
      if(type==='pack-editor'){await savePack(true);return;}
      if(type==='review'){await api.adminReview({submissionId:form.dataset.id,answerId:String(data.get('answerId')||'')||null,reject:false,newAnswer:data.get('answerId')?undefined:{canonical:String(data.get('canonical')),tier:String(data.get('tier')),aliases:[],explanation:String(data.get('explanation')||'')},applyToMatching:true,overridePoints:data.get('overridePoints')===''?null:Number(data.get('overridePoints')),note:String(data.get('note')||'')});await loadAdmin();S.notice='Optional correction saved. Affected results and standings are updated.';return;}
      if(type==='bulk-pack'){importEditor(window.CouncilBulk.parsePack(String(data.get('text')||''),{title:String(data.get('title')||'Imported pack')}));closeDialog();return;}
      if(type==='bulk-answers'){const added=window.CouncilBulk.parseAnswers(String(data.get('text')||''),{defaultTier:String(data.get('tier')||'dino')});const q=S.editor.questions[S.editorQuestion];q.answers=window.CouncilBulk.mergeAnswers(q.answers.filter(a=>a.canonical.trim()),added);closeDialog();S.notice=`Added ${added.length} answers. Assign ranks and save when ready.`;return;}
      if(type==='settings'){await api.configure({url:String(data.get('url')).trim().replace(/\/$/,''),key:String(data.get('key')).trim()});window.location.reload();return;}
    },{rerender:!inlineImport,keepDialog:inlineImport});
  });
  document.addEventListener('input',event=>{
    const input=event.target;
    if(input.id==='answer-search'){S.search=input.value;filterAnswers(S.search);return;}
    if(input.id==='answer'&&S.game?.question){
      writeStore(`councillion.draft.${S.game.id}.${S.game.question.id}`,input.value);
      if(S.suggestion && input.value.trim()!==S.suggestion.raw){S.suggestion=null;document.querySelector('.answer-suggestion')?.remove();const feedback=document.querySelector('.burrow-feedback');if(feedback)feedback.textContent='Think past your first answer.';}
    }
    if(input.hasAttribute('data-pack-field')||input.hasAttribute('data-question-field')||input.hasAttribute('data-answer-field'))syncEditor();
  });
  document.addEventListener('change',event=>{
    const input=event.target;
    if(input.dataset.answerField==='tier'){syncEditor();render();}
    if(input.id==='import-pack'&&input.files[0])run(async()=>{
      const file=input.files[0];if(file.size>1000000)throw new Error('Choose a pack file under 1 MB.');
      const format=/\.csv$/i.test(file.name)?'csv':/\.tsv$/i.test(file.name)?'tsv':'auto';
      importEditor(window.CouncilBulk.parsePack(await file.text(),{title:file.name.replace(/\.(json|csv|tsv|txt)$/i,''),format}));
    });
  });
  document.addEventListener('keydown',event=>{
    if(!S.dialog)return;
    if(event.key==='Escape'){closeDialog();return;}
    if(event.key==='Tab'){const focusables=[...dialogRoot.querySelectorAll('button,input,textarea,select,a[href]')].filter(el=>!el.disabled);const first=focusables[0],last=focusables.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
  });
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)updateTimer();});
  setInterval(updateTimer,100);
  async function boot() {
    const recoveryHash=window.location?.hash?new URLSearchParams(window.location.hash.replace(/^#/,'')):null;
    if(recoveryHash?.get('type')==='recovery'||recoveryHash?.has('error_description')){
      window.location.replace(new URL('reset-password.html'+window.location.hash,window.location.href).href);return;
    }
    if(!api){S.error='The game service did not load. Open the complete website folder, or use the standalone Councillion.html file.';render();return;}
    try { S.profile=await api.init();await refreshPacks();if(window.CouncilStorageUnavailable)S.error='Browser storage is blocked. This session cannot preserve progress or packs when you close it. Allow site storage before creating a pack or playing.';if(window.CouncilConfigurationError)S.error='Connection configuration: '+window.CouncilConfigurationError; }
    catch(err) { S.error=err.message||'Could not connect. Check your settings and try again.'; }
    render();
  }
  boot();
})();
