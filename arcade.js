/* Original Councillion burrow scene and synthesized arcade audio. No assets or network. */
(function (root) {
  'use strict';
  const ranks = [
    { id:'dino', name:'DINO', points:10, color:'#b6bfce', note:261.63 },
    { id:'kalen', name:'KALEN', points:15, color:'#91e6a7', note:329.63 },
    { id:'cavaughn', name:'CAVAUGHN', points:30, color:'#6adaff', note:392 },
    { id:'donovan', name:'DONOVAN', points:60, color:'#ffab75', note:523.25 },
    { id:'grimkyle', name:'GRIMKYLE', points:85, color:'#c5a0ff', note:659.25 },
    { id:'councillion', name:'ONE IN A COUNCILLION', points:100, color:'#ffe486', note:1046.5 }
  ];
  const escape = s => String(s == null ? '' : s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const clamp = (n, lo, hi) => Math.max(lo,Math.min(hi,Number(n)||0));
  const reduced = () => !!root.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  let mounted = null, enabled = false, audio = null, master = null, gobbleBuffer = null, lastGobbleAt = -Infinity, pending = null, raf = null, arriving = false;
  const timeouts = new Set();
  function later(fn, ms) { let id;id=root.setTimeout(()=>{timeouts.delete(id);fn();},ms);timeouts.add(id);return id; }
  function randomish(i, mult, range) { return (i*mult+17)%range; }
  const depthPixels = 4.4; // One score point is ten metres of world depth.
  const smooth = t => t*t*t*(t*(t*6-15)+10);
  function surface(stage) { return (stage.clientHeight||700)*.50; }
  function paint(stage,score,camera) {
    const height=stage.clientHeight||700,ground=height*.5,feet=ground+score*depthPixels-camera;
    stage.dataset.score=String(score);stage.dataset.camera=String(camera);
    stage.style.setProperty('--camera-y',camera.toFixed(2)+'px');
    stage.style.setProperty('--surface-y',ground.toFixed(2)+'px');
    stage.style.setProperty('--avatar-y',(feet/height*100).toFixed(3)+'%');
    stage.style.setProperty('--avatar-px',feet.toFixed(2)+'px');
    stage.dataset.avatarY=String(feet/height*100);
    stage.style.setProperty('--tunnel-depth',(Math.max(0,score)*depthPixels+22).toFixed(2)+'px');
    stage.style.setProperty('--depth-shade',String(Math.min(.7,score/1100)));
    stage.style.setProperty('--rank-base',(ground+(Number(stage.dataset.baseScore)||0)*depthPixels).toFixed(2)+'px');
  }
  function phase(stage,value) {
    stage.dataset.phase=value;
    for(const [name,active] of Object.entries({'is-question':value==='thinking','is-descending':value==='descending','is-settled':value==='reveal','is-ascending':value==='ascending','at-surface':value==='surface'}))
      stage.classList.toggle(name,active);
    stage.querySelector('.burrow-rails')?.setAttribute?.('aria-hidden',String(!['descending','reveal'].includes(value)));
  }
  function scene(opts={}) {
    const score=clamp(opts.score,0,700), gold=!!opts.gold;
    const phase=['thinking','descending','reveal','ascending','surface'].includes(opts.phase)?opts.phase:'thinking';
    const entrance=arriving&&phase==='thinking';arriving=false;
    const stars=Array.from({length:50},(_,i)=>`<i class="burrow-star" style="left:${randomish(i,73,100)}%;top:${randomish(i,41,85)}%;--twinkle:${1+i%5}s"></i>`).join('');
    const trees=Array.from({length:19},(_,i)=>`<i class="burrow-tree" style="left:${i*6-4}%;--tree-h:${90+randomish(i,53,120)}px;--tree-w:${40+randomish(i,19,34)}px"></i>`).join('');
    const roots=Array.from({length:25},(_,i)=>`<i class="burrow-root" style="left:${randomish(i,47,100)}%;top:${18+randomish(i,17,420)}px;--root-turn:${i%2?'-':''}${14+i%5*7}deg;--root-h:${55+randomish(i,29,150)}px"></i>`).join('');
    const gems=Array.from({length:48},(_,i)=>`<i class="burrow-crystal crystal-${i%3}" style="left:${randomish(i,37,96)+2}%;top:${660+randomish(i,71,2200)}px;--gem-size:${10+i%4*4}px;--gem-delay:${i%7*.4}s"></i>`).join('');
    const dust=Array.from({length:26},(_,i)=>`<i style="--dust-x:${(i%2?-1:1)*(18+i%7*14)}px;--dust-y:${-12-i%6*10}px;--dust-delay:${i%8*.075}s;--dust-color:${['#e9b36f','#b78154','#82708f','#e9d4a8'][i%4]}"></i>`).join('');
    const earned=ranks.find(r=>r.id===opts.tier)?.points||0;
    const rails=ranks.map((r,i)=>`<div class="burrow-rank-rail${opts.phase==='reveal'&&earned>=r.points?' is-passed':''}${opts.phase==='reveal'&&r.id===opts.tier?' is-winning':''}" data-rank="${r.id}" data-points="${r.points}" style="--rank-color:${r.color};--rank-offset:${Math.round(r.points*depthPixels)}px"><span class="rail-symbol">${i===5?'♛':'◆'}</span><span class="rail-rule"></span><span class="rail-label">${r.name} <b>+${r.points}</b></span></div>`).join('');
    return `<div class="arcade-scene${gold?' is-gold':''}${phase==='thinking'?' is-question':''}${entrance?' is-arriving':''}${phase==='reveal'?' is-settled':''}${phase==='reveal'&&earned===100?' gold-burst':''}" data-phase="${phase}" data-attempt-id="${escape(opts.attemptId||'')}" data-score="${score}" data-base-score="${Number(opts.baseScore)||0}" style="--avatar-y:50%;--camera-y:${score*4.4}px;--depth-shade:${Math.min(.72,score/1100)}"><div class="burrow-sky">${stars}<div class="burrow-moon"></div></div><div class="burrow-world"><div class="burrow-forest far-forest">${trees}</div><div class="burrow-forest near-forest">${trees}</div><div class="council-hut"><i class="hut-roof"></i><i class="hut-body"></i><i class="hut-window"></i><i class="hut-door"></i><span>THE COUNCIL</span></div><div class="burrow-ground"><div class="ground-grass"></div><div class="soil-layer soil-loam">${roots}</div><div class="soil-layer soil-shale"></div><div class="soil-layer soil-amethyst"></div><div class="soil-layer soil-abyss"></div>${gems}<div class="burrow-tunnel"></div><div class="ancient-tablet tablet-one">THE OBVIOUS<br>STAYS ABOVE.</div><div class="ancient-tablet tablet-two">ONLY THE<br>COUNCIL KNOWS.</div></div></div><div class="burrow-depth-haze"></div><div class="burrow-rails" aria-hidden="${phase==='thinking'}">${rails}</div><button type="button" data-action="gobble" aria-label="Make the turkey gobble" class="arcade-avatar${gold?' is-gold':''}"><span class="gobble-bubble" aria-live="polite"></span><span class="dig-face" aria-hidden="true"></span><div class="turkey-aura"></div><div class="turkey-motion">${opts.turkeySVG||''}</div><div class="turkey-footsteps"><i></i><i></i></div><div class="turkey-dust">${dust}</div><div class="gold-sparkles">${Array.from({length:12},(_,i)=>`<i style="--spark-x:${Math.cos(i*Math.PI/6)*105}px;--spark-y:${Math.sin(i*Math.PI/6)*85}px;--spark-delay:${i*.035}s"></i>`).join('')}</div></button><div class="burrow-answer-tag" aria-hidden="true"></div><div class="burrow-impact"></div><div class="burrow-side-scale">${Array.from({length:75},(_,i)=>`<span data-depth="${i*100}" style="top:calc(var(--surface-y) + ${i*44}px)">${(i*100).toLocaleString()}m</span>`).join('')}</div><div class="burrow-coordinates"><span>COUNCIL EXPEDITION</span><span data-arcade-depth>${Math.round(score*10).toLocaleString()}m BELOW THE ORDINARY</span></div><div class="burrow-vignette"></div></div>`;
  }
  function mount(element,opts) {
    const target=element?.matches?.('.arcade-scene')?element:element?.querySelector?.('.arcade-scene');
    const fresh=target!==mounted;
    if(fresh) { stopAnimation();mounted=target||null; }
    if(!mounted)return;
    if(opts) {
      mounted.dataset.baseScore=String(opts.baseScore||0);
      phase(mounted,opts.phase||'thinking');
      if(opts.phase==='thinking')mounted.classList.remove('is-clearing','is-departing','gold-burst');
      mounted.classList.toggle('is-gold',!!opts.gold);
      mounted.querySelector('.arcade-avatar')?.classList.toggle('is-gold',!!opts.gold);
      if(opts.phase==='thinking'||opts.phase==='surface')for(const node of mounted.querySelectorAll('.burrow-rank-rail'))node.classList.remove('is-passed','is-winning');
    }
    const score=opts?.score??(Number(mounted.dataset.score)||0);
    // Keep the final camera/feet position when the result UI is inserted.
    const camera=fresh?Math.max(0,score*depthPixels):(Number(mounted.dataset.camera)||0);
    paint(mounted,score,camera);
  }
  function resize(){
    if(!mounted)return;
    const score=Number(mounted.dataset.score)||0;
    paint(mounted,score,Number(mounted.dataset.camera)||0);
  }
  function stopAnimation() {
    if(raf!=null){root.cancelAnimationFrame?.(raf);raf=null;}
    for(const id of timeouts) root.clearTimeout(id);timeouts.clear();
    if(pending){const done=pending;pending=null;done();}
  }
  function ensureAudio() {
    if(!audio){const C=root.AudioContext||root.webkitAudioContext;if(C){audio=new C();master=audio.createGain();master.gain.value=enabled?1:0;master.connect(audio.destination);}}
    return audio;
  }
  function unlockAudio() { try{const c=ensureAudio();if(c&&c.state!=='running')c.resume().catch(()=>{});}catch(_){} }
  function tone(frequency, start, duration, type='square', volume=.035, slide) {
    if(!enabled)return;
    try{const c=ensureAudio();if(!c||c.state!=='running')return;const o=c.createOscillator(),g=c.createGain();
      o.type=type;o.frequency.setValueAtTime(frequency,c.currentTime+start);
      if(slide)o.frequency.exponentialRampToValueAtTime(Math.max(20,slide),c.currentTime+start+duration);
      g.gain.setValueAtTime(.0001,c.currentTime+start);g.gain.exponentialRampToValueAtTime(volume,c.currentTime+start+.012);g.gain.exponentialRampToValueAtTime(.0001,c.currentTime+start+duration);
      o.connect(g);g.connect(master||c.destination);o.onended=()=>{o.disconnect?.();g.disconnect?.();};o.start(c.currentTime+start);o.stop(c.currentTime+start+duration+.025);
    }catch(_){}
  }
  // Two quiet, throaty bird calls synthesized locally. No speech service or voice API.
  function gobbleSound(){
    if(!enabled)return;
    try{
      const c=ensureAudio();if(!c)return;
      if(c.state!=='running'){c.resume().then(()=>{if(enabled&&c.state==='running')gobbleSound();}).catch(()=>{});return;}
      if(c.currentTime-lastGobbleAt<.78)return;
      lastGobbleAt=c.currentTime;
      if(!gobbleBuffer){
        const sampleRate=c.sampleRate,duration=.78;
        gobbleBuffer=c.createBuffer(1,Math.ceil(sampleRate*duration),sampleRate);
        const data=gobbleBuffer.getChannelData(0);let phase=0;
        for(let i=0;i<data.length;i++){
          const t=i/sampleRate,local=t<.37?t:t-.39;
          if(local<0||local>.31){data[i]=0;continue;}
          const envelope=Math.min(1,local/.012)*Math.min(1,(.31-local)/.065);
          const trill=.18+.82*Math.pow(Math.max(0,Math.sin(2*Math.PI*19*local)),2);
          const pitch=170+105*Math.exp(-local*12)+27*Math.sin(2*Math.PI*16*local);
          phase+=2*Math.PI*pitch/sampleRate;
          const voice=Math.sin(phase)+.43*Math.sin(phase*2)+.17*Math.sin(phase*3);
          data[i]=voice*.5*envelope*trill;
        }
      }
      const source=c.createBufferSource(),filter=c.createBiquadFilter(),gain=c.createGain();
      source.buffer=gobbleBuffer;filter.type='lowpass';filter.frequency.value=1250;filter.Q.value=.6;
      gain.gain.value=.035;source.connect(filter);filter.connect(gain);gain.connect(master||c.destination);
      source.onended=()=>{source.disconnect?.();filter.disconnect?.();gain.disconnect?.();};source.start();
    }catch(_){}
  }
  function sound(kind='success',tier) {
    if(!enabled)return;
    const rank=ranks.find(r=>r.id===tier)||ranks[0];
    if(kind==='gobble'){gobbleSound();return;}
    if(kind==='suggest'){tone(392,0,.1,'sine',.04);tone(523,.09,.16,'sine',.04);return;}
    if(kind==='reject'){tone(110,0,.14,'sawtooth',.024,52);tone(74,.08,.12,'triangle',.04);return;}
    if(kind==='timeout'){[220,185,130.81].forEach((n,i)=>tone(n,i*.09,.16,'triangle',.05));return;}
    if(kind==='lock'){tone(880,0,.055,'square',.025);tone(440,.035,.08,'triangle',.04);return;}
    if(kind==='descent'){tone(130.81,0,.55,'triangle',.06,38);[196,261.63,329.63,392].forEach((n,i)=>tone(n,.07+i*.07,.13,'square',.018));return;}
    if(kind==='tier'){tone(rank.note,0,.14,'sine',.035);tone(rank.note*2,.05,.28,'sine',.026);return;}
    if(kind==='surface'){[130.81,164.81,196,261.63,329.63,392,523.25].forEach((n,i)=>tone(n,i*.12,.38,'sine',.022));return;}
    if(kind==='results'){[261.63,329.63,392,523.25].forEach((n,i)=>tone(n,i*.09,.45,'sine',.026));return;}
    if(kind==='gold'){[523.25,659.25,783.99,1046.5,1318.51,1567.98].forEach((n,i)=>tone(n,i*.085,.24,'square',.025));[523.25,659.25,783.99].forEach(n=>tone(n,.55,.55,'triangle',.035));tone(2093,.82,.32,'sine',.025);return;}
    tone(rank.note,0,.12,'square',.026);tone(rank.note*1.25,.075,.18,'triangle',.04);
  }
  function setSound(value){enabled=!!value;try{if(master)master.gain.setValueAtTime(enabled?1:0,audio.currentTime);}catch(_){}}
  function descend(opts={}) {
    stopAnimation();const stage=mounted;if(!stage)return Promise.resolve();
    const from=clamp(opts.fromScore,0,700),to=clamp(opts.toScore,from,700),gain=to-from;
    const duration=reduced()?0:1700+gain*8,leadIn=reduced()?0:320;
    const cameraFrom=Number(stage.dataset.camera)||0;
    // The bird travels first. The camera follows only once it reaches the lower half.
    const cameraTo=()=>Math.max(cameraFrom,surface(stage)+to*depthPixels-(stage.clientHeight||700)*.72);
    stage.dataset.baseScore=String(from);phase(stage,'descending');
    stage.classList.remove('is-clearing','is-departing');
    const avatar=stage.querySelector('.arcade-avatar'),tag=stage.querySelector('.burrow-answer-tag');
    if(tag)tag.textContent=opts.canonical?'“'+opts.canonical+'”':'';
    const railNodes=[...stage.querySelectorAll('.burrow-rank-rail')];
    const hud=stage.closest?.('.arcade-shell');
    const hudDepth=hud?.querySelector?.('#burrow-depth'),hudScore=hud?.querySelector?.('#burrow-score');
    const depth=stage.querySelector('[data-arcade-depth]');
    railNodes.forEach(n=>n.classList.remove('is-passed','is-winning'));paint(stage,from,cameraFrom);
    sound(gain>0?'descent':'timeout');
    return new Promise(resolve=>{
      pending=resolve;let started=null,finished=false;const crossed=new Set();
      function finish(){
        if(finished)return;finished=true;if(raf!=null){root.cancelAnimationFrame?.(raf);raf=null;}
        if(stage===mounted){
          paint(stage,to,cameraTo());phase(stage,'reveal');
          railNodes.forEach(n=>{if(Number(n.dataset.points)<=gain)n.classList.add('is-passed');if(n.dataset.rank===opts.tier)n.classList.add('is-winning');});
          if(hudScore)hudScore.textContent=String(to);
          if(opts.gold){stage.classList.add('gold-burst','is-gold');avatar?.classList.add('is-gold');sound('gold');later(()=>stage.classList.remove('gold-burst'),1400);}
        }
        if(pending===resolve)pending=null;resolve();
      }
      function frame(now){
        if(finished)return;if(stage!==mounted||stage.isConnected===false){finish();return;}
        if(started===null)started=now;
        const progress=clamp((now-started-leadIn)/duration,0,1),e=smooth(progress),current=from+gain*e;
        const camera=cameraFrom+(cameraTo()-cameraFrom)*e;
        paint(stage,current,camera);
        stage.style.setProperty('--burrow-progress',String(progress));
        if(hudDepth)hudDepth.innerHTML=Math.round(current*10).toLocaleString()+'<small>m</small>';
        // Numeric points, like the winning rank, wait for landing.
        if(depth)depth.textContent=Math.round(current*10).toLocaleString()+'m BELOW THE ORDINARY';
        for(const rank of ranks)if(current-from>=rank.points-.001&&!crossed.has(rank.id)){
          crossed.add(rank.id);const rail=railNodes.find(n=>n.dataset.rank===rank.id);
          rail?.classList.add('is-passed','is-crossing');sound('tier',rank.id);later(()=>rail?.classList.remove('is-crossing'),460);
        }
        if(progress<1)raf=root.requestAnimationFrame(frame);else finish();
      }
      if(reduced()||!root.requestAnimationFrame)finish();else raf=root.requestAnimationFrame(frame);
      if(!finished)later(finish,leadIn+duration+550);
    });
  }
  function travelCamera(targetScore,duration,returning=false){
    stopAnimation();const stage=mounted;if(!stage)return Promise.resolve();
    const score=Number(stage.dataset.score)||0,from=Number(stage.dataset.camera)||0,to=targetScore*depthPixels;
    const depth=stage.closest?.('.arcade-shell')?.querySelector?.('#burrow-depth');
    if(returning)phase(stage,'ascending');else stage.classList.add('is-departing');
    if(returning)sound('surface');
    return new Promise(resolve=>{
      pending=resolve;let started=null,finished=false;
      function finish(){if(finished)return;finished=true;if(raf!=null){root.cancelAnimationFrame?.(raf);raf=null;}
        if(stage===mounted){paint(stage,returning?0:score,to);if(returning){phase(stage,'surface');if(depth)depth.innerHTML='0<small>m</small>';}}
        if(pending===resolve)pending=null;resolve();}
      function frame(now){if(stage!==mounted||stage.isConnected===false){finish();return;}if(started===null)started=now;
        const p=clamp((now-started)/duration,0,1),e=smooth(p);
        paint(stage,returning?score*(1-e):score,from+(to-from)*e);
        if(returning&&depth)depth.innerHTML=Math.round(score*(1-e)*10).toLocaleString()+'<small>m</small>';
        if(p<1)raf=root.requestAnimationFrame(frame);else finish();}
      if(reduced()||!root.requestAnimationFrame)finish();else raf=root.requestAnimationFrame(frame);
      if(!finished)later(finish,duration+450);
    });
  }
  function returnToSurface(){return travelCamera(0,2600,true);}
  function dismissQuestion(){
    stopAnimation();const stage=mounted;if(!stage)return Promise.resolve();
    stage.classList.add('is-clearing');stage.closest?.('.playing-arcade')?.classList.add('is-clearing-ui');
    root.document?.activeElement?.blur?.();
    const viewport=root.visualViewport;let lastHeight=viewport?.height,checks=0;
    return new Promise(resolve=>{
      pending=resolve;
      function settle(){
        if(viewport&&Math.abs(viewport.height-lastHeight)>1&&checks++<5){lastHeight=viewport.height;later(settle,80);return;}
        if(pending===resolve)pending=null;resolve();
      }
      later(settle,reduced()?0:viewport?320:220);
    });
  }
  function prepareNext(){arriving=true;return travelCamera(Number(mounted?.dataset.score)||0,560);}
  function miss(){
    stopAnimation();const stage=mounted;if(!stage)return Promise.resolve();
    stage.classList.add('is-missed');sound('timeout');
    return new Promise(resolve=>{pending=resolve;later(()=>{if(stage===mounted)stage.classList.remove('is-missed');if(pending===resolve)pending=null;resolve();},reduced()?30:850);});
  }
  function gobble(){
    const stage=mounted;if(!stage)return;
    const bubble=stage.querySelector('.gobble-bubble');if(bubble)bubble.textContent='GOBBLE!';
    stage.classList.remove('is-gobbling');void stage.offsetWidth;stage.classList.add('is-gobbling');sound('gobble');
    later(()=>{if(stage===mounted){stage.classList.remove('is-gobbling');if(bubble)bubble.textContent='';}},1100);
  }
  function destroy(){stopAnimation();mounted=null;}
  const api={scene,mount,resize,descend,dismissQuestion,prepareNext,returnToSurface,miss,gobble,sound,unlockAudio,setSound,destroy,ranks};
  root.CouncilArcade=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
