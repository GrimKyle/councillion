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
  function avatarPosition(points) {
    const stops=[{points:0,y:50},...ranks.map((r,i)=>({points:r.points,y:55+i*5}))];
    const value=clamp(points,0,100);
    for(let i=1;i<stops.length;i++){const a=stops[i-1],b=stops[i];if(value<=b.points)return a.y+(b.y-a.y)*(value-a.points)/(b.points-a.points);}
    return 80;
  }
  function placeAvatar(stage, points) { placeAvatarY(stage,avatarPosition(points)); }
  function placeAvatarY(stage, y) {
    stage.dataset.avatarY=String(y);
    stage.style.setProperty('--avatar-y',y+'%');
    stage.style.setProperty('--avatar-px',(y/100*(stage.clientHeight||700)).toFixed(2)+'px');
  }
  function scene(opts={}) {
    const score=clamp(opts.score,0,700), gold=!!opts.gold;
    const phase=['thinking','descending','reveal'].includes(opts.phase)?opts.phase:'thinking';
    const entrance=arriving&&phase==='thinking';arriving=false;
    const stars=Array.from({length:50},(_,i)=>`<i class="burrow-star" style="left:${randomish(i,73,100)}%;top:${randomish(i,41,85)}%;--twinkle:${1+i%5}s"></i>`).join('');
    const trees=Array.from({length:19},(_,i)=>`<i class="burrow-tree" style="left:${i*6-4}%;--tree-h:${90+randomish(i,53,120)}px;--tree-w:${40+randomish(i,19,34)}px"></i>`).join('');
    const roots=Array.from({length:25},(_,i)=>`<i class="burrow-root" style="left:${randomish(i,47,100)}%;top:${18+randomish(i,17,420)}px;--root-turn:${i%2?'-':''}${14+i%5*7}deg;--root-h:${55+randomish(i,29,150)}px"></i>`).join('');
    const gems=Array.from({length:48},(_,i)=>`<i class="burrow-crystal crystal-${i%3}" style="left:${randomish(i,37,96)+2}%;top:${660+randomish(i,71,2200)}px;--gem-size:${10+i%4*4}px;--gem-delay:${i%7*.4}s"></i>`).join('');
    const dust=Array.from({length:26},(_,i)=>`<i style="--dust-x:${(i%2?-1:1)*(18+i%7*14)}px;--dust-y:${-12-i%6*10}px;--dust-delay:${i%8*.075}s;--dust-color:${['#e9b36f','#b78154','#82708f','#e9d4a8'][i%4]}"></i>`).join('');
    const earned=ranks.find(r=>r.id===opts.tier)?.points||0;
    const rails=ranks.map((r,i)=>`<div class="burrow-rank-rail${opts.phase==='reveal'&&earned>=r.points?' is-passed':''}${opts.phase==='reveal'&&r.id===opts.tier?' is-winning':''}" data-rank="${r.id}" data-points="${r.points}" style="--rank-color:${r.color};--rail-y:${55+i*5}%"><span class="rail-symbol">${i===5?'♛':'◆'}</span><span class="rail-rule"></span><span class="rail-label">${r.name} <b>+${r.points}</b></span></div>`).join('');
    return `<div class="arcade-scene${gold?' is-gold':''}${phase==='thinking'?' is-question':''}${entrance?' is-arriving':''}${phase==='reveal'?' is-settled':''}${phase==='reveal'&&earned===100?' gold-burst':''}" data-phase="${phase}" data-score="${score}" style="--avatar-y:${avatarPosition(opts.phase==='reveal'?earned:0)}%;--camera-y:${score*4.4}px;--depth-shade:${Math.min(.72,score/1100)}"><div class="burrow-sky">${stars}<div class="burrow-moon"></div></div><div class="burrow-world"><div class="burrow-forest far-forest">${trees}</div><div class="burrow-forest near-forest">${trees}</div><div class="council-hut"><i class="hut-roof"></i><i class="hut-body"></i><i class="hut-window"></i><i class="hut-door"></i><span>THE COUNCIL</span></div><div class="burrow-ground"><div class="ground-grass"></div><div class="soil-layer soil-loam">${roots}</div><div class="soil-layer soil-shale"></div><div class="soil-layer soil-amethyst"></div><div class="soil-layer soil-abyss"></div>${gems}<div class="burrow-tunnel"></div><div class="ancient-tablet tablet-one">THE OBVIOUS<br>STAYS ABOVE.</div><div class="ancient-tablet tablet-two">ONLY THE<br>COUNCIL KNOWS.</div></div></div><div class="burrow-depth-haze"></div><div class="burrow-rails" aria-hidden="${phase==='thinking'}">${rails}</div><button type="button" data-action="gobble" aria-label="Make the turkey gobble" class="arcade-avatar${gold?' is-gold':''}"><span class="gobble-bubble" aria-live="polite"></span><span class="dig-face" aria-hidden="true"></span><div class="turkey-aura"></div><div class="turkey-motion">${opts.turkeySVG||''}</div><div class="turkey-footsteps"><i></i><i></i></div><div class="turkey-dust">${dust}</div><div class="gold-sparkles">${Array.from({length:12},(_,i)=>`<i style="--spark-x:${Math.cos(i*Math.PI/6)*105}px;--spark-y:${Math.sin(i*Math.PI/6)*85}px;--spark-delay:${i*.035}s"></i>`).join('')}</div></button><div class="burrow-impact"></div><div class="burrow-side-scale">${Array.from({length:9},(_,i)=>`<span>${Math.round((score*10+i*100)/100)*100}m</span>`).join('')}</div><div class="burrow-coordinates"><span>COUNCIL EXPEDITION</span><span data-arcade-depth>${Math.round(score*10).toLocaleString()}m BELOW THE ORDINARY</span></div><div class="burrow-vignette"></div></div>`;
  }
  function mount(element) {
    const target=element?.matches?.('.arcade-scene')?element:element?.querySelector?.('.arcade-scene');
    if (target!==mounted) { stopAnimation(); mounted=target||null; }
    if (!mounted) return;
    resize();
    mounted.style?.setProperty('--camera-y',(Number(mounted.dataset.score)||0)*4.4+'px');
    const winning=mounted.querySelector('.burrow-rank-rail.is-winning');
    placeAvatar(mounted,winning?Number(winning.dataset.points):0);
  }
  function resize(){
    if(!mounted)return;
    const h=mounted.clientHeight||700;
    mounted.style.setProperty('--surface-y',Math.round(h*.5)+'px');
    placeAvatarY(mounted,Number(mounted.dataset.avatarY)||50);
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
  function unlockAudio() { try{const c=ensureAudio();if(c?.state==='suspended')c.resume().catch(()=>{});}catch(_){} }
  function tone(frequency, start, duration, type='square', volume=.035, slide) {
    if(!enabled)return;
    try{const c=ensureAudio();if(!c||c.state!=='running')return;const o=c.createOscillator(),g=c.createGain();
      o.type=type;o.frequency.setValueAtTime(frequency,c.currentTime+start);
      if(slide)o.frequency.exponentialRampToValueAtTime(Math.max(20,slide),c.currentTime+start+duration);
      g.gain.setValueAtTime(.0001,c.currentTime+start);g.gain.exponentialRampToValueAtTime(volume,c.currentTime+start+.012);g.gain.exponentialRampToValueAtTime(.0001,c.currentTime+start+duration);
      o.connect(g);g.connect(master||c.destination);o.start(c.currentTime+start);o.stop(c.currentTime+start+duration+.025);
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
    if(kind==='tier'){tone(rank.note,0,.15,'square',.03);tone(rank.note*1.5,.065,.22,'triangle',.055);return;}
    if(kind==='gold'){[523.25,659.25,783.99,1046.5,1318.51,1567.98].forEach((n,i)=>tone(n,i*.085,.24,'square',.025));[523.25,659.25,783.99].forEach(n=>tone(n,.55,.55,'triangle',.035));tone(2093,.82,.32,'sine',.025);return;}
    tone(rank.note,0,.12,'square',.026);tone(rank.note*1.25,.075,.18,'triangle',.04);
  }
  function setSound(value){enabled=!!value;try{if(master)master.gain.setValueAtTime(enabled?1:0,audio.currentTime);}catch(_){}}
  function descend(opts={}) {
    stopAnimation();
    const stage=mounted;
    if(!stage)return Promise.resolve();
    const from=clamp(opts.fromScore,0,700),to=clamp(opts.toScore,from,700),gain=to-from;
    const duration=reduced()?30:(opts.gold?2350:1850),leadIn=reduced()?0:240;
    const targetY=avatarPosition(gain);
    stage.classList.add('is-descending');stage.classList.remove('is-question','is-settled');
    stage.querySelector('.burrow-rails')?.setAttribute?.('aria-hidden','false');
    placeAvatar(stage,0);
    stage.dataset.score=String(from);stage.style.setProperty('--camera-y',from*4.4+'px');
    const avatar=stage.querySelector('.arcade-avatar');
    const railNodes=[...stage.querySelectorAll('.burrow-rank-rail')];
    railNodes.forEach(n=>n.classList.remove('is-passed','is-winning'));
    if(gain>0)sound('descent');else sound('timeout');
    return new Promise(resolve=>{
      pending=resolve;let started=null,finished=false;const crossed=new Set();
      function finish(){
        if(finished)return;finished=true;
        if(raf!=null){root.cancelAnimationFrame?.(raf);raf=null;}
        if(stage===mounted){railNodes.filter(n=>Number(n.dataset.points)<=gain).forEach(n=>n.classList.add('is-passed'));stage.style.setProperty('--depth-shade',String(Math.min(.72,to/1100)));placeAvatar(stage,gain);stage.querySelector('.burrow-rank-rail[data-rank="'+opts.tier+'"]')?.classList.add('is-winning');stage.dataset.score=String(to);stage.style.setProperty('--camera-y',to*4.4+'px');stage.classList.remove('is-descending');stage.classList.add('is-settled');if(opts.gold){stage.classList.add('gold-burst','is-gold');avatar?.classList.add('is-gold');sound('gold');later(()=>stage.classList.remove('gold-burst'),1500);}}
        if(pending===resolve)pending=null;resolve();
      }
      function frame(now){
        if(finished)return;
        if(stage!==mounted||stage.isConnected===false){finish();return;}
        if(started===null)started=now;
        const progress=clamp((now-started-leadIn)/duration,0,1);
        const ease=progress*progress*progress*(progress*(progress*6-15)+10);
        const avatarY=50+(targetY-50)*ease;
        const current=from+gain*ease;
        placeAvatarY(stage,avatarY);
        stage.style.setProperty('--camera-y',(current*4.4).toFixed(2)+'px');
        stage.style.setProperty('--depth-shade',Math.min(.72,current/1100).toFixed(3));
        stage.style.setProperty('--burrow-progress',String(progress));
        const ticks=[...stage.querySelectorAll('.burrow-side-scale span')];ticks.forEach((tick,i)=>{tick.textContent=(Math.floor(current*10/100)*100+i*100)+'m';});
        const depth=stage.querySelector('[data-arcade-depth]');if(depth)depth.textContent=Math.round(current*10).toLocaleString()+'m BELOW THE ORDINARY';
        const shell=stage.closest?.('.arcade-shell');
        const hudDepth=shell?.querySelector?.('#burrow-depth'),hudScore=shell?.querySelector?.('#burrow-score');
        if(hudDepth)hudDepth.innerHTML=Math.round(current*10).toLocaleString()+'<small>m</small>';
        if(hudScore)hudScore.textContent=String(Math.round(current));
        for(const [i,r] of ranks.entries()){
          if(gain>=r.points&&avatarY>=55+i*5-.001&&!crossed.has(r.id)){
            crossed.add(r.id);railNodes.find(n=>n.dataset.rank===r.id)?.classList.add('is-passed');sound('tier',r.id);
          }
        }
        if(progress<1)raf=root.requestAnimationFrame(frame);else finish();
      }
      if(reduced()||!root.requestAnimationFrame){railNodes.filter(n=>Number(n.dataset.points)<=gain).forEach(n=>n.classList.add('is-passed'));finish();}
      else raf=root.requestAnimationFrame(frame);
      // Fallback also resolves when a background tab throttles animation frames.
      later(finish,leadIn+duration+450);
    });
  }
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
  function prepareNext(){
    stopAnimation();arriving=true;
    const stage=mounted;if(!stage||reduced())return Promise.resolve();
    stage.classList.add('is-departing');
    return new Promise(resolve=>{pending=resolve;later(()=>{if(pending===resolve)pending=null;resolve();},220);});
  }
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
  const api={scene,mount,resize,descend,dismissQuestion,prepareNext,miss,gobble,sound,unlockAudio,setSound,destroy,ranks};
  root.CouncilArcade=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
