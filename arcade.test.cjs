'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
function environment({reduced=false}={}){
 const events=[],queue=new Map(),timeouts=new Map();let id=0;
 const context={console,Math,Number,String,Array,Set,Promise,setTimeout:(f)=>{timeouts.set(++id,f);return id;},clearTimeout:n=>timeouts.delete(n),requestAnimationFrame:f=>{queue.set(++id,f);return id;},cancelAnimationFrame:n=>queue.delete(n),matchMedia:()=>({matches:reduced})};
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
 env.advance(0);env.advance(1900);env.advance(2400);await done;
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
 env.advance(2400);await done;assert.equal(env.events.filter(([k])=>k==='--avatar-y').at(-1)[1],'80%');assert.ok(env.events.some(([k,v])=>k==='--avatar-px'&&parseFloat(v)===560));
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
