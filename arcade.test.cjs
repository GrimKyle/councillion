'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
function environment({reduced=false,extras={}}={}){
 const events=[],queue=new Map(),timeouts=new Map();let id=0;
 const context={console,Math,Number,String,Array,Set,Promise,setTimeout:(f)=>{timeouts.set(++id,f);return id;},clearTimeout:n=>timeouts.delete(n),requestAnimationFrame:f=>{queue.set(++id,f);return id;},cancelAnimationFrame:n=>queue.delete(n),matchMedia:()=>({matches:reduced}),...extras};
 context.window=context;vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../arcade.js'),'utf8'),context);
 function classes(){const s=new Set();return{add:(...xs)=>xs.forEach(x=>s.add(x)),remove:(...xs)=>xs.forEach(x=>s.delete(x)),contains:x=>s.has(x),values:s};}
 const rails=Array.from(context.CouncilArcade.ranks,r=>({dataset:{rank:r.id,points:r.points},classList:classes()}));
 const bubble={textContent:''},avatar={classList:classes()},style={setProperty:(k,v)=>events.push([k,v])};
 const stage={dataset:{score:'0'},isConnected:true,clientHeight:700,classList:classes(),style,querySelector:s=>s==='.arcade-avatar'?avatar:s==='.gobble-bubble'?bubble:s==='[data-arcade-depth]'?{textContent:''}:s==='.burrow-rank-rail.is-winning'?rails.find(r=>r.classList.contains('is-winning')):s.startsWith('.burrow-rank-rail[data-rank=')?rails.find(r=>s.includes(r.dataset.rank)):null,querySelectorAll:s=>s==='.burrow-rank-rail'?rails:[],closest:()=>null};
 return {api:context.CouncilArcade,stage,rails,avatar,bubble,events,queue,timeouts,advance(time){const frames=[...queue.values()];queue.clear();frames.forEach(f=>f(time));}};
}
test('scene contains original forest, depth terrain, six rank rails and persistent gold state',()=>{
 const {api}=environment();const markup=api.scene({turkeySVG:'<svg data-test-turkey></svg>',score:100,gold:true,phase:'reveal',tier:'councillion'});
 for(const needle of ['burrow-forest','council-hut','soil-abyss','burrow-crystal','turkey-footsteps','gold-sparkles','is-gold','is-winning','1,000m'])assert.ok(markup.includes(needle),needle);
 assert.equal((markup.match(/class="burrow-rank-rail/g)||[]).length,6);
 assert.ok(!markup.includes('http'));
});
test('descent moves camera, passes ranks, settles and transforms turkey to gold',async()=>{
 const env=environment();env.api.mount({querySelector:()=>env.stage});
 const done=env.api.descend({fromScore:0,toScore:100,tier:'councillion',gold:true});
 env.advance(0);env.advance(1900);env.advance(3000);await done;
 assert.equal(env.stage.dataset.score,'100');assert.ok(env.stage.classList.contains('is-gold'));assert.ok(env.avatar.classList.contains('is-gold'));
 assert.ok(env.rails.every(r=>r.classList.contains('is-passed')));assert.ok(env.events.some(([k,v])=>k==='--camera-y'&&Math.abs(parseFloat(v)-440)<.01));
 env.api.destroy();
});
test('reduced-motion descent resolves immediately while retaining final score and gold',async()=>{
 const env=environment({reduced:true});env.api.mount({querySelector:()=>env.stage});
 await env.api.descend({fromScore:85,toScore:185,tier:'councillion',gold:true});
 assert.equal(env.queue.size,0);assert.equal(env.stage.dataset.score,'185');assert.ok(env.stage.classList.contains('is-gold'));env.api.destroy();
});
test('destroy cancels an in-flight descent and resolves its promise safely',async()=>{
 const env=environment();env.api.mount({querySelector:()=>env.stage});const done=env.api.descend({fromScore:0,toScore:85,tier:'grimkyle'});
 env.api.destroy();await done;assert.equal(env.queue.size,0);assert.equal(env.timeouts.size,0);
 await env.api.descend({fromScore:0,toScore:100,gold:true});
});

test('bird visibly travels downward to the gold rail while the rank ruler stays in screen space',async()=>{
 const env=environment();env.api.mount({querySelector:()=>env.stage});const done=env.api.descend({fromScore:100,toScore:200,tier:'councillion',gold:true});
 env.advance(0);env.advance(700);const middle=env.events.filter(([k])=>k==='--avatar-y').at(-1)[1];assert.ok(parseFloat(middle)>50 && parseFloat(middle)<80);
 env.advance(3000);await done;assert.equal(env.events.filter(([k])=>k==='--avatar-y').at(-1)[1],'80%');assert.ok(env.events.some(([k,v])=>k==='--avatar-px'&&parseFloat(v)===560));
 const markup=env.api.scene({phase:'reveal',tier:'councillion',score:200});assert.ok(markup.includes('--rail-y:80%'));assert.ok(markup.includes('--avatar-y:80%'));assert.ok(markup.includes('dig-face'));env.api.destroy();
});
test('blank reaction keeps its pause until completed and cleans up on navigation',async()=>{
 const env=environment();env.api.mount({querySelector:()=>env.stage});let finished=false;const done=env.api.miss().then(()=>finished=true);await Promise.resolve();assert.equal(finished,false);assert.ok(env.stage.classList.contains('is-missed'));
 for(const [id,fn] of [...env.timeouts]){env.timeouts.delete(id);fn();}await done;assert.equal(finished,true);assert.ok(!env.stage.classList.contains('is-missed'));
 const interrupted=env.api.miss();env.api.destroy();await interrupted;assert.equal(env.timeouts.size,0);
});
test('turkey is a keyboard accessible gobble button with temporary text feedback',()=>{
 const env=environment();assert.match(env.api.scene(),/button type="button" data-action="gobble" aria-label="Make the turkey gobble"/);env.api.mount({querySelector:()=>env.stage});env.api.gobble();assert.equal(env.bubble.textContent,'GOBBLE!');assert.ok(env.stage.classList.contains('is-gobbling'));
 for(const [id,fn] of [...env.timeouts]){env.timeouts.delete(id);fn();}assert.equal(env.bubble.textContent,'');env.api.destroy();
});

test('question hides the rank ruler and landing alone reveals the winning rank and new gold',async()=>{
 const env=environment();const question=env.api.scene({phase:'thinking',score:10,tier:'dino'});
 assert.match(question,/class="arcade-scene is-question"/);assert.match(question,/burrow-rails" aria-hidden="true"/);assert.ok(!question.includes('is-winning'));
 const locked=env.api.scene({phase:'descending',score:10,tier:'councillion'});assert.ok(!locked.includes('is-winning'));assert.ok(!locked.includes('gold-burst'));
 env.api.mount({querySelector:()=>env.stage});const done=env.api.descend({fromScore:10,toScore:110,tier:'councillion',gold:true});
 env.advance(0);env.advance(200);assert.equal(env.events.filter(([k])=>k==='--avatar-y').at(-1)[1],'50%');
 env.advance(2200);assert.ok(env.rails.some(r=>r.classList.contains('is-passed')));assert.ok(env.rails.every(r=>!r.classList.contains('is-winning')));assert.ok(!env.avatar.classList.contains('is-gold'));
 env.advance(3000);await done;assert.ok(env.rails.at(-1).classList.contains('is-winning'));assert.ok(env.avatar.classList.contains('is-gold'));env.api.destroy();
});
test('next question fades the old position before entering the question with hidden ranks',async()=>{
 const env=environment();env.api.mount({querySelector:()=>env.stage});let finished=false;const done=env.api.prepareNext().then(()=>finished=true);
 await Promise.resolve();assert.equal(finished,false);assert.ok(env.stage.classList.contains('is-departing'));
 for(const [id,fn] of [...env.timeouts]){env.timeouts.delete(id);fn();}await done;
 const next=env.api.scene({phase:'thinking',score:100,tier:'councillion',gold:true});assert.ok(next.includes('is-arriving'));assert.ok(next.includes('burrow-rails" aria-hidden="true"'));assert.ok(!next.includes('is-winning'));assert.ok(!env.api.scene({phase:'thinking'}).includes('is-arriving'));env.api.destroy();
});

test('question dismisses before flight and waits for the keyboard viewport to settle',async()=>{
 let blurred=false;const viewport={height:320};const env=environment({extras:{visualViewport:viewport,document:{activeElement:{blur(){blurred=true;}}}}});env.api.mount({querySelector:()=>env.stage});let finished=false;const done=env.api.dismissQuestion().then(()=>finished=true);
 assert.equal(blurred,true);assert.ok(env.stage.classList.contains('is-clearing'));await Promise.resolve();assert.equal(finished,false);
 viewport.height=650;for(const [id,fn] of [...env.timeouts]){env.timeouts.delete(id);fn();}await Promise.resolve();assert.equal(finished,false);
 for(const [id,fn] of [...env.timeouts]){env.timeouts.delete(id);fn();}await done;assert.equal(finished,true);env.api.destroy();
});
test('viewport resize keeps current bird position and tunnel geometry aligned during a descent',async()=>{
 const env=environment();env.api.mount({querySelector:()=>env.stage});const done=env.api.descend({fromScore:0,toScore:100,tier:'councillion',gold:true});env.advance(0);env.advance(1500);const y=Number(env.stage.dataset.avatarY);
 env.stage.clientHeight=400;env.api.resize();assert.equal(Number(env.stage.dataset.avatarY),y);assert.equal(parseFloat(env.events.filter(([k])=>k==='--avatar-px').at(-1)[1]),Number((y*4).toFixed(2)));assert.equal(env.events.filter(([k])=>k==='--surface-y').at(-1)[1],'200px');env.advance(3000);await done;env.api.destroy();
});
function audioFixture(state='running'){
 const buffers=[],gains=[];let starts=0,resumes=0,speeches=0,instance;
 class AudioContext {
  constructor(){instance=this;this.sampleRate=44100;this.currentTime=0;this.state=state;this.destination={};}
  createGain(){const value={gain:{value:0,setValueAtTime(v){this.value=v;}},connect(){}};gains.push(value);return value;}
  createBuffer(channels,length,rate){const data=new Float32Array(length),buffer={length,sampleRate:rate,getChannelData(){return data;}};buffers.push(buffer);return buffer;}
  createBufferSource(){return {connect(){},start(){starts++;}};}
  createBiquadFilter(){return {type:'',frequency:{value:0},Q:{value:0},connect(){}};}
  async resume(){resumes++;this.state='running';}
 }
 return {AudioContext,buffers,gains,get instance(){return instance;},get starts(){return starts;},get resumes(){return resumes;},get speeches(){return speeches;},speechSynthesis:{speak(){speeches++;}},SpeechSynthesisUtterance:class{}};
}
test('gobble is two quiet locally synthesized bird calls, never speech, and rapid taps do not stack',()=>{
 const audio=audioFixture(),env=environment({extras:{AudioContext:audio.AudioContext,speechSynthesis:audio.speechSynthesis,SpeechSynthesisUtterance:audio.SpeechSynthesisUtterance}});env.api.mount({querySelector:()=>env.stage});env.api.setSound(true);env.api.gobble();assert.equal(audio.starts,1);assert.equal(audio.speeches,0);
 const buffer=audio.buffers[0],samples=buffer.getChannelData(0),rate=buffer.sampleRate;assert.equal(buffer.length,Math.ceil(.78*rate));
 const energy=(a,b)=>samples.slice(Math.floor(a*rate),Math.floor(b*rate)).reduce((n,x)=>n+x*x,0);assert.ok(energy(.01,.3)>1);assert.equal(energy(.32,.38),0);assert.ok(energy(.40,.68)>1);
 const gain=audio.gains.at(-1).gain.value;assert.ok(gain<=.035);assert.ok(samples.every(x=>Math.abs(x*gain)<.04));
 env.api.gobble();assert.equal(audio.starts,1);audio.instance.currentTime=.8;env.api.gobble();assert.equal(audio.starts,2);assert.equal(audio.buffers.length,1);
 env.api.setSound(false);assert.equal(audio.gains[0].gain.value,0);audio.instance.currentTime=2;env.api.gobble();assert.equal(audio.starts,2);env.api.destroy();
});
test('first gobble resumes suspended mobile audio before playing',async()=>{
 const audio=audioFixture('suspended'),env=environment({extras:{AudioContext:audio.AudioContext}});env.api.mount({querySelector:()=>env.stage});env.api.setSound(true);env.api.gobble();await Promise.resolve();await Promise.resolve();assert.equal(audio.resumes,1);assert.equal(audio.starts,1);env.api.destroy();
});
